import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build} from '../artifacts/api-server/node_modules/esbuild/lib/main.js';
const bundle=await build({entryPoints:['artifacts/api-server/src/lib/questionBankPartition.ts'],bundle:true,write:false,format:'esm'});
const {questionBankMembershipPredicate:predicate}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const targets=[
  {name:'qbank',account:'7a94feb19c9db9b7efb44b20cb249203',db:'qbank',config:'artifacts/qbank-worker/wrangler.toml',field:'subject_id',ids:[33,39,44],include:false},
  {name:'psu',account:'c8cdcd5acfd39d60f7cfe7989d6a6608',db:'psu',config:'artifacts/psu-worker/wrangler.toml',field:'subject_id',ids:[33,39,44],include:true},
  {name:'jam',account:'c8cdcd5acfd39d60f7cfe7989d6a6608',db:'jam-chemistry',config:'artifacts/jam-content-worker/wrangler.toml',field:'class_id',ids:[2],include:true},
];
const report=[];
const phase=process.argv[2]??'before-index';
if(!['before-index','after-index'].includes(phase))throw new Error('Expected before-index or after-index');
for(const target of targets){
  const table='question_bank_question_progress';
  const before=`question_id ${target.include?'IN':'NOT IN'} (SELECT id FROM question_bank_questions WHERE ${target.field} IN (${target.ids.join(',')}))`;
  const after=predicate(table,target.field,target.ids,target.include);
  const sql=p=>`SELECT question_id FROM ${table} WHERE student_id=(SELECT MIN(student_id) FROM ${table}) AND (${p}) ORDER BY question_id`;
  const command=[sql(before),sql(after),'EXPLAIN QUERY PLAN '+sql(before),'EXPLAIN QUERY PLAN '+sql(after)].join(';');
  const run=spawnSync('npx',['--yes','wrangler@4.137.0','d1','execute',target.db,'--remote','--config',target.config,'--env','production','--command',command,'--json'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:target.account},encoding:'utf8',maxBuffer:8*1024*1024});
  if(run.status!==0)throw new Error(run.stderr||'D1 measurement failed');
  const results=JSON.parse(run.stdout);assert.deepEqual(results[0].results,results[1].results,target.name+' membership changed');
  // Keep only counts/plans and hashes, never student IDs or question records.
  const metric=i=>({rowsRead:results[i].meta.rows_read,durationMs:results[i].meta.duration,rowsReturned:results[i].results.length});
  const record={database:target.name,before:metric(0),after:metric(1),sameResults:true,resultHash:createHash('sha256').update(JSON.stringify(results[0].results)).digest('hex'),beforePlan:results[2].results.map(r=>r.detail),afterPlan:results[3].results.map(r=>r.detail)};
  report.push(record);console.log(JSON.stringify(record));
}
const dir='artifacts/api-server/verification/20261005';mkdirSync(dir,{recursive:true});
writeFileSync(`${dir}/partition-reads-${phase}.json`,JSON.stringify({checkedAt:new Date().toISOString(),readOnly:true,measurements:report},null,2)+'\n');
