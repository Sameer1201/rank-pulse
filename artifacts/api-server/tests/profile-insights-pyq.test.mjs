import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers/worker-fixture.mjs';

const jamSchema=await readFile(new URL('../migrations/20260929_jam_pyq_solution_lock.sql',import.meta.url),'utf8');
function contentDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE pyq_questions(id INTEGER PRIMARY KEY,subject TEXT,chapter TEXT);
    CREATE TABLE pyq_question_progress(question_id INTEGER,student_id INTEGER,attempt_count INTEGER,correct_count INTEGER);
    CREATE INDEX progress_student_idx ON pyq_question_progress(student_id,question_id);`);
  return db;
}
test('profile PYQ covers GATE/JAM, retakes and delayed JAM projections without question scans or double counting',async t=>{
  const f=fixture(),gate=contentDb(),jam=contentDb();t.after(()=>{f.sql.close();gate.close();jam.close();});
  f.sql.exec(jamSchema);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://fixture-gate.example.test',PYQ_PROXY_TOKEN:'fake-gate-token',JAM_PYQ_PROXY_URL:'https://fixture-jam.example.test',JAM_PYQ_PROXY_TOKEN:'fake-jam-token'});
  gate.exec(`INSERT INTO pyq_questions VALUES(100,'EDC','Diffusion'),(101,'EDC','Diffusion'),(102,'EDC','Hall Effect');
    INSERT INTO pyq_question_progress VALUES(100,2,3,2),(101,2,1,1),(102,2,1,0),(999,2,1,0),(102,99,500,500),(101,2,0,0);`);
  jam.exec(`INSERT INTO pyq_questions VALUES(100,'EDC','Diffusion'),(201,'Inorganic Chemistry','Bioinorganic'),(202,'Inorganic Chemistry','Bioinorganic');
    INSERT INTO pyq_question_progress VALUES(100,2,1,1),(201,99,400,400),(201,2,0,0);`);
  f.sql.exec(`INSERT INTO jam_pyq_submissions VALUES(2,100,'0',1,1000),(2,201,'1',0,1000),(2,202,'0',1,1000),(99,201,'0',1,1000);`);
  const queries=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const host=new URL(url).hostname,body=JSON.parse(options.body),db=host==='fixture-gate.example.test'?gate:jam;
    assert.ok(['fixture-gate.example.test','fixture-jam.example.test'].includes(host));
    assert.equal(body.method,'all');queries.push({host,...body});
    return Response.json({ok:true,results:db.prepare(body.sql).all(...body.params)});
  });
  const res=await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1}),data=await res.json();
  assert.equal(res.status,200);assert.deepEqual(data.pyqPerformanceUnavailable,[]);
  const rows=data.pyqPerformance;
  assert.equal(rows.length,4);
  assert.deepEqual(rows.find(r=>r.exam==='GATE'&&r.subject==='EDC'),{key:'["gate","EDC"]',exam:'GATE',subject:'EDC',attempted:5,correct:3,accuracy:60});
  assert.equal(rows.find(r=>r.exam==='JAM Chemistry'&&r.subject==='EDC').attempted,1,'same question ID across shards is separate; immutable submission is deduplicated');
  assert.deepEqual(rows.find(r=>r.subject==='Inorganic Chemistry'),{key:'["jam","Inorganic Chemistry"]',exam:'JAM Chemistry',subject:'Inorganic Chemistry',attempted:2,correct:1,accuracy:50});
  assert.equal(rows.find(r=>r.subject==='Subject unavailable').attempted,1,'deleted metadata is explicit');
  assert.ok(rows.every(row=>!('topic' in row)));
  assert.equal(rows.reduce((sum,r)=>sum+r.attempted,0),9);
  assert.equal(rows.reduce((sum,r)=>sum+r.correct,0),5);
  assert.equal(queries.length,3,'one lean query per source and one batched missing-metadata lookup');
  const progressReads=queries.filter(q=>q.sql.includes('FROM pyq_question_progress'));
  assert.equal(progressReads.length,2);
  assert.ok(progressReads.every(q=>q.params.length===1&&q.params[0]===2));
  assert.ok(queries.every(q=>!/(?:SELECT \*|correct_answer|options_json|image_data|answer_json)/i.test(q.sql)));
  assert.ok(queries.every(q=>!/\bchapter\b/i.test(q.sql)),'topic metadata is not read');
  const metadataRead=queries.find(q=>q.sql.includes('json_each'));
  assert.deepEqual(JSON.parse(metadataRead.params[0]),[201,202]);
  const plan=gate.prepare('EXPLAIN QUERY PLAN '+progressReads[0].sql).all(2).map(row=>row.detail).join('\n');
  assert.match(plan,/SEARCH p USING INDEX progress_student_idx/);assert.match(plan,/SEARCH q USING INTEGER PRIMARY KEY/);
  assert.doesNotMatch(plan,/SCAN (?:p|q)\b/);
  f.sql.exec("UPDATE users SET status='active' WHERE id=2");
  assert.equal((await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:2})).status,403);
  assert.equal(queries.length,3,'unauthorized callers trigger no PYQ reads');
});

test('an unavailable PYQ shard does not hide the other source or invent zero results',async t=>{
  const f=fixture();t.after(()=>f.sql.close());f.sql.exec(jamSchema);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://fixture-gate.example.test',PYQ_PROXY_TOKEN:'fake-token',JAM_PYQ_PROXY_URL:'https://fixture-jam.example.test',JAM_PYQ_PROXY_TOKEN:'fake-token'});
  t.mock.method(globalThis,'fetch',async(url)=>new URL(url).hostname.includes('gate')
    ? Response.json({error:'unavailable'},{status:503})
    : Response.json({ok:true,results:[{question_id:1,subject:'Organic Chemistry',chapter:'Reactions',attempt_count:2,correct_count:1}]}));
  const res=await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1}),data=await res.json();
  assert.equal(res.status,200);assert.deepEqual(data.pyqPerformanceUnavailable,['GATE']);
  assert.equal(data.pyqPerformance.length,1);assert.equal(data.pyqPerformance[0].accuracy,50);
});

test('no PYQ attempts produces a clean empty result with no metadata fetch',async t=>{
  const f=fixture();t.after(()=>f.sql.close());f.sql.exec(jamSchema);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://fixture-gate.example.test',PYQ_PROXY_TOKEN:'fake-token',JAM_PYQ_PROXY_URL:'https://fixture-jam.example.test',JAM_PYQ_PROXY_TOKEN:'fake-token'});
  let reads=0;t.mock.method(globalThis,'fetch',async()=>{reads++;return Response.json({ok:true,results:[]});});
  const res=await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1}),data=await res.json();
  assert.equal(res.status,200);assert.deepEqual(data.pyqPerformance,[]);assert.deepEqual(data.pyqPerformanceUnavailable,[]);assert.equal(reads,2);
});

test('slow JAM source is bounded and saved submissions survive without retrying the failed shard',async t=>{
  const f=fixture();t.after(()=>f.sql.close());f.sql.exec(jamSchema);
  f.sql.exec(`INSERT INTO jam_pyq_submissions VALUES(2,100,'0',1,1000);`);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://fixture-gate.example.test',PYQ_PROXY_TOKEN:'fake-token',JAM_PYQ_PROXY_URL:'https://fixture-jam.example.test',JAM_PYQ_PROXY_TOKEN:'fake-token'});
  t.mock.timers.enable({apis:['setTimeout']});
  let started, jamReads=0;
  const queryStarted=new Promise(resolve=>{started=resolve;});
  t.mock.method(globalThis,'fetch',async url=>{
    if(new URL(url).hostname.includes('jam')){jamReads++;started();return new Promise(()=>{});}
    return Response.json({ok:true,results:[]});
  });
  const pending=f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1});
  await queryStarted;
  await new Promise(resolve=>setImmediate(resolve)); // settle healthy reads before advancing the mocked clock
  t.mock.timers.tick(10_000);
  const res=await pending,data=await res.json();
  assert.equal(res.status,200);assert.equal(jamReads,1,'do not retry missing metadata on a failed source');
  assert.deepEqual(data.pyqPerformanceUnavailable,['JAM Chemistry']);
  assert.equal(data.pyqPerformance[0].attempted,1);assert.equal(data.pyqPerformance[0].correct,1);
  assert.equal(data.pyqPerformance[0].subject,'Subject unavailable');
});
