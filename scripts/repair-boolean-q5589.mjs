// Scoped repair of the user-reported question, using the verified original HTML.
// Default is read-only; --apply writes only stem/options/explanation, with an
// exact old-value guard and a recovery artifact. Never replaces IDs or progress.
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {JSDOM} from '../artifacts/edtech/node_modules/jsdom/lib/api.js';
import {build} from '../artifacts/api-server/node_modules/esbuild/lib/main.js';
const sourcePath='/Users/sameermajhi/Downloads/digital/Digital_Electronics_56Q_OVERBARS_VERIFIED.html';
const id=1000000005589;
const config='artifacts/psu-worker/wrangler.toml';
const account='c8cdcd5acfd39d60f7cfe7989d6a6608';
const dir='artifacts/api-server/verification/20261005/boolean-q5589';
const window=new JSDOM('').window;
for(const key of ['DOMParser','Node','NodeFilter'])globalThis[key]=window[key];
const bundled=await build({entryPoints:['artifacts/edtech/src/lib/pyqImport.ts'],bundle:true,write:false,format:'esm',platform:'node',tsconfig:'artifacts/edtech/tsconfig.json'});
const {parsePyqHtml}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const source=readFileSync(sourcePath,'utf8');
const sourceDoc=new DOMParser().parseFromString(source,'text/html');
const card=sourceDoc.querySelector('#q23');
assert(card?.querySelector('.qtext')?.textContent.includes('The complement of'));
const parsed=parsePyqHtml(source,sourcePath).questions;
const replacement=parsed.find(q=>q.questionNumber===23);
assert(replacement);
const parse=html=>new DOMParser().parseFromString(html||'','text/html');
const contentText=html=>{
 const doc=parse(html);
 doc.querySelectorAll('.answer,script,style,annotation').forEach(n=>n.remove());
 return doc.body.textContent.replace(/[¯ˉ‾̅―—\s]/g,'');
};
const run=args=>{
 const r=spawnSync('npx',['--yes','wrangler@4.137.0',...args,'--config',config,'--env','production','--json'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account},encoding:'utf8',maxBuffer:8*1024*1024});
 if(r.status!==0)throw Error(r.stderr||r.stdout||'D1 failed');
 return JSON.parse(r.stdout);
};
const query=sql=>run(['d1','execute','psu','--remote','--command',sql]);
const select=`SELECT id,chapter_id,question,options,explanation,correct_answer FROM question_bank_questions WHERE id=${id}`;
const rows=query(select)[0].results;
assert.equal(rows.length,1);
const old=rows[0];
assert.equal(old.chapter_id,295);
assert.equal(old.correct_answer,replacement.correctAnswer);
assert.equal(contentText(old.question),contentText(card.querySelector('.qtext').innerHTML));
const originalOptions=[...card.querySelectorAll('.option-content')].map(n=>n.innerHTML);
assert.deepEqual(JSON.parse(old.options).map(contentText),originalOptions.map(contentText));
assert.equal(contentText(old.explanation),contentText(card.querySelector('.solution-inner').innerHTML));
const expected={question:replacement.question,options:JSON.stringify(replacement.options),explanation:replacement.explanation};
assert.equal(parse(expected.question).querySelectorAll('.overline-line').length,3);
assert.deepEqual(replacement.options.map(o=>parse(o).querySelectorAll('.overline-line').length),[3,3,2,0]);
assert(parse(expected.explanation).querySelector('.overline-line'));
console.log(JSON.stringify({id,sourceQuestion:23,sourceQuestionsParsed:parsed.length,sourceMatched:true,questionBars:3,optionBars:[3,3,2,0],apply:process.argv.includes('--apply')}));
if(process.argv.includes('--apply')){
 mkdirSync(dir,{recursive:true});
 const backupPath=`${dir}/before.json`;
 writeFileSync(backupPath,JSON.stringify({sourcePath,before:old,replacement:expected},null,2),{flag:'wx'});
 const recovery=run(['d1','time-travel','info','psu']);
 assert(recovery.bookmark);
 writeFileSync(`${dir}/recovery.json`,JSON.stringify(recovery,null,2),{flag:'wx'});
 const literal=v=>v==null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 const sql=`UPDATE question_bank_questions SET question=${literal(expected.question)},options=${literal(expected.options)},explanation=${literal(expected.explanation)},updated_at=${Date.now()} WHERE id=${id} AND chapter_id=295 AND question=${literal(old.question)} AND options=${literal(old.options)} AND explanation IS ${literal(old.explanation)} AND correct_answer=${old.correct_answer}`;
 const updated=query(sql);
 assert.equal(updated[0].meta.changes,1);
 const after=query(select)[0].results[0];
 for(const key of Object.keys(expected))assert.equal(after[key],expected[key]);
 assert.equal(after.correct_answer,old.correct_answer);
 writeFileSync(`${dir}/verified.json`,JSON.stringify({id,verifiedAt:new Date().toISOString(),changes:1,questionBars:3,optionBars:[3,3,2,0],progressUntouched:true},null,2));
 console.log('Verified: one question repaired; answer key, IDs and student progress unchanged.');
}
