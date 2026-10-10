import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
if(!['--check','--apply'].includes(process.argv[2]))throw Error('Usage: node scripts/apply-offline-practice.mjs --check|--apply');
const apply=process.argv[2]==='--apply';
if(process.argv.includes('--skip-gate-pyq')&&process.argv.includes('--only-gate-pyq'))throw Error('Choose either --skip-gate-pyq or --only-gate-pyq');
const targets=[
 ['main','044791c24ac1de2cb822a0df91b2ab5f','rank','artifacts/api-server/wrangler.toml'],
 ['qbank','7a94feb19c9db9b7efb44b20cb249203','qbank','artifacts/qbank-worker/wrangler.toml'],
 ['jam','c8cdcd5acfd39d60f7cfe7989d6a6608','jam-chemistry','artifacts/jam-content-worker/wrangler.toml'],
 ['psu','c8cdcd5acfd39d60f7cfe7989d6a6608','psu','artifacts/psu-worker/wrangler.toml'],
 ['pyq','b9522908b9bc3ab7fc3d80bda2121c95','pyq','artifacts/pyq-worker/wrangler.toml'],
 ['starter','1e65bed301120c0c392ae4989b3ed6b0','starter-questions','artifacts/starter-worker/wrangler.toml'],
].filter(([name])=>(!process.argv.includes('--skip-gate-pyq')||name!=='pyq')&&(!process.argv.includes('--only-gate-pyq')||name==='pyq'));
const ddl=readFileSync('artifacts/api-server/migrations/20261006_offline_practice.sql','utf8').split('\n').filter(l=>!l.startsWith('--')).join('\n').split(';').map(x=>x.trim()).filter(Boolean);
// Verify every configured database before making ANY production schema change.
if(apply){
 const check=spawnSync(process.execPath,[process.argv[1],'--check',...process.argv.slice(3)],{stdio:'inherit'});
 if(check.status!==0)throw Error('Preflight failed; no schema changes applied');
}
for(const [name,account,db,config] of targets){
 const run=args=>{const r=spawnSync('npx',['--yes','wrangler','d1',...args,'--config',config,'--env','production','--json'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account},encoding:'utf8',maxBuffer:2e6});if(r.status!==0)throw Error(name+': '+(r.stderr||r.stdout));return JSON.parse(r.stdout);};
 const query=sql=>run(['execute',db,'--remote','--command',sql]);
 const record={name,at:new Date().toISOString(),tables:[]};
 for(const statement of ddl){
  const table=statement.match(/^ALTER TABLE (\w+) ADD COLUMN offline_submission_ids TEXT NOT NULL DEFAULT '\[\]'$/)?.[1];
  if(!table)throw Error('Unexpected migration statement');
  const columns=query(`PRAGMA table_info(${table})`)[0].results;
  if(!columns.length)continue;
  const needed=!columns.some(c=>c.name==='offline_submission_ids');
  if(needed&&apply){
   record.recovery??=run(['time-travel','info',db]);
   if(!record.recovery.bookmark)throw Error('No recovery bookmark for '+name);
   mkdirSync('artifacts/api-server/verification/20261006',{recursive:true});
   writeFileSync(`artifacts/api-server/verification/20261006/${name}-offline.json`,JSON.stringify(record,null,2));
   query(statement);
   if(!query(`PRAGMA table_info(${table})`)[0].results.some(c=>c.name==='offline_submission_ids'))throw Error('Migration verification failed');
  }
  record.tables.push({table,needed,applied:needed&&apply});
 }
 if(apply){mkdirSync('artifacts/api-server/verification/20261006',{recursive:true});writeFileSync(`artifacts/api-server/verification/20261006/${name}-offline.json`,JSON.stringify(record,null,2));}
 console.log(JSON.stringify(record.tables.map(t=>({target:name,...t}))));
}
