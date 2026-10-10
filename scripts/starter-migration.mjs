// Staged migration: snapshot -> copy/verify -> activate routing. Never deletes source content.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='artifacts/api-server/verification/20261005/starter-migration';
mkdirSync(root,{recursive:true});
const accounts={qbank:['7a94feb19c9db9b7efb44b20cb249203','30921235-2543-4fb5-a970-fb4164590de6'],psu:['c8cdcd5acfd39d60f7cfe7989d6a6608','47eeafc4-8bfa-47e5-b200-332a04882828'],jam:['c8cdcd5acfd39d60f7cfe7989d6a6608','72f8aefa-beea-4d7e-8c79-fb982d8efa8e'],main:['044791c24ac1de2cb822a0df91b2ab5f','832a1c3f-79d9-4b07-85de-06ca4b85ba56'],starter:['1e65bed301120c0c392ae4989b3ed6b0','8b9ac081-7df0-49ae-871d-d6b74f3c7d2f']};
const auth=spawnSync('npx',['--yes','wrangler@4.137.0','auth','token','--json'],{encoding:'utf8'});
if(auth.status!==0)throw Error('Wrangler authentication unavailable');
const token=JSON.parse(auth.stdout).token;
assert(token && !/\s/.test(token),'Unexpected authentication response (not printed)');
async function query(target,sql,params=[]){
 const [account,db]=accounts[target];
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
 const data=await response.json(); if(!response.ok||!data.success)throw Error(`${target}: ${JSON.stringify(data.errors)}`);
 return data.result[0];
}
const tables=['question_bank_questions','question_bank_question_progress','question_bank_saved_questions','question_bank_reports','test_question_bank_links'];
const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const mode=process.argv[2]??'snapshot';
if(mode==='snapshot'){
 const all={}, schemas={};
 for(const source of ['qbank','psu','jam']){
  const ids=(await query(source,"SELECT id FROM question_bank_questions WHERE lower(trim(difficulty))='starter' ORDER BY id")).results.map(r=>r.id);
  all[source]={};
  for(const table of tables){
   const key=table==='question_bank_questions'?'id':table==='test_question_bank_links'?'question_bank_question_id':'question_id';
   const rows=[];
   for(let i=0;i<ids.length;i+=10)rows.push(...(await query(source,`SELECT * FROM ${table} WHERE ${key} IN (SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(ids.slice(i,i+10))])).results);
   all[source][table]=rows.sort((a,b)=>a.id-b.id);
  }
  console.log(source,Object.fromEntries(tables.map(t=>[t,all[source][t].length])));
 }
 const ids=Object.values(all).flatMap(s=>s.question_bank_questions.map(q=>q.id));assert.equal(new Set(ids).size,ids.length,'Question ID collision');
 const main={};
 main.student_question_timers=(await query('main',"SELECT * FROM student_question_timers WHERE source_type='question-bank' AND question_id IN (SELECT value FROM json_each(?)) ORDER BY student_id,exam_key,question_id",[JSON.stringify(ids)])).results;
 main.student_daily_question_activity=(await query('main',"SELECT * FROM student_daily_question_activity WHERE question_key IN (SELECT 'question-bank:'||value FROM json_each(?)) ORDER BY student_id,day,question_key",[JSON.stringify(ids)])).results;
 main.student_activity_tracking=(await query('main','SELECT * FROM student_activity_tracking')).results;
 for(const table of tables)schemas[table]=(await query('psu',"SELECT sql FROM sqlite_master WHERE type='table' AND name=?",[table])).results[0].sql;
 const backup={at:new Date().toISOString(),all,main,schemas};
 const file=`${root}/snapshot-${Date.now()}.json`;writeFileSync(file,JSON.stringify(backup),{flag:'wx'});writeFileSync(`${root}/latest.json`,JSON.stringify({file}));
 const manifest={questions:ids.sort((a,b)=>a-b),reports:[],saved:[],progress:[],links:[]};
 for(const [table,key]of [[tables[1],'progress'],[tables[2],'saved'],[tables[3],'reports'],[tables[4],'links']]){
  const rows=Object.values(all).flatMap(s=>s[table]);
  assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,`${table} ID collision: needs explicit remapping`);
  // Internal state row IDs are shard-local. Re-key them into a reserved range;
  // question IDs and logical student/question identities never change.
  manifest[key]=Object.entries(all).flatMap(([source,s])=>s[table].map(r=>r.id+({qbank:4e12,psu:5e12,jam:6e12}[source]))).sort((a,b)=>a-b);
 }
 writeFileSync('artifacts/api-server/src/lib/starter-manifest.json',JSON.stringify(manifest));
 console.log('Snapshot saved',file,{questions:ids.length,timers:main.student_question_timers.length,activity:main.student_daily_question_activity.length});
} else if(mode==='copy') {
 const {file}=JSON.parse(readFileSync(`${root}/latest.json`,'utf8'));const backup=JSON.parse(readFileSync(file,'utf8'));
 assert(!existsSync(`${root}/activated.json`),'Do not overwrite active destination');
 // All local source tables are schema-compatible; use the canonical isolated content schema.
 const sql=readFileSync('artifacts/api-server/migrations/20260920_question_bank_database.sql','utf8').replace(/--[^\n]*/g,'').replace(/id INTEGER PRIMARY KEY,/g,'id INTEGER PRIMARY KEY AUTOINCREMENT,');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await query('starter',statement);
 // Destination is still staging (activation marker checked above). Rebuild it
 // from the latest frozen snapshot, including source deletions between passes.
 for(const table of [...tables].reverse())await query('starter',`DELETE FROM ${table}`);
 const timer=readFileSync('artifacts/api-server/migrations/20261002_student_question_timers.sql','utf8').split('INSERT INTO student_question_timers')[0];
 for(const s of timer.split(';').map(s=>s.trim()).filter(Boolean))await query('starter',s);
 for(const name of ['student_activity_timer_insert','student_activity_timer_update'])await query('starter',`DROP TRIGGER IF EXISTS ${name}`);
 await query('starter','DELETE FROM student_question_timers');
 const hasActivity=(await query('starter',"SELECT name FROM sqlite_master WHERE type='table' AND name='student_daily_question_activity'")).results.length;
 if(hasActivity){await query('starter','DELETE FROM student_daily_question_activity');await query('starter','DELETE FROM student_daily_activity_totals');}
 // Install activity schema after timer copy, preventing old lifetime time from becoming new daily activity.
 const insert=async(table,rows)=>{
  for(let i=0;i<rows.length;i+=5)await Promise.all(rows.slice(i,i+5).map(async row=>{const cols=Object.keys(row);await query('starter',`INSERT INTO ${table} (${cols.map(c=>`"${c}"`).join(',')}) VALUES(${cols.map(()=>'?').join(',')}) ON CONFLICT DO UPDATE SET ${cols.map(c=>`"${c}"=excluded."${c}"`).join(',')}`,cols.map(c=>row[c]));}));
 };
 for(const table of tables){
  const rows=Object.entries(backup.all).flatMap(([source,s])=>s[table].map(r=>table==='question_bank_questions'?r:{...r,id:r.id+({qbank:4e12,psu:5e12,jam:6e12}[source])})).sort((a,b)=>a.id-b.id);await insert(table,rows);
  const read=(await query('starter',`SELECT * FROM ${table} ORDER BY id`)).results;
  assert.deepEqual(read,rows,`${table} content verification`);
  await query('starter',"INSERT INTO sqlite_sequence(name,seq) SELECT ?,4000000000000 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?)",[table,table]);
  await query('starter','UPDATE sqlite_sequence SET seq=MAX(seq,4000000000000) WHERE name=?',[table]);
  console.log('Verified',table,rows.length,hash(rows));
 }
 await insert('student_question_timers',backup.main.student_question_timers);
 const weekly=readFileSync('artifacts/api-server/migrations/20261004_student_weekly_activity.sql','utf8');
 // Cloudflare query API accepts a SQL script, including trigger bodies.
 await query('starter',weekly);
 await query('starter','UPDATE student_activity_tracking SET started_at=? WHERE id=1',[backup.main.student_activity_tracking[0].started_at]);
 await insert('student_daily_question_activity',backup.main.student_daily_question_activity);
 for(const table of ['student_question_timers','student_daily_question_activity']){
  const keys=table==='student_question_timers'?'student_id,exam_key,question_id':'student_id,day,question_key';
  assert.deepEqual((await query('starter',`SELECT * FROM ${table} ORDER BY ${keys}`)).results,backup.main[table]);
 }
 await query('starter',`CREATE VIEW IF NOT EXISTS jam_qb_catalog_counts AS SELECT class_id,subject_id,chapter_id,COUNT(*) AS question_count FROM question_bank_questions GROUP BY class_id,subject_id,chapter_id`);
 writeFileSync(`${root}/verified.json`,JSON.stringify({snapshot:file,counts:Object.fromEntries(tables.map(t=>[t,Object.values(backup.all).reduce((n,s)=>n+s[t].length,0)])),at:new Date().toISOString()},null,2));
 console.log('Verified timers and daily activity. Routing is not yet activated.');
} else if(mode==='baseline') {
 const {file}=JSON.parse(readFileSync(`${root}/latest.json`,'utf8'));const backup=JSON.parse(readFileSync(file,'utf8'));
 const ids=Object.values(backup.all).flatMap(s=>s.question_bank_questions.map(q=>q.id));
 await query('main',`CREATE TABLE IF NOT EXISTS starter_daily_activity_baseline(student_id INTEGER NOT NULL,day TEXT NOT NULL,correct INTEGER NOT NULL,wrong INTEGER NOT NULL,unanswered INTEGER NOT NULL,ungraded INTEGER NOT NULL,seconds INTEGER NOT NULL,PRIMARY KEY(student_id,day))`);
 await query('main',`INSERT INTO starter_daily_activity_baseline SELECT student_id,day,SUM(outcome=1),SUM(outcome=0),SUM(outcome=-1),SUM(outcome=2),SUM(seconds) FROM student_daily_question_activity
  WHERE question_key IN (SELECT 'question-bank:'||value FROM json_each(?)) GROUP BY student_id,day
  ON CONFLICT(student_id,day) DO UPDATE SET correct=excluded.correct,wrong=excluded.wrong,unanswered=excluded.unanswered,ungraded=excluded.ungraded,seconds=excluded.seconds`,[JSON.stringify(ids)]);
 await query('main',`CREATE VIEW IF NOT EXISTS nonstarter_daily_activity_totals AS SELECT t.student_id,t.day,t.correct-COALESCE(b.correct,0) AS correct,t.wrong-COALESCE(b.wrong,0) AS wrong,t.unanswered-COALESCE(b.unanswered,0) AS unanswered,t.ungraded-COALESCE(b.ungraded,0) AS ungraded,t.seconds-COALESCE(b.seconds,0) AS seconds FROM student_daily_activity_totals t LEFT JOIN starter_daily_activity_baseline b ON b.student_id=t.student_id AND b.day=t.day`);
 const source=(await query('main','SELECT * FROM starter_daily_activity_baseline ORDER BY student_id,day')).results;
 const target=(await query('starter','SELECT * FROM student_daily_activity_totals ORDER BY student_id,day')).results;
 assert.deepEqual(source,target,'Daily totals must remain identical across cutover');
 const students=[...new Set([...Object.values(backup.all).flatMap(s=>s.question_bank_question_progress.map(p=>p.student_id)),...backup.main.student_question_timers.map(p=>p.student_id)])];
 for(const table of ['student_dashboard_cache','student_daily_activity_cache'])await query('main',`UPDATE ${table} SET updated_at=0 WHERE student_id IN(SELECT value FROM json_each(?))`,[JSON.stringify(students)]);
 writeFileSync(`${root}/baseline-verified.json`,JSON.stringify({at:new Date().toISOString(),days:source.length,students:students.length},null,2));
 console.log('Daily activity baseline verified; affected dashboard caches expired.');
} else throw Error('Unknown mode');
