import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('real PYQ list-to-practice badges retain source exam/year despite workspace, on desktop/mobile and cached offline answers', {timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-pyq-source-year-'));
  const cases=[
    {id:31,exam:'JAM Chemistry',sourceName:'Nuclear Chemistry GATE.html',year:2017,label:'GATE 2017'},
    {id:32,exam:'JAM Chemistry',sourceName:'NET Nuclear Chemistry.html',year:2018,label:'NET 2018'},
    {id:33,exam:'JAM Chemistry',sourceName:'Nuclear Chemistry.html',year:2019,label:'JAM Chemistry 2019'},
    {id:34,exam:'GATE EC',sourceName:null,year:2020,label:'GATE 2020'},
    {id:35,exam:'JAM Chemistry',sourceName:'GATE.html',year:2021,label:'GATE 2021',offlineAnswer:'10',offlineCorrect:true},
  ];
  const questions=cases.map(row=>({...row,subject:'Physical Chemistry',chapter:'Nuclear Chemistry',questionNumber:row.id-30,marks:'1 mark',questionType:'integer',options:[],correctAnswer:null,correctAnswerMulti:[],answerText:'10',answerMin:10,answerMax:10,explanation:'Solution',question:'Radioactive isotope question '+row.id,progress:{attemptCount:1,correctCount:1,lastIsCorrect:true},isSaved:false}));
  const mocks={
    '@/contexts/AuthContext':`export const useAuth=()=>({user:{id:2,role:'student',status:'active'}});`,
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/components/student/AiHint':'export const AiHint=()=>null;',
    '@/components/student/AiSimilarPractice':'export default ()=>null;export const AiPracticeLibrary=()=>null;',
  };
  const resolveDir=new URL('..',import.meta.url).pathname;
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{QuestionPreview,QuestionCard,formatQuestionYear}from'./src/pages/student/PYQ';const questions=${JSON.stringify(questions)};window.__labels=questions.map(q=>formatQuestionYear(q.exam,q.year,q.sourceName,'JAM Chemistry'));window.__missingYear=formatQuestionYear('JAM Chemistry',0,'GATE.html','JAM Chemistry');function App(){const[selected,setSelected]=useState(null);return <main style={{maxWidth:1100,margin:'auto',padding:16}}>{selected===null?<div data-testid="question-list" className="space-y-3">{questions.map((question,index)=><QuestionPreview key={question.id} question={question} index={index} onOpen={()=>setSelected(index)} onSave={()=>{}}/>)}</div>:<div data-testid="question-practice"><button onClick={()=>setSelected(null)}>Return to list</button><QuestionCard key={questions[selected].id} question={questions[selected]} index={selected} displayExam="JAM Chemistry" onSave={()=>{}}/></div>}</main>;}createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);`,resolveDir,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.css':'empty'},plugins:[{name:'real-components-and-test-boundaries',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir}));b.onLoad({filter:/\/pages\/student\/PYQ\.tsx$/},async a=>({contents:(await readFile(a.path,'utf8'))+'\nexport {QuestionPreview,QuestionCard,formatQuestionYear};',loader:'tsx',resolveDir:path.dirname(a.path)}));}}]});
  const app=await readFile(path.join(directory,'app.js'));
  const assetsDir=new URL('../dist/public/assets/',import.meta.url),names=await readdir(assetsDir);
  const css=await readFile(new URL(names.find(f=>/^index-.*\.css$/.test(f)),assetsDir)),mathCss=await readFile(new URL(names.find(f=>/^rich-question-content-.*\.css$/.test(f)),assetsDir));
  const requests=[];
  const server=createServer((req,res)=>{
    const p=new URL(req.url,'http://test').pathname,send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);};
    if(p==='/app.js')return send('application/javascript',app);if(p==='/site.css')return send('text/css',css);if(p==='/math.css')return send('text/css',mathCss);
    if(p.startsWith('/api/')){requests.push({method:req.method,path:p});return send('application/json','{}');}
    send('text/html','<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/math.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin);await page.getByTestId('question-list').waitFor();
      assert.deepEqual(await page.evaluate(()=>window.__labels),cases.map(row=>row.label));assert.equal(await page.evaluate(()=>window.__missingYear),null);
      for(const row of cases){
        await page.getByTestId('question-list').getByText(row.label,{exact:true}).click();const practice=page.getByTestId('question-practice');await practice.getByText(row.label,{exact:true}).waitFor();
        if(row.sourceName?.includes('GATE'))assert.equal(await practice.getByText('JAM Chemistry '+row.year,{exact:true}).count(),0,'workspace cannot replace source year badge');
        if(row.offlineAnswer){assert.equal(await practice.getByPlaceholder('Enter numeric answer').inputValue(),'10');assert(await practice.getByPlaceholder('Enter numeric answer').isDisabled());}
        if(row.id===31)await page.screenshot({path:path.join(directory,`source-gate-${viewport.width}.png`),fullPage:true});
        await page.getByRole('button',{name:'Return to list'}).click();await page.getByTestId('question-list').getByText(row.label,{exact:true}).waitFor();
      }
      assert.deepEqual(errors,[]);await context.close();
    }
    assert(!requests.some(r=>r.method!=='GET'),'viewing a badge never changes student submissions');console.log('Visual QA directory: '+directory);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
