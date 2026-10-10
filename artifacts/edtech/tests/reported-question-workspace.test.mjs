import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';

test('report editor displays the complete cross-chapter queue, dedupes, navigates and removes resolved questions', async () => {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://app.example.test/admin/question-bank/exam/gate/subject/1/chapter/1?questionId=1'});
  for(const key of ['window','document','location','history','HTMLElement','HTMLImageElement','Element','SVGElement','Node','DOMParser','MutationObserver','localStorage','CustomEvent','Event','getComputedStyle']) globalThis[key]=dom.window[key];
  for(const key of ['addEventListener','removeEventListener','dispatchEvent']) globalThis[key]=dom.window[key].bind(dom.window);
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
  globalThis.cancelAnimationFrame=clearTimeout;
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const calls=[];
  const first={id:1,questionId:1,questionText:'Reported first question',examKey:'gate',subjectId:1,chapterId:1,subjectTitle:'Physics',chapterTitle:'First chapter',reporterName:'Student',status:'open',reason:'Fix answer'};
  const second={...first,id:3,questionId:201,chapterId:2,chapterTitle:'Other chapter',questionText:'Reported other chapter question'};
  let reports=[first,{...first,id:2,reason:'Second report'},second];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (path,init={})=>{
    const url=new URL(path,'https://app.example.test'); calls.push({path:url.pathname,params:url.searchParams,method:init.method||'GET'});
    if(init.method==='PATCH') {const id=Number(url.pathname.split('/').at(-1));reports=reports.filter(r=>r.questionId!==id);return Response.json({ok:true});}
    if(url.pathname.endsWith('/reports')) {
      assert.equal(url.searchParams.get('status'),'open');
      const rest=url.searchParams.has('cursor');
      return Response.json({reports:rest?reports.filter(r=>r.questionId===201):reports.filter(r=>r.questionId!==201),nextCursor:rest?null:'1000:3'});
    }
    if(url.pathname.endsWith('/exams')) return Response.json([{key:'gate',label:'GATE',subjectCount:1,chapterCount:2,questionCount:201}]);
    if(url.pathname.endsWith('/structure')) return Response.json({exam:{key:'gate',label:'GATE'},subjects:[{id:1,title:'Physics',chapters:[{id:1,title:'First chapter',questionCount:200,targetQuestions:200},{id:2,title:'Other chapter',questionCount:1,targetQuestions:1}]}]});
    if(url.pathname.endsWith('/image')) return Response.json({imageData:null,optionImages:[]});
    if(url.pathname.endsWith('/questions')) {
      const id=Number(url.searchParams.get('questionId')); assert.ok([1,201].includes(id),'Only selected reported content may load');
      const chapter=Number(url.pathname.split('/').at(-2)); assert.equal(chapter,id===1?1:2);
      return Response.json({questions:[{id,question:id===1?first.questionText:second.questionText,questionType:'mcq',options:['Option one','Option two','Option three','Option four'],correctAnswer:0,correctAnswerMulti:[],points:1,difficulty:'medium',reports:reports.filter(r=>r.questionId===id),openReportCount:1,explanation:'Explanation'}]});
    }
    throw new Error('Unexpected request '+url.pathname);
  };
  const mocks={
    '@/contexts/AuthContext':'const user={id:1,status:"active",role:"super_admin",fullName:"Admin"}; export const useAuth=()=>({user});',
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/components/ui/PremiumWhiteLoader':'export const PremiumWhiteLoader=()=>null;',
    '@/lib/api-origin':'export const buildApiUrl=path=>path;',
    '@/components/ui/rich-question-content':'export const RichQuestionContent=({content,...props})=><div {...props}>{content}</div>;',
    '@/lib/admin-exam-selection':'export const persistAdminExam=()=>{};export const readAdminExamQuery=()=>"";export const readAdminExamSelection=()=>"gate";',
  };
  const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Route} from 'wouter';
    import Page from './src/pages/admin/QuestionBank';export const act=React.act;
    export function mount(node){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});const root=createRoot(node);
    root.render(<QueryClientProvider client={client}><Route path="/admin/question-bank/exam/:examKey/subject/:subjectId/chapter/:chapterId"><Page/></Route></QueryClientProvider>);
    return ()=>{root.unmount();client.clear();};}`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},
    bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,
    plugins:[{name:'boundaries',setup(builder){
      builder.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
      builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:new URL('..',import.meta.url).pathname}));
    }}]});
  const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const {act,mount}=module.exports;let unmount;
  const settle=async()=>{for(let i=0;i<12;i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});};
  const click=async text=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(button,text);await act(async()=>button.click());await settle();};
  try {
    await act(async()=>{unmount=mount(document.getElementById('root'));});await settle();
    assert.match(document.body.textContent,/Reported questions \(2\)/);
    assert.equal(document.querySelectorAll('aside article').length,2);
    assert.match(document.querySelector('aside').textContent,/Second report/);
    await click('All Reported');
    assert.equal(document.querySelectorAll('section[aria-label="All reported questions"]').length,2);
    await click('Open & edit');
    assert.match(location.href,/chapter\/2\?questionId=201/);
    assert.equal(document.querySelector('[role="textbox"][aria-label="Question"]').textContent,second.questionText);
    const save=[...document.querySelectorAll('button')].find(b=>/Save Changes|Update Question|Save Question/.test(b.textContent));
    assert.ok(save,'save button'); await act(async()=>save.click());await settle();
    assert.doesNotMatch(document.querySelector('aside').textContent,/Reported other chapter question/);
    assert.match(location.href,/chapter\/1\?questionId=1/);
    const lastSave=[...document.querySelectorAll('button')].find(b=>/Save Changes|Update Question|Save Question/.test(b.textContent));
    assert.ok(lastSave); await act(async()=>lastSave.click());await settle();
    assert.match(document.body.textContent,/Report queue clear/);
    assert.equal(document.querySelectorAll('aside article').length,0);
    assert.ok(calls.filter(c=>c.path.endsWith('/questions')).every(c=>c.params.has('questionId')));
  } finally {if(unmount)await act(async()=>unmount());globalThis.fetch=originalFetch;dom.window.close();}
});
