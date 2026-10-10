import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/worker-fixture.mjs';

function setup(t, exam = 'GATE') {
  const f = fixture();
  t.after(() => f.sql.close());
  for (const name of ['20261002_jam_pyq_question_time.sql', '20261002_student_question_timers.sql']) {
    f.sql.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  f.sql.prepare("UPDATE users SET subject=?, status='active' WHERE id=2").run(exam);
  f.sql.prepare('INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,?,?,?)').run(exam,exam,'question_bank');
  f.sql.exec(`INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Physics');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Chapter'),(2,1,'Other chapter');`);
  const insert = f.sql.prepare('INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer,explanation,"order") VALUES(?,1,1,?,?,\'mcq\',\'["A","B","C","D"]\',0,?,?)');
  for (let id=1; id<=201; id++) insert.run(id,id===201?2:1,`Question ${id}`,`Explanation ${id}`,id);
  f.sql.exec(`INSERT INTO question_bank_question_progress(question_id,student_id,class_id,subject_id,chapter_id,attempt_count,correct_count,last_is_correct,first_attempted_at,last_attempted_at) VALUES(180,2,1,1,1,2,1,1,1000,2000);
    INSERT INTO question_bank_saved_questions(question_id,student_id) VALUES(180,2);
    INSERT INTO question_bank_reports(question_id,class_id,subject_id,chapter_id,teacher_id,reported_by,reason,status) VALUES(180,1,1,1,1,2,'Fix this','open'),(181,1,1,1,1,2,'Other question','open');`);
  const key = exam === 'GATE' ? 'gate' : 'jam-chemistry';
  f.sql.prepare("INSERT INTO student_question_timers VALUES(2,'question-bank',?,180,42,1000)").run(key);
  const queries=[];
  const prepare=f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = query => {
    const entry = { query, params: [] }; queries.push(entry);
    const statement=prepare(query), bind=statement.bind;
    statement.bind=function(...params){entry.params=params; return bind.apply(this,params);};
    return statement;
  };
  const get = async (search, userId=2, status=200) => {
    const response=await f.request('/api/question-bank/chapters/1/questions'+search,undefined,{method:'GET',userId});
    const body=await response.json(); assert.equal(response.status,status,JSON.stringify(body)); return body;
  };
  return {...f,get,queries};
}

test('admin report edit reads only the requested question, with only its reports', async t => {
  const f=setup(t);
  const result=await f.get('?questionId=180',1);
  assert.deepEqual(result.questions.map(q=>q.id),[180]);
  assert.equal(result.questions[0].explanation,'Explanation 180');
  assert.equal(result.questions[0].reports.length,1);
  assert.equal(result.questions[0].reports[0].reason,'Fix this');
  const select=f.queries.find(q=>q.query.includes('FROM question_bank_questions NOT INDEXED WHERE'));
  assert.ok(select.query.includes('id IN (SELECT value FROM json_each(?))'));
  assert.deepEqual(select.params,[1,'[180]']);
  const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+select.query).all(...select.params).map(row=>row.detail);
  assert.ok(plan.some(detail=>detail.includes('USING INTEGER PRIMARY KEY')),JSON.stringify(plan));
  assert.deepEqual((await f.get('?questionId=201',1)).questions,[],'A different chapter must not leak');
  for(const query of ['?questionId=','?questionId=bad','?questionId=12garbage','?questionId=-1','?questionId=1&questionIds=2']) await f.get(query,1,400);
});

