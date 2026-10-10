import assert from 'node:assert/strict';
import {test} from 'node:test';
import 'fake-indexeddb/auto';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
const bundled=await build({entryPoints:[new URL('../src/lib/offline-practice.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'}});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
globalThis.window=new EventTarget();
Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
function pack(userId,source='question-bank'){return {id:`pack-0000-0000-${userId}`,userId,source,title:'Test',context:'test',createdAt:Date.now(),questions:Array.from({length:16},(_,i)=>({id:i+1,exam:'gate',question:'Q',questionType:'mcq',options:['A','B'],correctAnswer:0}))};}

test('IndexedDB keeps 15 answers, rejects the 16th, locks answers and isolates accounts',async()=>{
 const p=pack(1);
 for(const q of p.questions.slice(0,15))await api.submitOffline(p,q,0,42);
 await assert.rejects(api.submitOffline(p,p.questions[15],1,99),/15 answers/);
 const repeat=await api.submitOffline(p,p.questions[0],1,99);assert.equal(repeat.answer,0);assert.equal(repeat.firstSubmissionTime,42);
 assert.equal((await api.getOfflineAttempts(1)).length,15);assert.equal((await api.getOfflineAttempts(2)).length,0);
});
test('sync retries after lost response with the same ID, then applies the server grade',async()=>{
 const p=pack(2,'pyq');await api.submitOffline(p,p.questions[0],0,12);navigator.onLine=true;
 const receipts=new Set();let increments=0,drop=true;const posts=[];
 globalThis.fetch=async(path,options)=>{
  if(path==='/api/auth/me')return Response.json({id:2});
  const body=JSON.parse(options.body);posts.push({path,body});
  if(path.endsWith('/time'))return Response.json({timeSpentSeconds:12});
  if(!receipts.has(body.offlineSubmissionId)){receipts.add(body.offlineSubmissionId);increments++;}
  if(drop){drop=false;throw new TypeError('Lost response');}
  return Response.json({isCorrect:false});
 };
 await api.syncOffline(2);assert.equal((await api.getOfflineAttempts(2))[0].status,'pending');
 await api.syncOffline(2);assert.equal(posts.filter(p=>p.path.endsWith('/attempt')).length,1,'backoff avoids immediate duplicate network retries');
 const now=Date.now;Date.now=()=>now()+16000;
 try{await api.syncOffline(2);}finally{Date.now=now;}
 assert.equal(increments,1);
 const answer=(await api.getOfflineAttempts(2))[0];assert.equal(answer.status,'synced');assert.equal(answer.isCorrect,false);
 assert.equal(posts.filter(p=>p.path.endsWith('/attempt')).length,2);
});
test('different signed-in user cannot replay an outbox',async()=>{
 const p=pack(3);await api.submitOffline(p,p.questions[0],0,5);let posted=false;
 globalThis.fetch=async(path)=>{if(path==='/api/auth/me')return Response.json({id:4});posted=true;return Response.json({});};
 await api.syncOffline(3);assert.equal(posted,false);assert.equal((await api.getOfflineAttempts(3))[0].status,'pending');
});
test('MCQ, MSQ and numeric zero/ranges grade without a network',()=>{
 const q=pack(8).questions[0];assert.equal(api.gradeOffline(q,0),true);assert.equal(api.gradeOffline(q,1),false);
 assert.equal(api.gradeOffline({...q,questionType:'multi',correctAnswerMulti:[2,0]},[0,2]),true);
 assert.equal(api.gradeOffline({...q,questionType:'multi',correctAnswerMulti:[0,2,3]},[3,0,2]),true);
 assert.equal(api.gradeOffline({...q,questionType:'multi',correctAnswerMulti:[0,2,3]},[0,2]),false);
 assert.equal(api.gradeOffline({...q,questionType:'multi',correctAnswerMulti:[0,2,3]},[0,1,2,3]),false);
 assert.equal(api.gradeOffline({...q,questionType:'integer',answerMin:0,answerMax:0},'0'),true);
 assert.equal(api.gradeOffline({...q,questionType:'integer',answerMin:1,answerMax:2},'1.5'),true);
 assert.equal(api.gradeOffline({...q,correctAnswer:null},0),null);
});
test('simultaneous tabs cannot exceed the 15-pending limit',async()=>{
 const p=pack(9);const results=await Promise.allSettled(p.questions.map(q=>api.submitOffline(p,q,0,1)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,15);
 assert.equal((await api.getOfflineAttempts(9)).length,15);
});

test('rolling buffer saves current first, fetches only gaps, preserves receipts and isolates chapters',async()=>{
 navigator.onLine=true;
 const q=id=>({...pack(30).questions[0],id});
 const calls=[];
 const input={userId:30,source:'pyq',context:'gate:chapter1',title:'Chapter',questionIds:Array.from({length:15},(_,i)=>i+1)};
 const load=async ids=>{
  calls.push(ids);
  if(calls.length===2)assert.deepEqual((await api.getOfflinePack(30)).questions.map(q=>q.id),[1]);
  return ids.map(q);
 };
 const first=await api.prepareOfflineBuffer(input,load);
 assert.deepEqual(calls.map(ids=>ids.length),[1,4,4,4,2]);
 await api.submitOffline(first,first.questions[1],0,8);
 calls.length=0;
 const next=await api.prepareOfflineBuffer({...input,questionIds:Array.from({length:15},(_,i)=>i+2)},load);
 assert.deepEqual(calls,[[16]]);
 assert.equal(next.id,first.id);
 assert.deepEqual(next.questions.map(q=>q.id),Array.from({length:15},(_,i)=>i+2));
 assert.equal((await api.submitOffline(next,next.questions[0],1,99)).firstSubmissionTime,8);
 assert.equal((await api.getOfflineAttempts(30)).length,1);
 const end=await api.prepareOfflineBuffer({...input,questionIds:[15,16]},load);
 assert.equal(end.questions.length,2);
 const other=await api.prepareOfflineBuffer({...input,context:'gate:chapter2',questionIds:[40]},async ids=>ids.map(q));
 assert.notEqual(other.id,first.id);
 assert.equal((await api.getOfflineAttempts(30)).length,1);
});

test('interrupted refill retains current question; cancelled old navigation cannot overwrite new window',async()=>{
 navigator.onLine=true;
 const input={userId:31,source:'question-bank',context:'chapter',title:'Chapter',questionIds:[1,2,3]};
 const q=id=>({...pack(31).questions[0],id});
 await assert.rejects(api.prepareOfflineBuffer(input,async ids=>{if(ids.includes(2))throw Error('disconnected');return ids.map(q);}),/disconnected/);
 assert.deepEqual((await api.getOfflinePack(31)).questions.map(q=>q.id),[1]);
 let active=true,release,started;
 const waiting=new Promise(resolve=>{started=resolve;});
 const old=api.prepareOfflineBuffer(input,async ids=>{started();await new Promise(resolve=>{release=resolve;});return ids.map(q);},()=>active);
 await waiting;active=false;
 const fresh=await api.prepareOfflineBuffer({...input,questionIds:[10]},async ids=>ids.map(q));
 release();await assert.rejects(old,/cancelled/);
 assert.deepEqual((await api.getOfflinePack(31)).questions,fresh.questions);
});

test('completed question is usable while a later diagram in the batch is still stalled',async()=>{
 navigator.onLine=true;
 const input={userId:32,source:'question-bank',context:'qb:gate:1',title:'Chapter',questionIds:[1,2,3]};
 const q=id=>({...pack(32).questions[0],id});
 let release,ready;
 const published=new Promise(resolve=>{ready=resolve;});
 const loading=api.prepareOfflineBuffer(input,async(ids,signal,onReady)=>{
  if(ids.length===1)return ids.map(q);
  await onReady(q(2));ready();
  await new Promise(resolve=>{release=resolve;});
  throw Error('Question 3 diagram stalled');
 });
 // Attach a rejection handler before releasing the stalled download.
 const failed=assert.rejects(loading,/diagram stalled/);
 await published;
 assert.deepEqual((await api.getOfflinePack(32)).questions.map(q=>q.id),[1,2]);
 release();await failed;
 assert.deepEqual((await api.getOfflinePack(32)).questions.map(q=>q.id),[1,2]);
});
