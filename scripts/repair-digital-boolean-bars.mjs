// Source-matched recovery of already-imported Digital Electronics overbars.
// Dry-run by default. Only approved plan fields are written; IDs, answer keys,
// attempts, timers, bookmarks and other metadata are never changed.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,readdirSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {JSDOM} from '../artifacts/edtech/node_modules/jsdom/lib/api.js';
import {build} from '../artifacts/api-server/node_modules/esbuild/lib/main.js';
import {booleanRepairPlan,inspectBooleanContent} from './lib/boolean-repair.mjs';
const sourceDir='/Users/sameermajhi/Downloads/digital';
const output='artifacts/api-server/verification/20261005/digital-boolean-repair'+(process.argv.includes('--remaining-pass')?'-remaining':process.argv.includes('--solutions-pass')?'-solutions':'');
const config='artifacts/psu-worker/wrangler.toml';
const window=new JSDOM('').window;
for(const key of ['DOMParser','Node','NodeFilter'])globalThis[key]=window[key];
const bundled=await build({entryPoints:['artifacts/edtech/src/lib/pyqImport.ts'],bundle:true,write:false,format:'esm',platform:'node',tsconfig:'artifacts/edtech/tsconfig.json'});
const {parsePyqHtml}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const sources=readdirSync(sourceDir).filter(f=>f.endsWith('.html')).flatMap(file=>parsePyqHtml(readFileSync(`${sourceDir}/${file}`,'utf8'),file).questions.map(q=>({...q,file})));
const run=args=>{
 const p=spawnSync('npx',['--yes','wrangler@4.137.0',...args,'--config',config,'--env','production','--json'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'c8cdcd5acfd39d60f7cfe7989d6a6608'},encoding:'utf8',maxBuffer:128*1024*1024});
 if(p.status!==0)throw Error(p.error?.message||p.stderr||p.stdout||'D1 call failed');return JSON.parse(p.stdout);
};
const query=sql=>{
 if(Buffer.byteLength(sql)<100_000)return run(['d1','execute','psu','--remote','--command',sql]);
 // Image-bearing explanations can exceed the OS argument-size limit. Pass
 // generated SQL through a file; retain exactly the same old-value guards.
 const dir=mkdtempSync(join(tmpdir(),'boolean-d1-repair-'));
 const file=join(dir,'query.sql');
 try{writeFileSync(file,sql);return run(['d1','execute','psu','--remote','--file',file]);}
 finally{unlinkSync(file);rmdirSync(dir);}
};
const columns='id,chapter_id,question,options,explanation,question_type,correct_answer,correct_answer_multi,updated_at';
const inspectSkipped=process.argv.includes('--inspect-skipped');
const skippedIds=inspectSkipped?JSON.parse(readFileSync(`${output}/audit.json`,'utf8')).skipped.map(p=>p.id):[];
const rows=query(`SELECT ${columns} FROM question_bank_questions WHERE subject_id=39 ${inspectSkipped?`AND id IN (${skippedIds.join(',')||'-1'})`:''} ORDER BY id`)[0].results;
const plan=[],unmatched=[],ambiguous=[],matched=[],skipped=[];
for(const row of rows){
 const matches=sources.flatMap(source=>{const p=booleanRepairPlan(row,source);return p?[{...p,file:source.file,sourceQuestion:source.questionNumber}]:[];});
 if(!matches.length){unmatched.push(row.id);continue;}
 matched.push(row.id);
 const variants=new Set(matches.map(m=>JSON.stringify(m.updates)));
 if(variants.size!==1){ambiguous.push(row.id);continue;}
 const match=matches[0];
 if(inspectSkipped){
   const source=sources.find(s=>s.file===match.file&&s.questionNumber===match.sourceQuestion);
   for(const field of match.skippedFields)console.log(JSON.stringify({id:row.id,sourceQuestion:match.sourceQuestion,field,before:inspectBooleanContent(row[field]).text,after:inspectBooleanContent(source[field]).text}));
 }
 if(match.skippedFields.length)skipped.push({id:row.id,fields:match.skippedFields});
 if(match.changedFields.length)plan.push({id:row.id,before:row,...match});
}
mkdirSync(output,{recursive:true});
const report={at:new Date().toISOString(),sources:sources.length,scanned:rows.length,matched:matched.length,repairable:plan.length,fields:plan.reduce((n,p)=>n+p.changedFields.length,0),ambiguous,unmatched,skipped,plan:plan.map(({id,file,sourceQuestion,changedFields})=>({id,file,sourceQuestion,changedFields}))};
if(!inspectSkipped)writeFileSync(`${output}/audit.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,plan:undefined,unmatched:unmatched.length}));
if(!process.argv.includes('--apply'))process.exit(0);
assert(plan.length>0,'No repairable records');
assert.equal(ambiguous.length,0,'Conflicting source variants require review');
writeFileSync(`${output}/before.json`,JSON.stringify(plan,null,2),{flag:'wx'});
const recovery=run(['d1','time-travel','info','psu']);assert(recovery.bookmark);
writeFileSync(`${output}/recovery.json`,JSON.stringify(recovery,null,2),{flag:'wx'});
const literal=v=>v==null?'NULL':`'${String(v).replaceAll("'","''")}'`;
const verified=[];
for(const p of plan){
 const fields=Object.keys(p.updates);
 const set=fields.map(f=>`${f}=${literal(p.updates[f])}`).join(',');
 const guard=['question','options','explanation','question_type','correct_answer','correct_answer_multi','updated_at'].map(f=>`${f} IS ${literal(p.before[f])}`).join(' AND ');
 const result=query(`UPDATE question_bank_questions SET ${set},updated_at=${Date.now()} WHERE id=${p.id} AND subject_id=39 AND chapter_id=${p.before.chapter_id} AND ${guard}`);
 assert.equal(result[0].meta.changes,1,`Concurrent edit: ${p.id}`);
 const after=query(`SELECT ${columns} FROM question_bank_questions WHERE id=${p.id}`)[0].results[0];
 for(const field of fields)assert.equal(after[field],p.updates[field]);
 for(const field of ['id','chapter_id','question_type','correct_answer','correct_answer_multi'])assert.equal(after[field],p.before[field]);
 verified.push(p.id);
 writeFileSync(`${output}/verified.json`,JSON.stringify({verifiedIds:verified,count:verified.length,total:plan.length,progressUntouched:true},null,2));
 console.log(`Verified ${verified.length}/${plan.length}: ${p.id} (${p.changedFields.join(', ')})`);
}
