import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/worker-fixture.mjs';

const bundle = await build({ entryPoints: [new URL('../src/lib/studentWeeklyActivity.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { activityWeekStart, activityWeekForDay, validActivityWeek, readWeeklyActivity, activityAnswerStatement, recordTestActivity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const at = Date.parse('2026-10-05T12:00:00Z');
function setup(t) {
  const f = fixture(); t.after(() => f.sql.close());
  f.sql.exec("UPDATE student_activity_tracking SET started_at = 1790879400000"); // Oct 2 IST
  return f;
}
function timer(f, seconds, timestamp = at, id = 1, exam = 'gate') {
  f.sql.prepare(`INSERT INTO student_question_timers VALUES (2,'pyq',?,?,?,?) ON CONFLICT(student_id,source_type,exam_key,question_id)
    DO UPDATE SET time_spent_seconds=MAX(time_spent_seconds,excluded.time_spent_seconds),updated_at=excluded.updated_at`).run(exam,id,seconds,timestamp);
}

test('rolling seven days follow IST midnight, including month/year boundaries and non-Monday starts', () => {
  assert.equal(activityWeekStart(Date.parse('2026-10-04T18:29:59Z')), '2026-09-28');
  assert.equal(activityWeekStart(Date.parse('2026-10-04T18:30:00Z')), '2026-09-29');
  assert.equal(activityWeekStart(Date.parse('2026-10-07T12:00:00Z')), '2026-10-01');
  assert.equal(activityWeekStart(Date.parse('2026-01-01T12:00:00Z')), '2025-12-26');
  assert.equal(activityWeekStart(Date.parse('2024-03-01T12:00:00Z')), '2024-02-24');
  for (const bad of ['2026-02-30','2026-09-30','2026-10-12',"2026-10-05' OR 1=1",'x']) assert.equal(validActivityWeek(bad,at),false);
  assert.equal(validActivityWeek('2026-09-29',at),true);
  assert.equal(validActivityWeek('2026-09-28',at),true);
  assert.equal(activityWeekForDay('2026-09-28',at),'2026-09-22');
});

test('visits, reanswers, unknown keys, duplicate saves and out-of-order outcomes never inflate totals', async t => {
  const f=setup(t);
  timer(f,0); timer(f,30); timer(f,30); timer(f,10);
  let week=await readWeeklyActivity(f.env.DB,2,'2026-10-05',at);
  assert.equal(week.days[6].seconds,30); assert.equal(week.days[6].unanswered,1);
  await activityAnswerStatement(f.env.DB,2,'pyq:gate:1',false,at).run();
  await activityAnswerStatement(f.env.DB,2,'pyq:gate:1',true,at+5).run();
  await activityAnswerStatement(f.env.DB,2,'pyq:gate:1',false,at).run();
  timer(f,40,at+10); // a later timer must not undo a submitted result
  await activityAnswerStatement(f.env.DB,2,'question-bank:1',null,at).run();
  timer(f,9,at,1,'jam-chemistry'); // same id, different exam
  week=await readWeeklyActivity(f.env.DB,2,'2026-10-05',at);
  assert.deepEqual([week.days[6].correct,week.days[6].wrong,week.days[6].unanswered,week.days[6].ungraded,week.days[6].seconds],[1,0,1,1,49]);
});

test('daily timer deltas do not recount lifetime time and last week remains unchanged', async t => {
  const f=setup(t);
  timer(f,180,Date.parse('2026-10-04T12:00:00Z'));
  await activityAnswerStatement(f.env.DB,2,'pyq:gate:1',false,Date.parse('2026-10-04T12:00:00Z')).run();
  timer(f,195,at);
  await activityAnswerStatement(f.env.DB,2,'pyq:gate:1',true,at).run();
  const previous=await readWeeklyActivity(f.env.DB,2,'2026-09-28',at);
  const yesterday=previous.days.find(day=>day.date==='2026-10-04');
  assert.equal(yesterday.seconds,180); assert.equal(yesterday.wrong,1);
  const current=await readWeeklyActivity(f.env.DB,2,'2026-10-05',at);
  assert.equal(current.days[6].seconds,15); assert.equal(current.days[6].correct,1);
  assert.equal(current.end,'2026-10-05');
  assert.ok(current.days.every(day=>day.date<=current.today),'never plots upcoming days');
});

test('test sessions record visited-only and numeric-zero answers, are idempotent, and preserve total time without inventing visits', async t => {
  const f=setup(t);
  const questions=[{id:1,visited:true,answered:true,correct:true,seconds:30},{id:2,visited:true,answered:false,correct:null,seconds:10},{id:3,visited:false,answered:false,correct:null,seconds:0}];
  for(let i=0;i<2;i++) await recordTestActivity(f.env.DB,2,'test:1:11',questions,at,50);
  const day=(await readWeeklyActivity(f.env.DB,2,'2026-10-05',at)).days[6];
  assert.deepEqual([day.correct,day.wrong,day.unanswered,day.seconds],[1,0,1,50]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM student_daily_question_activity').get().n,3);
});

test('history gaps stay unavailable and pre-tracking JAM retries do not manufacture history', async t => {
  const f=setup(t);
  await activityAnswerStatement(f.env.DB,2,'pyq:jam-chemistry:99',true,Date.parse('2026-09-30T12:00:00Z')).run();
  const week=await readWeeklyActivity(f.env.DB,2,'2026-09-28',at);
  assert.equal(week.days[0].available,false); assert.equal(week.days[0].correct,null);
  assert.equal(week.days[4].partial,true); assert.equal(week.days[4].correct,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM student_daily_question_activity').get().n,0);
});

test('weekly API authenticates, isolates students, validates ranges and reads only indexed daily summaries', async t => {
  const f=setup(t); const now=Date.now(); const start=activityWeekStart(now);
  await activityAnswerStatement(f.env.DB,2,'question-bank:12',true,now).run();
  f.sql.prepare("INSERT INTO student_daily_activity_totals VALUES(999,?,999,0,0,0,999)").run(start);
  const calls=[]; const prepare=f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare=sql=>{calls.push(sql);return prepare(sql);};
  assert.equal((await f.request('/api/student/activity/week',undefined,{method:'GET'})).status,401);
  assert.equal((await f.request('/api/student/activity/week',undefined,{method:'GET',userId:1})).status,403);
  assert.equal((await f.request('/api/student/activity/week?start=bad',undefined,{method:'GET',userId:2})).status,400);
  const response=await f.request(`/api/student/activity/week?start=${start}&studentId=999`,undefined,{method:'GET',userId:2});
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json(); assert.equal(data.days.length,7); assert.equal(data.days.reduce((s,d)=>s+(d.correct??0),0),1);
  assert.equal(data.start,start);
  assert.equal(data.end,new Date(now+330*60000).toISOString().slice(0,10));
  const defaultResponse=await f.request('/api/student/activity/week',undefined,{method:'GET',userId:2});
  assert.equal(defaultResponse.status,200);
  assert.equal((await defaultResponse.json()).start,start,'route defaults to today minus six days');
  assert.ok(!calls.some(sql=>/FROM (pyq_questions|question_bank_questions|test_submissions)/.test(sql)));
  const plan=f.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM student_daily_activity_totals WHERE student_id = ? AND day >= ? AND day <= ?').all(2,start,'2099-01-01');
  assert.ok(plan.some(row=>row.detail.includes('USING INDEX')),JSON.stringify(plan));
});

test('real Question Bank attempt route records the server grade; timer visit becomes answered', async t => {
  const f=setup(t);
  f.sql.exec(`UPDATE users SET status='active',subject='GATE' WHERE id=2;
    INSERT INTO classes(id,title,subject,workflow_type) VALUES(1,'GATE','GATE','question_bank');
    INSERT INTO subjects(id,class_id,title) VALUES(1,1,'Physics');
    INSERT INTO chapters(id,subject_id,title) VALUES(1,1,'Chapter');
    INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,question_type,options,correct_answer) VALUES(1,1,1,1,'Test','mcq','["A","B"]',0);`);
  const visit=await f.request('/api/question-bank/questions/1/time',{exam:'gate',timeSpentSeconds:0},{userId:2});
  assert.equal(visit.status,200,await visit.text());
  const beforeSubmit=await f.request('/api/question-bank/questions/1/time',{exam:'gate',timeSpentSeconds:35},{userId:2});
  assert.equal((await beforeSubmit.json()).timeSpentSeconds,35);
  const attempt=await f.request('/api/question-bank-questions/1/attempt',{answer:0,isCorrect:false},{userId:2});
  assert.equal(attempt.status,200,await attempt.text());
  const afterSubmit=await f.request('/api/question-bank/questions/1/time',{exam:'gate',timeSpentSeconds:99},{userId:2});
  assert.equal(afterSubmit.status,200);
  assert.equal((await afterSubmit.json()).timeSpentSeconds,35);
  assert.equal(f.sql.prepare("SELECT time_spent_seconds FROM student_question_timers WHERE student_id = 2 AND source_type = 'question-bank' AND question_id = 1").get().time_spent_seconds,35);
  const week=await readWeeklyActivity(f.env.DB,2,activityWeekStart());
  assert.equal(week.days.reduce((s,d)=>s+(d.correct??0),0),1);
  assert.equal(week.days.reduce((s,d)=>s+(d.unanswered??0),0),0);
});

test('history bounds are indexed, student-specific and rolling; quiet latest days remain zero', async t => {
  const f=setup(t),now=Date.parse('2026-10-19T12:00:00Z');
  await activityAnswerStatement(f.env.DB,2,'question-bank:1',true,Date.parse('2026-10-03T12:00:00Z')).run();
  await activityAnswerStatement(f.env.DB,2,'question-bank:2',false,Date.parse('2026-10-12T12:00:00Z')).run();
  f.sql.exec("INSERT INTO student_daily_activity_totals VALUES(999,'2026-10-02',99,0,0,0,0),(2,'2099-01-01',99,0,0,0,0),(2,'2020-01-01',99,0,0,0,0)");
  const calls=[],prepare=f.env.DB.prepare.bind(f.env.DB);f.env.DB.prepare=sql=>{calls.push(sql);return prepare(sql);};
  const latest=await readWeeklyActivity(f.env.DB,2,'2026-10-19',now);
  assert.equal(latest.start,'2026-10-13');assert.equal(latest.end,'2026-10-19');
  assert.equal(latest.firstAvailableWeek,'2026-09-29');assert.equal(latest.lastAvailableWeek,'2026-10-13');
  assert.equal(latest.days.reduce((n,d)=>n+(d.wrong??0),0),0);
  assert.ok(latest.days.every(day=>day.available && day.seconds===0));
  assert.equal(calls.length,2,'one bounds/tracking statement + at most seven indexed summary rows');
  const metadata=calls[0];
  const plans=f.sql.prepare('EXPLAIN QUERY PLAN '+metadata).all(2,'2026-10-19',2,'2026-10-19');
  assert.equal(plans.filter(row=>row.detail.includes('COVERING INDEX')).length,2,JSON.stringify(plans));
  assert.ok(!plans.some(row=>/SCAN student_daily|TEMP B-TREE/.test(row.detail)),JSON.stringify(plans));
  const previous=await readWeeklyActivity(f.env.DB,2,'2026-10-06',now);assert.equal(previous.days[6].wrong,1);
  const earliest=await readWeeklyActivity(f.env.DB,2,'2020-01-06',now);assert.equal(earliest.start,'2026-09-29');
  assert.equal(earliest.days[4].correct,1);
  const tomorrow=Date.parse('2026-10-20T12:00:00Z');
  const rolled=await readWeeklyActivity(f.env.DB,2,activityWeekStart(tomorrow),tomorrow);
  assert.equal(rolled.start,'2026-10-14');assert.equal(rolled.end,'2026-10-20');
  assert.equal(rolled.firstAvailableWeek,'2026-09-30','older ranges move with the rolling anchor');
  const lastWindow=await readWeeklyActivity(f.env.DB,2,'2026-09-30',tomorrow);
  assert.equal(lastWindow.days[3].correct,1,'earliest recorded day remains reachable after midnight');
  const empty=await readWeeklyActivity(f.env.DB,123,'2026-10-19',now);assert.equal(empty.firstAvailableWeek,null);assert.equal(empty.lastAvailableWeek,null);
});

test('real GATE and JAM PYQ attempt routes retain separate daily results for identical IDs', async t => {
  const f=setup(t);
  for (const name of ['0001_initial.sql','0002_subject_chapters.sql','0003_pyq_attempt_features.sql','0004_pyq_progress_reports.sql']) f.sql.exec(readFileSync(new URL('../../pyq-worker/migrations/'+name,import.meta.url),'utf8'));
  f.sql.exec(`UPDATE users SET status='active',subject='gate' WHERE id=2;
    INSERT INTO pyq_questions(id,exam,subject,chapter,question,year,created_by,correct_answer) VALUES(1,'GATE EC','Physics','A','Question',2020,1,0);`);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://gate.example.test',PYQ_PROXY_TOKEN:'test',JAM_PYQ_PROXY_URL:'https://jam.example.test',JAM_PYQ_PROXY_TOKEN:'test'});
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    const {sql,params}=JSON.parse(options.body);
    return Response.json({ok:true,results:f.sql.prepare(sql).all(...params)});
  });
  const firstTime=await f.request('/api/pyq/questions/1/time',{exam:'GATE EC',timeSpentSeconds:12},{userId:2});
  assert.equal(firstTime.status,200,await firstTime.text());
  for(const [exam,answer] of [['GATE EC',0],['JAM Chemistry',1]]) {
    const response=await f.request('/api/pyq/questions/1/attempt',{exam,answer},{userId:2});
    assert.equal(response.status,200,await response.text());
    if(exam==='GATE EC') {
      const laterTime=await f.request('/api/pyq/questions/1/time',{exam,timeSpentSeconds:90},{userId:2});
      assert.equal(laterTime.status,200);
      assert.equal((await laterTime.json()).timeSpentSeconds,12);
    }
  }
  const day=(await readWeeklyActivity(f.env.DB,2,activityWeekStart())).days.find(day=>day.correct===1);
  assert.equal(day.wrong,1);
});

test('real submitted test includes only opened or answered questions and saves question timing', async t => {
  const f=setup(t);
  f.sql.exec(`UPDATE users SET status='active',subject='GATE' WHERE id=2;
    INSERT INTO tests(id,title,exam_type,is_published) VALUES(1,'Test','gate',1);
    INSERT INTO test_questions(id,test_id,question,correct_answer) VALUES(1,1,'Q1',0),(2,1,'Q2',0),(3,1,'Q3',0);`);
  const result=await f.request('/api/tests/1/submit',{answers:{1:0},visitedQuestionIds:[1,2],questionTimings:{1:45,2:5}},{userId:2});
  assert.equal(result.status,201,await result.text());
  const week=await readWeeklyActivity(f.env.DB,2,activityWeekStart());
  assert.equal(week.days.reduce((s,d)=>s+(d.correct??0),0),1);
  assert.equal(week.days.reduce((s,d)=>s+(d.unanswered??0),0),1);
  assert.equal(week.days.reduce((s,d)=>s+(d.seconds??0),0),50);
});
