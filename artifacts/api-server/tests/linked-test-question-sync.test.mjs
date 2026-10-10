import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './helpers/worker-fixture.mjs';
import {build} from 'esbuild';
const bundled=await build({entryPoints:[new URL('../src/lib/linkedTestQuestionSync.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {linkedTestTargets,linkedTestSyncStatements}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const proxyBundle=await build({entryPoints:[new URL('../../qbank-worker/src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {default:bankProxy}=await import('data:text/javascript;base64,'+Buffer.from(proxyBundle.outputFiles[0].text).toString('base64'));
const starterBundle=await build({entryPoints:[new URL('../../starter-worker/src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {default:starterProxy}=await import('data:text/javascript;base64,'+Buffer.from(starterBundle.outputFiles[0].text).toString('base64'));

function setup(t,{links=true,source=true}={}){
  const f=fixture();t.after(()=>f.sql.close());
  f.sql.exec(`UPDATE users SET status='active',subject='GATE' WHERE id=2;
    INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
    INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Digital');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Boolean');
    INSERT INTO tests(id,title,exam_type,is_published) VALUES(1,'Mock One','GATE',1),(2,'Mock Two','GATE',1),(3,'Unlinked Mock','GATE',1);
    INSERT INTO test_sections(id,test_id,title,"order") VALUES(1,1,'Technical',2);
    INSERT INTO test_questions(id,test_id,section_id,question,question_type,options,option_images,correct_answer,points,negative_marks,solution_text,solution_image_data,ai_solution_text,image_data,"order",question_code,meta)
      VALUES(11,1,1,'Old question','mcq','["Old A","Old B"]','["old image",null]',1,2,0.67,'Old solution','Old solution image','Old AI solution','Old figure',5,'Q11','{"topicTag":"Original test topic"}'),
      (22,2,NULL,'Old question','mcq','["Old A","Old B"]',NULL,1,3,1,'Old solution',NULL,'Old AI solution',NULL,4,'Q22','{}'),
      (33,3,NULL,'Unrelated question','mcq','["A","B"]',NULL,1,1,0.33,'Unrelated solution',NULL,NULL,NULL,0,'Q33','{}'),
      (44,1,1,'Another question','mcq','["A","B"]',NULL,0,1,0.33,'Another solution',NULL,NULL,NULL,6,'Q44','{}');
    INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer,explanation,points)
      VALUES(1,1,1,1,'Old question','mcq','["Old A","Old B"]',1,'Old solution',1);
    INSERT INTO question_bank_reports(id,question_id,class_id,subject_id,chapter_id,reported_by,teacher_id,reason,status) VALUES(1,1,1,1,1,2,1,'Wrong answer','open');
    INSERT INTO test_submissions(id,test_id,student_id,answers,question_timings,score,total_points,submitted_at)
      VALUES(1,1,2,'{"11":0,"44":0}','{"11":25,"44":7}',0.33,3,2000);
    INSERT INTO question_bank_question_progress(question_id,student_id,class_id,subject_id,chapter_id,attempt_count,correct_count,incorrect_count,last_answer,last_is_correct,last_attempted_at)
      VALUES(1,2,1,1,1,1,0,1,'0',0,2000);`);
  if(links)f.sql.exec('INSERT INTO test_question_bank_links(test_id,test_question_id,question_bank_question_id) VALUES(1,11,1),(2,22,1);');
  if(source)f.sql.exec('UPDATE question_bank_questions SET source_test_id=1,source_test_question_id=11 WHERE id=1;');
  const rows=()=>f.sql.prepare('SELECT * FROM test_questions ORDER BY id').all();
  const patch=body=>f.request('/api/question-bank-questions/1',body,{method:'PATCH',userId:1});
  return {...f,rows,patch};
}
test('report fix updates every exact linked test in place, preserves marks/sections/history and deduplicates source links',async t=>{
  const f=setup(t),before=f.rows(),submission=f.sql.prepare('SELECT * FROM test_submissions').get();
  const payload={question:'Corrected <sup>question</sup>',questionType:'mcq',options:['New A','New B'],optionImages:[null,'New option image'],correctAnswer:0,
    correctAnswerMulti:[],correctAnswerMin:null,correctAnswerMax:null,explanation:'<p>Corrected solution</p><img src="data:image/png;base64,AAAA">',imageData:'New figure',points:9,topicTag:'New QBank topic',difficulty:'easy'};
  let response=await f.patch(payload),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
  assert.equal(data.linkedTestQuestionsSynced,2);assert.equal(data.resolvedReportsCount,1);
  const after=f.rows();assert.equal(after.length,before.length);assert.deepEqual(after.map(r=>r.id),before.map(r=>r.id));
  for(const id of [11,22]){
    const old=before.find(r=>r.id===id),row=after.find(r=>r.id===id);
    assert.equal(row.question,payload.question);assert.deepEqual(JSON.parse(row.options),payload.options);
    assert.deepEqual(JSON.parse(row.option_images),payload.optionImages);assert.equal(row.correct_answer,0);
    assert.equal(row.image_data,payload.imageData);assert.equal(row.solution_text,payload.explanation);
    assert.equal(row.solution_image_data,null);assert.equal(row.ai_solution_text,null);
    for(const key of ['id','test_id','section_id','order','points','negative_marks','question_code','meta','source_type','subject_label'])assert.equal(row[key],old[key],key);
  }
  assert.deepEqual(after.filter(r=>![11,22].includes(r.id)),before.filter(r=>![11,22].includes(r.id)));
  assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions').get(),submission);
  assert.equal(f.sql.prepare('SELECT attempt_count,last_is_correct FROM question_bank_question_progress').get().attempt_count,1);
  assert.equal(f.sql.prepare('SELECT last_is_correct FROM question_bank_question_progress').get().last_is_correct,1);
  response=await f.patch(payload);assert.equal(response.status,200);assert.deepEqual(f.rows(),after,'retry does not create or delete a test question');
  assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions').get(),submission);
  const analysis=await f.request('/api/tests/1/my-analysis',undefined,{method:'GET',userId:2});
  assert.equal(analysis.status,200);const review=await analysis.json();
  const question=review.questions?.find(q=>q.id===11)??review.perQuestion?.find(q=>q.id===11);
  assert.ok(question,JSON.stringify(Object.keys(review)));assert.equal(question.isCorrect,true);
  const solutions=await f.request('/api/tests/1/solutions',undefined,{method:'GET',userId:2});assert.equal(solutions.status,200);
  const solutionQuestion=(await solutions.json()).sections.flatMap(section=>section.items).find(q=>q.id===11);
  assert.equal(solutionQuestion.solutionText,payload.explanation);assert.equal(solutionQuestion.solutionImageData,null);
});
test('legacy source identity alone mirrors edits; solution-only updates do not overwrite the key or test marks',async t=>{
  const f=setup(t,{links:false}),before=f.rows();
  const response=await f.patch({explanation:'Replacement solution'});assert.equal(response.status,200);
  assert.equal((await response.json()).linkedTestQuestionsSynced,1);
  const row=f.rows().find(r=>r.id===11);assert.equal(row.solution_text,'Replacement solution');
  for(const key of ['question','options','correct_answer','points','negative_marks','image_data'])assert.equal(row[key],before[0][key]);
  assert.deepEqual(f.rows().find(r=>r.id===22),before.find(r=>r.id===22));
});
test('multi-select and numeric ranges mirror including explicitly cleared answer fields',async t=>{
  const f=setup(t);
  let response=await f.patch({questionType:'multi',correctAnswer:null,correctAnswerMulti:[0,1],correctAnswerMin:null,correctAnswerMax:null});assert.equal(response.status,200);
  for(const row of f.rows().filter(r=>[11,22].includes(r.id))){assert.equal(row.question_type,'multi');assert.deepEqual(JSON.parse(row.correct_answer_multi),[0,1]);}
  response=await f.patch({questionType:'integer',correctAnswer:null,correctAnswerMulti:null,correctAnswerMin:2,correctAnswerMax:2});assert.equal(response.status,200);
  for(const row of f.rows().filter(r=>[11,22].includes(r.id))){assert.equal(row.question_type,'integer');assert.equal(row.correct_answer_multi,null);assert.equal(row.correct_answer_min,2);assert.equal(row.correct_answer_max,2);}
  response=await f.patch({questionType:'mcq',correctAnswer:1,correctAnswerMulti:null,correctAnswerMin:null,correctAnswerMax:null});assert.equal(response.status,200);
  for(const row of f.rows().filter(r=>[11,22].includes(r.id))){assert.equal(row.correct_answer,1);assert.equal(row.correct_answer_min,null);assert.equal(row.correct_answer_max,null);}
});
test('unlinked QBank edits do not text-match or mutate any test question',async t=>{
  const f=setup(t,{links:false,source:false}),before=f.rows();
  const response=await f.patch({question:'New content',correctAnswer:0});assert.equal(response.status,200);
  assert.equal((await response.json()).linkedTestQuestionsSynced,0);assert.deepEqual(f.rows(),before);
});
test('stale/mismatched identities are ignored without recreating a missing test question',async t=>{
  const f=setup(t,{links:false,source:false}),before=f.rows();
  // Both foreign keys are valid, but question 11 belongs to test 1, not test 2.
  f.sql.exec('INSERT INTO test_question_bank_links(test_id,test_question_id,question_bank_question_id) VALUES(2,11,1);UPDATE question_bank_questions SET source_test_id=3,source_test_question_id=999 WHERE id=1;');
  const response=await f.patch({correctAnswer:0});assert.equal(response.status,200);
  assert.equal((await response.json()).linkedTestQuestionsSynced,0);assert.deepEqual(f.rows(),before);
});
test('deleting QBank content never deletes any test question, submission or test',async t=>{
  const f=setup(t),before=f.rows(),submissions=f.sql.prepare('SELECT * FROM test_submissions').all(),tests=f.sql.prepare('SELECT * FROM tests').all();
  const response=await f.request('/api/question-bank-questions/1',undefined,{method:'DELETE',userId:1});assert.equal(response.status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM question_bank_questions').get().n,0);
  assert.deepEqual(f.rows(),before);assert.deepEqual(f.sql.prepare('SELECT * FROM test_submissions').all(),submissions);
  assert.deepEqual(f.sql.prepare('SELECT * FROM tests').all(),tests);
});
test('linked write failure cannot report success or resolve reports; retry completes synchronization',async t=>{
  const f=setup(t),before=f.rows(),original=f.env.DB;
  f.env.DB={...original,batch:()=>Promise.reject(new Error('fixture linked write failure'))};
  let response=await f.patch({question:'Corrected',correctAnswer:0});assert.equal(response.status,503);
  assert.match((await response.json()).error,/Reports remain open/);assert.deepEqual(f.rows(),before);
  assert.equal(f.sql.prepare('SELECT status FROM question_bank_reports').get().status,'open');
  f.env.DB=original;response=await f.patch({question:'Corrected',correctAnswer:0});assert.equal(response.status,200);
  assert.equal((await response.json()).linkedTestQuestionsSynced,2);
  assert.equal(f.sql.prepare('SELECT status FROM question_bank_reports').get().status,'resolved');
});
test('students cannot invoke correction sync or delete a QBank question',async t=>{
  const f=setup(t),before=f.rows();
  for(const method of ['PATCH','DELETE'])assert.equal((await f.request('/api/question-bank-questions/1',method==='PATCH'?{correctAnswer:0}:undefined,{method,userId:2})).status,403);
  assert.deepEqual(f.rows(),before);
});
test('sync planner only emits UPDATEs with exact test/question guards and ignores unrelated metadata',()=>{
  const targets=linkedTestTargets({source_test_id:1,source_test_question_id:11},[{test_id:1,test_question_id:11},{test_id:2,test_question_id:22},{test_id:-1,test_question_id:33}]);
  assert.equal(targets.length,2);
  const statements=linkedTestSyncStatements({question_type:'mcq',correct_answer:null},['correctAnswer','points','difficulty'],targets);
  for(const statement of statements){assert.match(statement.sql,/^UPDATE test_questions SET/);assert.match(statement.sql,/WHERE id = \? AND test_id = \?$/);assert.doesNotMatch(statement.sql,/DELETE|INSERT|REPLACE|points\s*=/);assert.equal(statement.params[0],-1);}
  assert.deepEqual(linkedTestSyncStatements({},['points','difficulty'],targets),[]);
});
for(const scope of ['GATE','JAM','Starter'])test(`${scope} correction on a separate content database updates main test rows, never the shard's retained test copy`,async t=>{
  const main=setup(t),bank=setup(t,{links:false,source:false});
  const qid=scope==='Starter'?4_000_000_000_001:101;
  const classId=scope==='JAM'?2:1;
  for(const f of [main,bank]){
    if(classId===2)f.sql.exec(`INSERT INTO classes(id,title,subject,workflow_type) VALUES(2,'JAM Chemistry','JAM Chemistry','question_bank');
      INSERT INTO subjects(id,class_id,title) VALUES(2,2,'Chemistry');INSERT INTO chapters(id,subject_id,title) VALUES(2,2,'Atomic');`);
    f.sql.prepare(`INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer,difficulty,source_test_id,source_test_question_id)
      VALUES(?,?,?,?,'Shard question','mcq','["A","B"]',1,?,1,11)`).run(qid,classId,classId,classId,scope==='Starter'?'starter':'medium');
  }
  bank.sql.exec('DELETE FROM test_question_bank_links');
  bank.sql.prepare('INSERT INTO test_question_bank_links(test_id,test_question_id,question_bank_question_id) VALUES(2,22,?)').run(qid);
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init);assert.equal(new URL(request.url).origin,'https://content.test');
    return scope==='Starter'?starterProxy.fetch(request,{STARTER_DB:bank.env.DB,STARTER_PROXY_TOKEN:'fixture-only'})
      :bankProxy.fetch(request,{QB_DB:bank.env.DB,QB_PROXY_TOKEN:'fixture-only'});
  };
  const prefix=scope==='Starter'?'STARTER':scope==='JAM'?'JAM_QB':'QB';
  Object.assign(main.env,{[prefix+'_PROXY_URL']:'https://content.test',[prefix+'_PROXY_TOKEN']:'fixture-only'});
  if(scope==='GATE')delete main.env.QB_DB;
  if(scope==='JAM')main.env.JAM_QB_CLASS_IDS='2';
  if(scope==='Starter')main.env.STARTER_ENABLED='true';
  const before=bank.rows(),backup=main.sql.prepare('SELECT * FROM question_bank_questions WHERE id=?').get(qid);
  const response=await main.request(`/api/question-bank-questions/${qid}`,{question:'Fixed in '+scope,correctAnswer:0,explanation:'New shard solution'},{method:'PATCH',userId:1});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.linkedTestQuestionsSynced,2);
  for(const row of main.rows().filter(row=>[11,22].includes(row.id))){assert.equal(row.question,'Fixed in '+scope);assert.equal(row.correct_answer,0);assert.equal(row.solution_text,'New shard solution');}
  assert.deepEqual(bank.rows(),before,'test rows in the content database are not the authoritative linked tests');
  assert.deepEqual(main.sql.prepare('SELECT * FROM question_bank_questions WHERE id=?').get(qid),backup,'retained QBank backup is not edited');
});
