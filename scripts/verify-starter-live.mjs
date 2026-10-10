// Read-only production routing verification. Never changes student data.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {build}=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url))('esbuild');
const auth=spawnSync('npx',['--yes','wrangler@4.137.0','auth','token','--json'],{encoding:'utf8'});
assert.equal(auth.status,0,'Cloudflare authentication unavailable');
const token=JSON.parse(auth.stdout).token;
const accounts={
 qbank:['7a94feb19c9db9b7efb44b20cb249203','30921235-2543-4fb5-a970-fb4164590de6'],
 psu:['c8cdcd5acfd39d60f7cfe7989d6a6608','47eeafc4-8bfa-47e5-b200-332a04882828'],
 starter:['1e65bed301120c0c392ae4989b3ed6b0','8b9ac081-7df0-49ae-871d-d6b74f3c7d2f'],
};
const calls={qbank:0,psu:0,starter:0};
function db(name){return {prepare(sql){
 assert(/^\s*SELECT\b/i.test(sql),'Verification is read-only');
 const bind=(...params)=>({async all(){
  calls[name]++;
  const [account,id]=accounts[name];
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${id}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const body=await response.json();assert(response.ok&&body.success,`Read failed: ${name}`);
  return body.result[0];
 },async first(){return (await this.all()).results[0]??null;}});
 return {bind,...bind()};
}};}
const bundle=await build({entryPoints:['artifacts/api-server/src/lib/starterDatabase.ts'],bundle:true,write:false,format:'esm'});
const {starterBank}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const manifest=JSON.parse(readFileSync('artifacts/api-server/src/lib/starter-manifest.json','utf8'));
const starter=db('starter');
const questions=(await starter.prepare('SELECT id,class_id,subject_id,chapter_id FROM question_bank_questions ORDER BY id').all()).results;
assert(manifest.questions.every(id=>questions.some(q=>q.id===id)),'Missing migrated question');
for(const subjectId of [39,50]){
 const source=subjectId===39?'psu':'qbank';
 const subset=questions.filter(q=>q.subject_id===subjectId);
 const bank=starterBank(db(source),starter,{classId:subset[0].class_id,subjectId});
 const before=calls[source];
 const direct=await bank.prepare('SELECT id FROM question_bank_questions WHERE id=?').bind(subset[0].id).first();
 assert.equal(direct.id,subset[0].id);assert.equal(calls[source],before,'Direct Starter fetch read old shard');
 const rows=(await bank.prepare('SELECT id FROM question_bank_questions WHERE subject_id=? ORDER BY id').bind(subjectId).all()).results;
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,'Duplicate question');
 assert(subset.every(q=>rows.some(r=>r.id===q.id)),'Merged list missed Starter');
 const count=await bank.prepare('SELECT count(*) AS count FROM question_bank_questions WHERE subject_id=?').bind(subjectId).first();
 assert.equal(count.count,rows.length,'Merged count mismatch');
 console.log(JSON.stringify({subjectId,starterQuestions:subset.length,mergedQuestions:rows.length,directReadsOldShard:false,duplicates:0}));
}
for(const table of ['question_bank_question_progress','question_bank_reports','question_bank_saved_questions','student_question_timers','student_daily_question_activity']){
 const row=await starter.prepare(`SELECT count(*) AS count FROM ${table}`).first();
 console.log(table,row.count);
}
console.log('Live read-only verification passed');
