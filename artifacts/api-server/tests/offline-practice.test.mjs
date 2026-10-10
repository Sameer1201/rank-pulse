import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {fixture} from './helpers/worker-fixture.mjs';

function setup(t){
 const f=fixture();t.after(()=>f.sql.close());
 for(const name of ['0001_initial.sql','0002_subject_chapters.sql','0003_pyq_attempt_features.sql','0004_pyq_progress_reports.sql'])f.sql.exec(readFileSync(new URL('../../pyq-worker/migrations/'+name,import.meta.url),'utf8'));
 f.sql.exec(readFileSync(new URL('../migrations/20261006_offline_practice.sql',import.meta.url),'utf8'));
 f.sql.exec(`UPDATE users SET status='active',subject='GATE' WHERE id=2;
 INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
 INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Physics');INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Chapter');
 INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer) VALUES(1,1,1,1,'Test','mcq','["A","B"]',0);
 INSERT INTO pyq_questions(id,exam,subject,chapter,question,year,created_by,correct_answer) VALUES(1,'GATE EC','Physics','A','Question',2020,1,0);`);
 Object.assign(f.env,{PYQ_PROXY_URL:'https://gate.example.test',PYQ_PROXY_TOKEN:'test',JAM_PYQ_PROXY_URL:'https://jam.example.test',JAM_PYQ_PROXY_TOKEN:'test'});
 t.mock.method(globalThis,'fetch',async(url,options)=>{const{sql,params}=JSON.parse(options.body);return Response.json({ok:true,results:f.sql.prepare(sql).all(...params)});});
 return f;
}
test('offline capabilities: GATE rollout is gated and requires the migrated database',async t=>{
 const f=setup(t);
 const gate='/api/student/offline-capabilities?source=pyq&exam=GATE%20EC&questionId=1';
 const get=path=>f.request(path,undefined,{method:'GET',userId:2});
 assert.equal((await f.request(gate,undefined,{method:'GET'})).status,401);
 assert.deepEqual(await (await get(gate)).json(),{available:false,limit:0});
 for(const path of ['/api/student/offline-capabilities?source=question-bank&exam=gate&questionId=1','/api/student/offline-capabilities?source=pyq&exam=JAM%20Chemistry&questionId=1']){
  assert.deepEqual(await (await get(path)).json(),{available:true,limit:15});
 }
 f.env.OFFLINE_GATE_PYQ_ENABLED='true';
 assert.deepEqual(await (await get(gate)).json(),{available:true,limit:15});
 f.sql.exec('ALTER TABLE pyq_question_progress DROP COLUMN offline_submission_ids');
 assert.deepEqual(await (await get(gate)).json(),{available:false,limit:0});
});
for(const [source,path,table] of [['QBank','/api/question-bank-questions/1/attempt','question_bank_question_progress'],['PYQ','/api/pyq/questions/1/attempt','pyq_question_progress']]){
 test(`${source}: lost responses, concurrent retries and later online attempts do not replay offline increments`,async t=>{
  const f=setup(t), at=Date.now()-60000;
  const body={answer:0,exam:'GATE EC',offlineSubmissionId:'offline-test-event-0001',offlineUserId:2,attemptedAt:at};
  for(const response of await Promise.all(Array.from({length:5},()=>f.request(path,body,{userId:2}))))assert.equal(response.status,200,await response.text());
  let p=f.sql.prepare(`SELECT * FROM ${table} WHERE student_id=2`).get();assert.equal(p.attempt_count,1);assert.equal(p.correct_count,1);assert.equal(p.first_attempted_at,at);
  const online=await f.request(path,{answer:1,exam:'GATE EC'},{userId:2});assert.equal(online.status,200,await online.text());
  await f.request(path,body,{userId:2});
  p=f.sql.prepare(`SELECT * FROM ${table} WHERE student_id=2`).get();assert.equal(p.attempt_count,2);assert.equal(p.last_is_correct,0);
  const older=await f.request(path,{...body,offlineSubmissionId:'offline-test-event-0002',attemptedAt:at-1000},{userId:2});assert.equal(older.status,200,await older.text());
  p=f.sql.prepare(`SELECT * FROM ${table} WHERE student_id=2`).get();assert.equal(p.attempt_count,3);assert.equal(p.correct_count,2);assert.equal(p.last_is_correct,0);assert.equal(p.first_attempted_at,at-1000);
 });
 test(`${source}: wrong account, missing session and malformed replay are rejected`,async t=>{
  const f=setup(t),body={answer:0,exam:'GATE EC',offlineSubmissionId:'offline-test-event-0001',offlineUserId:99,attemptedAt:Date.now()};
  assert.equal((await f.request(path,body,{userId:2})).status,403);
  assert.equal((await f.request(path,body)).status,401);
  assert.equal((await f.request(path,{...body,offlineUserId:2,attemptedAt:0},{userId:2})).status,400);
  assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
 });
}
test('QBank: queued first time remains frozen after duplicate synchronization',async t=>{
 const f=setup(t),body={exam:'gate',timeSpentSeconds:42,offlineUserId:2};
 assert.equal((await f.request('/api/question-bank/questions/1/time',body,{userId:2})).status,200);
 await f.request('/api/question-bank-questions/1/attempt',{answer:0,offlineUserId:2,offlineSubmissionId:'offline-timer-event-0001',attemptedAt:Date.now()},{userId:2});
 const r=await f.request('/api/question-bank/questions/1/time',{...body,timeSpentSeconds:500},{userId:2});assert.equal((await r.json()).timeSpentSeconds,42);
 assert.equal((await f.request('/api/question-bank/questions/1/time',{...body,offlineUserId:99},{userId:2})).status,403);
});
test('JAM one-time solution mode keeps its original answer and first timestamp on replay',async t=>{
 const f=setup(t),at=Date.now()-60000;
 f.sql.exec(readFileSync(new URL('../migrations/20260929_jam_pyq_solution_lock.sql',import.meta.url),'utf8'));
 f.sql.exec("UPDATE pyq_questions SET exam='JAM Chemistry';UPDATE users SET subject='JAM Chemistry' WHERE id=2;INSERT INTO jam_pyq_solution_access VALUES(2,1,1)");
 const body={exam:'JAM Chemistry',answer:0,offlineSubmissionId:'jam-offline-event-0001',offlineUserId:2,attemptedAt:at};
 const first=await f.request('/api/pyq/questions/1/jam-submit',body,{userId:2});assert.equal(first.status,200,await first.text());
 const second=await f.request('/api/pyq/questions/1/jam-submit',{...body,answer:1},{userId:2});assert.equal(second.status,200);
 const saved=await second.json();assert.equal(saved.answer,0);assert.equal(saved.alreadySubmitted,true);
 assert.equal(f.sql.prepare('SELECT attempt_count FROM pyq_question_progress').get().attempt_count,1);
 assert.equal(f.sql.prepare('SELECT submitted_at FROM jam_pyq_submissions').get().submitted_at,at);
});
