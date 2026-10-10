import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';
const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:'https://example.test'});
Error.stackTraceLimit = 2;
for (const key of ['window','document','HTMLElement','Element','Node','DOMParser','MutationObserver','getComputedStyle']) globalThis[key]=key==='getComputedStyle'?dom.window[key].bind(dom.window):dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
// React's browser scheduler opens MessageChannels in this Node/JSDOM harness.
const NativeMessageChannel = globalThis.MessageChannel;
const schedulerChannels = [];
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); schedulerChannels.push(this); }
};
const output = await build({
  stdin: { contents: `export {default as Practice, AiPracticeLibrary as Library} from './src/components/student/AiSimilarPractice'; export {createRoot} from 'react-dom/client'; export {act, createElement} from 'react'; export {QueryClient,QueryClientProvider} from '@tanstack/react-query';`, resolveDir:new URL('..',import.meta.url).pathname },
  bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,
  plugins:[{name:'test-api',setup(b){
    b.onResolve({filter:/^@\/contexts\/AuthContext$/},()=>({path:'auth',namespace:'double'}));
    b.onResolve({filter:/^@\/lib\/api$/},()=>({path:'api',namespace:'double'}));
    b.onLoad({filter:/.*/,namespace:'double'},({path})=>({contents:path==='auth'?'export const useAuth=()=>({user:{id:2,role:"student",priorityAccess:true}});':'export const api={get:(...a)=>globalThis.__practiceApi.get(...a),post:(...a)=>globalThis.__practiceApi.post(...a)};'}));
  }}],
});
const {Practice,Library,createRoot,act,createElement:h,QueryClient,QueryClientProvider}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
test('Easy generation, math, retry, level-up and bookmarked chapter library survive remount',async()=>{
  const seed={source:'pyq',sourceQuestionId:7,exam:'GATE ECE',subject:'Networks',chapter:'Circuits',question:'Current?',questionType:'mcq',options:['1','2']};
  let rows=[]; const generations=[];
  globalThis.__practiceApi={
    get:async path=>path.includes('registration-status')?{aiAccess:true}:{questions:rows,nextCursor:null},
    post:async(path,body)=>{
      if(path==='/ai/similar-question'){
        generations.push(body.difficulty);
        const question={...seed,id:rows.length+1,difficulty:body.difficulty,question:'Find $I_1=\\frac{V}{R}$.',options:['1 A','2 A'],correctAnswer:1,correctAnswerMulti:[],explanation:'$I_1=2$ A.',isSaved:false};rows=[question,...rows];return {question};
      }
      const id=Number(path.split('/')[3]); const row=rows.find(q=>q.id===id);
      if(path.endsWith('/save')){row.isSaved=!row.isSaved;return {saved:row.isSaved};}
      if(path.endsWith('/attempt')){row.lastAnswer=body.answer;if(body.answer===1)row.solvedAt=Date.now();return {isCorrect:body.answer===1};}
    }
  };
  let root,client;
  const mount=async(Component,props)=>{client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false,gcTime:0}}});root=createRoot(document.getElementById('root'));await act(async()=>root.render(h(QueryClientProvider,{client},h(Component,props))));};
  const until=async condition=>{for(let i=0;i<60;i++){await act(async()=>{await new Promise(r=>setTimeout(r,10));});if(condition())return;}assert.fail('UI condition timed out');};
  const click=async button=>{assert(button);await act(async()=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
  const textButton=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  try{
    await mount(Practice,seed);
    await until(()=>document.querySelector('[aria-label="Generate Easy similar question"]'));
    assert(document.querySelector('[aria-label="Choose practice difficulty"]'));
    assert(!document.body.textContent.includes("Your AI practice"));
    assert(!document.body.textContent.includes("Solve your AI question correctly"));
    assert(document.querySelector('[aria-label="Choose practice difficulty"]').className.includes("text-violet-700"));
    await click(document.querySelector('[aria-label="Generate Easy similar question"]'));
    await until(()=>textButton('Solve question'));
    assert.deepEqual(generations,['easy']);
    assert(document.querySelector('.katex'));
    assert(!textButton('Level up to Mid'));
    await click(textButton('Solve question'));
    await click(document.querySelector('button[aria-pressed="false"]'));
    await click(textButton('Check answer'));
    await until(()=>document.body.textContent.includes('Try again after reviewing'));
    assert(!textButton('Level up to Mid'));
    await click([...document.querySelectorAll('button[aria-pressed]')][1]);
    await click(textButton('Check answer'));
    await until(()=>textButton('Level up to Mid'));
    await click(document.querySelector('[aria-label="Save AI question"]'));
    await until(()=>document.querySelector('[aria-label="Unsave AI question"]'));
    await click(textButton('Level up to Mid'));
    await until(()=>generations.length===2);
    assert.deepEqual(generations,['easy','mid']);
    await act(async()=>root.unmount());client.clear();
    await mount(Library,{source:'pyq',exam:seed.exam,subject:seed.subject,chapter:seed.chapter});
    await until(()=>document.querySelector('[aria-label="Unsave AI question"]'));
    assert.equal(document.querySelectorAll('article').length,2);
    assert(textButton('Level up to Mid'));
  }finally{await act(async()=>root?.unmount());client?.clear();dom.window.close();for(const channel of schedulerChannels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=NativeMessageChannel;}
});
