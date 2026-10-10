import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fixture } from './helpers/worker-fixture.mjs';
const schemas=await Promise.all(['0001_initial.sql','0002_subject_chapters.sql','0003_pyq_attempt_features.sql','0004_pyq_progress_reports.sql'].map(name=>readFile(new URL('../../pyq-worker/migrations/'+name,import.meta.url),'utf8')));
const jamSchema=await readFile(new URL('../migrations/20260929_jam_pyq_solution_lock.sql',import.meta.url),'utf8');
async function proxy(entry){const bundle=await build({entryPoints:[new URL(entry,import.meta.url).pathname],bundle:true,write:false,format:'esm'});return(await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default;}
const gateProxy=await proxy('../../pyq-worker/src/index.js'),jamProxy=await proxy('../../jam-content-worker/src/index.js');
const plain=value=>JSON.parse(JSON.stringify(value));
async function setup(t){
  const f=fixture(),gate=fixture(),jam=fixture();t.after(()=>{f.sql.close();gate.sql.close();jam.sql.close();});
  f.sql.exec(jamSchema);f.sql.exec("UPDATE users SET status='active' WHERE id=2");
  for(const [db,exam]of[[gate.sql,'GATE EC'],[jam.sql,'JAM Chemistry']]){
    for(const schema of schemas)db.exec(schema);
    db.prepare(`INSERT INTO pyq_questions(id,exam,subject,chapter,year,question_type,question,options_json,correct_answer,answer_text,answer_min,answer_max,explanation,image_data,created_by,updated_at) VALUES(1,?,'Physical Chemistry','Nuclear Chemistry',2021,'integer','<p>Initial mass <b>1mg</b></p>','[]',NULL,'0.1',0.09,0.11,'Old solution','data:image/png;base64,abc',1,'2026-10-07T00:00:00.000Z')`).run(exam);
    db.exec(`INSERT INTO pyq_reports(id,question_id,reported_by,reason,status,created_at,updated_at) VALUES(1,1,2,'0.115-0.13','open',1000,1000),(2,1,2,'Second report','open',1000,1000),(3,1,2,'Rejected report','rejected',1000,1000);
      INSERT INTO pyq_question_progress(id,question_id,student_id,attempt_count,correct_count,incorrect_count,last_answer,last_is_correct,first_attempted_at,last_attempted_at) VALUES(1,1,2,2,0,2,'0.12',0,1000,2000);`);
  }
  f.sql.exec(`INSERT INTO jam_pyq_submissions VALUES(2,1,'0.12',0,1000);
    INSERT INTO student_daily_question_activity(student_id,day,question_key,outcome,seconds,updated_at) VALUES(2,'2026-10-07','pyq:jam-chemistry:1',0,30,2000),(2,'2026-10-07','pyq:gate:1',0,10,2000);
    INSERT INTO student_dashboard_cache VALUES(2,'{}',1000);INSERT INTO student_daily_activity_cache VALUES(2,'2026-10-07','{}',1000);
    INSERT INTO tests(id,title,exam_type,is_published,created_by) VALUES(41,'Preserved exam','GATE',1,1);
    INSERT INTO test_questions(id,test_id,question,options,correct_answer,points,"order") VALUES(99,41,'Keep this','["A","B"]',0,2,1);`);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://gate.fixture.test',PYQ_PROXY_TOKEN:'fixture',JAM_PYQ_PROXY_URL:'https://jam.fixture.test',JAM_PYQ_PROXY_TOKEN:'fixture',STARTER_ENABLED:'true',STARTER_PROXY_URL:'https://starter.fixture.test',STARTER_PROXY_TOKEN:'fixture'});
  const calls=[];let bankFailure=false;
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    const request=new Request(input,init),host=new URL(request.url).hostname;calls.push(host);
    assert.notEqual(host,'starter.fixture.test','corrections use raw main DB, not Starter activity routing');
    if(bankFailure&&JSON.parse(await request.clone().text()).method==='batch')return Response.json({error:'fixture bank unavailable'},{status:503});
    return host==='jam.fixture.test'?jamProxy.fetch(request,{JAM_DB:jam.env.DB,JAM_CONTENT_PROXY_TOKEN:'fixture'}):gateProxy.fetch(request,{PYQ_DB:gate.env.DB,PYQ_PROXY_TOKEN:'fixture'});
  });
  const endpoint=exam=>`/api/pyq/questions/1?exam=${encodeURIComponent(exam)}`;
  const patch=(body={},exam='JAM Chemistry',userId=1)=>f.request(endpoint(exam),{expectedUpdatedAt:'2026-10-07T00:00:00.000Z',answerMin:0.115,answerMax:0.13,explanation:'<p>Corrected solution</p>',...body},{method:'PATCH',userId});
  return {...f,gate,jam,calls,patch,endpoint,failBank:()=>{bankFailure=true;}};
}
test('admin opens and fixes exact JAM question through real proxy; preserved answers regrade, reports resolve, no test deletion',async t=>{
  const f=await setup(t),beforeGate=plain(f.gate.sql.prepare('SELECT * FROM pyq_questions').all()),beforeTests=plain(f.sql.prepare('SELECT * FROM test_questions').all());
  const get=await f.request(f.endpoint('JAM Chemistry'),undefined,{method:'GET',userId:1});assert.equal(get.status,200);const q=(await get.json()).question;assert.equal(q.answerMin,0.09);assert.equal(q.updatedAt,'2026-10-07T00:00:00.000Z');
  const response=await f.patch();assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).regradedStudents,1);
  assert.deepEqual(plain(f.gate.sql.prepare('SELECT * FROM pyq_questions').all()),beforeGate);assert.deepEqual(plain(f.sql.prepare('SELECT * FROM test_questions').all()),beforeTests);
  const corrected=f.jam.sql.prepare('SELECT * FROM pyq_questions').get();assert.equal(corrected.year,2021);assert.equal(corrected.image_data,'data:image/png;base64,abc');assert.equal(corrected.answer_min,0.115);
  const progress=f.jam.sql.prepare('SELECT * FROM pyq_question_progress').get();assert.equal(progress.last_is_correct,1);assert.equal(progress.attempt_count,2);assert.equal(progress.correct_count,1);assert.equal(progress.incorrect_count,1);assert.equal(progress.last_answer,'0.12');assert.equal(progress.last_attempted_at,2000);
  assert.deepEqual(plain(f.sql.prepare('SELECT * FROM jam_pyq_submissions').get()),{student_id:2,question_id:1,answer_json:'0.12',is_correct:1,submitted_at:1000});
  assert.deepEqual(f.jam.sql.prepare('SELECT status FROM pyq_reports ORDER BY id').all().map(r=>r.status),['resolved','resolved','rejected']);assert.equal(f.gate.sql.prepare('SELECT status FROM pyq_reports WHERE id=1').get().status,'open');
  assert.equal(f.sql.prepare("SELECT outcome FROM student_daily_question_activity WHERE question_key='pyq:jam-chemistry:1'").get().outcome,1);assert.equal(f.sql.prepare("SELECT outcome FROM student_daily_question_activity WHERE question_key='pyq:gate:1'").get().outcome,0);
  assert.equal(f.sql.prepare('SELECT updated_at FROM student_dashboard_cache').get().updated_at,0);
});
test('unauthorized, missing/mismatched exam, stale revision and invalid ranges never change question or reports',async t=>{
  const f=await setup(t),before=plain(f.jam.sql.prepare('SELECT * FROM pyq_questions').get());
  assert.equal((await f.patch({},'JAM Chemistry',2)).status,403);assert.equal((await f.patch({},'JAM Chemistry',null)).status,401);
  assert.equal((await f.request('/api/pyq/questions/1',undefined,{method:'GET',userId:1})).status,400);
  assert.equal((await f.patch({},'JAM Physics')).status,404);assert.equal((await f.patch({expectedUpdatedAt:'stale'})).status,409);
  assert.equal((await f.patch({answerMin:0.3,answerMax:0.1})).status,400);assert.equal((await f.patch({answerMin:null,answerMax:0.1})).status,400);
  assert.equal((await f.patch({question:''})).status,400);assert.deepEqual(plain(f.jam.sql.prepare('SELECT * FROM pyq_questions').get()),before);
  assert.equal(f.jam.sql.prepare('SELECT status FROM pyq_reports WHERE id=1').get().status,'open');
});
test('MCQ letter and MSQ stored answers are checked with corrected key in GATE only',async t=>{
  for(const [kind,answer,key]of[['mcq','"B"',{correctAnswer:1}],['multi','["A","C"]',{correctAnswerMulti:[0,2]}]]){
    const f=await setup(t);f.gate.sql.prepare('UPDATE pyq_question_progress SET last_answer=?').run(answer);
    const res=await f.patch({questionType:kind,options:['Alpha','Beta','Gamma'],...key},'GATE EC');assert.equal(res.status,200,await res.clone().text());
    assert.equal(f.gate.sql.prepare('SELECT last_is_correct FROM pyq_question_progress').get().last_is_correct,1);
    assert.equal(f.sql.prepare('SELECT is_correct FROM jam_pyq_submissions').get().is_correct,0);assert.equal(f.jam.sql.prepare('SELECT status FROM pyq_reports WHERE id=1').get().status,'open');
  }
});
test('bank failure leaves original intact; main failure retains open report and a reload/retry completes once',async t=>{
  const f=await setup(t);f.failBank();assert.equal((await f.patch()).status,503);assert.equal(f.jam.sql.prepare('SELECT answer_min FROM pyq_questions').get().answer_min,0.09);
  const g=await setup(t),batch=g.env.DB.batch;g.env.DB.batch=()=>Promise.reject(Error('fixture main failure'));
  assert.equal((await g.patch()).status,503);assert.equal(g.jam.sql.prepare('SELECT status FROM pyq_reports WHERE id=1').get().status,'open');
  g.env.DB.batch=batch;const updated=g.jam.sql.prepare('SELECT updated_at FROM pyq_questions').get().updated_at;
  assert.equal((await g.patch({expectedUpdatedAt:updated})).status,200);assert.equal(g.jam.sql.prepare('SELECT correct_count FROM pyq_question_progress').get().correct_count,1);assert.equal(g.jam.sql.prepare('SELECT status FROM pyq_reports WHERE id=1').get().status,'resolved');
});
test('reject is exam-routed and never changes an identically numbered GATE report',async t=>{
  const f=await setup(t);const response=await f.request('/api/pyq/reports/1/reject?exam=JAM%20Chemistry',{}, {method:'PATCH',userId:1});assert.equal(response.status,200,await response.clone().text());
  assert.equal(f.jam.sql.prepare('SELECT status FROM pyq_reports WHERE id=1').get().status,'rejected');assert.equal(f.gate.sql.prepare('SELECT status FROM pyq_reports WHERE id=1').get().status,'open');
});
