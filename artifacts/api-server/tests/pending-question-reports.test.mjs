import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './helpers/worker-fixture.mjs';

function setup(t) {
  const f = fixture();
  t.after(() => f.sql.close());
  f.sql.exec(`PRAGMA foreign_keys=OFF;
    UPDATE users SET status='active' WHERE id=2;
    UPDATE users SET subject='GATE EC' WHERE id=2;
    INSERT INTO users(id,username,password_hash,full_name,email,role,status,onboarding_complete) VALUES(3,'second','test','Second Student','second@example.test','student','active',1);
    UPDATE users SET subject='GATE EC' WHERE id=3;
    INSERT INTO classes(id,title,subject,workflow_type,admin_id,status) VALUES(1,'GATE EC','GATE EC','question_bank',1,'active');
    INSERT INTO subjects(id,class_id,title) VALUES(900,1,'EDC');
    INSERT INTO chapters(id,subject_id,title) VALUES(295,900,'Synthetic chapter');
    INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,created_by) VALUES(100,1,900,295,'Synthetic question',1),(101,1,900,295,'Another question',1);
    INSERT INTO tests(id,title,created_by) VALUES(10,'Synthetic test',1);
    INSERT INTO test_questions(id,test_id,question) VALUES(20,10,'Synthetic test question');
    INSERT INTO test_submissions(test_id,student_id,answers) VALUES(10,2,'{}');`);
  return f;
}
async function post(f, path, body = { reason: 'Synthetic issue' }, userId = 2) {
  return f.request(path, body, { userId });
}
async function pending(f, path, userId = 2) {
  const res = await f.request(path, undefined, { method: 'GET', userId });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).pending;
}

test('Q Bank blocks concurrent duplicates, preserves original reason, and unlocks only after an admin response', async t => {
  const f = setup(t), path = '/api/question-bank-questions/100/report';
  assert.equal(await pending(f, path), false);
  const responses = await Promise.all(Array.from({length: 6}, () => post(f, path)));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(responses.filter(r => r.status === 409).length, 5);
  assert.equal(await pending(f, path), true);
  const plan = f.sql.prepare("EXPLAIN QUERY PLAN SELECT id FROM question_bank_reports WHERE question_id=? AND reported_by=? AND status='open' LIMIT 1").all(100,2).map(row=>row.detail).join('\n');
  assert.match(plan,/SEARCH question_bank_reports USING/,'pending lookup uses a question index, not a full report scan');
  assert.equal((await post(f, path, { reason: 'Should not overwrite' })).status, 409);
  assert.equal(f.sql.prepare('SELECT reason FROM question_bank_reports').get().reason, 'Synthetic issue');
  // Blocking is scoped to the reporter, not every student or every question.
  assert.equal(await pending(f, path, 3), false);
  assert.equal((await post(f, path, undefined, 3)).status, 200);
  assert.equal((await post(f, '/api/question-bank-questions/101/report')).status, 200);
  for (const status of ['resolved','rejected']) {
    f.sql.prepare('UPDATE question_bank_reports SET status=? WHERE question_id=100 AND reported_by=2').run(status);
    assert.equal(await pending(f, path), false);
    assert.equal((await post(f, path)).status, 200);
    assert.equal(await pending(f, path), true);
  }
});

test('report status is private, authenticated and missing/empty report requests do not insert records', async t => {
  const f = setup(t), path = '/api/question-bank-questions/100/report';
  assert.equal((await f.request(path, undefined, {method:'GET'})).status, 401);
  assert.equal((await f.request(path, undefined, {method:'GET',userId:1})).status, 403);
  assert.equal((await post(f, path, {reason:'  '})).status, 400);
  assert.equal((await post(f, '/api/question-bank-questions/999/report')).status, 404);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM question_bank_reports').get().n, 0);
});

