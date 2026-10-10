import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';

test('chapter UI fetches 20 cards, paginates and filters the entire chapter index', async () => {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://app.example.test/student/question-bank/exam/gate/subject/1/chapter/1'});
  for(const key of ['window','document','location','history','HTMLElement','MutationObserver','localStorage','Event']) globalThis[key]=dom.window[key];
  for(const key of ['addEventListener','removeEventListener','dispatchEvent']) globalThis[key]=dom.window[key].bind(dom.window);
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const calls=[];
  const questions=Array.from({length:200},(_,i)=>({id:i+1,difficulty:i>=100&&i<130?'starter':'medium',isSaved:false,timeSpentSeconds:0,
    progress:i>=150?{attemptCount:1,lastIsCorrect:true}:null}));
  globalThis.__qbTestApi={get: async path=>{
    calls.push(path);
    if(path.endsWith('/structure')) return {exam:{key:'gate',label:'GATE'},subjects:[{id:1,title:'Physics',chapters:[{id:1,title:'Chapter',questionCount:200,attemptedCount:50},{id:2,title:'No starters',questionCount:170,attemptedCount:50}]}]};
    const url=new URL(path,'https://api.example.test');
    if(url.searchParams.get('indexOnly')==='1') return {questions:path.includes('/chapters/2/')?questions.filter(q=>q.difficulty!=='starter'):questions};
    const ids=(url.searchParams.get('questionIds')||url.searchParams.get('questionId')||'').split(',').map(Number);
    return {questions:ids.map(id=>({...questions[id-1],question:`Visible question ${id}`,questionType:'mcq',options:['A','B'],correctAnswer:0,correctAnswerMulti:[],points:1}))};
  }};
  const mocks={
    '@/lib/api':'export const api=globalThis.__qbTestApi;',
    '@/contexts/AuthContext':'const user={id:2,status:"active",role:"student",subject:"GATE"}; export const useAuth=()=>({user});',
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/lib/student-access':'export const isStudentFeatureLocked=()=>false; export const isStudentPendingVerification=()=>false;',
    '@/components/student/PendingVerificationDialog':'export default ()=>null;',
    '@/components/student/PerformanceInsightButton':'export const PerformanceInsightButton=()=>null;',
    '@/components/student/AiSimilarPractice':'export const AiPracticeLibrary=()=>null;',
    '@/components/student/OfflinePractice':'export const OfflinePackLoader=()=>null;',
    '@/lib/offline-qbank':'export const loadOfflineQBank=async()=>[];',
  };
  const result=await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import {Route} from 'wouter';
    import Chapter from './src/pages/student/question-bank/ChapterPage';
    export const act=React.act;
    export function mount(node){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});const root=createRoot(node);
    root.render(<QueryClientProvider client={client}><Route path="/student/question-bank/exam/:examId/subject/:subjectId/chapter/:chapterId"><Chapter/></Route></QueryClientProvider>);
    return ()=>{root.unmount();client.clear();};}`,
    resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'}, bundle:true,write:false,format:'cjs',platform:'node',
    tsconfig:new URL('../tsconfig.json',import.meta.url).pathname, jsx:'automatic',
    plugins:[{name:'test-boundaries',setup(builder){
      builder.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
      builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));
    }}]});
  const module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const {act,mount}=module.exports;
  let unmount;
  const settle=async()=>{for(let i=0;i<8;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});};
  try {
    await act(async()=>{unmount=mount(document.getElementById('root'));}); await settle();
    assert.match(document.body.textContent,/Visible question 1(?!\d)/);
    assert.doesNotMatch(document.body.textContent,/Visible question 101/);
    assert.doesNotMatch(document.body.textContent,/Visible question 21\b/);
    assert.match(document.body.textContent,/1–20 of 200/);
    assert.ok([...document.querySelectorAll('button')].some(b=>b.textContent==='starter'));
    const click=async label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label);await act(async()=>button.click());await settle();};
    await click('Next');
    assert.match(document.body.textContent,/Visible question 21(?!\d)/);
    assert.match(document.body.textContent,/Practice Questions/);
    assert.match(document.body.textContent,/21–40 of 200/);
    for(let page=2;page<=8;page++) await click('Next');
    assert.match(document.body.textContent,/161–180 of 200/);
    assert.match(document.body.textContent,/Visible question 200/);
    assert.match(document.body.textContent,/Visible question 101/);
    assert.ok(document.body.textContent.indexOf('Visible question 200')<document.body.textContent.indexOf('Visible question 101'));
    assert.match(document.body.textContent,/Starter Questions/);
    await click('attempted');
    assert.match(document.body.textContent,/Visible question 151/);
    assert.match(document.body.textContent,/1–20 of 50/);
    await click('starter');
    assert.match(document.body.textContent,/1–20 of 30/);
    assert.match(document.body.textContent,/Visible question 101/);
    assert.doesNotMatch(document.body.textContent,/Visible question 151/);
    assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='starter').getAttribute('aria-pressed'),'true');
    await click('Next');
    assert.match(document.body.textContent,/21–30 of 30/);
    assert.match(document.body.textContent,/Visible question 130/);
    await click('all');
    assert.match(document.body.textContent,/1–20 of 200/);
    assert.equal(calls.filter(path=>path.includes('indexOnly=1')).length,1);
    await click('starter');
    await act(async()=>{
      window.history.pushState(null,'','/student/question-bank/exam/gate/subject/1/chapter/2');
      window.dispatchEvent(new window.PopStateEvent('popstate'));
    });
    await settle();
    assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='starter'));
    assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='all').getAttribute('aria-pressed'),'true');
    assert.match(document.body.textContent,/1–20 of 170/);
    for(const path of calls.filter(path=>!path.endsWith('/structure')&&!path.includes('indexOnly=1'))) {
      const params=new URL(path,'https://api.example.test').searchParams;
      assert.ok((params.get('questionIds')||params.get('questionId')).split(',').length<=20);
    }
  } finally {if(unmount)await act(async()=>unmount());dom.window.close();delete globalThis.__qbTestApi;}
});
