import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fixture} from './helpers/worker-fixture.mjs';
const bundle=await build({entryPoints:[new URL('../src/lib/studentDashboard.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {readStudentDashboard}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const now=Date.parse('2026-10-05T12:00:00Z');
const grade=(q,a)=>q.correct_answer==null?null:Number(q.correct_answer)===Number(a);
function setup(t){
  const f=fixture(); const stores={main:f.sql,'question-bank':f.sql,pyq:new DatabaseSync(':memory:'),'jam-pyq':new DatabaseSync(':memory:'),psu:new DatabaseSync(':memory:')};
  t.after(()=>{for(const db of new Set(Object.values(stores)))db.close();});
  f.sql.exec(readFileSync(new URL('../migrations/20260929_jam_pyq_solution_lock.sql',import.meta.url),'utf8'));
  for(const key of ['pyq','jam-pyq'])for(const name of ['0001_initial.sql','0002_subject_chapters.sql','0003_pyq_attempt_features.sql','0004_pyq_progress_reports.sql']) stores[key].exec(readFileSync(new URL('../../pyq-worker/migrations/'+name,import.meta.url),'utf8'));
  for(const name of ['0001_initial.sql','0003_test_storage_attempts.sql'])stores.psu.exec(readFileSync(new URL('../../psu-worker/migrations/'+name,import.meta.url),'utf8'));
  const calls=[]; const query=async(store,sql,params)=>{calls.push({store,sql,params});return stores[store].prepare(sql).all(...params);};
  return {...f,stores,calls,query};
}
function seed(f){
  f.sql.exec(`UPDATE users SET status='active',subject='GATE' WHERE id=2;
    INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
    INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Physics');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Circuits');
    INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,source_test_id,source_test_question_id) VALUES(1,1,1,1,'Do not download question',1,1),(2,1,1,1,'Do not download question',NULL,NULL);
    INSERT INTO question_bank_question_progress(question_id,student_id,class_id,subject_id,chapter_id,attempt_count,last_is_correct,last_attempted_at) VALUES(1,2,1,1,1,9,1,${now}),(2,2,1,1,1,5,0,${now});
    INSERT INTO tests(id,title,exam_type) VALUES(1,'Physics Mock','GATE');
    INSERT INTO test_questions(id,test_id,question,correct_answer,subject_label,meta) VALUES(1,1,'Question one',0,'Physics','{"chapterName":"Circuits"}'),(2,1,'Question two',1,'Physics','{"chapterName":"Circuits"}');
    INSERT INTO test_submissions(id,test_id,student_id,answers,question_timings,submitted_at) VALUES(1,1,2,'{"1":1,"2":1}','{"1":30,"2":30}',${now-86400000}),(2,1,2,'{"1":0,"2":0}','{"1":40,"2":40}',${now});
    INSERT INTO test_question_bank_links(test_id,test_question_id,question_bank_question_id) VALUES(1,1,1);
    INSERT INTO student_question_timers VALUES(2,'question-bank','gate',1,60,${now}),(2,'pyq','gate',1,40,${now}),(2,'pyq','jam-chemistry',1,50,${now});`);
  for(const [key,correct] of [['pyq',1],['jam-pyq',0]]){
    f.stores[key].prepare("INSERT INTO pyq_questions(id,exam,subject,chapter,question,year,created_by) VALUES(1,?,'Chemistry','Atomic','Large content not selected',2020,1)").run(key==='pyq'?'GATE':'JAM Chemistry');
    f.stores[key].prepare('INSERT INTO pyq_question_progress(question_id,student_id,attempt_count,last_is_correct,first_attempted_at,last_attempted_at) VALUES(1,2,10,?,?,?)').run(correct,now-86400000,now);
  }
  f.sql.prepare('INSERT INTO jam_pyq_submissions(student_id,question_id,answer_json,is_correct,submitted_at) VALUES(2,1,?,0,?)').run('1',now);
  f.stores.psu.exec(`INSERT INTO psus(id,name,slug) VALUES(1,'ISRO','isro');INSERT INTO psu_tests(id,psu_id,title,bundle_json) VALUES(1,1,'ISRO Mock','{}');
    INSERT INTO psu_test_attempts(id,psu_id,test_id,student_id,correct_count,wrong_count,total_time_seconds,submitted_at) VALUES(1,1,1,2,4,1,300,'2026-10-04 12:00:00'),(2,1,1,2,3,2,240,'2026-10-05 12:00:00');`);
}

test('combines four sources and both PYQ shards, dedupes mirrored tests and JAM projections, and weights accuracy by question',async t=>{
  const f=setup(t);seed(f);
  const data=await readStudentDashboard(f.query,2,grade,now);
  assert.equal(data.partial,false,JSON.stringify(data.unavailableSources));
  assert.deepEqual(data.totals,{questions:10,correct:5,wrong:5,ungraded:0,seconds:830,completed:4,accuracy:50});
  const sources=Object.fromEntries(data.sources.map(s=>[s.key,s]));
  assert.equal(sources['question-bank'].questions,1);assert.equal(sources.tests.questions,2);
  assert.equal(sources.pyq.questions,2);assert.equal(sources.psu.questions,5);
  assert.equal(sources.psu.seconds,540);assert.equal(sources.pyq.seconds,90);
  assert.equal(data.subjects.find(row=>row.subject==='Physics').questions,3);
  assert.ok(data.weakAreas.some(row=>row.subject==='Chemistry'));
  assert.ok(data.weakAreas.some(row=>row.subject==='ISRO'));
  assert.deepEqual(new Set(data.recent.map(row=>row.source)),new Set(['tests','question-bank','pyq','psu']));
  assert.equal(data.testAttempts.length,4,'test history includes regular and PSU retakes');
  assert.deepEqual(new Set(data.testAttempts.map(row=>row.source)),new Set(['tests','psu']));
  assert.ok(data.testAttempts.every((row,index,rows)=>index===0||row.at>=rows[index-1].at));
  for(const {sql}of f.calls){assert.doesNotMatch(sql,/SELECT\s+(?:\w+\.)?\*/i);assert.doesNotMatch(sql,/image_data|solution_text|bundle_json|question_json|interaction_log/);}
});

test('a later direct QBank answer wins over the older test mirror, without increasing question count',async t=>{
  const f=setup(t);seed(f);f.sql.prepare('UPDATE question_bank_question_progress SET last_is_correct=0,last_attempted_at=? WHERE question_id=1').run(now+1000);
  const data=await readStudentDashboard(f.query,2,grade,now);
  assert.equal(data.totals.questions,10);assert.equal(data.totals.correct,4);
  assert.equal(data.sources.find(s=>s.key==='question-bank').questions,2);assert.equal(data.sources.find(s=>s.key==='tests').questions,1);
});

test('practice-only students have useful metrics with zero tests; empty accounts and another student do not inherit data',async t=>{
  const f=setup(t);seed(f);
  f.sql.exec("DELETE FROM test_submissions;DELETE FROM student_question_timers WHERE source_type='question-bank';");f.stores.psu.exec('DELETE FROM psu_test_attempts');
  const data=await readStudentDashboard(f.query,2,grade,now);
  assert.equal(data.totals.questions,4);assert.equal(data.totals.accuracy,50);assert.equal(data.totals.completed,0);
  assert.deepEqual(data.testAttempts,[]);
  const other=await readStudentDashboard(f.query,777,grade,now);
  assert.equal(other.totals.questions,0);assert.equal(other.totals.accuracy,null);assert.deepEqual(other.recent,[]);
  assert.deepEqual(other.testAttempts,[]);
});

test('test graph uses bounded score metadata, preserves negative scores and excludes another student',async t=>{
  const f=setup(t);seed(f);
  f.sql.exec('UPDATE test_submissions SET score=-1,total_points=10 WHERE id=1;UPDATE test_submissions SET score=8,total_points=10 WHERE id=2');
  f.stores.psu.exec('UPDATE psu_test_attempts SET score=6,total_points=10 WHERE id=1');
  let data=await readStudentDashboard(f.query,2,grade,now);
  assert.equal(data.testAttempts.find(row=>row.id==='tests:1').percentage,-10);
  assert.equal(data.testAttempts.find(row=>row.id==='tests:2').percentage,80);
  assert.equal(data.testAttempts.find(row=>row.id==='psu:1').percentage,60);
  assert.equal(data.testAttempts.find(row=>row.id==='psu:2').percentage,null);
  const insert=f.sql.prepare("INSERT INTO test_submissions(test_id,student_id,answers,score,total_points,submitted_at) VALUES(1,2,'{}',1,2,?)");
  for(let i=1;i<=35;i++)insert.run(now+i*1000);
  data=await readStudentDashboard(f.query,2,grade,now+40000);
  assert.equal(data.testAttempts.length,30);
  assert.equal(data.testAttempts.at(-1).percentage,50);
  assert.equal(data.testAttempts[0].at,now+6000);
  assert.deepEqual((await readStudentDashboard(f.query,777,grade,now)).testAttempts,[]);
});

test('missing JAM projection uses immutable submissions; unavailable stores are explicit partial results',async t=>{
  const f=setup(t);seed(f);f.stores['jam-pyq'].exec('DELETE FROM pyq_question_progress');
  let data=await readStudentDashboard(f.query,2,grade,now);assert.equal(data.sources.find(s=>s.key==='pyq').questions,2);
  const originalError=console.error;console.error=()=>{};
  try{data=await readStudentDashboard((store,sql,params)=>store==='psu'?Promise.reject(new Error('offline')):f.query(store,sql,params),2,grade,now);}finally{console.error=originalError;}
  assert.equal(data.partial,true);assert.ok(data.unavailableSources.includes('psu'));assert.equal(data.totals.questions,5);
});

test('overview route caches one account summary, isolates sessions, and avoids old per-test analysis endpoints',async t=>{
  const f=setup(t);seed(f);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://gate.example.test',PYQ_PROXY_TOKEN:'x',JAM_PYQ_PROXY_URL:'https://jam.example.test',JAM_PYQ_PROXY_TOKEN:'x',PSU_PROXY_URL:'https://psu.example.test',PSU_PROXY_TOKEN:'x'});
  let requests=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    requests++;const host=new URL(url).hostname;const store=host.startsWith('gate')?'pyq':host.startsWith('jam')?'jam-pyq':'psu';
    const{sql,params}=JSON.parse(options.body);return Response.json({ok:true,results:(/question_bank/.test(sql)?f.sql:f.stores[store]).prepare(sql).all(...params)});
  });
  assert.equal((await f.request('/api/student/dashboard/overview',undefined,{method:'GET'})).status,401);
  assert.equal((await f.request('/api/student/dashboard/overview',undefined,{method:'GET',userId:1})).status,403);
  const get=()=>f.request('/api/student/dashboard/overview?studentId=777',undefined,{method:'GET',userId:2});
  const first=await get();assert.equal(first.status,200);const data=await first.json();assert.equal(data.partial,false,JSON.stringify(data));
  const before=requests;const second=await get();assert.equal(second.status,200);assert.equal(requests,before,'cache hit must not re-read shards');
  assert.equal((await second.json()).totals.questions,10);assert.equal(first.headers.get('cache-control'),'no-store');
});