test('regular test reporting is atomic and sends only one teacher notification', async t => {
  const f = setup(t), path = '/api/tests/questions/20/report';
  const responses = await Promise.all([post(f,path),post(f,path),post(f,path)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409,409]);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM notifications WHERE title='Question reported'").get().n,1);
  f.sql.exec("UPDATE test_question_reports SET status='resolved'");
  assert.equal((await post(f,path)).status,201);
  assert.equal((await post(f,path,undefined,3)).status,403,'submission remains required');
});

function remote(t, f) {
  const dbs = new Map();
  for (const source of ['gate','jam','psu']) {
    const db = new DatabaseSync(':memory:');
    dbs.set(source,db);t.after(()=>db.close());
    db.exec(`CREATE TABLE pyq_questions(id INTEGER PRIMARY KEY,exam TEXT,subject TEXT,chapter TEXT,year INTEGER,question TEXT); INSERT INTO pyq_questions VALUES(50,'gate','EDC','Synthetic chapter',2026,'Synthetic question');
      CREATE TABLE pyq_reports(id INTEGER PRIMARY KEY,question_id INTEGER,reported_by INTEGER,reason TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE INDEX pyq_reports_question_idx ON pyq_reports(question_id);
      CREATE TABLE psus(id INTEGER PRIMARY KEY,is_published INTEGER); INSERT INTO psus VALUES(1,1);
      CREATE TABLE psu_questions(id INTEGER PRIMARY KEY,psu_id INTEGER); INSERT INTO psu_questions VALUES(60,1);
      CREATE TABLE psu_question_reports(id INTEGER PRIMARY KEY,psu_id INTEGER,question_id INTEGER,reported_by INTEGER,reason TEXT,status TEXT DEFAULT 'open');
      CREATE TABLE psu_tests(id INTEGER PRIMARY KEY,psu_id INTEGER,is_published INTEGER); INSERT INTO psu_tests VALUES(10,1,1);
      CREATE TABLE psu_test_questions(id INTEGER PRIMARY KEY,test_id INTEGER,question_order INTEGER); INSERT INTO psu_test_questions VALUES(100,10,0);
      CREATE TABLE psu_test_question_reports(id INTEGER PRIMARY KEY,psu_id INTEGER,test_id INTEGER,question_order INTEGER,reported_by INTEGER,reason TEXT,status TEXT DEFAULT 'open',updated_at TEXT, UNIQUE(test_id,question_order,reported_by));`);
  }
  Object.assign(f.env,{PYQ_PROXY_URL:'https://gate.fixture.test',PYQ_PROXY_TOKEN:'fake',JAM_PYQ_PROXY_URL:'https://jam.fixture.test',JAM_PYQ_PROXY_TOKEN:'fake',PSU_PROXY_URL:'https://psu.fixture.test',PSU_PROXY_TOKEN:'fake'});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const db = dbs.get(new URL(url).hostname.split('.')[0]);
    assert.ok(db, 'only synthetic proxies may be contacted');
    const body=JSON.parse(options.body);
    const results=db.prepare(body.sql).all(...body.params);
    return Response.json({ok:true,results});
  });
  return dbs;
}

test('GATE and JAM PYQ keep pending report identity in their own database, even with overlapping question IDs',async t=>{
  const f=setup(t),dbs=remote(t,f),path='/api/pyq/questions/50/report';
  // Isolate report email delivery from the synthetic external service.
  f.env.GMAIL_USER=''; f.env.GMAIL_APP_PASSWORD='';
  for(const exam of ['gate','jam-chemistry']) {
    assert.equal(await pending(f,`${path}?exam=${exam}`),false);
    assert.equal((await post(f,path,{reason:'Synthetic issue',exam})).status,200);
    assert.equal((await post(f,path,{reason:'Duplicate',exam})).status,409);
    assert.equal(await pending(f,`${path}?exam=${exam}`),true);
    const db=dbs.get(exam==='gate'?'gate':'jam');
    assert.equal(db.prepare('SELECT count(*) AS n FROM pyq_reports').get().n,1);
    db.exec("UPDATE pyq_reports SET status='rejected'");
    assert.equal(await pending(f,`${path}?exam=${exam}`),false);
    assert.equal((await post(f,path,{reason:'New issue',exam})).status,200);
  }
  await f.finish();
});

