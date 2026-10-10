import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';

function verifyDailyCurve(line) {
  const endpoints=[];let previous;
  const path=line.querySelector('.recharts-line-curve').getAttribute('d');
  for(const command of path.match(/[MLC][^MLC]*/g) ?? []) {
    const numbers=command.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
    const end=numbers.slice(-2);
    if(command[0]==='C') {
      const [x1,y1,x2,y2,x3,y3]=numbers,[x0,y0]=previous;
      assert.ok(x1>=x0-0.002 && x2>=x1-0.002 && x3>=x2-0.002,'curve never doubles back across days');
      for(let step=0;step<=100;step++) {
        const t=step/100,u=1-t;
        const y=u**3*y0+3*u*u*t*y1+3*u*t*t*y2+t**3*y3;
        assert.ok(y>=Math.min(y0,y3)-0.002 && y<=Math.max(y0,y3)+0.002,'smooth curve cannot invent peaks or negative dips between totals');
      }
    }
    endpoints.push(end);previous=end;
  }
  const dots=[...line.querySelectorAll('.recharts-line-dot')].map(dot=>[Number(dot.getAttribute('cx')),Number(dot.getAttribute('cy'))]);
  assert.ok(endpoints.length>=dots.length,'curve includes daily points and chart-only estimates');
  dots.forEach(dot=>assert.ok(endpoints.some(point=>point.every((value,axis)=>Math.abs(value-dot[axis])<=0.002)),'curve passes through each exact daily point'));
}

