import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fixture } from './helpers/worker-fixture.mjs';
const bundle = await build({entryPoints:[new URL('../src/lib/studentActivityRanking.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {readStudentActivityRanking} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function setup(t) {
  const stores = Object.fromEntries(['main','question-bank','pyq','jam-pyq','psu'].map(key=>[key,new DatabaseSync(':memory:')]));
  t.after(()=>Object.values(stores).forEach(db=>db.close()));
  stores.main.exec(`CREATE TABLE jam_pyq_submissions(student_id,question_id,submitted_at);
    CREATE TABLE test_submissions(student_id,test_id);
    INSERT INTO jam_pyq_submissions VALUES(2,1,1000),(2,3,2000),(3,1,1000),(99,1,1000);
    INSERT INTO test_submissions VALUES(2,1),(2,1),(3,1),(99,1);`);
  stores['question-bank'].exec(`CREATE TABLE question_bank_question_progress(student_id,question_id,attempt_count);
    INSERT INTO question_bank_question_progress VALUES(2,1,3),(2,2,4),(3,1,0),(99,1,50);`);
  for(const key of ['pyq','jam-pyq'])stores[key].exec('CREATE TABLE pyq_question_progress(student_id,question_id,attempt_count);');
  stores.pyq.exec('INSERT INTO pyq_question_progress VALUES(2,1,2),(3,1,4),(99,1,50);');
  stores['jam-pyq'].exec('INSERT INTO pyq_question_progress VALUES(2,1,1),(2,2,3),(2,3,0),(3,1,1),(99,1,50);');
  stores.psu.exec('CREATE TABLE psu_test_attempts(student_id,test_id);INSERT INTO psu_test_attempts VALUES(2,1),(99,1);');
  const calls=[];
  const query=async(store,sql,params)=>{calls.push({store,sql,params});return stores[store].prepare(sql).all(...params);};
  return {stores,calls,query};
}
test('bulk totals combine shards, retakes and PSU tests; JAM immutable submissions are counted exactly once',async t=>{
  const f=setup(t), data=await readStudentActivityRanking(f.query,[2,3,4,2,-1]);
  assert.deepEqual(data.unavailableSources,[]);
  assert.deepEqual(data.students,[
    {studentId:2,questionBankAttempts:7,pyqAttempts:7,testCount:3,activityCount:17},
    {studentId:3,questionBankAttempts:0,pyqAttempts:5,testCount:1,activityCount:6},
    {studentId:4,questionBankAttempts:0,pyqAttempts:0,testCount:0,activityCount:0},
  ]);
  assert.equal(f.calls.length,6,'constant number of source reads, not per-student requests');
  for(const call of f.calls){assert.doesNotMatch(call.sql,/SELECT\s+\*|answers|image_data|question_text/);assert.ok(call.params.includes('[2,3,4]'));}
});
test('unavailable shard returns unknown instead of deceptively zero, without losing other categories',async t=>{
  const f=setup(t), data=await readStudentActivityRanking(async(store,sql,params)=>{
    if(store==='pyq')throw new Error('offline shard');return f.query(store,sql,params);
  },[2]);
  assert.deepEqual(data.unavailableSources,['GATE PYQ']);
  assert.deepEqual(data.students[0],{studentId:2,questionBankAttempts:7,pyqAttempts:null,testCount:3,activityCount:null});
});
test('no students means no shard requests',async()=>{
  assert.deepEqual(await readStudentActivityRanking(()=>{throw Error('should not run');},[]),{students:[],unavailableSources:[]});
});
test('ranking endpoint requires admin or super-admin; empty population is valid',async t=>{
  const f=fixture();t.after(()=>f.sql.close());
  assert.equal((await f.request('/api/users/student-activity',undefined,{method:'GET'})).status,401);
  assert.equal((await f.request('/api/users/student-activity',undefined,{method:'GET',userId:2})).status,403);
  f.sql.exec('DELETE FROM users WHERE id=2');
  for(const role of ['admin','super_admin']){
    f.sql.prepare('UPDATE users SET role=? WHERE id=1').run(role);
    const response=await f.request('/api/users/student-activity',undefined,{method:'GET',userId:1});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{students:[],unavailableSources:[]});
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
test('deployed handler reads grouped counts through the real proxy adapters and preserves student boundaries',async t=>{
  const f=fixture(), remote=setup(t);t.after(()=>f.sql.close());
  remote.stores.psu.exec(`CREATE TABLE question_bank_questions(id,subject_id,class_id);
    CREATE TABLE question_bank_question_progress(student_id,question_id,attempt_count);`);
  f.sql.exec(`CREATE TABLE jam_pyq_submissions(student_id,question_id,submitted_at);
    INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
    INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Physics');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Circuits');
    INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question) VALUES(1,1,1,1,'Fixture');
    INSERT INTO tests(id,title,exam_type) VALUES(1,'Mock','GATE');
    INSERT INTO jam_pyq_submissions VALUES(2,1,1000),(2,3,2000);
    INSERT INTO question_bank_question_progress(question_id,student_id,class_id,subject_id,chapter_id,attempt_count) VALUES(1,2,1,1,1,7);
    INSERT INTO test_submissions(test_id,student_id,answers) VALUES(1,2,'{}'),(1,2,'{}');`);
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  for(const [prefix,store]of [['PYQ','pyq'],['JAM_PYQ','jam-pyq'],['PSU','psu']]){
    f.env[prefix+'_PROXY_URL']='https://'+store+'.example.test';f.env[prefix+'_PROXY_TOKEN']='fixture-secret';
  }
  globalThis.fetch=async(url,options)=>{
    const store=new URL(url).hostname.replace('.example.test','');
    const {sql,params}=JSON.parse(options.body);
    return Response.json({ok:true,results:remote.stores[store].prepare(sql).all(...params)});
  };
  const response=await f.request('/api/users/student-activity',undefined,{method:'GET',userId:1});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{
    students:[{studentId:2,questionBankAttempts:7,pyqAttempts:7,testCount:3,activityCount:17}],unavailableSources:[],
  });
});