test('PSU library and tests reject duplicates without overwriting open reports',async t=>{
  const f=setup(t),dbs=remote(t,f),db=dbs.get('psu');
  for (const [path,table] of [['/api/psus/1/question-bank/questions/60/report','psu_question_reports'],['/api/psus/1/tests/10/questions/0/report','psu_test_question_reports']]) {
    const first=await post(f,path); assert.equal(first.status,200,await first.clone().text());
    assert.equal((await post(f,path,{reason:'Do not overwrite'})).status,409);
    assert.equal(db.prepare(`SELECT reason FROM ${table}`).get().reason,'Synthetic issue');
    db.exec(`UPDATE ${table} SET status='resolved'`);
    assert.equal((await post(f,path,{reason:'Follow-up issue'})).status,200);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM psu_test_question_reports').get().n,1,'unique PSU test row is reopened only after response');
});

test('JAM and Starter Q Bank report writes and status checks stay on their content shard',async t=>{
  const f=setup(t),dbs=remote(t,f);
  const starter=new DatabaseSync(':memory:');dbs.set('starter',starter);t.after(()=>starter.close());
  for(const source of ['jam','starter','psu'])dbs.get(source).exec(`
    CREATE TABLE question_bank_questions(id INTEGER PRIMARY KEY,class_id INTEGER,subject_id INTEGER,chapter_id INTEGER,created_by INTEGER);
    CREATE TABLE question_bank_reports(id INTEGER PRIMARY KEY,question_id INTEGER,class_id INTEGER,subject_id INTEGER,chapter_id INTEGER,reported_by INTEGER,teacher_id INTEGER,reason TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE INDEX pending_by_question ON question_bank_reports(question_id);`);
  f.sql.exec(`INSERT INTO classes(id,title,subject,workflow_type,admin_id,status) VALUES(2,'JAM Chemistry','JAM Chemistry','question_bank',1,'active');
    INSERT INTO subjects(id,class_id,title) VALUES(901,2,'Chemistry');INSERT INTO chapters(id,subject_id,title) VALUES(296,901,'Synthetic JAM chapter');
    INSERT INTO subjects(id,class_id,title) VALUES(39,1,'PSU-backed EDC');INSERT INTO chapters(id,subject_id,title) VALUES(297,39,'Synthetic EDC chapter');
    UPDATE users SET additional_exams='["JAM Chemistry"]' WHERE id=2;`);
  Object.assign(f.env,{JAM_QB_PROXY_URL:'https://jam.fixture.test',JAM_QB_PROXY_TOKEN:'fake',JAM_QB_CLASS_IDS:'2',STARTER_ENABLED:'true',STARTER_PROXY_URL:'https://starter.fixture.test',STARTER_PROXY_TOKEN:'fake'});
  dbs.get('jam').exec('INSERT INTO question_bank_questions VALUES(102,2,901,296,1)');
  dbs.get('psu').exec('INSERT INTO question_bank_questions VALUES(103,1,39,297,1)');
  starter.exec('INSERT INTO question_bank_questions VALUES(4000000000050,1,900,295,1)');
  for(const [source,id] of [['jam',102],['starter',4000000000050],['psu',103]]) {
    const path=`/api/question-bank-questions/${id}/report`,db=dbs.get(source);
    assert.equal(await pending(f,path),false);
    const res=await post(f,path);assert.equal(res.status,200,await res.clone().text());
    assert.equal(await pending(f,path),true);
    assert.equal((await post(f,path)).status,409);
    assert.equal(db.prepare('SELECT count(*) AS n FROM question_bank_reports').get().n,1);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM question_bank_reports').get().n,0);
    db.exec("UPDATE question_bank_reports SET status='resolved'");assert.equal(await pending(f,path),false);
    assert.equal((await post(f,path)).status,200);
  }
});
