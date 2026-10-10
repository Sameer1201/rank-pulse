import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('real PYQ report cards open rich editor, retain failed fixes, resolve only on save, and fit desktop/mobile', {timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-pyq-report-editor-'));
  const mocks={
    'katex/dist/katex.min.css':'',
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/lib/api':`async function req(path,method='GET',body){const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}export const api={get:path=>req(path),patch:(path,body)=>req(path,'PATCH',body)};`,
  };
  await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Admin from'./src/pages/admin/PYQ';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Admin/></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^(?:@\/|katex\/dist\/)/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:new URL('..',import.meta.url).pathname}));}}]});
  const app=await readFile(path.join(directory,'app.js'));
  const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
  const css=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
  let reports=[],fail=false;const calls=[];
  const makeReport=()=>({id:7,questionId:31,exam:'JAM Chemistry',subject:'Physical Chemistry',chapter:'Nuclear Chemistry',year:2021,reporterName:'Test student',reason:'Correct range: 0.115–0.13',questionText:'<div class="rich-source-content">Given initial mass <strong>1mg</strong> of radioactive material</div>'});
  let question;
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://test');
    const send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);},json=value=>send('application/json',JSON.stringify(value));
    if(url.pathname==='/app.js')return send('application/javascript',app);
    if(url.pathname==='/site.css')return send('text/css',css);
    if(url.pathname==='/api/pyq/questions/31'){
      calls.push({method:req.method,exam:url.searchParams.get('exam')});
      if(req.method==='GET')return json({question});
      let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{calls.at(-1).body=JSON.parse(body);if(fail){res.statusCode=503;return json({error:'Correction unavailable. Reload the question and retry; reports stay open until saved.'});}question={...question,...JSON.parse(body)};reports=[];json({ok:true,regradedStudents:1});});return;
    }
    if(url.pathname==='/api/pyq/reports')return json({reports});
    if(url.pathname==='/api/users')return json([]);
    if(url.pathname==='/api/pyq/subjects')return json({subjects:[]});
    if(url.pathname==='/api/pyq/jam-solution-access')return json({studentIds:[]});
    if(url.pathname.startsWith('/api/'))return json({});
    send('text/html','<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head><body style="padding:12px"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      reports=[makeReport()];question={id:31,exam:'JAM Chemistry',subject:'Physical Chemistry',chapter:'Nuclear Chemistry',year:2021,question:reports[0].questionText,questionType:'integer',options:[],correctAnswer:null,correctAnswerMulti:[],answerText:'0.1',answerMin:0.09,answerMax:0.11,explanation:'<p>Old solution</p>',imageData:null,updatedAt:'2026-10-07T00:00:00.000Z'};fail=false;calls.length=0;
      const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/admin/pyq?exam=jam-chemistry');await page.getByRole('button',{name:'Open & fix'}).waitFor();
      assert(!await page.locator('body').innerText().then(text=>text.includes('<div')),'report renders rich content rather than source HTML');
      await page.getByRole('button',{name:'Open & fix'}).click();await page.getByRole('textbox',{name:'Reported PYQ question',exact:true}).waitFor();
      assert.equal(calls[0].exam,'JAM Chemistry');assert.equal(await page.getByLabel('Minimum answer').inputValue(),'0.09');
      await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls.filter(c=>c.method==='PATCH').length,0);assert.equal(reports.length,1);
      await page.getByRole('button',{name:'Open & fix'}).click();await page.getByLabel('Minimum answer').fill('0.115');await page.getByLabel('Maximum answer').fill('0.13');await page.getByRole('textbox',{name:'Reported PYQ solution',exact:true}).fill('Corrected solution with valid range');
      fail=true;await page.getByRole('button',{name:'Save & resolve report'}).click();await page.getByRole('alert').filter({hasText:'Correction unavailable'}).waitFor();assert.equal(reports.length,1);assert.equal(await page.getByLabel('Minimum answer').inputValue(),'0.115');
      await page.getByRole('button',{name:'Preview changes'}).click();await page.screenshot({path:path.join(directory,`editor-${viewport.width}.png`)});
      const bounds=await page.getByRole('dialog').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1,'dialog fits viewport');
      assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog has no horizontal overflow');
      fail=false;await page.getByRole('button',{name:'Save & resolve report'}).click();await page.getByText('No open student reports.').waitFor();
      const saved=calls.filter(c=>c.method==='PATCH').at(-1);assert.equal(saved.exam,'JAM Chemistry');assert.equal(saved.body.answerMin,0.115);assert.equal(saved.body.answerMax,0.13);assert.match(saved.body.explanation,/Corrected solution/);assert.equal(saved.body.expectedUpdatedAt,'2026-10-07T00:00:00.000Z');assert(!calls.some(c=>c.method==='DELETE'));assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log('Visual QA directory: '+directory);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
