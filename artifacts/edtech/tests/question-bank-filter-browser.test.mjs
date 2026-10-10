import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('chapter filters carry into practice navigation, submission, reload and Back on GATE/JAM desktop/mobile', {timeout:120000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-filter-'));
 const mocks={
  '@/contexts/AuthContext':'const user=JSON.parse(localStorage.getItem("educonnect_user"));export const useAuth=()=>({user});',
  '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
  '@/lib/api':`const request=async(path,body)=>{const response=await fetch('/api'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json();};export const api={get:path=>request(path),post:(path,body)=>request(path,body)};`,
  '@/components/student/AiHint':'export const AiHint=()=>null;',
  '@/components/student/AiSimilarPractice':'export default ()=>null;export const AiPracticeLibrary=()=>null;',
  '@/components/student/PerformanceInsightButton':'export const PerformanceInsightButton=()=>null;',
  '@/components/student/PendingVerificationDialog':'export default ()=>null;',
  '@/components/student/OfflinePractice':'export const OfflinePackLoader=props=>{window.__bufferIds=props.questionIds;return null;};export const useBufferedPractice=()=>({attempts:[],offline:false});',
  '@/lib/offline-qbank':'export const loadOfflineQBank=async()=>[];',
 };
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Route}from'wouter';import{TooltipProvider}from'./src/components/ui/tooltip';import Chapter from './src/pages/student/question-bank/ChapterPage';import Question from './src/pages/student/question-bank/QuestionPage';
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider><Route path="/student/question-bank/exam/:examId/subject/:subjectId/chapter/:chapterId"><Chapter/></Route><Route path="/student/question-bank/exam/:examId/subject/:subjectId/chapter/:chapterId/question/:questionId"><Question/></Route></TooltipProvider></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const app=await readFile(path.join(directory,'app.js')),css=await readFile(path.join(directory,'app.css'));
 const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
 const siteCss=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
 let questions;
 const reset=()=>{questions=Array.from({length:6},(_,i)=>({id:i+1,difficulty:i>=4?'starter':'medium',points:1,question:'Filter question '+(i+1),questionType:'mcq',options:['Correct option','Wrong option'],correctAnswer:0,correctAnswerMulti:[],explanation:'Solution '+(i+1),hasImage:false,progress:i%2===0?{attemptCount:1,lastIsCorrect:i===0,correctCount:i===0?1:0,incorrectCount:i===0?0:1}:null}));};reset();
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://test'),p=url.pathname;
  const send=(type,value)=>{res.setHeader('Content-Type',type);res.end(value);};const json=value=>send('application/json',JSON.stringify(value));
  if(p==='/app.js')return send('application/javascript',app);
  if(p==='/app.css')return send('text/css',css);
  if(p==='/site.css')return send('text/css',siteCss);
  if(p.endsWith('/structure')){const key=p.split('/').at(-2);return json({exam:{key,label:key==='gate'?'GATE':'JAM Chemistry'},subjects:[{id:1,title:'Physics',chapters:[{id:1,title:'Chapter',questionCount:6,attemptedCount:questions.filter(q=>q.progress).length}]}]});}
  if(p==='/api/question-bank/chapters/1/questions'){
   if(url.searchParams.get('indexOnly')==='1')return json({questions:questions.map(({id,difficulty,progress})=>({id,difficulty,progress}))});
   const ids=(url.searchParams.get('questionIds')??url.searchParams.get('questionId')??'').split(',').map(Number);
   return json({questions:questions.filter(q=>ids.includes(q.id))});
  }
  if(p.endsWith('/image'))return json({imageData:null,optionImages:[]});
  if(req.method==='POST'){
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
   if(p.endsWith('/attempt')){const id=Number(p.match(/questions\/(\d+)\/attempt$/)[1]);const q=questions.find(q=>q.id===id);q.progress={attemptCount:1,lastIsCorrect:true,correctCount:1,incorrectCount:0};return json({isCorrect:true,progress:q.progress});}
   return json({timeSpentSeconds:body.timeSpentSeconds??0});
  }
  if(p.startsWith('/api/'))return json({});
  return send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  for(const exam of ['gate','jam'])for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   reset();console.log('Checking filtered practice',exam,viewport.width);
   const context=await browser.newContext({viewport});
   await context.addInitScript(()=>localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:'GATE EC'})));
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const chapter=`/student/question-bank/exam/${exam}/subject/1/chapter/1`;
   const shown=id=>page.getByText('Filter question '+id,{exact:true});
   const dots=()=>page.getByRole('button',{name:/^Open question /});
   const next=()=>page.getByRole('button',{name:'Next question',exact:true}).last();
   const previous=()=>page.getByRole('button',{name:'Previous question',exact:true}).last();
   await page.goto(origin+chapter);await shown(1).waitFor();
   await page.getByRole('button',{name:'unattempted',exact:true}).click();await shown(2).waitFor();
   assert.equal(await shown(1).count(),0);
   await page.getByRole('button',{name:'Start Practising',exact:true}).click();await shown(2).waitFor();
   assert.equal(new URL(page.url()).searchParams.get('filter'),'unattempted');
   assert.equal(await dots().count(),3);
   assert.deepEqual(await page.evaluate(()=>[...window.__bufferIds].sort((a,b)=>a-b)),[2,4,6]);
   await page.getByRole('link',{name:'Back',exact:true}).click();await shown(2).waitFor();
   assert.equal(await page.getByRole('button',{name:'unattempted',exact:true}).getAttribute('aria-pressed'),'true');
   await shown(2).click();await next().waitFor();
   await next().click();await shown(4).waitFor();
   await previous().click();await shown(2).waitFor();
   await page.getByRole('button',{name:'Open question 3',exact:true}).click();await shown(6).waitFor();
   await previous().click();await shown(4).waitFor();
   await page.getByRole('button',{name:/Correct option/}).click();await page.getByRole('button',{name:'Submit Answer',exact:true}).click();
   await page.getByText('Solution 4',{exact:true}).waitFor();
   assert.equal(await shown(4).count(),1,'submitted current question stays visible for its result');
   await page.getByRole('button',{name:'Next Question',exact:true}).click();await shown(6).waitFor();
   assert.equal(await dots().count(),2);
   await previous().click();await shown(2).waitFor();
   await next().click();await shown(6).waitFor();
   await page.reload();await shown(6).waitFor();assert.equal(await dots().count(),2);
   await page.screenshot({path:path.join(directory,`${exam}-${viewport.width}.png`),fullPage:true});
   await page.getByRole('link',{name:'Back',exact:true}).click();await shown(2).waitFor();
   assert.equal(await shown(4).count(),0);
   assert.equal(await page.getByRole('button',{name:'unattempted',exact:true}).getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'attempted',exact:true}).click();await shown(1).waitFor();await shown(1).click();
   await next().waitFor();assert.equal(await dots().count(),4);
   await next().click();await shown(3).waitFor();
   assert.equal(new URL(page.url()).searchParams.get('filter'),'attempted');
   await page.getByRole('link',{name:'Back',exact:true}).click();await shown(1).waitFor();
   await page.getByRole('button',{name:'starter',exact:true}).click();await shown(5).waitFor();await shown(5).click();
   await next().waitFor();assert.equal(await dots().count(),2);
   await next().click();await shown(6).waitFor();
   assert.equal(new URL(page.url()).searchParams.get('filter'),'starter');
   await page.getByRole('link',{name:'Back',exact:true}).click();await shown(5).waitFor();
   await page.getByRole('button',{name:'all',exact:true}).click();await shown(1).waitFor();await shown(1).click();
   await next().waitFor();assert.equal(await dots().count(),6);
   assert.equal(new URL(page.url()).searchParams.get('filter'),null);
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Filtered practice screenshots:',directory);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
