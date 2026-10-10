import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/lib/starterDatabase.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {starterBank,starterActivity,addOuterPredicate}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const manifest=JSON.parse(readFileSync(new URL('../src/lib/starter-manifest.json',import.meta.url)));
const id=manifest.questions[0];
function database(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 const schema=readFileSync(new URL('../migrations/20260920_question_bank_database.sql',import.meta.url),'utf8').replace(/id INTEGER PRIMARY KEY,/g,'id INTEGER PRIMARY KEY AUTOINCREMENT,');sql.exec(schema);
 const calls=[];
 const db={prepare(query){const statement={bind(...params){return {async all(){calls.push(query);return {results:sql.prepare(query).all(...params)};},async first(){calls.push(query);return sql.prepare(query).get(...params)??null;},async run(){calls.push(query);const r=sql.prepare(query).run(...params);return {success:true,meta:{changes:r.changes,last_row_id:r.lastInsertRowid}};}};}};return {...statement,...statement.bind()};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
 return {sql,db,calls};
}
function seed(d,qid,difficulty='starter'){d.sql.prepare("INSERT INTO question_bank_questions(id,class_id,subject_id,chapter_id,question,difficulty,\"order\") VALUES(?,1,1,1,'Question',?,?)").run(qid,difficulty,qid===id?2:1);}
test('Starter read routes directly; chapter counts and max order exclude retained backup',async t=>{
 const base=database(t),starter=database(t);seed(base,id);seed(base,42,'medium');seed(starter,id);
 const db=starterBank(base.db,starter.db,{classId:1,subjectId:1});
 assert.equal((await db.prepare('SELECT id FROM question_bank_questions WHERE id=?').bind(id).first()).id,id);
 assert.equal(base.calls.length,0,'Known Starter avoids old shard reads');
 const count=await db.prepare('SELECT count(*) AS count FROM question_bank_questions WHERE chapter_id=?').bind(1).first();assert.equal(count.count,2);
 const max=await db.prepare('SELECT coalesce(max("order"), -1) AS maxOrder FROM question_bank_questions WHERE chapter_id=?').bind(1).first();assert.equal(max.maxOrder,2);
 const rows=(await db.prepare('SELECT id,"order" FROM question_bank_questions WHERE chapter_id=? ORDER BY "order" LIMIT ?').bind(1,1).all()).results;assert.deepEqual(rows.map(r=>r.id),[42]);
});
test('Starter progress RETURNING writes only new DB; regular progress stays put',async t=>{
 const base=database(t),starter=database(t);seed(base,id);seed(base,42,'medium');seed(starter,id);
 const db=starterBank(base.db,starter.db);const sql='INSERT INTO question_bank_question_progress(student_id,question_id,class_id,subject_id,chapter_id,attempt_count) VALUES(?, ?,1,1,1,1) RETURNING question_id';
 assert.equal((await db.prepare(sql).bind(2,id).first()).question_id,id);
 assert.equal(base.sql.prepare('SELECT count(*) n FROM question_bank_question_progress').get().n,0);
 await db.prepare(sql).bind(2,42).first();assert.equal(base.sql.prepare('SELECT count(*) n FROM question_bank_question_progress').get().n,1);
});
test('new GATE and JAM Starter inserts get reserved IDs and future reads route directly',async t=>{
 const base=database(t),starter=database(t);starter.sql.exec("INSERT INTO sqlite_sequence(name,seq) VALUES('question_bank_questions',4000000000000)");
 const db=starterBank(base.db,starter.db);
 for(const classId of [1,2]){
  const r=await db.prepare('INSERT INTO question_bank_questions(class_id,subject_id,chapter_id,question,difficulty) VALUES(?,?,?, ?,?)').bind(classId,1,1,'New','starter').run();assert(r.meta.last_row_id>4e12);
  assert.equal((await db.prepare('SELECT id FROM question_bank_questions WHERE id=?').bind(r.meta.last_row_id).first()).id,r.meta.last_row_id);
 }
 assert.equal(base.sql.prepare('SELECT count(*) n FROM question_bank_questions').get().n,0);
});
test('outer filters do not modify a nested saved-question subquery or OR semantics',()=>{
 assert.equal(addOuterPredicate('SELECT id,(SELECT id FROM saved WHERE id=? LIMIT 1) s FROM questions WHERE a=? OR b=? ORDER BY id LIMIT ?', 'id>0'),'SELECT id,(SELECT id FROM saved WHERE id=? LIMIT 1) s FROM questions  WHERE (a=? OR b=?) AND (id>0) ORDER BY id LIMIT ?');
});
test('timers and daily activity stay in Starter while the dashboard totals merge once',async t=>{
 const main=database(t),starter=database(t);
 for(const d of [main,starter]){
  d.sql.exec(readFileSync(new URL('../migrations/20261002_student_question_timers.sql',import.meta.url),'utf8').split('INSERT INTO student_question_timers')[0]);
  d.sql.exec(readFileSync(new URL('../migrations/20261004_student_weekly_activity.sql',import.meta.url),'utf8'));
  d.sql.exec('UPDATE student_activity_tracking SET started_at=0');
 }
 main.sql.exec('CREATE VIEW nonstarter_daily_activity_totals AS SELECT * FROM student_daily_activity_totals');
 const db=starterActivity(main.db,starter.db);
 const sql="INSERT INTO student_question_timers(student_id,source_type,exam_key,question_id,time_spent_seconds,updated_at) VALUES(?,'question-bank',?,?,?,?) RETURNING time_spent_seconds";
 assert.equal((await db.prepare(sql).bind(2,'gate',id,19,1000).first()).time_spent_seconds,19);
 assert.equal(main.sql.prepare('SELECT count(*) n FROM student_question_timers').get().n,0);
 await db.prepare(sql).bind(2,'gate',42,11,1000).first();
 const rows=(await db.prepare('SELECT source_type,SUM(time_spent_seconds) AS seconds FROM student_question_timers WHERE student_id=? GROUP BY source_type').bind(2).all()).results;
 assert.equal(rows[0].seconds,30);
 const activity="INSERT INTO student_daily_question_activity(student_id,day,question_key,outcome,updated_at,answered_at) SELECT ?,?,?,?,?,? WHERE ? >= (SELECT started_at FROM student_activity_tracking WHERE id=1) ON CONFLICT(student_id,day,question_key) DO UPDATE SET outcome=excluded.outcome,answered_at=excluded.answered_at";
 await db.prepare(activity).bind(2,'1970-01-01',`question-bank:${id}`,1,1000,1000,1000).run();
 const daily=(await db.prepare('SELECT day,correct,wrong,seconds FROM student_daily_activity_totals WHERE student_id=? ORDER BY day').bind(2).all()).results;
 assert.equal(daily.length,1);assert.equal(daily[0].correct,1);assert.equal(daily[0].seconds,30);
 assert.equal(main.sql.prepare('SELECT count(*) n FROM student_daily_question_activity WHERE outcome=1').get().n,0);
});
