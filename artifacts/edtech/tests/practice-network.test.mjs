import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
const bundle=await build({entryPoints:[new URL('../src/lib/practice-network.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const lib=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.window=new EventTarget();
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
test('slow session validation can resume only verified unlocked student practice, never admin or tests',()=>{
 const user={role:'student',status:'active',onboardingComplete:true};
 assert(lib.canResumeBufferedPractice(user,'/student/question-bank/exam/gate'));
 assert(lib.canResumeBufferedPractice(user,'/student/pyq'));
 for(const path of ['/student/tests/1','/admin/question-bank','/student/dashboard','/student/pyq-other'])assert(!lib.canResumeBufferedPractice(user,path));
 for(const changed of [null,{...user,role:'admin'},{...user,status:'pending'},{...user,status:'rejected'},{...user,onboardingComplete:false},{...user,studentFeatureAccess:{questionBankLocked:true}}])assert(!lib.canResumeBufferedPractice(changed,'/student/question-bank'));
 assert(!lib.canResumeBufferedPractice({...user,studentFeatureAccess:{pyqLocked:true}},'/student/pyq'));
});
test('buffer keeps current first, next questions and three previous within the 15-question bound',()=>{
 const ids=Array.from({length:30},(_,i)=>i+1);
 assert.deepEqual(lib.practiceBufferIds(ids,0),ids.slice(0,15));
 assert.deepEqual(lib.practiceBufferIds(ids,4),[5,6,7,8,9,10,11,12,13,14,15,16,4,3,2]);
 assert.deepEqual(lib.practiceBufferIds(ids,29),[30,29,28,27]);
});
test('connected low bandwidth and measured stalls select small downloads',()=>{
 navigator.connection={effectiveType:'2g'};assert(lib.weakPracticeConnection());
 navigator.connection={effectiveType:'4g',rtt:50,downlink:10};assert(!lib.weakPracticeConnection());
 lib.practiceNetworkSlow();assert(lib.weakPracticeConnection());
 lib.practiceNetworkHealthy();assert(!lib.weakPracticeConnection());
});
test('deadline settles and aborts an unresponsive transport; explicit cancellation propagates',async()=>{
 let signal;
 await assert.rejects(lib.practiceDeadline(s=>{signal=s;return new Promise(()=>{});},15),{name:'TimeoutError'});
 assert(signal.aborted);
 const controller=new AbortController();controller.abort();
 let called=false;
 await assert.rejects(lib.practiceDeadline(()=>{called=true;return Promise.resolve();},100,controller.signal),{name:'AbortError'});
 assert.equal(called,false);
 assert.equal(await lib.practiceDeadline(async()=>42,100),42);
});
