// Backfill only resolved QBank reports with exact stored test links.
// Read-only by default. --apply uses guarded UPDATEs, never inserts/deletes rows.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {build} from '../artifacts/api-server/node_modules/esbuild/lib/main.js';
const execute = promisify(execFile);
const bundled = await build({entryPoints:['artifacts/api-server/src/lib/linkedTestQuestionSync.ts'],bundle:true,write:false,format:'esm'});
const {linkedTestTargets,linkedTestSyncStatements} = await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const scopes = {
  main:{account:'044791c24ac1de2cb822a0df91b2ab5f',config:'artifacts/api-server/wrangler.toml',database:'rank'},
  GATE:{account:'7a94feb19c9db9b7efb44b20cb249203',config:'artifacts/qbank-worker/wrangler.toml',database:'qbank'},
  JAM:{account:'c8cdcd5acfd39d60f7cfe7989d6a6608',config:'artifacts/jam-content-worker/wrangler.toml',database:'jam-chemistry'},
  Starter:{account:'1e65bed301120c0c392ae4989b3ed6b0',config:'artifacts/starter-worker/wrangler.toml',database:'starter-questions'},
};
const requested = process.argv.find(value=>value.startsWith('--scopes='))?.slice(9).split(',') ?? ['GATE','JAM','Starter'];
for (const name of requested) assert(name !== 'main' && scopes[name], 'Unknown content scope');
const apply = process.argv.includes('--apply');
const dir = resolve('artifacts/api-server/verification/20261007',`resolved-qbank-test-sync-${Date.now()}`);
mkdirSync(dir,{recursive:true});
const save = (name,value) => writeFileSync(resolve(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const quote = value => value == null ? 'NULL' : typeof value === 'number' ? (assert(Number.isFinite(value)),String(value)) : `'${String(value).replaceAll("'","''")}'`;
async function run(name,args) {
  const scope=scopes[name];
  try {
    const {stdout}=await execute('npx',['--yes','wrangler','d1',...args,'--config',scope.config,'--env','production','--json'],
      {env:{...process.env,CLOUDFLARE_ACCOUNT_ID:scope.account},maxBuffer:96*1024*1024,timeout:60000});
    const result=JSON.parse(stdout);
    if(Array.isArray(result))for(const item of result)assert(item.success!==false,`${name} D1 statement failed`);
    return result;
  } catch(error) {
    // Do not dump command contents, corrected question text or student data.
    const message=String(error.stderr||error.stdout||error.message);
    save(`failure-${name}-${Date.now()}.json`,{stage:args.slice(0,3),message:error.message,stderr:error.stderr??'',stdout:error.stdout??'',exitCode:error.code});
    throw Error(`${name} D1 ${/7403|not authorized/.test(message)?'access denied':'request failed'}`);
  }
}
async function query(name,sql) {return (await run(name,['execute',scopes[name].database,'--remote','--command',sql])).flatMap(item=>item.results??[]);}
async function writeMainBatch(statements) {
  // Use Wrangler's legitimate current credential in memory. Parameter binding
  // avoids huge inline image literals and the disruptive SQL-import workflow.
  const {stdout}=await execute('npx',['--yes','wrangler','auth','token','--json'],{maxBuffer:1024*1024,timeout:30000});
  const credential=JSON.parse(stdout);assert(credential.token,'Current Cloudflare credential is required');
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/044791c24ac1de2cb822a0df91b2ab5f/d1/database/832a1c3f-79d9-4b07-85de-06ca4b85ba56/query',
    {method:'POST',headers:{Authorization:`Bearer ${credential.token}`,'Content-Type':'application/json'},
      body:JSON.stringify({batch:statements}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  save('write-result.json',{status:response.status,success:result.success,errors:result.errors,metadata:result.result?.map(item=>({success:item.success,meta:item.meta}))});
  assert(response.ok&&result.success,'Main database guarded update request failed; inspect write-result.json');
}
const reportFilter=`EXISTS(SELECT 1 FROM question_bank_reports r WHERE r.question_id=q.id AND r.status='resolved')
  AND NOT EXISTS(SELECT 1 FROM question_bank_reports r WHERE r.question_id=q.id AND r.status='open')`;
const loaded=await Promise.all(requested.map(async name=>{
  try {
    const questions=await query(name,`SELECT q.* FROM question_bank_questions q WHERE ${reportFilter} ORDER BY q.id`);
    const links=questions.length?await query(name,`SELECT test_id,test_question_id,question_bank_question_id FROM test_question_bank_links WHERE question_bank_question_id IN (${questions.map(q=>Number(q.id)).join(',')})`):[];
    return {name,questions,links};
  } catch(error) {return {name,error:error.message};}
}));
const candidates=[];
for(const scope of loaded)if(!scope.error)for(const question of scope.questions)for(const target of linkedTestTargets(question,scope.links.filter(link=>Number(link.question_bank_question_id)===Number(question.id))))
  candidates.push({scope:scope.name,question,target});
const ids=[...new Set(candidates.map(item=>item.target.questionId))];
const testRows=ids.length?await query('main',`SELECT * FROM test_questions WHERE id IN (${ids.join(',')}) ORDER BY id`):[];
const mapping={question:'question',questionType:'question_type',options:'options',optionImages:'option_images',correctAnswer:'correct_answer',correctAnswerMulti:'correct_answer_multi',correctAnswerMin:'correct_answer_min',correctAnswerMax:'correct_answer_max',imageData:'image_data',explanation:'solution_text'};
function expected(question,key) {
  const statement=linkedTestSyncStatements(question,[key],[{testId:1,questionId:1}])[0];
  return statement.params[0];
}
function equivalent(key,left,right) {
  if(['options','optionImages','correctAnswerMulti'].includes(key)) {
    const parse=value=>{try{return JSON.parse(value??'null');}catch{return value;}};
    return JSON.stringify(parse(left))===JSON.stringify(parse(right));
  }
  if(['question','imageData','explanation'].includes(key))return (left??'')===(right??'');
  return left===right;
}
const plans=new Map(), missing=[];
for(const candidate of candidates) {
  const before=testRows.find(row=>Number(row.id)===candidate.target.questionId&&Number(row.test_id)===candidate.target.testId);
  if(!before){missing.push({scope:candidate.scope,qbankId:candidate.question.id,...candidate.target});continue;}
  const keys=Object.keys(mapping).filter(key=>!equivalent(key,expected(candidate.question,key),before[mapping[key]]));
  if(!keys.length)continue;
  const statement=linkedTestSyncStatements(candidate.question,keys,[candidate.target])[0];
  const destination={...before};
  for(const key of keys)destination[mapping[key]]=expected(candidate.question,key);
  destination.ai_solution_text=null;
  if(keys.includes('explanation'))destination.solution_image_data=null;
  const previous=plans.get(before.id);
  if(previous){assert.deepEqual(previous.after,destination,`Conflicting QBank corrections for test question ${before.id}; refusing all writes`);continue;}
  const guards=Object.keys(before).map(column=>`"${column}" IS ${quote(before[column])}`).join(' AND ');
  // Every existing column is checked, including marks, section and old content.
  const interpolated=statement.sql.replace(/\?/g,(()=>{let index=0;return()=>quote(statement.params[index++]);})());
  plans.set(before.id,{scope:candidate.scope,qbankId:candidate.question.id,source:candidate.question,before,after:destination,changedFields:keys,
    sql:`${interpolated} AND ${guards};`,
    statement:{sql:`${statement.sql} AND ${Object.keys(before).map(column=>`"${column}" IS ?`).join(' AND ')}`,
      params:[...statement.params,...Object.values(before)]}});
}
const summary={apply,scopes:loaded.map(scope=>({scope:scope.name,correctedQuestions:scope.questions?.length??null,error:scope.error??null})),
  exactLinks:candidates.length,missingTargets:missing.length,questionsToUpdate:plans.size,testsToUpdate:new Set([...plans.values()].map(plan=>plan.before.test_id)).size,
  plan:[...plans.values()].map(plan=>({scope:plan.scope,qbankId:plan.qbankId,testId:plan.before.test_id,testQuestionId:plan.before.id,changedFields:plan.changedFields})),artifactDirectory:dir};
save('audit.json',{...summary,missingTargets:missing});
save('before-and-expected.json',[...plans.values()].map(({sql,statement,...plan})=>plan));
console.log(JSON.stringify(summary));
if(!apply||!plans.size)process.exit(0);
// Recheck canonical corrected QBank content immediately before touching tests.
for(const name of new Set([...plans.values()].map(plan=>plan.scope))) {
  const relevant=[...plans.values()].filter(plan=>plan.scope===name);
  const current=await query(name,`SELECT q.* FROM question_bank_questions q WHERE q.id IN (${[...new Set(relevant.map(plan=>plan.qbankId))].join(',')}) AND ${reportFilter}`);
  for(const plan of relevant)assert.deepEqual(current.find(q=>Number(q.id)===Number(plan.qbankId)),plan.source,'QBank changed after audit; refusing writes');
}
const recovery=await run('main',['time-travel','info','rank']);
assert(recovery.bookmark,'Main database recovery bookmark is required');save('recovery.json',recovery);
const inventorySql='SELECT id,test_id,section_id,"order",points,negative_marks,question_code,meta,source_type,subject_label FROM test_questions ORDER BY id';
const inventory=await query('main',inventorySql);
const affectedTests=[...new Set([...plans.values()].map(plan=>plan.before.test_id))];
const submissions=await query('main',`SELECT * FROM test_submissions WHERE test_id IN (${affectedTests.join(',')}) ORDER BY id`);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
save('preservation.json',{inventory,submissionDigests:submissions.map(row=>({id:row.id,hash:hash(row)}))});
// SQL contains only guarded UPDATEs; no deletes, inserts, report/status or submission writes.
const sql=[...plans.values()].map(plan=>plan.sql).join('\n');
assert([...plans.values()].every(plan=>plan.sql.startsWith('UPDATE test_questions SET ')));
const sqlFile=resolve(dir,'updates.sql');writeFileSync(sqlFile,sql,{flag:'wx',mode:0o600});
await writeMainBatch([...plans.values()].map(plan=>plan.statement));
const after=await query('main',`SELECT * FROM test_questions WHERE id IN (${[...plans.keys()].join(',')}) ORDER BY id`);
for(const plan of plans.values())assert.deepEqual(after.find(row=>row.id===plan.before.id),plan.after,`Concurrent edit or incomplete sync on test question ${plan.before.id}; inspect recovery artifact`);
assert.deepEqual(await query('main',inventorySql),inventory,'Test IDs, marks, sections or ordering changed during verification');
if(submissions.length) {
  const current=await query('main',`SELECT * FROM test_submissions WHERE id IN (${submissions.map(row=>row.id).join(',')}) ORDER BY id`);
  assert.deepEqual(current,submissions,'Preexisting student submissions changed during verification');
}
save('verified.json',{verifiedAt:new Date().toISOString(),updatedQuestions:plans.size,updatedTests:affectedTests.length,testQuestionCount:inventory.length,
  noTestQuestionsDeleted:true,marksAndOrderUnchanged:true,studentSubmissionsUnchanged:true,blockedScopes:loaded.filter(scope=>scope.error).map(scope=>scope.name)});
console.log(JSON.stringify({verified:true,updatedQuestions:plans.size,updatedTests:affectedTests.length,noTestQuestionsDeleted:true,studentSubmissionsUnchanged:true,artifactDirectory:dir}));