for (const exam of ['GATE','JAM Chemistry']) {
  test(`${exam}: 200-question chapter loads a lean index, then bounded content without losing progress`,async t => {
    const f=setup(t,exam);
    const index=await f.get('?indexOnly=1');
    assert.equal(index.questions.length,200);
    for(const row of index.questions) {
      assert.equal('question' in row,false); assert.equal('options' in row,false);
      assert.equal('explanation' in row,false); assert.equal('imageData' in row,false);
    }
    const current=index.questions.find(q=>q.id===180);
    assert.equal(current.progress.attemptCount,2);
    assert.equal(current.isSaved,true); assert.equal(current.timeSpentSeconds,42);
    assert.ok(!f.queries.some(q=>q.query.includes('FROM question_bank_reports')),'Students never fetch report bodies');
    const ids=[];
    for(let start=0; start<200; start+=20) {
      const batchIds=index.questions.slice(start,start+20).map(q=>q.id);
      const page=await f.get('?questionIds='+batchIds.join(','));
      assert.equal(page.questions.length,20);
      assert.equal(page.questions[0].question,`Question ${start+1}`);
      ids.push(...page.questions.map(q=>q.id));
    }
    assert.deepEqual(ids,index.questions.map(q=>q.id),'No missing/duplicate questions across page boundaries');
    assert.equal((await f.get('')).questions.length,20,'Legacy unbounded student fetch is capped');
    assert.deepEqual((await f.get('?indexOnly=1&saved=1')).questions.map(q=>q.id),[180]);
    const single=await f.get('?questionId=180');
    assert.equal(single.questions.length,1); assert.equal(single.questions[0].timeSpentSeconds,42);
    const contentQueries=f.queries.filter(q=>q.query.includes('FROM question_bank_questions NOT INDEXED WHERE'));
    assert.ok(contentQueries.length >= 11);
    for(const query of contentQueries) {
      const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+query.query).all(...query.params).map(row=>row.detail);
      assert.ok(plan.some(detail=>detail.includes('USING INTEGER PRIMARY KEY')),JSON.stringify(plan));
    }
    await f.get('?questionIds='+Array.from({length:21},(_,i)=>i+1).join(','),2,400);
    await f.get('?indexOnly=1&questionId=180',2,400);
    f.sql.prepare("UPDATE users SET subject='NEET' WHERE id=2").run();
    await f.get('?questionId=180',2,403);
  });
}

test('open report queue spans chapters, paginates past 100 and excludes resolved content on the server', async t => {
  const f=setup(t);
  f.sql.exec("UPDATE question_bank_reports SET status='resolved';");
  const insert=f.sql.prepare("INSERT INTO question_bank_reports(question_id,class_id,subject_id,chapter_id,teacher_id,reported_by,reason,status,created_at) VALUES(?,1,1,?,1,2,'Review','open',1000)");
  for(let id=1;id<=105;id++) insert.run(id,1);
  insert.run(201,2);
  const received=[]; let cursor=null;
  do {
    const response=await f.request('/api/question-bank/reports?status=open&limit=100'+(cursor?'&cursor='+cursor:''),undefined,{method:'GET',userId:1});
    assert.equal(response.status,200);
    const body=await response.json(); received.push(...body.reports); cursor=body.nextCursor;
  } while(cursor);
  assert.equal(received.length,106);
  assert.equal(new Set(received.map(r=>r.id)).size,106);
  assert.ok(received.every(r=>r.status==='open' && r.subjectTitle==='Physics'));
  assert.equal(received.find(r=>r.questionId===201).chapterTitle,'Other chapter');
  assert.ok(!received.some(r=>[180,181].includes(r.questionId)));
  const contentReads=f.queries.filter(q=>q.query.includes('SELECT id, question, class_id AS classId'));
  assert.equal(contentReads.length,2);
  assert.ok(contentReads.every(q=>q.params.length<=100));
  assert.ok(contentReads.every(q=>!q.params.includes(180)&&!q.params.includes(181)));
  f.sql.exec("UPDATE question_bank_reports SET status='resolved' WHERE question_id=201");
  const next=await f.request('/api/question-bank/reports?status=open&limit=100',undefined,{method:'GET',userId:1});
  assert.ok(!(await next.json()).reports.some(r=>r.questionId===201));
  assert.equal((await f.request('/api/question-bank/reports?status=open',undefined,{method:'GET',userId:2})).status,403);
});
