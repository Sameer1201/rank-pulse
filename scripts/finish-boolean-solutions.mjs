import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {JSDOM} from '../artifacts/edtech/node_modules/jsdom/lib/api.js';
const dir='artifacts/api-server/verification/20261005/digital-boolean-repair-remaining';
const plan=JSON.parse(readFileSync(`${dir}/before.json`,'utf8'));
const parse=html=>new JSDOM(html).window.document;
const lit=s=>`'${String(s).replaceAll("'","''")}'`;
const query=sql=>{
 const p=spawnSync('npx',['--yes','wrangler@4.137.0','d1','execute','psu','--remote','--config','artifacts/psu-worker/wrangler.toml','--env','production','--command',sql,'--json'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'c8cdcd5acfd39d60f7cfe7989d6a6608'},encoding:'utf8',maxBuffer:16*1024*1024});
 if(p.status!==0)throw Error(p.error?.message||p.stderr||p.stdout);return JSON.parse(p.stdout);
};
const verified=[];
for(const p of plan){
 assert.deepEqual(Object.keys(p.updates),['explanation']);
 const row=query(`SELECT explanation,updated_at FROM question_bank_questions WHERE id=${p.id}`)[0].results[0];
 if(row.explanation!==p.updates.explanation){
   assert.equal(row.explanation,p.before.explanation,'Concurrent edit');
   assert.equal(row.updated_at,p.before.updated_at,'Concurrent edit');
   const old=row.explanation,newHtml=p.updates.explanation;
   const before=[...old.matchAll(/<math\b[\s\S]*?<\/math>/g)];
   const after=[...parse(newHtml).querySelectorAll('.katex,math')].filter(n=>n.matches('.katex')||!n.closest('.katex'));
   assert.equal(before.length,after.length);
   let last=0,reconstructed='';const pieces=[],guards=[];
   for(let i=0;i<before.length;i++){
     const m=before[i],start=m.index,end=start+m[0].length;
     const chunk=after[i].outerHTML;
     reconstructed+=old.slice(last,start)+chunk;
     pieces.push(`substr(explanation,${[...old.slice(0,last)].length+1},${[...old.slice(last,start)].length})`,lit(chunk));
     guards.push(`substr(explanation,${[...old.slice(0,start)].length+1},${[...m[0]].length})=${lit(m[0])}`);
     last=end;
   }
   reconstructed+=old.slice(last);pieces.push(`substr(explanation,${[...old.slice(0,last)].length+1})`);
   assert.equal(reconstructed,newHtml,'Only math replacements allowed');
   const result=query(`UPDATE question_bank_questions SET explanation=${pieces.join('||')},updated_at=${Date.now()} WHERE id=${p.id} AND updated_at=${row.updated_at} AND length(explanation)=${[...old].length} AND ${guards.join(' AND ')}`);
   assert.equal(result[0].meta.changes,1);
 }
 assert.equal(query(`SELECT explanation FROM question_bank_questions WHERE id=${p.id}`)[0].results[0].explanation,p.updates.explanation);
 verified.push(p.id);console.log('Verified',p.id);
 writeFileSync(`${dir}/verified.json`,JSON.stringify({verifiedIds:verified,count:verified.length,total:plan.length,progressUntouched:true},null,2));
}
