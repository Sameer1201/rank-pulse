import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir='artifacts/api-server/verification/20261005/q5597-regrade';
const id=1000000005597;
const configs={psu:['c8cdcd5acfd39d60f7cfe7989d6a6608','psu','artifacts/psu-worker/wrangler.toml'],main:['044791c24ac1de2cb822a0df91b2ab5f','rank','artifacts/api-server/wrangler.toml']};
function run(target,args){
 const [account,,config]=configs[target];
 const p=spawnSync('npx',['--yes','wrangler@4.137.0',...args,'--config',config,'--env','production','--json'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account},encoding:'utf8',maxBuffer:8*1024*1024});
 if(p.status!==0)throw Error(p.stderr||p.stdout);
 return JSON.parse(p.stdout);
}
const query=(target,sql)=>run(target,['d1','execute',configs[target][1],'--remote','--command',sql]);
const lit=value=>value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const day=at=>new Date(at+19800000).toISOString().slice(0,10);
mkdirSync(dir,{recursive:true});
const q=query('psu',`SELECT id,question_type,correct_answer FROM question_bank_questions WHERE id=${id}`)[0].results[0];
assert.equal(q.question_type,'mcq');assert.equal(q.correct_answer,0);
const current=query('psu',`SELECT * FROM question_bank_question_progress WHERE question_id=${id}`)[0].results;
const path=`${dir}/before.json`;
if(!existsSync(path)) {
 const rows=current.filter(p=>p.last_is_correct===0&&JSON.parse(p.last_answer)==='A');
 assert(rows.length>0,'No known affected answer');
 const activity=rows.flatMap(p=>query('main',`SELECT * FROM student_daily_question_activity WHERE student_id=${p.student_id} AND day=${lit(day(p.last_attempted_at))} AND question_key='question-bank:${id}'`)[0].results);
 writeFileSync(path,JSON.stringify({q,rows,activity},null,2),{flag:'wx'});
 for(const target of ['psu','main'])writeFileSync(`${dir}/${target}-recovery.json`,JSON.stringify(run(target,['d1','time-travel','info',configs[target][1]]),null,2),{flag:'wx'});
}
const backup=JSON.parse(readFileSync(path,'utf8'));
for(const p of backup.rows){
 const before=query('psu',`SELECT * FROM question_bank_question_progress WHERE id=${p.id} AND question_id=${id}`)[0].results[0];
 assert.equal(before.last_answer,p.last_answer);assert.equal(before.last_attempted_at,p.last_attempted_at);assert.equal(before.attempt_count,p.attempt_count);
 if(before.last_is_correct===0){
  const result=query('psu',`UPDATE question_bank_question_progress SET last_is_correct=1,correct_count=correct_count+1,incorrect_count=MAX(0,incorrect_count-1),solved_at=COALESCE(solved_at,last_attempted_at)
   WHERE id=${p.id} AND question_id=${id} AND last_answer=${lit(p.last_answer)} AND last_attempted_at=${p.last_attempted_at} AND last_is_correct=0
   AND EXISTS(SELECT 1 FROM question_bank_questions WHERE id=${id} AND question_type='mcq' AND correct_answer=0)`);
  assert.equal(result[0].meta.changes,1);
 }
 query('main',`UPDATE student_daily_question_activity SET outcome=1,updated_at=${Date.now()} WHERE student_id=${p.student_id} AND day=${lit(day(p.last_attempted_at))} AND question_key='question-bank:${id}' AND answered_at=${p.last_attempted_at} AND outcome IN(0,2);
  UPDATE student_dashboard_cache SET updated_at=0 WHERE student_id=${p.student_id}`);
 const after=query('psu',`SELECT * FROM question_bank_question_progress WHERE id=${p.id} AND question_id=${id}`)[0].results[0];
 assert.equal(after.last_is_correct,1);assert.equal(after.correct_count,p.correct_count+1);assert.equal(after.incorrect_count,Math.max(0,p.incorrect_count-1));
 for(const field of ['last_answer','attempt_count','first_attempted_at','last_attempted_at'])assert.equal(after[field],p[field]);
 const activity=query('main',`SELECT * FROM student_daily_question_activity WHERE student_id=${p.student_id} AND day=${lit(day(p.last_attempted_at))} AND question_key='question-bank:${id}'`)[0].results;
 for(const a of activity){const old=backup.activity.find(b=>b.student_id===a.student_id&&b.day===a.day);assert.equal(a.seconds,old.seconds);if(a.answered_at===p.last_attempted_at)assert.equal(a.outcome,1);}
}
writeFileSync(`${dir}/verified.json`,JSON.stringify({questionId:id,repaired:backup.rows.length,attemptsAndTimersPreserved:true},null,2));
console.log(`Verified ${backup.rows.length} saved result(s); attempts and timers preserved.`);
