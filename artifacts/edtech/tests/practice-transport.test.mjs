import assert from 'node:assert/strict';
import {test} from 'node:test';
import 'fake-indexeddb/auto';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
const result=await build({stdin:{contents:`export{api}from'./src/lib/api';export*from'./src/lib/offline-practice';export*from'./src/lib/practice-transport';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'}});
const lib=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
globalThis.window=new EventTarget();window.localStorage=localStorage;Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const user=id=>localStorage.setItem('educonnect_user',JSON.stringify({id,role:'student',status:'active'}));
const q=id=>({id,exam:'gate',question:'Original question',questionType:'mcq',options:['A','B'],correctAnswer:0,view:{difficulty:'starter',points:2}});

test('normal API restores buffered content and queues first-submit time with account isolation',async()=>{
 user(70);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:70,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 await lib.cachePracticeRead('/question-bank/chapters/5/questions?indexOnly=1',{questions:[{id:1},{id:2}]},70);
 navigator.onLine=false;
 const content=await lib.api.get('/question-bank/chapters/5/questions?questionId=1');
 assert.equal(content.questions[0].question,'Original question');assert.equal(content.questions[0].difficulty,'starter');
 await lib.api.post('/question-bank/questions/1/time',{exam:'gate',timeSpentSeconds:23});
 const submitted=await lib.api.post('/question-bank-questions/1/attempt',{answer:0});assert.equal(submitted.isCorrect,true);
 assert.equal((await lib.getOfflineAttempts(70))[0].firstSubmissionTime,23);
 const repeated=await lib.api.post('/question-bank-questions/1/attempt',{answer:1});assert.equal(repeated.answer,0);
 const loaded=await lib.api.get('/question-bank/chapters/5/questions?questionId=1');assert.equal(loaded.questions[0].offlineAnswer,0);
 await assert.rejects(lib.api.get('/question-bank/chapters/5/questions?questionId=2'),/Connect/);
 await assert.rejects(lib.api.get('/tests/1'),/Connect/);
 user(71);await assert.rejects(lib.api.get('/question-bank/chapters/5/questions?questionId=1'),/Connect/);
});

test('lost online response queues the original receipt; authorization failures never become offline success',async()=>{
 user(72);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:72,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 let sent;
 globalThis.fetch=async(_path,options)=>{sent=JSON.parse(options.body);throw new TypeError('lost response');};
 const saved=await lib.api.post('/question-bank-questions/1/attempt',{answer:0});assert.equal(saved.offlineSaved,true);
 assert.equal((await lib.getOfflineAttempts(72))[0].id,sent.offlineSubmissionId);
 globalThis.fetch=async()=>Response.json({error:'Denied'},{status:403});
 await assert.rejects(lib.api.post('/question-bank-questions/1/attempt',{answer:1}),/Denied/);
 assert.equal((await lib.getOfflineAttempts(72)).length,1);
});

test('PYQ metadata snapshots keep list positions without saving out-of-buffer content',async()=>{
 user(73);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:73,source:'pyq',context:'pyq:gate:subject:chapter',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 const path='/pyq/questions?exam=gate&subject=subject&chapter=chapter';
 await lib.cachePracticeRead(path,{questions:[q(1),{...q(2),question:'Do not cache this body'}],total:2},73);
 navigator.onLine=false;
 const data=await lib.api.get(path);assert.equal(data.questions.length,2);assert.equal(data.questions[0].question,'Original question');
 assert.equal(data.questions[1].offlineUnavailable,true);assert.ok(!JSON.stringify(data).includes('Do not cache this body'));
});

test('online revalidation falls back to ready content and metadata within a bounded wait',async()=>{
 user(74);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:74,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1,2]},async ids=>ids.map(q));
 const metadata='/question-bank/chapters/5/questions?indexOnly=1';
 await lib.cachePracticeRead(metadata,{questions:[{id:1},{id:2}]},74);
 let calls=0;let signal;
 globalThis.fetch=async(_path,options)=>{calls++;signal=options.signal;return new Promise(()=>{});};
 const before=Date.now();
 assert.equal((await lib.api.get('/question-bank/chapters/5/questions?questionId=2')).questions[0].id,2);
 assert.equal(calls,1,'ready question checks for teacher edits before falling back');
 assert(Date.now()-before<2200);
 assert(signal.aborted);
 const metadataStarted=Date.now();
 const index=await lib.api.get(metadata);
 assert.equal(index.questions.length,2);assert.equal(calls,2);assert(signal.aborted);
 assert(Date.now()-metadataStarted<2200,'metadata fallback does not wait for browser network timeout');
});

test('teacher edits replace buffered options, solution and answer key online and remain corrected offline',async()=>{
 user(81);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:81,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 navigator.onLine=false;
 await lib.api.post('/question-bank-questions/1/attempt',{answer:1});
 assert.equal((await lib.getOfflineAttempts(81))[0].isCorrect,false);
 navigator.onLine=true;
 const corrected={...q(1),question:'Corrected question',options:['10<sup>3</sup> cm<sup>−3</sup> s<sup>−1</sup>','10<sup>12</sup> cm<sup>−3</sup> s<sup>−1</sup>'],correctAnswer:1,explanation:'Corrected solution',progress:null,hasImage:false,hasOptionImages:false};
 let reads=0;
 globalThis.fetch=async()=>{reads++;return Response.json({questions:[corrected]});};
 const path='/question-bank/chapters/5/questions?questionId=1';
 const fresh=await lib.api.get(path);
 assert.equal(reads,1);assert.deepEqual(fresh.questions[0].options,corrected.options);
 navigator.onLine=false;
 const offline=await lib.api.get(path);
 assert.deepEqual(offline.questions[0].options,corrected.options);
 assert.equal(offline.questions[0].explanation,'Corrected solution');
 assert.equal(offline.questions[0].offlineCorrect,true);
 assert.equal(offline.questions[0].offlineAnswer,1);
 assert.equal((await lib.getOfflineAttempts(81)).length,1,'correction never adds attempts');
 navigator.onLine=true;
 globalThis.fetch=async()=>Response.json({error:'Denied'},{status:403});
 await assert.rejects(lib.api.get(path),/Denied/);
});

test('stalled response body queues the same receipt and timestamp while Wi-Fi stays online',async()=>{
 user(75);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:75,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 let sent;let signal;
 globalThis.fetch=async(_path,options)=>{sent=JSON.parse(options.body);signal=options.signal;return {ok:true,text:()=>new Promise(()=>{})};};
 const before=Date.now();
 const saved=await lib.api.post('/question-bank-questions/1/attempt',{answer:0});
 assert(saved.offlineSaved);assert(signal.aborted);assert(navigator.onLine);
 const pending=(await lib.getOfflineAttempts(75))[0];
 assert.equal(pending.id,sent.offlineSubmissionId);assert.equal(pending.attemptedAt,sent.attemptedAt);
 assert(Date.now()-before<3300);
});

test('temporary 503 queues safely, while 401/403/422 never become local success',async()=>{
 user(76);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:76,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1,2]},async ids=>ids.map(q));
 globalThis.fetch=async()=>Response.json({error:'Temporary'},{status:503});
 assert((await lib.api.post('/question-bank-questions/1/attempt',{answer:0})).offlineSaved);
 for(const status of [401,403,422]){
  globalThis.fetch=async()=>Response.json({error:`Denied ${status}`},{status});
  await assert.rejects(lib.api.post('/question-bank-questions/2/attempt',{answer:0}),new RegExp(`Denied ${status}`));
 }
 assert.equal((await lib.getOfflineAttempts(76)).length,1);
});

test('refill bypasses the cache, cancellation never queues, and concurrent reads are coalesced',async()=>{
 user(77);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:77,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 const path='/question-bank/chapters/5/questions?questionId=1';
 let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({questions:[{...q(1),question:'Fresh server content'}]});};
 const values=await Promise.all([lib.api.get(path,{networkOnly:true}),lib.api.get(path,{networkOnly:true})]);
 assert.equal(calls,1);assert.equal(values[0].questions[0].question,'Fresh server content');
 const controller=new AbortController();
 globalThis.fetch=async()=>new Promise(()=>{});
 const cancelled=lib.api.get(path,{networkOnly:true,signal:controller.signal});
 controller.abort();await assert.rejects(cancelled,/abort|cancel/i);
 assert.equal((await lib.getOfflineAttempts(77)).length,0);
});

test('changing accounts during a slow fetch cannot return the previous student snapshot',async()=>{
 user(78);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:78,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 const path='/question-bank/chapters/5/questions?indexOnly=1';
 await lib.cachePracticeRead(path,{questions:[{id:1}]},78);
 let reject;let started;
 const ready=new Promise(resolve=>{started=resolve;});
 globalThis.fetch=()=>new Promise((_,fail)=>{reject=fail;started();});
 const request=lib.api.get(path);await ready;user(79);reject(new TypeError('Connection lost'));
 await assert.rejects(request,/original account|account changed/i);
});

test('a received permission denial with a stalled body cannot be queued as an offline success',async()=>{
 user(80);navigator.onLine=true;
 await lib.prepareOfflineBuffer({userId:80,source:'question-bank',context:'qb:gate:5',title:'Chapter',questionIds:[1]},async ids=>ids.map(q));
 globalThis.fetch=async()=>({ok:false,status:403,json:()=>new Promise(()=>{})});
 await assert.rejects(lib.api.post('/question-bank-questions/1/attempt',{answer:0}),/HTTP 403/);
 assert.equal((await lib.getOfflineAttempts(80)).length,0);
});
