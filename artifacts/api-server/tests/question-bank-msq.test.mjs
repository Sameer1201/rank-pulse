import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './helpers/worker-fixture.mjs';

for(const [answer,correct] of [[[0,2,3],true],[[3,0,2],true],[[0,2],false],[[0,1,2,3],false]]) {
 test(`MSQ endpoint grades ${JSON.stringify(answer)} as ${correct} and preserves selected set`,async t=>{
  const f=fixture();t.after(()=>f.sql.close());
  f.sql.exec(`UPDATE users SET status='active',subject='GATE' WHERE id=2;
   INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
   INSERT INTO subjects(id,class_id,title) VALUES(1,1,'EDC');
   INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Basics of SC Physics');
   INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer,correct_answer_multi)
   VALUES(1,1,1,1,'Select the CORRECT statement(s) regarding semiconductor devices:','multi','["Auger","Compound","Photons","Steady state"]',0,'[0,2,3]');`);
  const response=await f.request('/api/question-bank-questions/1/attempt',{answer},{userId:2});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).isCorrect,correct);
  const progress=f.sql.prepare('SELECT * FROM question_bank_question_progress WHERE question_id=1 AND student_id=2').get();
  assert.equal(progress.last_is_correct,correct?1:0);
  assert.deepEqual(JSON.parse(progress.last_answer),answer);
  assert.equal(progress.attempt_count,1);assert.equal(progress.correct_count,correct?1:0);assert.equal(progress.incorrect_count,correct?0:1);
 });
}
