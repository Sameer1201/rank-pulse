import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('real PYQ list shows standalone/inline/lazy images, SVG and tables without clipping, on desktop/mobile/offline', {timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-pyq-image-preview-'));
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220"><rect width="900" height="220" fill="white"/><text x="24" y="42" font-size="24" fill="black">A digital communication system has the following block diagram.</text><rect x="24" y="80" width="230" height="70" fill="none" stroke="black"/><text x="42" y="122" font-size="22" fill="black">Input signal</text><line x1="254" y1="115" x2="360" y2="115" stroke="black"/><rect x="360" y="80" width="230" height="70" fill="none" stroke="black"/><text x="378" y="122" font-size="22" fill="black">Encoder</text><text x="24" y="195" font-size="22" fill="black">Determine the output bit rate in bits per second.</text></svg>';
  const image='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
  const fixtures=[
    {question:'...',imageData:image},
    {question:`<div class="rich-source-content"><img src="${image}" alt="Inline question"></div>`},
    {question:`<p>Use the diagram to determine the bit rate.</p><img data-src="${image}" alt="Lazy question">`},
    {question:'Determine the output of the following encoder.',imageData:image},
    {question:`<img src="${image}" alt="Already embedded">`,imageData:image},
    {question:'<p>Use this signal diagram.</p><svg width="300" height="100" viewBox="0 0 300 100"><rect width="300" height="100" fill="white"/><path d="M0 80 L60 80 L60 20 L120 20 L120 80 L180 80" stroke="black" fill="none"/></svg>'},
    {question:'<p>Determine the encoded output from this table.</p><table><tr><th>Input</th><th>Output</th></tr><tr><td>00</td><td>10</td></tr><tr><td>01</td><td>11</td></tr><tr><td>10</td><td>00</td></tr></table>'},
    {question:'A communication system uses a pulse code modulation encoder. '.repeat(10)},
    {question:'...'},
    {question:'<div class="rich-source-content">\n  \n  \n  <div>\n    \n    <p>For a digital communication channel, determine the bit rate.</p>\n  </div>\n</div>'},
  ];
  const questions=fixtures.map((row,index)=>({id:65+index,exam:'GATE EC',subject:'Communication Systems',chapter:'Digital Communication Systems',year:2026-index,questionNumber:65+index,marks:'1 mark',questionType:'mcq',options:['A','B'],isSaved:false,...row}));
  const resolveDir=new URL('..',import.meta.url).pathname;
  await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QuestionPreview}from'./src/pages/student/PYQ';window.__events=[];const questions=${JSON.stringify(questions)};createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'auto',padding:16}}><h1>Digital Communication Systems</h1><div className="space-y-3">{questions.map((question,index)=><section data-testid={'preview-'+question.id} key={question.id}><QuestionPreview question={question} index={index} onOpen={()=>window.__events.push('open:'+question.id)} onSave={id=>window.__events.push('save:'+id)} /></section>)}</div></main>);`,resolveDir,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},loader:{'.css':'empty'},plugins:[{name:'real-preview',setup(b){b.onLoad({filter:/\/pages\/student\/PYQ\.tsx$/},async a=>({contents:(await readFile(a.path,'utf8'))+'\nexport {QuestionPreview};',loader:'tsx',resolveDir:path.dirname(a.path)}));}}]});
  const app=await readFile(path.join(directory,'app.js'));
  const assetsDir=new URL('../dist/public/assets/',import.meta.url),names=await readdir(assetsDir);
  const css=await readFile(new URL(names.find(f=>/^index-.*\.css$/.test(f)),assetsDir));
  const server=createServer((req,res)=>{
    const p=new URL(req.url,'http://test').pathname,send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);};
    if(p==='/app.js')return send('application/javascript',app);
    if(p==='/site.css')return send('text/css',css);
    send('text/html','<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin);await page.getByTestId('preview-73').waitFor();
      for(let id=65;id<=69;id++){
        const card=page.getByTestId('preview-'+id),img=card.locator('img');
        assert.equal(await img.count(),1,'question image appears once');
        await img.scrollIntoViewIfNeeded();
        await img.evaluate(image=>image.decode());
        const box=await img.boundingBox(),cardBox=await card.boundingBox();
        assert(box&&box.height>40&&box.width>200,'image question is visibly rendered');
        assert(box.x>=cardBox.x&&box.x+box.width<=cardBox.x+cardBox.width+1,'image fits card');
        assert(box.y+box.height<=cardBox.y+cardBox.height,'image is not clipped by line clamp');
        assert.equal(await img.evaluate(image=>getComputedStyle(image).display==='none'),false);
      }
      assert.doesNotMatch(await page.getByTestId('preview-65').innerText(),/\.\.\./,'image-only placeholder is not the preview');
      assert((await page.getByTestId('preview-70').locator('.rich-question-content svg').boundingBox()).height>=100,'SVG figure visible');
      const table=page.getByTestId('preview-71').locator('table');
      await table.scrollIntoViewIfNeeded();
      assert((await table.boundingBox()).height>60,'all table rows are shown');
      assert.equal(await page.getByTestId('preview-72').locator('.rich-question-content').evaluate(node=>getComputedStyle(node).webkitLineClamp),'2','plain text remains a compact preview');
      await page.getByTestId('preview-73').getByText('Open question to view its content.').waitFor();
      const formatted=page.getByTestId('preview-74').locator('.rich-question-content');
      await formatted.scrollIntoViewIfNeeded();
      const visibleParagraph=await formatted.evaluate(node=>{const root=node.getBoundingClientRect(),text=node.querySelector('p').getBoundingClientRect();return Math.min(root.bottom,text.bottom)-Math.max(root.top,text.top);});
      assert(visibleParagraph>=12,'indented source HTML displays the question rather than clamping empty source lines');
      await page.getByTestId('preview-65').getByRole('button',{name:'Save',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.__events),['save:65']);
      await page.getByTestId('preview-65').locator('img').click();
      assert.deepEqual(await page.evaluate(()=>window.__events),['save:65','open:65']);
      await context.setOffline(true);
      assert(await page.getByTestId('preview-65').locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),'cached image remains visible offline');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:path.join(directory,`images-${viewport.width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('Visual QA directory: '+directory);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
