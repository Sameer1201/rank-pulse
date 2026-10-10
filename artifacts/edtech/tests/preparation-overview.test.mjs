import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';

test('student Dashboard renders all four sources without per-test analysis or full-bank fetches',async()=>{
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://app.example.test/student'});
  for(const key of ['window','document','location','history','HTMLElement','Element','SVGElement','Node','MutationObserver','Event','CustomEvent','getComputedStyle','localStorage'])globalThis[key]=dom.window[key];
  for(const key of ['addEventListener','removeEventListener','dispatchEvent'])globalThis[key]=dom.window[key].bind(dom.window);
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;
  globalThis.ResizeObserver=class{constructor(fn){this.fn=fn;}observe(){this.fn([{contentRect:{width:900,height:300}}]);}unobserve(){}disconnect(){}};
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:900,height:300,top:0,left:0,bottom:300,right:900,x:0,y:0});
  const now=Date.now(),day=new Date(now+330*60000).toISOString().slice(0,10);
  const sources=[['tests','Tests',2],['question-bank','Question Bank',5],['pyq','PYQ',7],['psu','PSU tests',9]].map(([key,label,n])=>({key,label,questions:n,correct:n-1,wrong:1,seconds:60*n,completed:key==='tests'||key==='psu'?1:0,accuracy:Math.round((n-1)/n*100),ungraded:0}));
  let partial=false, psuMode='test', hasTests=true;const requests=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=async path=>{
    const url=new URL(path,'https://app.example.test');requests.push(url.pathname);
    if(url.pathname==='/api/student/dashboard/overview')return Response.json({generatedAt:new Date(now).toISOString(),scope:'All your exams',partial,unavailableSources:partial?['psu']:[],totals:{questions:23,correct:19,wrong:4,accuracy:83,seconds:1380,completed:hasTests?2:0,ungraded:0},sources:sources.map(s=>s.key==='psu'?{...s,questions:psuMode==='question'?1:psuMode==='none'||psuMode==='empty-test'?0:s.questions,completed:psuMode==='test'||psuMode==='empty-test'?1:0}:s),
      testAttempts:hasTests?[{id:'tests:1',source:'tests',title:'Chemistry Mock',at:now,score:8,totalPoints:10,percentage:80,path:'/student/tests/1/analysis'}]:[],
      subjects:[{subject:'Chemistry',questions:7,correct:6,wrong:1,accuracy:86,sources:['pyq'],ungraded:0}],weakAreas:Array.from({length:6},(_,i)=>({subject:'Chemistry',topic:i===0?'Atomic structure':`Focus topic ${i+1}`,questions:7,correct:6,wrong:1,accuracy:86,path:'/student/pyq',source:'pyq'})),
      recent:sources.map(s=>({source:s.key,title:s.label+' practice',subject:'Chemistry',questions:s.questions,correct:s.correct,wrong:s.wrong,path:'/student/pyq',at:now})),history:[{date:day,correct:19,wrong:4,accuracy:83,seconds:1380,available:true}],streak:1,trackingStartedAt:now,notes:['Latest results, with test-to-QBank mirrors counted once.']});
    if(url.pathname==='/api/student/activity/today')return Response.json({date:day,attemptedToday:12});
    if(url.pathname==='/api/student/activity/week')return Response.json({start:day,end:day,today:day,currentWeek:day,firstAvailableWeek:day,lastAvailableWeek:day,trackingStartedAt:new Date(now).toISOString(),days:[{date:day,available:true,partial:true,correct:19,wrong:4,unanswered:2,seconds:1380,ungraded:0}]});
    throw new Error('Unexpected legacy/dashboard request: '+path);
  };
  const mocks={
    '@/contexts/AuthContext':'const user={id:2,status:"active",role:"student",onboardingComplete:true,fullName:"Student",subject:"GATE",profileDetails:{dashboard:{dailyQuestionGoal:50}}};export const useAuth=()=>({user,login:()=>{}});',
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/components/ui/PremiumWhiteLoader':'export const PremiumWhiteLoader=()=>null;',
    '@/lib/api-origin':'export const buildApiUrl=path=>path;',
  };
  const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import Dashboard from './src/pages/student/Dashboard';
    export const act=React.act;export function mount(node){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});const root=createRoot(node);root.render(<QueryClientProvider client={client}><Dashboard/></QueryClientProvider>);const dispose=()=>{root.unmount();client.clear();};dispose.refresh=()=>client.refetchQueries({type:'active'});return dispose;}`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,
    define:{'import.meta.env':'{}'},plugins:[{name:'mocks',setup(builder){builder.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:new URL('..',import.meta.url).pathname}));}}]});
  const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const{act,mount}=module.exports;let unmount;const settle=async()=>{for(let i=0;i<10;i++)await act(async()=>{await new Promise(r=>setTimeout(r,15));});};
  try{
    await act(async()=>{unmount=mount(document.getElementById('root'));});await settle();
    assert.match(document.body.textContent,/Your preparation dashboard/);assert.match(document.body.textContent,/23/);assert.match(document.body.textContent,/83%/);assert.match(document.body.textContent,/23m/);
    for(const text of ['Latest saved results · duplicates removed','Recorded practice + submitted test time','Regular tests + PSU tests, including retakes','Your latest test results','All Question Bank subjects','GATE + JAM Chemistry'])assert.equal(document.body.textContent.includes(text),false,`removed dashboard helper: ${text}`);
    for(const text of ['All your exams · Tests, Question Bank, PYQ and PSU in one place','submitted test attempts · regular + PSU tests · retakes included','Attempt order (oldest to newest)','Weighted by graded questions across every source','Weak areas from Tests, Q Bank, PYQ and PSU','Submitted PSU test results','Your most recently active topics and test results','Review mistakes, then retry this topic','Early signal — practise more to confirm','Daily progress across your PYQ','Exact daily dots · Smooth curve','Daily graded answers across all sources','Daily history and streak start','How your combined dashboard is counted','syncs within 1 min'])assert.equal(document.body.textContent.includes(text),false,`removed descriptive dashboard copy: ${text}`);
    assert.match(document.body.textContent,/19 correct · 4 wrong/,'actual accuracy counts remain visible');
    for(const source of sources)assert.match(document.querySelector('[aria-label="Progress by source"]').textContent,new RegExp(source.label));
    assert.match(document.body.textContent,/Atomic structure/);assert.match(document.body.textContent,/Weekly practice activity/);
    const combinedTrend=document.querySelector('[aria-label="Combined accuracy trend"]');
    assert.ok(combinedTrend,'dashboard uses the bounded combined accuracy chart');
    assert.equal(combinedTrend.querySelectorAll('.recharts-line-dot').length,1,'a single saved day renders only one accuracy point');
    const focusRegion=document.querySelector('[role="region"][aria-labelledby="focus-next-title"]');
    assert.ok(focusRegion);
    assert.equal(focusRegion.style.maxHeight,'240px');
    assert.ok(focusRegion.classList.contains('overflow-y-auto'));
    assert.equal(focusRegion.tabIndex,0,'keyboard users can scroll the focus list');
    assert.equal(focusRegion.querySelectorAll('button').length,6,'all focus areas remain available');
    assert.equal(focusRegion.contains(document.getElementById('focus-next-title')),false,'heading stays outside scrolling content');
    await act(async()=>focusRegion.querySelector('button').click());
    assert.equal(window.location.pathname,'/student/pyq');
    assert.equal(document.querySelector('[aria-label="Daily activity line chart"]').querySelectorAll('.recharts-line').length,1,'weekly activity defaults to total only');
    assert.ok(document.querySelectorAll('.recharts-line').length>=3);
    assert.ok(document.querySelector('[aria-label="Test performance graph"]'));
    assert.match(document.querySelector('[aria-label="Test performance graph"]').textContent,/Chemistry Mock/);
    assert.deepEqual(new Set(requests),new Set(['/api/student/dashboard/overview','/api/student/activity/today','/api/student/activity/week']));
    const refresh=async()=>{await act(async()=>unmount.refresh());await settle();};
    partial=true;await refresh();
    assert.match(document.querySelector('[role=alert]').textContent,/Totals below are partial/);
    assert.match(document.querySelector('[aria-label="Progress by source"]').textContent,/Source sync incomplete/);
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Open PSU tests').click());
    assert.equal(window.location.pathname,'/student/psu');
    partial=false;hasTests=false;psuMode='none';await refresh();
    assert.equal(document.querySelector('[aria-label="Test performance graph"]'),null,'no submitted tests means no test graph');
    assert.doesNotMatch(document.querySelector('[aria-label="Progress by source"]').textContent,/PSU tests/,'time alone does not count as an attempt');
    psuMode='question';await refresh();
    assert.match(document.querySelector('[aria-label="Progress by source"]').textContent,/PSU tests/,'recorded PSU questions also qualify');
    psuMode='empty-test';await refresh();
    assert.match(document.querySelector('[aria-label="Progress by source"]').textContent,/PSU tests/);
  }finally{if(unmount)await act(async()=>unmount());globalThis.fetch=originalFetch;dom.window.close();}
});
