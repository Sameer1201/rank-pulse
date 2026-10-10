import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('real PYQ matches QBank explicit-submit, restoration, MSQ/NAT, failures, timer, filtering and mobile controls', {timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-pyq-qbank-parity-'));
  const mocks={
    '@/contexts/AuthContext':'const user=JSON.parse(localStorage.getItem("educonnect_user"));export const useAuth=()=>({user});',
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/components/student/AiHint':'export const AiHint=()=>null;',
    '@/components/student/AiSimilarPractice':'export default ()=>null;export const AiPracticeLibrary=()=>null;',
    '@/components/student/PerformanceInsightButton':'export const PerformanceInsightButton=()=>null;',
    '@/components/student/OfflinePractice':'export const OfflinePackLoader=()=>null;export const useBufferedPractice=()=>({attempts:[],offline:false});',
    '@/lib/api':`async function req(path,body){const r=await fetch('/api'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(value.error);return value;}export const api={get:path=>req(path),post:(path,body)=>req(path,body)};`,
  };
  const resolveDir=new URL('..',import.meta.url).pathname;
  await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Student from'./src/pages/student/PYQ';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Student/></QueryClientProvider>);`,resolveDir,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.css':'empty'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir}));}}]});
  const app=await readFile(path.join(directory,'app.js'));
  const assets=new URL('../dist/public/assets/',import.meta.url),names=await readdir(assets);
  const css=await readFile(new URL(names.find(f=>/^index-.*\.css$/.test(f)),assets));
  const mathCss=await readFile(new URL(names.find(f=>/^rich-question-content-.*\.css$/.test(f)),assets));
  let exam,questions,posts,timePosts,failNext;
  const reset=(value)=>{
    exam=value;posts=[];timePosts=[];failNext=false;
    questions=[
      {id:1,question:'<div>\n\n\n\n\n\n\n\n<p>Single correct question</p><p><br><br></p><p>The longest wavelength that can be absorbed by silicon, which has the bandgap<br>of 1.12 eV, is 1.1 μm. If the longest wavelength that can be absorbed by<br>another material is 0.87 μm, then bandgap of this material is</p><div><br><br></div>\n\n\n\n\n</div>',questionType:'mcq',options:['Single A','Single B'],correctAnswer:1,correctAnswerMulti:[]},
      {id:2,question:'Multiple correct question',questionType:'multi',options:['Multi A','Multi B','Multi C'],correctAnswer:null,correctAnswerMulti:[0,2]},
      {id:3,question:'Numeric question',questionType:'integer',options:[],correctAnswer:null,correctAnswerMulti:[],answerText:'42',answerMin:42,answerMax:42},
      {id:4,question:'Previously attempted question',questionType:'mcq',options:['Old A','Old B'],correctAnswer:1,correctAnswerMulti:[],timeSpentSeconds:34,progress:{attemptCount:2,lastIsCorrect:false}},
      {id:5,question:'Admin locked solution',questionType:'mcq',options:['Locked A','Locked B'],correctAnswer:1,correctAnswerMulti:[],jamSolutionMode:true,jamSubmitted:exam==='JAM Chemistry',jamSubmittedAnswer:exam==='JAM Chemistry'?1:undefined,jamSubmittedCorrect:true},
    ].map((q,index)=>({exam,subject:'Physics',chapter:'Practice',questionNumber:index+1,year:2020,sourceName:'GATE Practice.html',marks:'1 Mark',answerText:null,answerMin:null,answerMax:null,explanation:'Worked solution '+q.id,timeSpentSeconds:0,progress:null,isSaved:false,jamSolutionMode:exam==='JAM Chemistry',...q}));
  };
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://test'),p=url.pathname,send=(type,value)=>{res.setHeader('Content-Type',type);res.end(value);},json=value=>send('application/json',JSON.stringify(value));
    if(p==='/app.js')return send('application/javascript',app);if(p==='/site.css')return send('text/css',css);if(p==='/math.css')return send('text/css',mathCss);
    if(p==='/api/pyq/subjects')return json({subjects:[{exam,subject:'Physics',questionCount:5,chapterCount:1}]});
    if(p==='/api/pyq/chapters')return json({chapters:[{chapter:'Practice',chapterOrder:0,questionCount:5}]});
    if(p==='/api/pyq/questions')return json({questions,total:5});
    if(req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),q=questions.find(q=>q.id===Number(p.match(/questions\/(\d+)/)?.[1]));
      if(p.endsWith('/time')){timePosts.push({id:q.id,...body});q.timeSpentSeconds=Math.max(q.timeSpentSeconds,body.timeSpentSeconds);return json({timeSpentSeconds:q.timeSpentSeconds});}
      if(p.endsWith('/attempt')||p.endsWith('/jam-submit')){
        if(failNext){failNext=false;res.statusCode=503;return json({error:'Temporary failure'});}
        posts.push({id:q.id,path:p,...body});
        const correct=Array.isArray(body.answer)?JSON.stringify([...body.answer].sort())==='[0,2]':q.questionType==='integer'?Number(body.answer)===42:body.answer===1;
        if(p.endsWith('/jam-submit')){q.jamSubmitted=true;q.jamSubmittedAnswer=body.answer;q.jamSubmittedCorrect=correct;}
        else q.progress={attemptCount:(q.progress?.attemptCount??0)+1,correctCount:correct?1:0,incorrectCount:correct?0:1,lastIsCorrect:correct};
        // Slow response proves review is immediate rather than network-gated.
        await new Promise(resolve=>setTimeout(resolve,180));
        return json({isCorrect:correct,progress:q.progress,submitted:true,alreadySubmitted:false,answer:body.answer});
      }
      return json({saved:true});
    }
    if(p.startsWith('/api/'))return json({pending:false});
    send('text/html','<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/math.css"></head><body style="padding:12px"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const selectedExam of ['GATE EC','JAM Chemistry'])for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      reset(selectedExam);const context=await browser.newContext({viewport});
      await context.addInitScript(exam=>{
        localStorage.setItem('educonnect_user',JSON.stringify({id:2,role:'student',status:'active',subject:exam}));
        if(!sessionStorage.getItem('pyq-view:2'))sessionStorage.setItem('pyq-view:2',JSON.stringify({selectedSubject:{exam,subject:'Physics',questionCount:5,chapterCount:1},selectedChapter:{chapter:'Practice',chapterOrder:0,questionCount:5},practiceMode:false,attemptedFilter:'all'}));
      },selectedExam);
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/student/pyq');
      await page.getByText('Single correct question',{exact:true}).click();
      const submit=()=>page.getByRole('button',{name:'Submit Answer',exact:true});
      const next=()=>page.getByRole('button',{name:'Next question',exact:true}).last();
      const previous=()=>page.getByRole('button',{name:'Previous question',exact:true}).last();
      assert(await submit().isDisabled());
      assert((await page.getByText('Single correct question',{exact:true}).boundingBox()).height<100,'HTML indentation does not produce giant question gaps');
      const card=page.locator('[data-question-navigation-card]'),stem=card.locator('.rich-question-content').first();
      assert.equal(await stem.locator('br').count(),0,'source-width line breaks and empty spacer blocks are removed');
      assert.equal(await card.evaluate(node=>getComputedStyle(node).backgroundColor),await page.evaluate(()=>{const node=document.createElement('div');node.className='bg-card';document.body.append(node);const color=getComputedStyle(node).backgroundColor;node.remove();return color;}),'PYQ uses the theme-aware QBank card, not the old slate-blue surface');
      assert(await stem.evaluate(node=>{const card=node.closest('[data-question-navigation-card]'),padding=parseFloat(getComputedStyle(card).paddingLeft);return Math.abs(node.getBoundingClientRect().width-(card.clientWidth-padding*2))<2;}),'question uses the full available card width');
      if(viewport.width>=640){
        const positions=await stem.locator('p').last().evaluate(p=>{const text=p.firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,1);const first=range.getBoundingClientRect();const at=text.textContent.indexOf('of 1.12');range.setStart(text,at);range.setEnd(text,at+1);return {first:first.y,continuation:range.getBoundingClientRect().y};});
        assert.equal(positions.continuation,positions.first,'prose continues on the first line instead of wrapping at the old imported page width');
      }
      await page.screenshot({path:path.join(directory,`${selectedExam}-${viewport.width}-question.png`),fullPage:true});
      await page.getByRole('button',{name:/Single A/}).click();await page.getByRole('button',{name:/Single B/}).click();assert.equal(posts.length,0,'selection never auto-submits');
      const receipt=page.waitForResponse(r=>/\/(attempt|jam-submit)$/.test(r.url()));await submit().click();await page.getByText('Correct! Well done.',{exact:true}).waitFor();await receipt;
      assert.equal(posts.length,1);assert.equal(posts[0].answer,1);assert.equal(posts[0].exam,selectedExam);
      assert.equal(posts[0].path.endsWith('/jam-submit'),selectedExam==='JAM Chemistry','admin one-time endpoint is preserved');
      await page.screenshot({path:path.join(directory,`${selectedExam}-${viewport.width}-review.png`),fullPage:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no mobile overflow');
      const actionStyle=await page.locator('[data-practice-action-bar]').evaluate(el=>getComputedStyle(el).position);assert.equal(actionStyle,viewport.width<640?'fixed':'static');
      await page.getByRole('button',{name:'Next Question',exact:true}).click();await page.getByText('Multiple correct question',{exact:true}).waitFor();
      await previous().click();await page.getByText('Correct! Well done.',{exact:true}).waitFor();assert(await page.getByRole('button',{name:/Single B/}).isDisabled());assert.equal(posts.length,1);
      await page.reload();await page.getByText('Correct! Well done.',{exact:true}).waitFor();assert.equal(posts.length,1,'session reload does not reattempt');
      questions[0].correctAnswer=0;if(questions[0].progress)questions[0].progress.lastIsCorrect=false;questions[0].jamSubmittedCorrect=false;
      await page.reload();await page.getByText('Incorrect',{exact:true}).waitFor();assert.equal(posts.length,1,'admin correction regrades the saved answer without another attempt');
      questions[0].correctAnswer=1;if(questions[0].progress)questions[0].progress.lastIsCorrect=true;questions[0].jamSubmittedCorrect=true;
      await page.reload();await page.getByText('Correct! Well done.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Next Question',exact:true}).click();
      const checkbox=letter=>page.getByRole('checkbox',{name:'Option '+letter,exact:true});await checkbox('A').click();await checkbox('C').focus();await page.keyboard.press('Space');await page.getByText('2 selected',{exact:true}).waitFor();
      const multiReceipt=page.waitForResponse(r=>/\/(attempt|jam-submit)$/.test(r.url()));await submit().click();await multiReceipt;assert.deepEqual(posts.at(-1).answer,[0,2]);
      await page.getByRole('button',{name:'Next Question',exact:true}).click();await page.getByPlaceholder('Enter numeric answer').fill('43');assert.equal(await page.getByRole('checkbox').count(),0);
      failNext=true;const failed=page.waitForResponse(r=>r.status()===503);await submit().click();await failed;await submit().waitFor();assert(!(await page.getByPlaceholder('Enter numeric answer').isDisabled()),'failed write unlocks for retry');
      const numericReceipt=page.waitForResponse(r=>/\/(attempt|jam-submit)$/.test(r.url()));await submit().click();await numericReceipt;await page.getByText('Incorrect',{exact:true}).waitFor();assert.equal(posts.at(-1).answer,'43');assert.equal(await page.getByText('2 in a row',{exact:true}).count(),0,'wrong answer resets streak');
      await page.getByRole('button',{name:'Next Question',exact:true}).click();await page.getByText('Previously attempted question',{exact:true}).waitFor();
      if(viewport.width<640){await page.getByRole('button',{name:'More question actions',exact:true}).click();await page.getByText('Time spent · 0:34',{exact:true}).waitFor();await page.keyboard.press('Escape');}
      else await page.getByLabel('Time spent 0:34',{exact:true}).waitFor();
      assert(!timePosts.some(p=>p.id===4),'first-submit timer stays frozen on previously attempted question');
      await next().click();await page.getByText('Admin locked solution',{exact:true}).waitFor();
      if(selectedExam==='JAM Chemistry'){assert(await page.getByRole('button',{name:/Locked B/}).isDisabled());assert.equal(await submit().count(),0);}
      assert.deepEqual(errors,[]);await context.close();console.log('Parity verified:',selectedExam,viewport.width);
    }
    // Current question must survive the Unattempted filter after submitting.
    reset('GATE EC');const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>{localStorage.setItem('educonnect_user',JSON.stringify({id:3,role:'student',status:'active',subject:'GATE EC'}));sessionStorage.setItem('pyq-view:3',JSON.stringify({selectedSubject:{exam:'GATE EC',subject:'Physics',questionCount:5,chapterCount:1},selectedChapter:{chapter:'Practice',chapterOrder:0,questionCount:5},attemptedFilter:'unattempted'}));});
    const page=await context.newPage();await page.goto(origin+'/student/pyq');await page.getByText('Single correct question',{exact:true}).click();await page.getByRole('button',{name:/Single B/}).click();await page.getByRole('button',{name:'Submit Answer',exact:true}).click();await page.getByText('Correct! Well done.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Next Question',exact:true}).click();await page.getByText('Multiple correct question',{exact:true}).waitFor();assert.equal(await page.getByText('Single correct question',{exact:true}).count(),0);await context.close();
    console.log('Visual QA directory: '+directory);
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
