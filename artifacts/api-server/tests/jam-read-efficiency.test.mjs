import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fixture as workerFixture } from './helpers/worker-fixture.mjs';

const bundled = await build({ stdin: {
  contents: `export * from './src/lib/jamCatalogQueries'; export * from './src/lib/practiceProgressWrites';`,
  resolveDir: new URL('..', import.meta.url).pathname,
}, bundle: true, write: false, format: 'esm', platform: 'node' });
const { JAM_PYQ_SUBJECTS_SQL, JAM_PYQ_CHAPTERS_SQL, QB_ATTEMPT_UPSERT, PYQ_ATTEMPT_UPSERT } =
  await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const schema = readFileSync(new URL('../../jam-content-worker/migrations/0001_jam_content.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../jam-content-worker/migrations/0002_read_efficiency.sql', import.meta.url), 'utf8');
const plain = rows => JSON.parse(JSON.stringify(rows));

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec(`INSERT INTO pyq_questions (id, exam, subject, chapter, chapter_order, year, question, created_by) VALUES
    (1,'JAM Chemistry','Physical Chemistry','Kinetics',0,2001,'Question 1',1),
    (2,'JAM Chemistry','Physical Chemistry','Kinetics',0,2002,'Question 2',1),
    (3,'JAM Chemistry','Physical Chemistry','',2,2003,'Question 3',1),
    (4,'JAM Chemistry','Physical Chemistry','General',1,2004,'Question 4',1),
    (5,'JAM Chemistry','Organic Chemistry','Reactions',0,2005,'Question 5',1);
    INSERT INTO question_bank_questions (id,class_id,subject_id,chapter_id,question) VALUES
    (1,2,3,10,'Question'),(2,2,3,10,'Question'),(3,2,3,11,'Question');`);
  db.exec(migration);
  t.after(() => db.close());
  return db;
}

test('catalog totals remain exact through backfill, import, move, deletion and rollback', t => {
  const db = fixture(t);
  const verify = () => {
    assert.deepEqual(plain(db.prepare('SELECT * FROM jam_pyq_catalog_counts ORDER BY exam,subject,chapter,chapter_order').all()),
      plain(db.prepare('SELECT exam,subject,chapter,chapter_order,COUNT(*) question_count FROM pyq_questions GROUP BY exam,subject,chapter,chapter_order ORDER BY exam,subject,chapter,chapter_order').all()));
    assert.deepEqual(plain(db.prepare('SELECT * FROM jam_qb_catalog_counts ORDER BY class_id,chapter_id').all()),
      plain(db.prepare('SELECT class_id,chapter_id,COUNT(*) question_count FROM question_bank_questions GROUP BY class_id,chapter_id ORDER BY class_id,chapter_id').all()));
  };
  verify();
  db.exec(migration); verify(); // rerun must not double count
  db.exec(`INSERT INTO pyq_questions (exam,subject,chapter,year,question,created_by) VALUES ('JAM Chemistry','Organic Chemistry','New chapter',2020,'New question',1);
    INSERT INTO question_bank_questions (class_id,subject_id,chapter_id,question) VALUES (2,3,12,'New question');`);
  verify();
  db.exec(`UPDATE pyq_questions SET chapter='Moved',chapter_order=7,subject='Inorganic Chemistry' WHERE id=1;
    UPDATE question_bank_questions SET chapter_id=12,class_id=3 WHERE id=1;`);
  verify();
  db.exec('BEGIN; DELETE FROM pyq_questions; DELETE FROM question_bank_questions;'); verify();
  db.exec('ROLLBACK;'); verify();
  db.exec('DELETE FROM pyq_questions WHERE id=1; DELETE FROM question_bank_questions WHERE id=1;'); verify();
});

test('catalog summaries preserve General grouping and isolate each student’s progress', t => {
  const db = fixture(t);
  const attempt = (q, s, ok) => db.prepare(PYQ_ATTEMPT_UPSERT).get(q,s,ok,1-ok,'0',ok,1000,1000,ok?1000:null);
  attempt(1,10,1); attempt(1,10,0); attempt(3,10,0); attempt(4,10,1); attempt(2,20,1);
  const subjects = plain(db.prepare(JAM_PYQ_SUBJECTS_SQL).all(10,'JAM Chemistry','JAM Chemistry'));
  assert.deepEqual(subjects.map(q => [q.subject,q.questionCount,q.attemptedCount]), [
    ['Organic Chemistry',1,0],['Physical Chemistry',4,3],
  ]);
  const chapters = plain(db.prepare(JAM_PYQ_CHAPTERS_SQL).all(10,'JAM Chemistry','Physical Chemistry','JAM Chemistry','Physical Chemistry'));
  assert.deepEqual(chapters.map(q => [q.chapter,q.chapterOrder,q.questionCount,q.attemptedCount]), [
    ['Kinetics',0,2,1],['General',1,2,2],
  ]);
  assert.equal(db.prepare(JAM_PYQ_SUBJECTS_SQL).all(99,'JAM Chemistry','JAM Chemistry').every(q => q.attemptedCount===0),true);
});

