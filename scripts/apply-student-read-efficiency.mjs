import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
if(process.argv[2]!=='--apply')throw new Error('Usage: node scripts/apply-student-read-efficiency.mjs --apply');
const targets=[
  {name:'main',account:'044791c24ac1de2cb822a0df91b2ab5f',db:'rank',id:'832a1c3f-79d9-4b07-85de-06ca4b85ba56',config:'artifacts/api-server/wrangler.toml',migration:'artifacts/api-server/migrations/20261005_student_read_efficiency.sql',plan:'SELECT question_id FROM jam_pyq_submissions WHERE student_id=-1 AND submitted_at>=0 AND submitted_at<9999999999999'},
  {name:'qbank',account:'7a94feb19c9db9b7efb44b20cb249203',db:'qbank',id:'30921235-2543-4fb5-a970-fb4164590de6',config:'artifacts/qbank-worker/wrangler.toml',migration:'artifacts/api-server/migrations/20261005_qbank_student_lookup.sql',plan:'SELECT question_id FROM question_bank_question_progress WHERE student_id=-1 ORDER BY question_id'},
  {name:'jam',account:'c8cdcd5acfd39d60f7cfe7989d6a6608',db:'jam-chemistry',id:'72f8aefa-beea-4d7e-8c79-fb982d8efa8e',config:'artifacts/jam-content-worker/wrangler.toml',migration:'artifacts/jam-content-worker/migrations/0003_student_lookup.sql',plan:'SELECT question_id FROM question_bank_question_progress WHERE student_id=-1 ORDER BY question_id'},
  {name:'psu',account:'c8cdcd5acfd39d60f7cfe7989d6a6608',db:'psu',id:'47eeafc4-8bfa-47e5-b200-332a04882828',config:'artifacts/psu-worker/wrangler.toml',migration:'artifacts/psu-worker/migrations/0005_student_lookup.sql',plan:'SELECT id FROM psu_test_attempts WHERE student_id=-1 ORDER BY submitted_at DESC,id DESC LIMIT 30'},
];
const dir='artifacts/api-server/verification/20261005';mkdirSync(dir,{recursive:true});
for(const t of targets){
  if(!readFileSync(t.config,'utf8').includes(t.id))throw new Error('Binding mismatch: '+t.name);
  const ddl=readFileSync(t.migration,'utf8').replace(/--[^\n]*/g,'').trim();
  if(ddl.split(';').filter(s=>s.trim()).some(s=>!/^\s*CREATE (TABLE|INDEX) IF NOT EXISTS [a-z_]+\s/i.test(s)))throw new Error('Only additive reviewed DDL is permitted');
  const run=args=>{
    const result=spawnSync('npx',['--yes','wrangler@4.137.0',...args,'--config',t.config,'--env','production','--json'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:t.account},encoding:'utf8',maxBuffer:4*1024*1024});
    if(result.status!==0)throw new Error(result.stderr||'D1 command failed');return JSON.parse(result.stdout);
  };
  const execute=sql=>run(['d1','execute',t.db,'--remote','--command',sql]);
  const record={target:t.name,databaseId:t.id,startedAt:new Date().toISOString(),migration:t.migration};
  const save=()=>writeFileSync(`${dir}/${t.name}-read-efficiency-migration.json`,JSON.stringify(record,null,2)+'\n');
  record.recovery=run(['d1','time-travel','info',t.db]);
  if(!record.recovery.bookmark)throw new Error('No recovery bookmark; stopping before DDL');
  save();record.beforePlan=execute('EXPLAIN QUERY PLAN '+t.plan);save();
  record.applied=execute(ddl);save();
  record.afterPlan=execute('EXPLAIN QUERY PLAN '+t.plan);record.completedAt=new Date().toISOString();save();
  console.log(JSON.stringify({target:t.name,applied:true,plan:record.afterPlan[0].results.map(r=>r.detail)}));
}
