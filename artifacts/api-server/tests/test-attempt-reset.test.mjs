import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fixture} from './helpers/worker-fixture.mjs';
const migration=await readFile(new URL('../migrations/20261007_test_attempt_resets.sql',import.meta.url),'utf8');
const psuSchemas=await Promise.all(['0001_initial.sql','0003_test_storage_attempts.sql','0004_test_bucket_reports.sql'].map(name=>readFile(new URL('../../psu-worker/migrations/'+name,import.meta.url),'utf8')));
const proxyBundle=await build({entryPoints:[new URL('../../psu-worker/src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {default:psuProxy}=await import('data:text/javascript;base64,'+Buffer.from(proxyBundle.outputFiles[0].text).toString('base64'));
const starterBundle=await build({entryPoints:[new URL('../../starter-worker/src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {default:starterProxy}=await import('data:text/javascript;base64,'+Buffer.from(starterBundle.outputFiles[0].text).toString('base64'));
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(t) {
  const f=fixture();t.after(()=>f.sql.close());f.sql.exec(migration);
  f.sql.exec(`UPDATE users SET status='active',subject='GATE',student_profile_data='{"reviewBucketDismissedQuestionIds":[11,99],"preserve":"yes"}',review_bucket_dismissed_question_ids='[11,99]' WHERE id=2;
    INSERT INTO users(id,username,password_hash,full_name,email,role,status,subject) VALUES(3,'teacher','x','Teacher','teacher@example.test','admin','active','GATE'),(4,'other','x','Other','other@example.test','student','active','GATE');
    INSERT INTO tests(id,title,exam_type,is_published,created_by) VALUES(1,'Mock one','GATE',1,1),(2,'Mock two','GATE',1,3);
    INSERT INTO test_questions(id,test_id,question,options,correct_answer,points,"order") VALUES(11,1,'Question one','["A","B"]',0,2,1),(22,2,'Question two','["A","B"]',0,1,1);
    INSERT INTO test_submissions(id,test_id,student_id,answers,question_timings,score,total_points,percentage,submitted_at)
      VALUES(1,1,2,'{"11":1}','{"11":20}',0,2,0,1000),(2,1,2,'{"11":1}','{"11":30}',0,2,0,2000),(3,2,2,'{"22":1}','{"22":15}',0,1,0,3000),(4,1,4,'{"11":1}','{"11":40}',0,2,0,4000);
    UPDATE student_activity_tracking SET started_at=0;
    INSERT INTO student_daily_question_activity(student_id,day,question_key,outcome,seconds,updated_at) VALUES
      (2,'2026-10-07','test:1:1:11',0,20,1000),(2,'2026-10-07','test:1:2:11',0,30,2000),(2,'2026-10-07','test:2:3:22',0,15,3000),(2,'2026-10-07','question-bank:11',1,5,3000),(4,'2026-10-07','test:1:4:11',0,40,4000);
    INSERT INTO student_dashboard_cache VALUES(2,'{}',1000),(4,'{}',1000);
    INSERT INTO student_daily_activity_cache VALUES(2,'2026-10-07','{}',1000),(4,'2026-10-07','{}',1000);`);
  const reset=(body={source:'regular',testId:1,latestAttemptId:2},userId=3)=>f.request('/api/users/2/test-attempts/reset',body,{userId});
  f.sql.exec('PRAGMA foreign_keys=ON');
  return {...f,reset};
}
test('admin resets only selected student/test, archives attempts, removes bucket and permits a new attempt',async t=>{
  const f=setup(t),before=f.sql.prepare('SELECT * FROM test_submissions ORDER BY id').all(),questions=f.sql.prepare('SELECT * FROM test_questions ORDER BY id').all();
  let response=await f.request('/api/users/2/attempted-tests',undefined,{method:'GET',userId:3});assert.equal(response.status,200);
  const list=await response.json();assert.equal(list.total,2);assert.equal(list.items.find(item=>item.testId===1).attemptCount,2);
  response=await f.reset();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).resetAttempts,2);
  assert.deepEqual(f.sql.prepare('SELECT * FROM test_questions ORDER BY id').all(),questions);
  assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions ORDER BY id').all(),before.filter(row=>![1,2].includes(row.id)));
  const audit=f.sql.prepare('SELECT * FROM test_attempt_reset_audit').get();assert.equal(audit.status,'completed');assert.equal(audit.reset_by,3);
  assert.deepEqual(JSON.parse(audit.original_submissions_json),plain(before.slice(0,2)));
  const profile=JSON.parse(f.sql.prepare('SELECT student_profile_data FROM users WHERE id=2').get().student_profile_data);
  assert.deepEqual(profile,{reviewBucketDismissedQuestionIds:[99],preserve:'yes'});
  assert.deepEqual(f.sql.prepare('SELECT correct,wrong,seconds FROM student_daily_activity_totals WHERE student_id=2').get(),Object.assign(Object.create(null),{correct:1,wrong:1,seconds:20}));
  assert.equal(f.sql.prepare('SELECT updated_at FROM student_dashboard_cache WHERE student_id=2').get().updated_at,0);
  assert.equal(f.sql.prepare('SELECT updated_at FROM student_daily_activity_cache WHERE student_id=4').get().updated_at,1000);
  const bucket=await f.request('/api/tests/review-bucket',undefined,{method:'GET',userId:2});assert.equal(bucket.status,200);
  assert.deepEqual((await bucket.json()).map(item=>item.testId),[2]);
  const otherBucket=await f.request('/api/tests/review-bucket',undefined,{method:'GET',userId:4});assert.equal((await otherBucket.json())[0].testId,1);
  const analysis=await f.request('/api/tests/1/my-analysis',undefined,{method:'GET',userId:2});assert.equal(analysis.status,403);
  response=await f.request('/api/tests/1/submit',{answers:{11:1}},{userId:2});assert.equal(response.status,201,await response.clone().text());
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_submissions WHERE student_id=2 AND test_id=1').get().n,1);
  const newBucket=await f.request('/api/tests/review-bucket',undefined,{method:'GET',userId:2});assert((await newBucket.json()).some(item=>item.testId===1));
});
test('reset is idempotent; private own manifest contains no answers or other students',async t=>{
  const f=setup(t);assert.equal((await f.reset()).status,200);assert.equal((await f.reset()).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_attempt_reset_audit').get().n,1);
  const manifest=await f.request('/api/users/me/test-attempt-resets',undefined,{method:'GET',userId:2});const data=await manifest.json();
  assert.equal(data.items.length,1);assert.deepEqual(data.items[0].questionIds,[11]);assert(!JSON.stringify(data).includes('answers'));
  assert.equal((await f.request('/api/users/me/test-attempt-resets',undefined,{method:'GET',userId:3})).status,403);
  assert.equal((await (await f.request('/api/users/me/test-attempt-resets',undefined,{method:'GET',userId:4})).json()).items.length,0);
  const {resetAt,id}=data.nextCursor;
  assert.equal((await (await f.request(`/api/users/me/test-attempt-resets?since=${resetAt}&afterId=${id}`,undefined,{method:'GET',userId:2})).json()).items.length,0);
});
test('students, anonymous callers, wrong IDs and stale confirmation cannot reset attempts',async t=>{
  const f=setup(t),before=f.sql.prepare('SELECT * FROM test_submissions').all();
  assert.equal((await f.reset(undefined,2)).status,403);assert.equal((await f.request('/api/users/2/test-attempts/reset',{source:'regular',testId:1,latestAttemptId:2})).status,401);
  assert.equal((await f.reset({source:'regular',testId:1,latestAttemptId:1})).status,409);
  assert.equal((await f.reset({source:'regular',testId:999,latestAttemptId:2})).status,404);
  assert.equal((await f.reset({source:'unknown',testId:1,latestAttemptId:2})).status,400);
  assert.equal((await f.reset({source:'regular',testId:-1,latestAttemptId:2})).status,400);
  assert.equal((await f.reset(null)).status,400);
  assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions').all(),before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_attempt_reset_audit').get().n,0);
});
test('a submission arriving between confirmation and atomic reset is preserved',async t=>{
  const f=setup(t),original=f.env.DB.batch;let once=true;
  f.env.DB.batch=statements=>{
    if(once){once=false;f.sql.exec(`INSERT INTO test_submissions(id,test_id,student_id,answers) VALUES(5,1,2,'{}')`);}
    return original(statements);
  };
  assert.equal((await f.reset()).status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_submissions WHERE test_id=1 AND student_id=2').get().n,3);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_attempt_reset_audit').get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM student_daily_question_activity WHERE question_key LIKE 'test:1:%'").get().n,3);
});
test('atomic database failure keeps original attempts and bucket',async t=>{
  const f=setup(t),before=f.sql.prepare('SELECT * FROM test_submissions').all();f.env.DB.batch=()=>Promise.reject(Error('fixture-only failure'));
  assert.equal((await f.reset()).status,503);assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions').all(),before);
});
test('production Starter routing cannot split main test resets or touch Starter practice',async t=>{
  const f=setup(t),starter=fixture();t.after(()=>starter.sql.close());
  starter.sql.exec("INSERT INTO student_daily_question_activity(student_id,day,question_key,outcome,seconds,updated_at) VALUES(2,'2026-10-07','question-bank:4000000000001',1,12,5000)");
  const before=starter.sql.prepare('SELECT * FROM student_daily_question_activity').all();
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});let starterCalls=0;
  globalThis.fetch=(input,init)=>{starterCalls++;return starterProxy.fetch(new Request(input,init),{STARTER_DB:starter.env.DB,STARTER_PROXY_TOKEN:'fixture-only'});};
  Object.assign(f.env,{STARTER_ENABLED:'true',STARTER_PROXY_URL:'https://starter.example.test',STARTER_PROXY_TOKEN:'fixture-only'});
  const originalBatch=f.env.DB.batch;let mainBatches=0;f.env.DB.batch=statements=>{mainBatches++;return originalBatch(statements);};
  assert.equal((await f.reset()).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_submissions WHERE test_id=1 AND student_id=2').get().n,0);
  assert.equal(mainBatches,1,'all reset statements commit as one main transaction');assert.equal(starterCalls,0,'no remote activity reads or writes');
  assert.deepEqual(starter.sql.prepare('SELECT * FROM student_daily_question_activity').all(),before);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM test_attempt_reset_audit WHERE status='completed'").get().n,1);
});
test('with Starter enabled, a failed raw main batch cannot leave a completed archive or partial cleanup',async t=>{
  const f=setup(t),before=f.sql.prepare('SELECT * FROM test_submissions').all();
  Object.assign(f.env,{STARTER_ENABLED:'true',STARTER_PROXY_URL:'https://unavailable-starter.example.test',STARTER_PROXY_TOKEN:'fixture-only'});
  f.env.DB.batch=()=>Promise.reject(Error('fixture atomic failure'));
  assert.equal((await f.reset()).status,503);assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions').all(),before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_attempt_reset_audit').get().n,0);
});
test('super-admin can reset across test owners and list search/pagination stays scoped',async t=>{
  const f=setup(t);
  const list=await (await f.request('/api/users/2/attempted-tests?search=two&limit=1',undefined,{method:'GET',userId:1})).json();
  assert.equal(list.total,1);assert.deepEqual(list.items.map(row=>row.testId),[2]);assert.equal(list.items[0].attemptCount,1);
  assert.equal((await f.request('/api/users/4/test-attempts/reset',{source:'regular',testId:1,latestAttemptId:4},{userId:1})).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM test_submissions WHERE student_id=2').get().n,3);
  const offset=await (await f.request('/api/users/2/attempted-tests?offset=1&limit=1',undefined,{method:'GET',userId:3})).json();assert.equal(offset.items.length,1);assert.equal(offset.items[0].testId,1);
});
test('manifest cursor paginates events sharing the same timestamp without skipping them',async t=>{
  const f=setup(t),insert=f.sql.prepare(`INSERT INTO test_attempt_reset_audit VALUES(?,'regular',1,NULL,2,3,1000,'completed','[]','[]','[]')`);
  for(let n=0;n<205;n++)insert.run(String(n).padStart(4,'0'));
  const page=await (await f.request('/api/users/me/test-attempt-resets',undefined,{method:'GET',userId:2})).json();assert.equal(page.items.length,200);assert.equal(page.hasMore,true);
  const last=page.nextCursor;
  const next=await (await f.request(`/api/users/me/test-attempt-resets?since=${last.resetAt}&afterId=${last.id}`,undefined,{method:'GET',userId:2})).json();assert.equal(next.items.length,5);assert.equal(next.hasMore,false);
  assert.equal(new Set([...page.items,...next.items].map(row=>row.id)).size,205);
});
test('PSU reset crosses the authenticated proxy, preserves original questions and other attempts',async t=>{
  const f=setup(t),p=fixture();t.after(()=>p.sql.close());for(const schema of psuSchemas)p.sql.exec(schema);
  p.sql.exec(`INSERT INTO psus(id,name,slug,is_published) VALUES(1,'PSU','psu',1);
    INSERT INTO psu_tests(id,psu_id,title,bundle_json,is_published) VALUES(1,1,'PSU mock','{"test":{"questions":[]}}',1),(2,1,'Other PSU mock','{}',1);
    INSERT INTO psu_test_questions(test_id,question_order,question_json) VALUES(1,0,'{"question":"A","questionType":"mcq","options":["A","B"],"correctAnswer":0}');
    INSERT INTO psu_test_attempts(id,psu_id,test_id,student_id,answers_json) VALUES(1,1,1,2,'{"1":1}'),(2,1,1,2,'{"1":1}'),(3,1,1,4,'{}'),(4,1,2,2,'{}');
    INSERT INTO psu_test_review_dismissals(student_id,test_id,question_order) VALUES(2,1,0),(4,1,0);`);
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=(input,init)=>psuProxy.fetch(new Request(input,init),{PSU_DB:p.env.DB,PSU_PROXY_TOKEN:'fixture-token'});
  f.env.PSU_PROXY_URL='https://psu.example.test';f.env.PSU_PROXY_TOKEN='fixture-token';
  const questions=p.sql.prepare('SELECT * FROM psu_test_questions').all(),main=f.sql.prepare('SELECT * FROM test_submissions').all();
  let response=await f.request('/api/users/2/attempted-tests?limit=1',undefined,{method:'GET',userId:3});const list=await response.json();assert.equal(list.total,4);assert.equal(list.hasMore,true);assert.equal(list.psuUnavailable,false);
  response=await f.reset({source:'psu',testId:1,latestAttemptId:2});assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(p.sql.prepare('SELECT * FROM psu_test_questions').all(),questions);assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions').all(),main);
  assert.deepEqual(p.sql.prepare('SELECT id FROM psu_test_attempts ORDER BY id').all().map(row=>row.id),[3,4]);
  assert.equal(p.sql.prepare('SELECT COUNT(*) n FROM psu_test_review_dismissals WHERE student_id=2').get().n,0);
  assert.equal(p.sql.prepare('SELECT COUNT(*) n FROM psu_test_review_dismissals WHERE student_id=4').get().n,1);
  const bucket=await f.request('/api/psus/1/review-bucket',undefined,{method:'GET',userId:2});assert.equal(bucket.status,200);assert.deepEqual(await bucket.json(),[]);
  const manifest=await f.request('/api/users/me/test-attempt-resets',undefined,{method:'GET',userId:2});assert.deepEqual((await manifest.json()).items[0].questionIds,[1000000]);
  // Simulate the remote reset succeeding but the main-database cleanup failing.
  p.sql.exec(`INSERT INTO psu_test_attempts(id,psu_id,test_id,student_id,answers_json) VALUES(5,1,1,2,'{}')`);
  f.sql.exec(`INSERT INTO student_daily_question_activity(student_id,day,question_key,outcome,seconds,updated_at) VALUES(2,'2026-10-07','psu-test:1:5:0',0,25,5000)`);
  const originalBatch=f.env.DB.batch;let batches=0;
  f.env.DB.batch=statements=>++batches===2?Promise.reject(Error('fixture cleanup interrupted')):originalBatch(statements);
  response=await f.reset({source:'psu',testId:1,latestAttemptId:5});assert.equal(response.status,503);
  assert.equal(p.sql.prepare('SELECT COUNT(*) n FROM psu_test_attempts WHERE test_id=1 AND student_id=2').get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM test_attempt_reset_audit WHERE status='prepared'").get().n,1);
  f.env.DB.batch=originalBatch;
  const retryList=await (await f.request('/api/users/2/attempted-tests',undefined,{method:'GET',userId:3})).json();
  assert.equal(retryList.items.find(row=>row.source==='psu'&&row.testId===1).latestAttemptId,5,'interrupted reset remains retryable in the admin picker');
  assert.equal((await f.reset({source:'psu',testId:1,latestAttemptId:2})).status,409,'wrong stale request cannot resume a different reset');
  assert.equal((await f.reset({source:'psu',testId:1,latestAttemptId:5})).status,200);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM student_daily_question_activity WHERE question_key='psu-test:1:5:0'").get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM test_attempt_reset_audit WHERE status='prepared'").get().n,0);
  assert.deepEqual(p.sql.prepare('SELECT * FROM psu_test_questions').all(),questions);
  // A newer PSU submission arriving before the guarded batch is not cleared.
  p.sql.exec(`INSERT INTO psu_test_attempts(id,psu_id,test_id,student_id,answers_json) VALUES(6,1,1,2,'{}');INSERT INTO psu_test_review_dismissals(student_id,test_id,question_order) VALUES(2,1,0);`);
  const psuBatch=p.env.DB.batch;let once=true;
  p.env.DB.batch=statements=>{if(once){once=false;p.sql.exec(`INSERT INTO psu_test_attempts(id,psu_id,test_id,student_id,answers_json) VALUES(7,1,1,2,'{}')`);}return psuBatch(statements);};
  assert.equal((await f.reset({source:'psu',testId:1,latestAttemptId:6})).status,409);
  assert.deepEqual(p.sql.prepare('SELECT id FROM psu_test_attempts WHERE student_id=2 AND test_id=1 ORDER BY id').all().map(row=>row.id),[6,7]);
  assert.equal(p.sql.prepare('SELECT COUNT(*) n FROM psu_test_review_dismissals WHERE student_id=2 AND test_id=1').get().n,1);
});
