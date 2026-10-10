import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('actual reported builder visually edits question/options/solution and saves HTML/math/images safely', {timeout:120000}, async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-rich-editor-'));
 const mocks={
  '@/contexts/AuthContext':'const user={id:1,status:"active",role:"super_admin",fullName:"Admin"};export const useAuth=()=>({user});',
  '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
  '@/components/ui/PremiumWhiteLoader':'export const PremiumWhiteLoader=()=>null;',
  '@/lib/api-origin':'export const buildApiUrl=path=>path;',
  '@/lib/admin-exam-selection':'export const persistAdminExam=()=>{};export const readAdminExamQuery=()=>"";export const readAdminExamSelection=()=>"gate";',
 };
 await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Route}from'wouter';import{TooltipProvider}from'./src/components/ui/tooltip';import Page from'./src/pages/admin/QuestionBank';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TooltipProvider><Route path="/admin/question-bank/exam/:examKey/subject/:subjectId/chapter/:chapterId"><Page/></Route></TooltipProvider></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const app=await readFile(path.join(directory,'app.js')),css=await readFile(path.join(directory,'app.css'));
 const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
 const siteCss=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><rect width="320" height="80" fill="white"/><text x="20" y="45" fill="black">Hall effect circuit image</text></svg>';
 const image='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
 let questions,reports,saved;
 const reset=()=>{
  questions=[{id:1,question:`<p>A sample of silicon is doped with 10<sup>16</sup> boron atoms per cm<sup>3</sup>. Width <em>W</em> is 10<sup>−2</sup> cm.</p><p><img src="${image}" alt="Circuit"></p><p>Boolean $\\overline{A+B} \\oplus C$.</p>`,questionType:'mcq',options:['<p>1.63 mV</p>','<p>1.98 mV</p>','<p>2.12 mV</p>','<p>2.19 mV</p>'],correctAnswer:3,correctAnswerMulti:[],points:1,difficulty:'hard',topicTag:'Hall Effect',explanation:`<p>Solution: 10<sup>−3</sup> and $\\frac{1}{2}$.</p><p><img src="${image}" alt="Solution diagram"></p>`,chapterId:1},{id:201,question:'Other reported question',questionType:'mcq',options:['one','two','three','four'],correctAnswer:0,correctAnswerMulti:[],points:1,difficulty:'medium',explanation:'Other solution',chapterId:2}];
  reports=questions.map(q=>({id:q.id,questionId:q.id,questionText:q.question,examKey:'gate',subjectId:1,chapterId:q.chapterId,subjectTitle:'EDC',chapterTitle:q.chapterId===1?'Basics of SC Physics':'Other chapter',reporterName:'Student',status:'open',reason:'Fix question'}));saved=null;
 };reset();
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://test'),p=url.pathname;
  const send=(type,value)=>{res.setHeader('Content-Type',type);res.end(value);};const json=value=>send('application/json',JSON.stringify(value));
  if(p==='/app.js')return send('application/javascript',app);if(p==='/app.css')return send('text/css',css);if(p==='/site.css')return send('text/css',siteCss);
  if(req.method==='PATCH'){
   let raw='';for await(const part of req)raw+=part;const id=Number(p.split('/').at(-1));saved={id,payload:JSON.parse(raw)};
   Object.assign(questions.find(q=>q.id===id),saved.payload);reports=reports.filter(r=>r.questionId!==id);return json({ok:true});
  }
  if(p.endsWith('/reports'))return json({reports,nextCursor:null});
  if(p.endsWith('/exams'))return json([{key:'gate',label:'GATE EC',subjectCount:1,chapterCount:2,questionCount:2}]);
  if(p.endsWith('/structure'))return json({exam:{key:'gate',label:'GATE EC'},subjects:[{id:1,title:'EDC',chapters:[{id:1,title:'Basics of SC Physics',questionCount:1,targetQuestions:1},{id:2,title:'Other chapter',questionCount:1,targetQuestions:1}]}]});
  if(p.endsWith('/image')){await new Promise(resolve=>setTimeout(resolve,1000));return json({imageData:null,optionImages:[]});}
  if(p.endsWith('/questions')){const id=url.searchParams.has('questionId')?Number(url.searchParams.get('questionId')):null;if(id!==null)assert.ok([1,201].includes(id),'Only requested question loads');const chapter=Number(p.split('/').at(-2));return json({questions:questions.filter(q=>id===null?q.chapterId===chapter:q.id===id).map(q=>({...q,reports:reports.filter(r=>r.questionId===q.id),openReportCount:reports.filter(r=>r.questionId===q.id).length}))});}
  if(p.startsWith('/api/'))return json({});
  return send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  for(const variant of [{width:1440,height:1000,dark:false},{width:1440,height:1000,dark:true},{width:390,height:844,dark:true}]){
   reset();console.log('Checking visual builder',variant);const context=await browser.newContext({viewport:{width:variant.width,height:variant.height}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/admin/question-bank/exam/gate/subject/1/chapter/1?questionId=1');
   const question=page.getByRole('textbox',{name:'Question',exact:true}),solution=page.getByRole('textbox',{name:'Teacher solution',exact:true});
   await question.locator('img').waitFor();if(variant.dark)await page.evaluate(()=>document.documentElement.classList.add('dark'));
   assert.equal(await question.locator('sup').count(),3);assert.equal(await question.locator('em').innerText(),'W');
   assert.equal(await question.locator('.katex').count(),1);assert.equal(await solution.locator('.katex').count(),1);
   assert.ok(await question.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
   assert.doesNotMatch(await question.innerText(),/<p>|base64|<img|\$/);
   // Several separate keyboard events prove controlled updates do not reset the caret.
   const end=async locator=>{await locator.evaluate(el=>{el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);});};
   await end(question);await page.keyboard.type(' Fixed here.',{delay:15});
   assert.match(await question.innerText(),/Fixed here\.$/);assert.equal(await question.locator('img').count(),1);
   await page.waitForTimeout(1100);assert.match(await question.innerText(),/Fixed here\.$/,'late image metadata cannot overwrite in-progress visual edits');
   const option=page.getByRole('textbox',{name:'Option A',exact:true});await end(option);await page.keyboard.type(' updated');
   await end(solution);await page.keyboard.type(' Verified.');
   assert.match(await solution.innerText(),/Verified\.$/);assert.equal(await solution.locator('img').count(),1);
   // Formatting uses the actual selected text, preserving its selection across toolbar focus.
   await question.evaluate(el=>{el.focus();const text=el.querySelector('p').firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,8);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   const toolbar=page.getByRole('toolbar',{name:'Question formatting'});await toolbar.getByRole('button',{name:'Bold',exact:true}).click();
   assert.equal(await question.locator('b,strong').first().innerText(),'A sample');
   await page.getByRole('button',{name:'B',exact:true}).click();await page.getByRole('button',{name:'D',exact:true}).click();
   assert.match(await option.innerText(),/updated/,'answer selection must not reset rich edits');
   // Edit rendered math, not flattened HTML or its duplicated MathML content.
   console.log('Editing formula');await question.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'before-formula.png'),fullPage:true});await question.locator('.katex-html .mord').first().dblclick();const dialog=page.getByRole('dialog');await dialog.waitFor();
   await dialog.getByRole('textbox',{name:'Formula notation'}).fill('\\overline{AB} \\oplus D');await dialog.getByRole('button',{name:'Apply formula'}).click();
   assert.equal(await question.locator('annotation').textContent(),'\\overline{AB} \\oplus D');assert.equal(await question.locator('.overline-line').count(),1);
   await toolbar.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await question.locator('annotation').textContent(),'\\overline{A+B} \\oplus C');
   await toolbar.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await question.locator('annotation').textContent(),'\\overline{AB} \\oplus D');
   // A pasted HTML fragment renders safely; scripts/handlers cannot enter the document or payload.
   await end(question);
   await question.evaluate(el=>{const data=new DataTransfer();data.setData('text/html','<p onclick="window.__bad=true">Pasted<sup>2</sup></p><script>window.__bad=true</script><img src="javascript:alert(1)" onerror="window.__bad=true">');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
   assert.equal(await question.locator('[onclick],[onerror],script').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.__bad)),false);
   // Existing external "Add multiple images" controls also refresh the actual editor.
   console.log('Checking external images');const questionBox=question.locator('..').locator('..');
   await questionBox.locator('input[type=file][multiple]').last().setInputFiles({name:'extra.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
   await page.waitForFunction(()=>document.querySelector('[role=textbox][aria-label=Question]').querySelectorAll('img[src^="data:image"]').length===2);
   const validImages=question.locator('img[src^="data:image"]');await validImages.last().click();await toolbar.getByRole('button',{name:'Remove selected image'}).click();
   assert.equal(await validImages.count(),1);await toolbar.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await validImages.count(),2);
   await validImages.first().click();await toolbar.getByRole('button',{name:'Replace selected image'}).click();
   const replacement='data:image/svg+xml;base64,'+Buffer.from(svg.replace('Hall effect','Replacement')).toString('base64');
   await toolbar.locator('input[type=file]').setInputFiles({name:'replacement.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg.replace('Hall effect','Replacement'))});
   await page.waitForFunction(src=>document.querySelector('[role=textbox][aria-label=Question] img').getAttribute('src')===src,replacement);
   await toolbar.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await validImages.first().getAttribute('src'),image);
   await toolbar.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await validImages.first().getAttribute('src'),replacement);
   const box=await question.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=variant.width+1,'visual editor fits viewport without horizontal clipping');
   await question.locator('..').screenshot({path:path.join(directory,`question-${variant.width}-${variant.dark?'dark':'light'}.png`)});
   await page.screenshot({path:path.join(directory,`builder-${variant.width}-${variant.dark?'dark':'light'}.png`),fullPage:true});
   console.log('Saving question');await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByRole('textbox',{name:'Question',exact:true}).filter({hasText:'Other reported question'}).waitFor();
   assert.equal(saved.id,1);assert.match(saved.payload.question,/Fixed here\./);assert.match(saved.payload.question,/annotation/);assert.match(saved.payload.question,/overline/);
   assert.doesNotMatch(saved.payload.question,/onerror|onclick|javascript:|<script|contenteditable|data-editor-selected/);
   assert.match(saved.payload.options[0],/updated/);assert.match(saved.payload.explanation,/Verified\./);assert.match(saved.payload.explanation,/data:image/);
   assert.match(saved.payload.question,/<(?:b|strong)>A sample<\//);
   assert.equal(saved.payload.correctAnswer,3,'letter answer remains independent of rich editing');
   await page.goto(origin+'/admin/question-bank/exam/gate/subject/1/chapter/1');await question.locator('annotation').waitFor({state:'attached'});
   assert.match(await question.innerText(),/Fixed here\./);assert.equal(await question.locator('annotation').textContent(),'\\overline{AB} \\oplus D');
   assert.match(await solution.innerText(),/Verified\./);assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Visual builder screenshots:',directory);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
