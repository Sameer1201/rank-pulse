import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

function setup(t, answer = 'A', type = 'mcq') {
  const f = fixture(); t.after(() => f.sql.close());
  f.sql.exec(`INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
    INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Digital');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Boolean');`);
  f.sql.prepare(`INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer) VALUES(1,1,1,1,'Example',?,'["Yes","No","-","-"]',1)`).run(type);
  f.sql.prepare(`INSERT INTO question_bank_question_progress(question_id,student_id,class_id,subject_id,chapter_id,attempt_count,correct_count,incorrect_count,last_answer,last_is_correct,first_attempted_at,last_attempted_at)
    VALUES(1,2,1,1,1,1,0,1,?,0,1000,2000)`).run(JSON.stringify(answer));
  const patch = async (body) => {
    const response = await f.request('/api/question-bank-questions/1',body,{method:'PATCH',userId:1});
    assert.equal(response.status,200,await response.text());
    return f.sql.prepare('SELECT * FROM question_bank_question_progress WHERE question_id=1').get();
  };
  return {...f,patch};
}

for (const answer of ['A',' a ',0,'0']) test(`admin correction regrades ${JSON.stringify(answer)} without adding attempts; repeat is idempotent`, async t => {
  const f=setup(t,answer);
  let p=await f.patch({correctAnswer:0});
  assert.equal(p.last_is_correct,1); assert.equal(p.correct_count,1); assert.equal(p.incorrect_count,0);
  assert.equal(p.attempt_count,1); assert.equal(p.last_attempted_at,2000); assert.equal(p.solved_at,2000);
  assert.equal(p.last_answer,JSON.stringify(answer));
  p=await f.patch({correctAnswer:0}); assert.equal(p.correct_count,1); assert.equal(p.incorrect_count,0);
  p=await f.patch({correctAnswer:1}); assert.equal(p.correct_count,0); assert.equal(p.incorrect_count,1); assert.equal(p.solved_at,null);
});
test('multi letters normalize without accepting partial selection',async t=> {
  const f=setup(t,['A','C'],'multi');
  let p=await f.patch({correctAnswerMulti:[0,2]}); assert.equal(p.last_is_correct,1);
  p=await f.patch({correctAnswerMulti:[0,1,2]}); assert.equal(p.last_is_correct,0);
});
test('numeric question does not interpret A as zero',async t=> {
  const f=setup(t,'A','integer');
  const p=await f.patch({correctAnswer:0,correctAnswerMin:0,correctAnswerMax:0}); assert.equal(p.last_is_correct,0);
});
test('question type correction triggers regrading',async t=> {
  const f=setup(t,'B','integer');
  const p=await f.patch({questionType:'mcq'}); assert.equal(p.last_is_correct,1);
});
test('missing answer key and malformed answers never become option A',async t=> {
  const f=setup(t,'');
  let p=await f.patch({correctAnswer:0}); assert.equal(p.last_is_correct,0);
  p=await f.patch({correctAnswer:null}); assert.equal(p.last_is_correct,0);
});
test('regrade corrects the original activity day and expires only that student dashboard',async t=> {
  const f=setup(t);
  f.sql.exec(`INSERT INTO student_daily_question_activity VALUES(2,'1970-01-01','question-bank:1',0,42,2000,2000);
    INSERT INTO student_dashboard_cache VALUES(2,'{}',12345),(1,'{}',12345);`);
  await f.patch({correctAnswer:0});
  const totals=f.sql.prepare('SELECT * FROM student_daily_activity_totals WHERE student_id=2').get();
  assert.equal(totals.correct,1); assert.equal(totals.wrong,0); assert.equal(totals.seconds,42);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM student_daily_question_activity').get().n,1);
  assert.equal(f.sql.prepare('SELECT updated_at FROM student_dashboard_cache WHERE student_id=2').get().updated_at,0);
  assert.equal(f.sql.prepare('SELECT updated_at FROM student_dashboard_cache WHERE student_id=1').get().updated_at,12345);
  await f.patch({correctAnswer:0});
  assert.equal(f.sql.prepare('SELECT correct FROM student_daily_activity_totals WHERE student_id=2').get().correct,1);
});
