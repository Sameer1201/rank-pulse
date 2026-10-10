import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

test('profile insights resolve real catalog names across progress records and keep every attempt', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  f.sql.exec('PRAGMA foreign_keys=OFF'); // content shards do not share main-DB foreign keys
  f.sql.exec(`INSERT INTO subjects(id,title) VALUES(39,'EDC'),(40,'Digital Electronics');
    INSERT INTO chapters(id,subject_id,title) VALUES(295,39,'Basics of SC Physics'),(296,39,'Hall Effect'),(300,40,'Boolean Theorems');`);
  const insert = f.sql.prepare('INSERT INTO question_bank_question_progress(question_id,student_id,class_id,subject_id,chapter_id,attempt_count,correct_count) VALUES(?,2,1,?,?,?,?)');
  for(let i=0;i<15;i++)insert.run(1000+i,39,i<13?295:296,1,i%2);
  insert.run(2000,40,300,3,2); // retakes remain counted
  insert.run(2001,999,888,1,0); // deleted catalog entries are never blank
  insert.run(2002,40,300,0,0); // a visit is not an attempt
  const queries=[];
  const prepare=f.env.DB.prepare.bind(f.env.DB);
  t.mock.method(f.env.DB,'prepare',sql=>{queries.push(sql);return prepare(sql);});
  const response=await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
  const rows=data.questionBankPerformance;
  assert.equal(rows.length,3,'one row per subject across all chapters');
  assert.deepEqual(rows.find(r=>r.key==='39'),{key:'39',subject:'EDC',attempted:15,correct:7,accuracy:46.7});
  assert.equal(rows.find(r=>r.key==='40').attempted,3);
  assert.equal(rows.find(r=>r.key==='999').subject,'Subject unavailable');
  assert.ok(rows.every(row=>!('topic' in row)));
  assert.equal(rows.reduce((n,r)=>n+r.attempted,0),19,'not truncated to the first 12 questions');
  assert.equal(rows.reduce((n,r)=>n+r.correct,0),9);
  assert.equal(data.overview.totalPracticeAttempts,19);
  assert.equal(data.overview.practiceAccuracy,47);
  assert.equal(queries.filter(sql=>/SELECT id, title FROM (subjects|chapters)/.test(sql)).length,1,'only one indexed subject lookup');
  assert.ok(!queries.some(sql=>/FROM chapters\b/.test(sql)),'no chapter metadata read');
  assert.ok(!queries.some(sql=>/FROM question_bank_questions\b/.test(sql)),'no content/question scan');
  assert.match(f.sql.prepare('EXPLAIN QUERY PLAN SELECT id,title FROM subjects WHERE id IN (SELECT value FROM json_each(?))').all('[39,40]').map(r=>r.detail).join('\n'),/SEARCH subjects USING INTEGER PRIMARY KEY/);
});

test('empty profile performance skips catalog queries and keeps insights admin-only',async t=>{
  const f=fixture();t.after(()=>f.sql.close());
  f.sql.exec("UPDATE users SET status='active' WHERE id=2");
  const queries=[],prepare=f.env.DB.prepare.bind(f.env.DB);
  t.mock.method(f.env.DB,'prepare',sql=>{queries.push(sql);return prepare(sql);});
  const response=await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).questionBankPerformance,[]);
  assert.equal(queries.filter(sql=>/SELECT id, title FROM (subjects|chapters)/.test(sql)).length,0);
  assert.equal((await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:2})).status,403);
  assert.equal((await f.request('/api/users/2/profile-insights',undefined,{method:'GET'})).status,401);
});

test('study heatmap contains four calendar weeks, including inactive days, without truncating streak history',async t=>{
  const f=fixture();t.after(()=>f.sql.close());
  const today=Date.parse(new Date().toISOString().slice(0,10)+'T12:00:00Z');
  const insert=f.sql.prepare('INSERT INTO user_activity_logs(user_id,action,created_at) VALUES(2,?,?)');
  for(let offset=0;offset<40;offset++)insert.run('practice',today-offset*86400000);
  const res=await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1}),data=await res.json();
  assert.equal(res.status,200);
  assert.equal(data.studyStreak.heatmap.length,28);
  assert.equal(data.studyStreak.heatmap[0].date,new Date(today-27*86400000).toISOString().slice(0,10));
  assert.equal(data.studyStreak.heatmap.at(-1).date,new Date(today).toISOString().slice(0,10));
  assert.equal(data.studyStreak.currentStreak,40);assert.equal(data.studyStreak.longestStreak,40);
  assert.equal(data.studyStreak.totalActiveDays,40);
  f.sql.exec('DELETE FROM user_activity_logs WHERE user_id=2');
  const empty=await(await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1})).json();
  assert.equal(empty.studyStreak.heatmap.length,28);assert.ok(empty.studyStreak.heatmap.every(day=>day.count===0&&day.level===0));
  assert.equal(empty.studyStreak.currentStreak,0);
});