test('weekly chart renders five smooth lines with exact daily dots, toggles metrics and bounds historical weeks', async () => {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://app.example.test'});
  for(const key of ['window','document','HTMLElement','Element','SVGElement','Node','MutationObserver','Event','getComputedStyle']) globalThis[key]=dom.window[key];
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,0); globalThis.cancelAnimationFrame=clearTimeout;
  globalThis.ResizeObserver=class { constructor(fn){this.fn=fn;} observe(){this.fn([{contentRect:{width:900,height:300}}]);} unobserve(){} disconnect(){} };
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:900,height:300,top:0,left:0,bottom:300,right:900,x:0,y:0});
  const requests=[]; let fail=false; let populatedHistory=false;
  const now=new Date(Date.now()+330*60000); const today=now.toISOString().slice(0,10);
  const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const start=shift(today,-6);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async path=>{
    const week=new URL(path,'https://app.example.test').searchParams.get('start'); requests.push(week);
    if(fail) return Response.json({error:'offline'},{status:503});
    return Response.json({start:week,end:shift(week,6),today,currentWeek:start,firstAvailableWeek:shift(start,-14),lastAvailableWeek:start,trackingStartedAt:today+'T01:00:00Z',days:Array.from({length:7},(_,i)=>{
      const date=shift(week,i);
      if(populatedHistory && week===shift(start,-14)) {
        const correct=[2,8,3,null,5,1,null][i];
        return {date,available:correct!==null,partial:false,correct,wrong:correct,unanswered:correct,seconds:correct===null?null:correct*60,ungraded:0};
      }
      const available=date===today;
      return {date,available,partial:date===today,correct:available?7:null,wrong:available?2:null,unanswered:available?3:null,seconds:available?125:null,ungraded:available?1:null};
    })});
  };
  const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import Chart from './src/components/student/WeeklyActivityChart';
    export const act=React.act;export function mount(node){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});const root=createRoot(node);
    root.render(<QueryClientProvider client={client}><Chart studentId={2}/></QueryClientProvider>);return ()=>{root.unmount();client.clear();};}`,
    resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,
    plugins:[{name:'chart-api',setup(builder){builder.onResolve({filter:/^@\/lib\/api$/},()=>({path:'api',namespace:'mock'}));builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const api={get:async path=>{const response=await fetch(path);const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}};'}));}}]});
  const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const {act,mount}=module.exports;let unmount;
  const settle=async()=>{for(let i=0;i<8;i++)await act(async()=>{await new Promise(r=>setTimeout(r,15));});};
  const click=async node=>{assert.ok(node);await act(async()=>node.click());await settle();};
  try {
    await act(async()=>{unmount=mount(document.getElementById('root'));});await settle();
    assert.equal(requests[0],shift(today,-6),'initial range starts six days before today, not on Monday');
    assert.equal(document.querySelectorAll('input[type=checkbox]:checked').length,1);
    assert.equal(document.querySelector('input[type=checkbox]:checked').getAttribute('aria-label'),'Total answered','only total is selected by default');
    assert.equal(document.querySelectorAll('.recharts-line').length,1,'initial chart shows only total');
    const inputs = [...document.querySelectorAll('input[type=checkbox]')];
    const colors = ['rgb(16, 185, 129)', 'rgb(244, 63, 94)', 'rgb(234, 160, 8)', 'rgb(139, 92, 246)', 'rgb(59, 130, 246)'];
    inputs.forEach((input, index) => {
      assert.ok(input.getAttribute('aria-label'));
      const box = input.nextElementSibling;
      assert.equal(box.style.backgroundColor, index===4?colors[index]:'transparent');
      assert.equal(box.style.borderColor, colors[index]);
      assert.ok(box.classList.contains('h-4') && box.classList.contains('w-4'), 'compact 16px checkbox');
      assert.ok(box.classList.contains('rounded-[4px]'), 'small clear rounded-square outline');
      assert.equal(!!box.querySelector('svg'),index===4,'only the checked total has a tick');
      assert.ok(box.className.includes('peer-focus-visible:ring-2'), 'keyboard focus remains visible');
      const label=input.closest('label');
      assert.equal(label.hasAttribute('title'),false,'instant tooltip replaces the delayed native title');
      assert.equal(label.getAttribute('data-state'),'closed','each metric has an accessible tooltip trigger');
      assert.equal(label.querySelectorAll('svg').length,index===4?2:1,'metric icon remains visible even when unchecked');
      assert.ok(!label.textContent.includes(input.getAttribute('aria-label')),'metric text is replaced by an icon');
    });
    assert.equal(inputs[4].closest('label').textContent,'10','total includes correct + wrong + ungraded, not visited-only');
    for(const input of inputs.slice(0,4))await click(input.closest('label'));
    assert.equal(document.querySelectorAll('.recharts-line').length,5);
    assert.equal([...document.querySelectorAll('button')].some(b=>['Exact','Smooth'].includes(b.textContent)),false,'line mode buttons are removed');
    assert.doesNotMatch(document.body.textContent,/Daily progress across|Exact daily dots|Practice questions count once|Total answered =|Intermediate 6-hour points/,'descriptive paragraphs are removed');
    assert.doesNotMatch(document.querySelector('[aria-live="polite"]').textContent,/\d{4}/,'week range has no year');
    assert.ok(document.querySelector('[aria-label="Daily activity line chart"]').classList.contains('sm:h-[200px]'));
    assert.match(document.body.textContent,/2m 5s/);
    assert.match(document.body.textContent,/Partial history/);
    assert.match(document.body.textContent,/1 ungraded answers/);
    assert.equal(document.querySelector('[aria-label="Next 7 days"]').disabled,true);
    await click(document.querySelectorAll('input')[3]);
    assert.equal(inputs[3].nextElementSibling.style.backgroundColor, 'transparent');
    assert.equal(inputs[3].nextElementSibling.querySelector('svg'), null);
    assert.equal(document.querySelectorAll('.recharts-line').length,4);
    await click(inputs[3].closest('label'));
    assert.equal(inputs[3].checked, true, 'clicking the label re-enables the metric');
    assert.equal(document.querySelectorAll('.recharts-line').length,5);
    for(const input of [...document.querySelectorAll('input:checked')]) await click(input);
    assert.match(document.body.textContent,/Select at least one parameter/);
    assert.equal(document.querySelectorAll('.recharts-line').length,0);
    await click(document.querySelectorAll('input')[0]);
    await click(document.querySelector('[aria-label="Previous 7 days"]'));
    assert.equal(requests.at(-1),shift(start,-7));
    assert.match(document.body.textContent,/Daily history unavailable for this range/);
    assert.equal(document.querySelector('[aria-label="Next 7 days"]').disabled,false);
    await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Last 7 days'));
    assert.equal(document.querySelectorAll('.recharts-line').length,1);
    populatedHistory=true;
    for(const input of [...document.querySelectorAll('input:not(:checked)')]) await click(input);
    await click(document.querySelector('[aria-label="Previous 7 days"]'));
    await click(document.querySelector('[aria-label="Previous 7 days"]'));
    const dailyDots=()=>[...document.querySelectorAll('.recharts-line-dot')].map(dot=>[dot.getAttribute('cx'),dot.getAttribute('cy')]);
    assert.equal(document.querySelector('[aria-label="Previous 7 days"]').disabled,true,'cannot go before the first recorded range');
    const curves=[...document.querySelectorAll('.recharts-line-curve')];
    assert.equal(curves.length,5);
    curves.forEach(curve=>{
      const path=curve.getAttribute('d');
      assert.match(path,/C/, 'smooth cubic interpolation, not straight line segments');
      assert.equal((path.match(/M/g)||[]).length,2,'missing day remains a gap between two segments');
      assert.equal(curve.getAttribute('stroke-linecap'),'round');
      assert.equal(curve.getAttribute('stroke-linejoin'),'round');
    });
    document.querySelectorAll('.recharts-line').forEach(line=>{
      const dots=[...line.querySelectorAll('.recharts-line-dot')];
      assert.equal(dots.length,5,'only actual daily data points have dots');
      assert.ok(dots.every(dot=>dot.getAttribute('r')==='2'),'smaller daily dots');
      verifyDailyCurve(line);
    });
    assert.match(document.body.textContent,/19m 0s/,'daily values and totals are unchanged');
    assert.equal(dailyDots().length,25,'estimated 6-hour values are not drawn as recorded dots');
    await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Last 7 days'));
    fail=true;
    await click(document.querySelector('[aria-label="Previous 7 days"]'));
    assert.match(document.querySelector('[role=alert]').textContent,/progress has not been reset/);
    fail=false;
    await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Retry'));
    assert.equal(document.querySelector('[role=alert]'),null);
  } finally {if(unmount)await act(async()=>unmount());globalThis.fetch=originalFetch;dom.window.close();}
});
