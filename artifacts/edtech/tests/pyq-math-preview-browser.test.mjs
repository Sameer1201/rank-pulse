import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';
import katex from 'katex';

test('actual PYQ preview renders isotope/fraction math once with no visible LaTeX, preserves status/save/open on desktop/mobile', {timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-pyq-math-preview-'));
  const math=tex=>katex.renderToString(tex,{output:'htmlAndMathml',throwOnError:true});
  const stems=[
    'Among the following, the most stable isotope of radioactive decay is:',
    `${math(String.raw`^{210}\mathrm{Bi}`)} undergoes ${math(String.raw`\beta^-`)} decay to ${math(String.raw`\tfrac18`)} of its initial amount in 15 days. The time required for its decay to ${math(String.raw`\tfrac1{44}`)} of its initial amount is _____ days (up to two decimal places).`,
    `For radioactive isotope ${math(String.raw`^{131}\mathrm{I}`)}, the time required for 50% disintegration is 8 days. The time required for 99.9% disintegration of 5.5 g of ${math(String.raw`^{131}\mathrm{I}`)} is _____ days (up to one decimal place).`,
    `The total number of ${math(String.raw`\alpha`)} and ${math(String.raw`\beta^-`)} particles emitted in the radioactive decay ${math(String.raw`{}^{238}_{92}\mathrm{U}\rightarrow{}^{210}_{82}\mathrm{Pb}`)} is _____.`,
    `Given an initial mass of 1mg of radioactive ${math(String.raw`{}^{60}_{27}\mathrm{Co}`)} with half-life 5.27 years, the amount disintegrated in 1 year (rounded off to two decimal places) is _____ mg.`,
    String.raw`A bare isotope ^{210}\mathrm{Bi}, a fraction \frac{1}{8}, and \beta^- decay.`,
  ];
  const questions=stems.map((stem,i)=>({id:i+31,exam:'JAM Chemistry',subject:'Physical Chemistry',chapter:'Nuclear Chemistry',year:2016+i,sourceName:'GATE',questionNumber:i+1,marks:'1 mark',questionType:i===0?'mcq':'integer',options:i===0?['A','B']:[],question:i===5?stem:`<div class="rich-source-content">\n  \n  <div>\n    ${stem}\n  </div>\n</div>`,progress:{attemptCount:1,lastIsCorrect:i!==0,correctCount:i===0?0:1},isSaved:false}));
  const resolveDir=new URL('..',import.meta.url).pathname;
  await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QuestionPreview}from'./src/pages/student/PYQ';window.__events=[];const questions=${JSON.stringify(questions)};createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'auto',padding:16}}><h1>Questions</h1><div className="space-y-3">{questions.map((question,index)=><section data-testid={'preview-'+question.id} key={question.id}><QuestionPreview question={question} index={index} onOpen={()=>window.__events.push('open:'+question.id)} onSave={id=>window.__events.push('save:'+id)} /></section>)}</div></main>);`,resolveDir,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.css':'empty'},plugins:[{name:'expose-real-preview-for-test',setup(b){b.onLoad({filter:/\/pages\/student\/PYQ\.tsx$/},async a=>({contents:(await readFile(a.path,'utf8'))+'\nexport {QuestionPreview};',loader:'tsx',resolveDir:path.dirname(a.path)}));}}]});
  const app=await readFile(path.join(directory,'app.js'));
  const assetsDir=new URL('../dist/public/assets/',import.meta.url);
  const cssName=(await readdir(assetsDir)).find(f=>/^index-.*\.css$/.test(f));const css=await readFile(new URL(cssName,assetsDir));
  const mathCssName=(await readdir(assetsDir)).find(f=>/^rich-question-content-.*\.css$/.test(f));const mathCss=await readFile(new URL(mathCssName,assetsDir));
  const server=createServer(async(req,res)=>{
    const p=new URL(req.url,'http://test').pathname;
    const send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);};
    if(p==='/app.js')return send('application/javascript',app);
    if(p==='/site.css')return send('text/css',css);
    if(p==='/assets/math.css')return send('text/css',mathCss);
    if(/^\/assets\/KaTeX_[\w.-]+$/.test(p))return send('font/woff2',await readFile(new URL(p.slice(8),assetsDir)));
    send('text/html','<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/assets/math.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin);await page.getByTestId('preview-36').waitFor();await page.evaluate(()=>document.fonts.ready);
      const isotope=page.getByTestId('preview-32');assert.equal(await isotope.locator('.katex').count(),4);assert.equal(await isotope.locator('math mfrac').count(),2);
      assert.equal(await page.getByTestId('preview-33').locator('.katex').count(),2);assert.equal(await page.getByTestId('preview-35').locator('math msubsup').count(),1);
      const visibleSource=await page.locator('.rich-question-content').evaluateAll(roots=>roots.map(root=>{const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let text='';for(let node=walker.nextNode();node;node=walker.nextNode())if(!node.parentElement.closest('.katex, math'))text+=node.textContent;return text;}).join(' '));
      assert.doesNotMatch(visibleSource,/\\(?:mathrm|tfrac|frac|beta|alpha|rightarrow)|\^\{/);
      assert.equal(await page.getByTestId('preview-31').getByLabel('Wrong',{exact:true}).count(),1);assert.equal(await isotope.getByLabel('Correct',{exact:true}).count(),1);
      await isotope.getByRole('button',{name:'Save',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__events),['save:32']);
      await isotope.locator('.rich-question-content').click();assert.deepEqual(await page.evaluate(()=>window.__events),['save:32','open:32']);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page fits mobile width');
      const semantic=await isotope.locator('.katex-mathml').first().boundingBox(),rendered=await isotope.locator('.katex-html').first().boundingBox();
      const previewBox=await isotope.locator('.rich-question-content').boundingBox();
      assert(rendered&&rendered.y>=previewBox.y&&rendered.y<previewBox.y+previewBox.height,'indented HTML does not clip the opening formula out of the preview');
      await page.screenshot({path:path.join(directory,`preview-${viewport.width}.png`),fullPage:true});
      assert((!semantic||semantic.width<=2)&&rendered?.width>10,'only visual formula occupies layout; hidden semantic LaTeX is not displayed');assert.deepEqual(errors,[]);await context.close();
    }
    console.log('Visual QA directory: '+directory);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
