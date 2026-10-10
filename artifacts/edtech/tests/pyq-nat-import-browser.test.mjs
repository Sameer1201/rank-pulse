import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';
import {moleConceptAnswers,moleConceptSource} from './fixtures/mole-concept-nat.mjs';

test('actual admin import preview has numeric NAT controls, no choices, and sends numeric import payload on desktop/mobile', {timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-pyq-nat-import-'));
  const mocks={
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/lib/api':`async function req(path,method='GET',body){const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return r.json();}export const api={get:path=>req(path),post:(path,body)=>req(path,'POST',body)};`,
  };
  const resolveDir=new URL('..',import.meta.url).pathname;
  await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Admin from'./src/pages/admin/PYQ';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Admin/></QueryClientProvider>);`,resolveDir,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.css':'empty'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir}));}}]});
  const app=await readFile(path.join(directory,'app.js'));
  const names=await readdir(new URL('../dist/public/assets/',import.meta.url));
  const css=await readFile(new URL('../dist/public/assets/'+names.find(f=>/^index-.*\.css$/.test(f)),import.meta.url));
  const calls=[];
  // Optional read-only check of the full user source; never execute its scripts
  // or send this import to the production API.
  const interactiveSource=process.env.PYQ_NAT_SOURCE_PATH?await readFile(process.env.PYQ_NAT_SOURCE_PATH,'utf8'):moleConceptSource;
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://test'),send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);},json=value=>send('application/json',JSON.stringify(value));
    if(url.pathname==='/app.js')return send('application/javascript',app);
    if(url.pathname==='/site.css')return send('text/css',css);
    if(url.pathname==='/api/pyq/import'&&req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{calls.push(JSON.parse(body));json({imported:1,chapters:1});});return;}
    if(url.pathname==='/api/pyq/subjects')return json({subjects:[]});
    if(url.pathname==='/api/pyq/chapters')return json({chapters:[]});
    if(url.pathname==='/api/users')return json([]);
    if(url.pathname==='/api/pyq/reports')return json({reports:[]});
    if(url.pathname==='/api/pyq/jam-solution-access')return json({studentIds:[]});
    if(url.pathname.startsWith('/api/'))return json({});
    send('text/html','<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head><body style="padding:12px"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const source=answer=>`<meta name="exam" content="JAM Chemistry"><meta name="subject" content="Physical Chemistry"><meta name="chapter" content="Mole Concept"><article class="qcard"><div class="qhead"><span class="qnum">1</span><div class="qtext">4.5 g of compound A (MW = 90) was used to make 250 mL of its aqueous solution. The molarity of the solution in M is x × 10⁻¹. The value of x is ____ (nearest integer).</div></div><div class="solution"><div class="answer">Answer: ${answer}</div><div class="solution-inner">Moles = 0.05; molarity = 0.2 M, so x = 2.</div></div></article>`;
  try{
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/admin/pyq?exam=jam-chemistry');
      const input=page.locator('input[type="file"][accept=".html,text/html"]:not([multiple])');
      await input.setInputFiles({name:'molarity.html',mimeType:'text/html',buffer:Buffer.from(source('2'))});
      await page.getByText('Correct numeric answer · NAT',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Numeric answer',{exact:true}).inputValue(),'2');
      assert(await page.getByLabel('Numeric answer',{exact:true}).isDisabled());
      assert.equal(await page.getByRole('button',{name:/^[A-D](?: ✓)?$/}).count(),0,'NAT has no option-selection buttons');
      assert.equal(await page.getByText('Options',{exact:true}).count(),0);
      assert.equal(await page.getByText('Not added',{exact:true}).count(),0,'no fake empty choices');
      await page.getByRole('button',{name:'Enable editing',exact:true}).click();
      await page.getByLabel('Numeric answer',{exact:true}).fill('2.5');
      assert.deepEqual(errors,[], 'editing numeric answer does not crash');
      assert.equal(await page.getByLabel('Minimum answer',{exact:true}).inputValue(),'2.5');
      assert.equal(await page.getByLabel('Maximum answer',{exact:true}).inputValue(),'2.5');
      await page.getByLabel('Minimum answer',{exact:true}).fill('2.4');
      await page.getByLabel('Maximum answer',{exact:true}).fill('2.6');
      const priorCalls=calls.length;
      await page.getByLabel('Minimum answer',{exact:true}).fill('3');
      await page.getByRole('button',{name:'Import',exact:true}).click();
      assert.equal(calls.length,priorCalls,'reversed range never reaches the import endpoint');
      await page.getByLabel('Minimum answer',{exact:true}).fill('2.4');
      await page.getByText('Correct numeric answer · NAT',{exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(directory,`nat-${viewport.width}.png`)});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'import preview fits viewport');
      await page.getByRole('button',{name:'Import',exact:true}).click();
      await page.getByText('Import preview',{exact:true}).waitFor({state:'detached'});
      const saved=calls.at(-1).questions[0];assert.equal(saved.questionType,'integer');assert.deepEqual(saved.options,[]);assert.deepEqual(saved.correctAnswers,[]);assert.equal(saved.correctAnswer,null);assert.equal(saved.answerMin,2.4);assert.equal(saved.answerMax,2.6);assert.match(saved.question,/4\.5 g/);assert.match(saved.explanation,/Moles/);
      await input.setInputFiles({name:'mcq.html',mimeType:'text/html',buffer:Buffer.from(source('C'))});
      await page.getByText('Click one option to set the answer',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:/^[A-D](?: ✓)?$/}).count(),4,'answer-only MCQ keeps its four choices');
      assert.equal(await page.getByRole('button',{name:'C ✓',exact:true}).getAttribute('aria-pressed'),'true');
      await input.setInputFiles({name:'Mole_Concept_21Q_Interactive.html',mimeType:'text/html',buffer:Buffer.from(interactiveSource)});
      await page.getByText('Correct numeric answer · NAT',{exact:true}).first().waitFor();
      assert.equal(await page.getByText('Correct numeric answer · NAT',{exact:true}).count(),21);
      assert.deepEqual(await page.getByLabel('Numeric answer',{exact:true}).evaluateAll(inputs=>inputs.map(input=>input.value)),moleConceptAnswers.map(String));
      assert.equal(await page.getByRole('button',{name:/^[A-D](?: ✓)?$/}).count(),0);
      assert.equal(await page.getByText('Not added',{exact:true}).count(),0);
      await page.getByText('Correct numeric answer · NAT',{exact:true}).first().scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(directory,`mole-concept-${viewport.width}.png`)});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'21-question preview fits viewport');
      await page.getByRole('button',{name:'Import',exact:true}).click();
      await page.getByText('Import preview',{exact:true}).waitFor({state:'detached'});
      assert.equal(calls.at(-1).questions.length,21);
      calls.at(-1).questions.forEach((q,index)=>{assert.equal(q.questionType,'integer');assert.deepEqual(q.options,[]);assert.equal(q.answerMin,moleConceptAnswers[index]);assert.equal(q.answerMax,moleConceptAnswers[index]);assert.equal(q.correctAnswer,null);});
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('Visual QA directory: '+directory);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
