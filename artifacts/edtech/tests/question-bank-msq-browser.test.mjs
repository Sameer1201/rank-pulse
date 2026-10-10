import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('real QuestionPage MSQ selection, keyboard, submission and restoration on GATE/JAM desktop/mobile', {timeout:120000}, async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-msq-'));
 const mocks={
  '@/contexts/AuthContext':'const user=JSON.parse(localStorage.getItem("educonnect_user"));export const useAuth=()=>({user});',
  '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
  '@/lib/api':`const request=async(path,body)=>{const response=await fetch('/api'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json();};export const api={get:path=>request(path),post:(path,body)=>request(path,body)};`,
  '@/components/student/AiHint':'export const AiHint=()=>null;',
  '@/components/student/AiSimilarPractice':'export default ()=>null;export const AiPracticeLibrary=()=>null;',
  '@/components/student/PerformanceInsightButton':'export const PerformanceInsightButton=()=>null;',
  '@/components/student/PendingVerificationDialog':'export default ()=>null;',
  '@/components/student/OfflinePractice':'export const OfflinePackLoader=()=>null;export const useBufferedPractice=()=>({attempts:[],offline:false});',
  '@/lib/offline-qbank':'export const loadOfflineQBank=async()=>[];',
 };
 await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Route}from'wouter';import{TooltipProvider}from'./src/components/ui/tooltip';import Question from'./src/pages/student/question-bank/QuestionPage';
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider><Route path="/student/question-bank/exam/:examId/subject/:subjectId/chapter/:chapterId/question/:questionId"><Question/></Route></TooltipProvider></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const app=await readFile(path.join(directory,'app.js')),css=await readFile(path.join(directory,'app.css'));
 const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
 const siteCss=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
 const stem='Select the CORRECT statement(s) regarding semiconductor devices:';
 const options=['The frequency of Auger recombination increases with carrier concentration.','All compound type of semiconductors are direct band gap semiconductor.','Photons carry very little momentum; photon-assisted transitions are essentially vertical.','At steady state, generation rate is equal to recombination rate.'];
 let questions,posts;
 const reset=(type='multi')=>{posts=[];questions=[
  {id:1,question:stem,questionType:type,options,correctAnswer:0,correctAnswerMulti:[0,2,3],explanation:'MSQ solution'},
  {id:2,question:'Single correct question',questionType:'mcq',options:['Single A','Single B'],correctAnswer:1,correctAnswerMulti:[]},
  {id:3,question:'Numeric question',questionType:'integer',options:['','','',''],correctAnswer:42,correctAnswerMulti:[]},
 ].map(q=>({...q,difficulty:'medium',points:2,hasImage:false,progress:null}));};reset();
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://test'),p=url.pathname;
  const send=(type,value)=>{res.setHeader('Content-Type',type);res.end(value);};const json=value=>send('application/json',JSON.stringify(value));
  if(p==='/app.js')return send('application/javascript',app);
  if(p==='/app.css')return send('text/css',css);
  if(p==='/site.css')return send('text/css',siteCss);
  if(p.endsWith('/structure'))return json({exam:{key:p.split('/').at(-2),label:'Practice'},subjects:[{id:1,title:'EDC',chapters:[{id:1,title:'Basics of SC Physics',questionCount:3,attemptedCount:0}]}]});
  if(p==='/api/question-bank/chapters/1/questions'){
   if(url.searchParams.get('indexOnly')==='1')return json({questions:questions.map(({id,difficulty,progress})=>({id,difficulty,progress}))});
   const ids=(url.searchParams.get('questionIds')??url.searchParams.get('questionId')??'').split(',').map(Number);
   return json({questions:questions.filter(q=>ids.includes(q.id))});
  }
  if(p.endsWith('/image'))return json({imageData:null,optionImages:[]});
  if(req.method==='POST'){
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
   if(p.endsWith('/attempt')){
    posts.push(body);const q=questions.find(q=>q.id===Number(p.match(/questions\/(\d+)\/attempt$/)[1]));
    const isCorrect=Array.isArray(body.answer)?JSON.stringify([...body.answer].sort())==='[0,2,3]':body.answer===q.correctAnswer;
    q.progress={attemptCount:1,lastAnswer:body.answer,lastIsCorrect:isCorrect,correctCount:isCorrect?1:0,incorrectCount:isCorrect?0:1};
    return json({isCorrect,progress:q.progress});
   }
   return json({timeSpentSeconds:body.timeSpentSeconds??0});
  }
  if(p.startsWith('/api/'))return json({});
  return send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const open=async(exam,viewport,dark=false)=>{
  const context=await browser.newContext({viewport});
  await context.addInitScript(({dark})=>{localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:'GATE EC'}));if(dark)document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('dark'));},{dark});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/student/question-bank/exam/${exam}/subject/1/chapter/1/question/1`);
  await page.getByText(stem,{exact:true}).waitFor();await page.getByText('MSQ · Select all correct options',{exact:true}).waitFor();
  return {context,page,errors};
 };
 try{
  for(const exam of ['gate','jam'])for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   reset();const {context,page,errors}=await open(exam,viewport,viewport.width===390);
   const option=letter=>page.getByRole('checkbox',{name:'Option '+letter,exact:true});
   const submit=page.getByRole('button',{name:'Submit Answer',exact:true});
   assert.equal(await page.getByRole('checkbox').count(),4);assert.equal(await submit.isDisabled(),true);
   for(const letter of ['A','C','D'])await option(letter).click();
   for(const letter of ['A','C','D'])assert.equal(await option(letter).isChecked(),true);
   assert.equal(await option('B').isChecked(),false);await page.getByText('3 selected',{exact:true}).waitFor();
   await option('C').click();assert.equal(await option('C').isChecked(),false);assert.equal(await option('A').isChecked(),true);assert.equal(await option('D').isChecked(),true);
   await option('C').focus();await page.keyboard.press('Space');assert.equal(await option('C').isChecked(),true);
   await page.screenshot({path:path.join(directory,`${exam}-${viewport.width}-selection.png`),fullPage:true});
   const receipt=page.waitForResponse(r=>r.url().endsWith('/attempt'));await submit.click();await receipt;await page.getByText('Correct! Well done.',{exact:true}).waitFor();
   await page.waitForFunction(()=>document.body.textContent.includes('Submitted answer (locked)'));
   assert.deepEqual(posts,[{answer:[0,2,3]}]);
   for(const letter of ['A','B','C','D'])assert.equal(await option(letter).isDisabled(),true);
   await page.reload();await page.getByText('MSQ · Submitted answer (locked)',{exact:true}).waitFor();
   for(const letter of ['A','C','D'])assert.equal(await option(letter).isChecked(),true);
   assert.equal(await option('B').isChecked(),false);await page.getByText('Correct! Well done.',{exact:true}).waitFor();
   assert.equal(posts.length,1);
   await page.getByRole('button',{name:'Next Question',exact:true}).click();await page.getByText('Single correct question',{exact:true}).waitFor();
   assert.equal(await page.getByRole('checkbox').count(),0);
   await page.getByRole('button',{name:/Single A/}).click();await page.getByRole('button',{name:/Single B/}).click();
   const mcqResponse=page.waitForResponse(r=>r.url().endsWith('/attempt'));await submit.click();await mcqResponse;
   assert.equal(posts.at(-1).answer,1);
   await page.getByRole('button',{name:'Next Question',exact:true}).click();await page.getByText('Numeric question',{exact:true}).waitFor();
   assert.equal(await page.getByRole('checkbox').count(),0);await page.getByPlaceholder('Enter numeric answer').waitFor();
   assert.deepEqual(errors,[]);await context.close();console.log('MSQ verified:',exam,viewport.width);
  }
  for(const [type,selected] of [['msq',['A','C']],['multiple',['A','B','C','D']]]){
   reset(type);const {context,page,errors}=await open('gate',{width:1440,height:900});
   for(const letter of selected)await page.getByRole('checkbox',{name:'Option '+letter,exact:true}).click();
   const receipt=page.waitForResponse(r=>r.url().endsWith('/attempt'));await page.getByRole('button',{name:'Submit Answer',exact:true}).click();await receipt;
   await page.getByText('Incorrect',{exact:true}).waitFor();assert.deepEqual(posts[0].answer,selected.map(letter=>letter.charCodeAt(0)-65));
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('MSQ screenshots:',directory);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
