import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

async function poll(page,predicate,timeout=30000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await page.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('Timed out waiting for durable practice state');
}

test('real QBank and PYQ screens stay identical offline, retain answers on reload, and sync', {timeout:180000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-same-ui-'));
 const mocks={
  '@/contexts/AuthContext':'const user=JSON.parse(localStorage.getItem("educonnect_user"));export const useAuth=()=>({user});',
  '@/hooks/use-toast':'export const useToast=()=>({toast:value=>{window.__toast=value;}});',
  '@/components/student/AiHint':'export const AiHint=()=>null;',
  '@/components/student/AiSimilarPractice':'export default ()=>null;export const AiPracticeLibrary=()=>null;',
  '@/components/student/PerformanceInsightButton':'export const PerformanceInsightButton=()=>null;',
 };
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Route}from'wouter';
 import{TooltipProvider}from'./src/components/ui/tooltip';
 import Question from './src/pages/student/question-bank/QuestionPage';import PYQ from './src/pages/student/PYQ';
 import{OfflinePracticeManager}from'./src/components/student/OfflinePractice';
 import{getOfflinePack,getOfflineAttempts,prepareOfflineBuffer}from'./src/lib/offline-practice';
 import{loadOfflineQBank}from'./src/lib/offline-qbank';
 import{api}from'./src/lib/api';
 window.__saved=()=>getOfflinePack(2);window.__answers=()=>getOfflineAttempts(2);
 window.__bufferQuestion=id=>prepareOfflineBuffer({userId:2,source:'question-bank',context:'qb:gate:1',title:'Chapter',questionIds:[id]},(ids,signal,onReady)=>loadOfflineQBank(1,ids,'gate',signal,onReady));
 const client=window.__client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 window.__refresh16=async()=>{const queryKey=['student-qb-question-content',1,[16],2];await client.cancelQueries({queryKey});return client.fetchQuery({queryKey,queryFn:()=>api.get('/question-bank/chapters/1/questions?questionId=16',{networkOnly:true}),retry:false});};
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TooltipProvider><OfflinePracticeManager/><main data-testid="normal-practice"><Route path="/student/question-bank/exam/:examId/subject/:subjectId/chapter/:chapterId/question/:questionId"><Question/></Route><Route path="/student/pyq"><PYQ/></Route></main></TooltipProvider></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const app=await readFile(path.join(directory,'app.js')),css=await readFile(path.join(directory,'app.css'));
 const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
 const siteCss=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
 const sw=await readFile(new URL('../public/practice-sw.js',import.meta.url));
 const receipts=new Set();let posts=0;let weak=false;let failNextRefill=false;let refillFailures=0;
 let stallDiagram3=false,stallSingle16=false,single16Started=false,denySingle16=false;
 const questions=Array.from({length:16},(_,i)=>({id:i+1,exam:'JAM Chemistry',subject:'Chemistry',chapter:'Chapter',year:2020,marks:'1',points:1,difficulty:'medium',questionNumber:i+1,question:'Practice question '+(i+1),questionType:'mcq',options:['Correct option','Wrong option'],correctAnswer:0,correctAnswerMulti:[],answerText:null,answerMin:null,answerMax:null,explanation:'Stored solution.',hasImage:true,imageData:'/diagram.svg',progress:null}));
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://test'),p=url.pathname;
  const send=(type,data)=>{res.setHeader('Content-Type',type);res.end(data);};const json=data=>send('application/json',JSON.stringify(data));
  if(p==='/practice-sw.js')return send('application/javascript',sw);
  if(p==='/assets/app.js')return send('application/javascript',app);
  if(p==='/assets/app.css')return send('text/css',css);
  if(p==='/assets/site.css')return send('text/css',siteCss);
  if(p==='/diagram.svg')return send('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="orange"/></svg>');
  if(p==='/api/auth/me'){if(weak){res.statusCode=503;return json({error:'Weak connection'});}return json({id:2});}
  if(p==='/api/student/offline-capabilities')return json({available:true,limit:15});
  if(p.endsWith('/structure')){const key=p.split('/').at(-2);return json({exam:{key,label:key==='gate'?'GATE':'JAM Chemistry'},subjects:[{id:1,title:'Physics',chapters:[{id:1,title:'Chapter',questionCount:16,attemptedCount:0}]}]});}
  if(p==='/api/question-bank/chapters/1/questions'){
   if(url.searchParams.get('indexOnly')==='1')return json({questions:questions.map(({id,difficulty,progress})=>({id,difficulty,progress}))});
   const ids=(url.searchParams.get('questionIds')??url.searchParams.get('questionId')??'').split(',').map(Number);
   if(denySingle16&&url.searchParams.get('questionId')==='16'){res.statusCode=403;return json({error:'Access denied'});}
   if(stallSingle16&&url.searchParams.get('questionId')==='16'){single16Started=true;res.setHeader('Content-Type','application/json');res.write('{');return;}
   if(ids.includes(16)&&(weak||failNextRefill)){failNextRefill=false;refillFailures++;res.statusCode=503;return json({error:'Temporary connection failure'});}
   return json({questions:questions.filter(q=>ids.includes(q.id))});
  }
  if(/\/question-bank\/questions\/\d+\/image$/.test(p)){
   if(stallDiagram3&&p.endsWith('/3/image')){res.setHeader('Content-Type','application/json');res.write('{');return;}
   return json({imageData:'/diagram.svg',optionImages:[]});
  }
  if(p==='/api/pyq/questions')return json({questions:questions.map(q=>({...q,exam:url.searchParams.get('exam')??q.exam})),total:16});
  if(req.method==='POST'){
   let body='';for await(const part of req)body+=part;const data=JSON.parse(body);
   if(p.endsWith('/attempt')&&!receipts.has(data.offlineSubmissionId)){assert.ok(data.offlineSubmissionId);receipts.add(data.offlineSubmissionId);posts++;}
   if(weak){res.setHeader('Content-Type','application/json');res.write('{');return;}
   return json({isCorrect:true,timeSpentSeconds:data.timeSpentSeconds,progress:{attemptCount:1,lastIsCorrect:true,correctCount:1,incorrectCount:0}});
  }
  if(p.startsWith('/api/'))return json({subjects:[],chapters:[],total:0});
  if(weak){res.setHeader('Content-Type','text/html');res.write('<!doctype html>');return;}
  send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  for(const {source,exam} of [{source:'question-bank',exam:'GATE EC'},{source:'question-bank',exam:'JAM Chemistry'},{source:'pyq',exam:'JAM Chemistry'},{source:'pyq',exam:'GATE EC'}])for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   console.log('Checking',source,exam,viewport.width);
   const context=await browser.newContext({viewport});
   await context.addInitScript(exam=>{
    localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:exam}));
    if(!sessionStorage.getItem('pyq-view:2'))sessionStorage.setItem('pyq-view:2',JSON.stringify({selectedSubject:{exam,subject:'Chemistry'},selectedChapter:{chapter:'Chapter',questionCount:16},practiceMode:true,questionIndex:0}));
   },exam);
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const route=source==='pyq'?'/student/pyq':`/student/question-bank/exam/${exam==='JAM Chemistry'?'jam':'gate'}/subject/1/chapter/1/question/1`;
   await page.goto(origin+route);await page.getByText('Practice question 1',{exact:true}).waitFor();
   await poll(page,async()=> (await window.__saved())?.questions.length===15);
   assert.equal(await page.getByRole('button',{name:'Offline practice',exact:true}).count(),0);
   const classBefore=await page.getByRole('button',{name:/Correct option/}).getAttribute('class');
   await context.setOffline(true);
   assert.equal(await page.getByRole('dialog',{name:'Offline practice'}).count(),0);
   assert.equal(await page.getByRole('button',{name:/Correct option/}).getAttribute('class'),classBefore);
   await page.getByRole('button',{name:/Correct option/}).click();
   if(source==='question-bank'||exam==='JAM Chemistry')await page.getByRole('button',{name:'Submit Answer',exact:true}).click();
   await poll(page,async()=> (await window.__answers()).filter(a=>a.status==='pending').length===1);
   await page.reload();await page.getByText('Stored solution.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(async()=> (await window.__answers())[0].answer),0);
   await page.getByRole('button',{name:/Next/}).last().click();
   await page.getByText('Practice question 2',{exact:true}).waitFor();
   await page.getByRole('button',{name:/Correct option/}).click();if(source==='question-bank'||exam==='JAM Chemistry')await page.getByRole('button',{name:'Submit Answer',exact:true}).click();
   await poll(page,async()=> (await window.__answers()).filter(a=>a.status==='pending').length===2);
   assert.equal(await page.getByRole('dialog',{name:'Offline practice'}).count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(directory,`${source}-${exam.replaceAll(' ','-')}-${viewport.width}.png`),fullPage:true});
   await context.setOffline(false);
   await poll(page,async()=> (await window.__answers()).filter(a=>a.status==='synced').length===2);
   assert.deepEqual(errors,[]);await context.close();
  }
  assert.equal(posts,16);
  console.log('Checking teacher correction of an already-buffered question');
  const correctedContext=await browser.newContext({viewport:{width:390,height:844}});
  await correctedContext.addInitScript(()=>localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:'GATE EC'})));
  const correctedPage=await correctedContext.newPage();
  await correctedPage.goto(origin+'/student/question-bank/exam/gate/subject/1/chapter/1/question/1');
  await poll(correctedPage,async()=>(await window.__saved())?.questions.length===15);
  const originalQuestion={...questions[0]};
  questions[0]={...questions[0],question:'Teacher-corrected question',options:['10<sup>3</sup> cm<sup>−3</sup> s<sup>−1</sup>','10<sup>12</sup> cm<sup>−3</sup> s<sup>−1</sup>'],correctAnswer:1,explanation:'Teacher-corrected solution'};
  await correctedPage.evaluate(()=>window.__client.invalidateQueries({queryKey:['student-qb-question-content']}));
  await correctedPage.getByText('Teacher-corrected question',{exact:true}).waitFor();
  assert.equal(await correctedPage.locator('#qb-option-1-1 sup').count(),3,'student sees corrected superscripts');
  await poll(correctedPage,async()=>(await window.__saved()).questions.find(q=>q.id===1)?.correctAnswer===1);
  await correctedPage.screenshot({path:path.join(directory,'teacher-correction-mobile.png'),fullPage:true});
  await correctedContext.setOffline(true);
  await correctedPage.reload();
  await correctedPage.getByText('Teacher-corrected question',{exact:true}).waitFor();
  assert.equal(await correctedPage.locator('#qb-option-1-1 sup').count(),3,'offline reload retains teacher formatting');
  await correctedContext.close();questions[0]=originalQuestion;
  console.log('Checking connected Wi-Fi with stalled bodies and automatic background refill');
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:'GATE EC'})));
  const page=await context.newPage();
  await page.goto(origin+'/student/question-bank/exam/gate/subject/1/chapter/1/question/1');
  await poll(page,async()=>(await window.__saved())?.questions.length===15);
  weak=true;
  assert.equal(await page.evaluate(()=>navigator.onLine),true);
  await page.getByRole('button',{name:/Correct option/}).click();
  await page.getByRole('button',{name:'Submit Answer',exact:true}).click();
  await poll(page,async()=>(await window.__answers()).filter(a=>a.status==='pending').length===1);
  // Reload while HTML arrives only partially: the public cached shell must win.
  await page.reload();await page.getByText('Stored solution.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>navigator.onLine),true);
  const before=Date.now();
  await page.getByRole('button',{name:/Next/}).last().click();
  await page.getByText('Practice question 2',{exact:true}).waitFor();
  assert(Date.now()-before<2000,'next buffered question must not wait for the weak network');
  await page.getByRole('button',{name:/Next/}).last().click();
  await page.getByText('Practice question 3',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Next/}).last().click();
  await page.getByText('Practice question 4',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Next/}).last().click();
  await page.getByText('Practice question 5',{exact:true}).waitFor();
  await poll(page,async()=>(await window.__saved())?.questions[0]?.id===5);
  weak=false;failNextRefill=true;
  // No online event: the Wi-Fi icon never changed. Refill must retry by itself.
  await poll(page,async()=>(await window.__saved())?.questions.some(q=>q.id===16),45000);
  assert(refillFailures>=1);
  await poll(page,async()=>(await window.__answers()).filter(a=>a.status==='synced').length===1,60000);
  assert.equal(posts,17,'lost response replay must not count the answer twice');
  assert.equal(await page.evaluate(()=>navigator.onLine),true);
  await page.screenshot({path:path.join(directory,'weak-network-buffer-mobile.png'),fullPage:true});
  await context.close();
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   console.log('Checking immediate Next and late-ready buffer during stalled foreground read',viewport.width);
   stallDiagram3=true;stallSingle16=true;single16Started=false;
   const bufferedContext=await browser.newContext({viewport});
   await bufferedContext.addInitScript(()=>localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:'GATE EC'})));
   const bufferedPage=await bufferedContext.newPage();
   await bufferedPage.goto(origin+'/student/question-bank/exam/gate/subject/1/chapter/1/question/1');
   await bufferedPage.getByText('Practice question 1',{exact:true}).waitFor();
   // Question 2 must be persisted before the following diagram finishes.
   await poll(bufferedPage,async()=>(await window.__saved())?.questions.some(q=>q.id===2),10000);
   assert.equal(await bufferedPage.evaluate(()=>navigator.onLine),true);
   await bufferedPage.evaluate(()=>{
    window.__loadingSeen=false;
    window.__loaderObserver=new MutationObserver(()=>{if(document.getElementById('root').textContent.includes('Loading question...'))window.__loadingSeen=true;});
    window.__loaderObserver.observe(document.getElementById('root'),{childList:true,subtree:true,characterData:true});
   });
   const started=Date.now();
   await bufferedPage.getByRole('button',{name:/Next/}).last().click();
   await bufferedPage.getByText('Practice question 2',{exact:true}).waitFor();
   assert(Date.now()-started<1000,'ready Next must not wait for a slow diagram');
   assert.equal(await bufferedPage.evaluate(()=>window.__loadingSeen),false,'ready Next must not flash a loading screen');
   await bufferedPage.evaluate(()=>{window.__loaderObserver.disconnect();history.pushState(null,'','/student/question-bank/exam/gate/subject/1/chapter/1/question/16');dispatchEvent(new PopStateEvent('popstate'));});
   await bufferedPage.getByText('Loading question...',{exact:true}).waitFor();
   assert(single16Started,'foreground read must already be stalled');
   // Background refill completes while the older foreground request is pending.
   await bufferedPage.evaluate(()=>window.__bufferQuestion(16));
   await bufferedPage.getByText('Practice question 16',{exact:true}).waitFor({timeout:1000});
   assert.equal(await bufferedPage.evaluate(()=>window.__client.getQueryState(['student-qb-question-content',1,[16],2]).fetchStatus),'fetching','buffer must render without waiting for the in-flight content read');
   await bufferedPage.screenshot({path:path.join(directory,`ready-during-stalled-read-${viewport.width}.png`),fullPage:true});
   // A subsequent authoritative permission denial still overrides the ready buffer.
   denySingle16=true;
   await bufferedPage.evaluate(()=>window.__refresh16().catch(()=>{}));
   await bufferedPage.getByText('Could not load question.',{exact:false}).waitFor();
   assert.equal(await bufferedPage.getByText('Practice question 16',{exact:true}).count(),0);
   await bufferedContext.close();stallDiagram3=false;stallSingle16=false;denySingle16=false;
  }
  for(const {exam,viewport} of [{exam:'gate',viewport:{width:390,height:844}},{exam:'jam',viewport:{width:1440,height:900}}]){
   console.log('Checking offline unattempted navigation',exam,viewport.width);
   for(const q of questions)q.progress=q.id%2===1?{attemptCount:1,lastIsCorrect:true,correctCount:1,incorrectCount:0}:null;
   const filteredContext=await browser.newContext({viewport});
   await filteredContext.addInitScript(()=>localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:'GATE EC'})));
   const filteredPage=await filteredContext.newPage();
   await filteredPage.goto(origin+`/student/question-bank/exam/${exam}/subject/1/chapter/1/question/2?filter=unattempted`);
   await filteredPage.getByText('Practice question 2',{exact:true}).waitFor();
   await poll(filteredPage,async()=>(await window.__saved())?.questions.length===8);
   assert.deepEqual(await filteredPage.evaluate(async()=>(await window.__saved()).questions.map(q=>q.id)),[2,4,6,8,10,12,14,16]);
   await filteredContext.setOffline(true);
   await filteredPage.getByRole('button',{name:'Next question',exact:true}).last().click();
   await filteredPage.getByText('Practice question 4',{exact:true}).waitFor();
   await filteredPage.getByRole('button',{name:/Correct option/}).click();
   await filteredPage.getByRole('button',{name:'Submit Answer',exact:true}).click();
   await poll(filteredPage,async()=>(await window.__answers()).some(a=>a.questionId===4&&a.status==='pending'));
   await filteredPage.getByRole('button',{name:'Next Question',exact:true}).click();
   await filteredPage.getByText('Practice question 6',{exact:true}).waitFor();
   await filteredPage.getByRole('button',{name:'Previous question',exact:true}).last().click();
   await filteredPage.getByText('Practice question 2',{exact:true}).waitFor();
   assert.equal(await filteredPage.getByRole('button',{name:/^Open question /}).count(),7);
   await filteredPage.reload();await filteredPage.getByText('Practice question 2',{exact:true}).waitFor();
   assert.equal(new URL(filteredPage.url()).searchParams.get('filter'),'unattempted');
   assert.equal(await filteredPage.getByRole('button',{name:/^Open question /}).count(),7);
   await filteredContext.close();
  }
  console.log('Same-UI screenshots:',directory);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