test('atomic QBank writes preserve counts, solved state and first attempt across devices', t => {
  const db = fixture(t);
  const attempt = (student, ok, time) => db.prepare(QB_ATTEMPT_UPSERT).get(student,1,2,3,10,ok,1-ok,'0',time,time,ok?time:null,ok);
  attempt(10,1,1000); const saved = attempt(10,0,2000); attempt(20,0,3000);
  assert.equal(saved.attempt_count,2); assert.equal(saved.correct_count,1); assert.equal(saved.incorrect_count,1);
  assert.equal(saved.first_attempted_at,1000); assert.equal(saved.last_attempted_at,2000);
  assert.equal(saved.solved_at,1000); assert.equal(saved.last_is_correct,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM question_bank_question_progress').get().n,2);
});

test('chapter reads use a covering ordered index without sorting the entire subject', t => {
  const db = fixture(t);
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM pyq_questions WHERE exam=? AND subject=? AND chapter=?
    ORDER BY chapter_order,question_number,year DESC,id DESC LIMIT 100`).all('JAM Chemistry','Physical Chemistry','Kinetics');
  assert.ok(plan.some(row => row.detail.includes('COVERING INDEX jam_pyq_chapter_practice_idx')));
  assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')));
});

test('summary joins start from indexed student progress, not the whole question catalog', t => {
  const db = fixture(t);
  for (const [sql, params] of [
    [JAM_PYQ_SUBJECTS_SQL, [10,'JAM Chemistry','JAM Chemistry']],
    [JAM_PYQ_CHAPTERS_SQL, [10,'JAM Chemistry','Physical Chemistry','JAM Chemistry','Physical Chemistry']],
  ]) {
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map(row => row.detail);
    const progress = plan.findIndex(detail => detail.includes('jam_pyq_progress_student_question_idx'));
    const question = plan.findIndex(detail => detail.includes('SEARCH q USING INTEGER PRIMARY KEY'));
    assert.ok(progress >= 0 && question > progress, JSON.stringify(plan));
    assert.ok(!plan.some(detail => /^SCAN q\b/.test(detail)), JSON.stringify(plan));
  }
});

test('deployed JAM routes use catalog totals, count-only bookmarks and direct chapter routing', async t => {
  const jam = fixture(t);
  const f = workerFixture();
  t.after(() => f.sql.close());
  f.sql.exec(readFileSync(new URL('../migrations/20261002_jam_pyq_question_time.sql', import.meta.url),'utf8'));
  f.sql.exec(readFileSync(new URL('../migrations/20261002_student_question_timers.sql', import.meta.url),'utf8'));
  f.sql.exec(`UPDATE users SET subject='JAM Chemistry',status='active' WHERE id=2;
    INSERT INTO classes (id,title,subject,workflow_type) VALUES (2,'JAM Chemistry','JAM Chemistry','question_bank');
    INSERT INTO subjects (id,class_id,title) VALUES (3,2,'Physical Chemistry');
    INSERT INTO chapters (id,subject_id,title) VALUES (10,3,'Kinetics'),(11,3,'Electrochemistry');`);
  Object.assign(f.env,{ JAM_PYQ_PROXY_URL:'https://jam.test', JAM_PYQ_PROXY_TOKEN:'test',
    JAM_QB_PROXY_URL:'https://jam.test', JAM_QB_PROXY_TOKEN:'test', JAM_QB_CLASS_IDS:'2' });
  const queries=[];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(new URL(url).hostname,'jam.test');
    const {sql,params,method}=JSON.parse(options.body);
    queries.push(sql);
    const stmt=jam.prepare(sql);
    if(method==='run') { stmt.run(...params); return Response.json({ok:true,results:[]}); }
    return Response.json({ok:true,results:stmt.all(...params)});
  });
  const get=async path => {
    const response=await f.request(path,undefined,{method:'GET',userId:2});
    const data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data)); return data;
  };
  const subjects=await get('/api/pyq/subjects?exam=JAM%20Chemistry');
  assert.equal(subjects.subjects.reduce((n,s)=>n+s.questionCount,0),5);
  assert.ok(queries[0].includes('jam_pyq_catalog_counts'));
  jam.exec('INSERT INTO pyq_saved_questions(student_id,question_id) VALUES (2,1),(2,3),(99,2)');
  queries.length=0;
  assert.deepEqual(await get('/api/pyq/questions?exam=JAM%20Chemistry&saved=1&countOnly=1'),{total:2});
  assert.equal(queries.length,1); assert.match(queries[0],/COUNT\(\*\)/);
  assert.ok(!queries[0].includes('explanation'));
  queries.length=0;
  const questions=await get('/api/question-bank/chapters/10/questions');
  assert.equal(questions.questions.length,2);
  assert.ok(queries.every(sql=>!sql.includes('NOT IN')), 'No cross-shard partition queries for JAM chapters');
  const structure=await get('/api/question-bank/exams/jam-chemistry/structure');
  assert.equal(structure.subjects[0].chapters.reduce((n,c)=>n+c.questionCount,0),3);
  assert.ok(queries.some(sql=>sql.includes('jam_qb_catalog_counts')));
  jam.exec("UPDATE question_bank_questions SET question_type='integer',correct_answer=12 WHERE id=1");
  for(const answer of [12,11]) {
    const response=await f.request('/api/question-bank-questions/1/attempt',{answer},{userId:2});
    const result=await response.json(); assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(result.isCorrect,answer===12); assert.equal(result.progress.attemptCount,answer===12?1:2);
  }
  assert.equal(jam.prepare('SELECT attempt_count FROM question_bank_question_progress WHERE student_id=2 AND question_id=1').get().attempt_count,2);
});
