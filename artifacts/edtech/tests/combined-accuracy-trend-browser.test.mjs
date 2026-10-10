import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('combined accuracy chart uses bounded real dates, zero accuracy and gaps on desktop/mobile',{timeout:60000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-combined-accuracy-'));
 await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import Chart from'./src/components/student/CombinedAccuracyTrend';const root=createRoot(document.getElementById('root'));window.renderHistory=history=>root.render(<main style={{padding:12,maxWidth:1100,margin:'auto'}}><Chart history={history}/></main>);window.renderHistory([]);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname});
 const app=await readFile(path.join(directory,'app.js'));
 const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
 const css=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
 const server=createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');return res.end(app);}
  if(req.url==='/site.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const row=(day,accuracy)=>({date:`2026-09-${String(day).padStart(2,'0')}`,available:true,accuracy,correct:accuracy===null?0:1,wrong:0,seconds:0,unanswered:0});
 const history=[row(1,null),row(2,0),row(3,50),row(4,null),row(5,100),row(6,75),row(7,null)];
 try{
  for(const [width,dark] of [[1440,false],[390,true],[320,false]]){
   const context=await browser.newContext({viewport:{width,height:800}});
   if(dark)await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('dark')));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   const chart=page.locator('[aria-label="Combined accuracy trend"]');
   await chart.getByText('Combined accuracy trend',{exact:true}).waitFor();
   assert.equal(await chart.locator('.recharts-wrapper').count(),0,'no data means no fabricated dates');
   await page.evaluate(rows=>window.renderHistory(rows),history);
   await page.waitForFunction(()=>document.querySelectorAll('.recharts-line-dot').length===4);
   assert.match(await chart.textContent(),/2 Sept 2026 – 6 Sept 2026/);
   const dates=await chart.locator('.recharts-xAxis').textContent();
   assert.doesNotMatch(dates,/1 Sept|7 Sept/,'outside dates do not appear on the axis');
   assert.match(dates,/2 Sept/);
   const curve=await chart.locator('.recharts-line-curve').getAttribute('d');
   assert.equal((curve.match(/M/g)||[]).length,2,'interior missing day remains a break, not connected');
   const points=await chart.locator('.recharts-line-dot').evaluateAll(nodes=>nodes.map(n=>({x:Number(n.getAttribute('cx')),y:Number(n.getAttribute('cy'))})));
   assert.ok(points[0].y>points[1].y,'zero accuracy is a real rendered point');
   await chart.locator('.recharts-line-dot').first().hover();
   await chart.locator('.recharts-tooltip-wrapper').getByText('0%',{exact:true}).waitFor();
   await chart.locator('.recharts-tooltip-wrapper').getByText('2 Sept 2026 · IST',{exact:true}).waitFor();
   await chart.getByText('Combined accuracy trend',{exact:true}).hover();
   await page.screenshot({path:path.join(directory,`${width}-bounded.png`),fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal mobile overflow');
   await page.evaluate(rows=>window.renderHistory(rows),[row(1,null),row(2,0),row(3,null)]);
   await page.waitForFunction(()=>document.querySelectorAll('.recharts-line-dot').length===1);
   assert.match(await chart.textContent(),/2 Sept 2026 · IST/);
   assert.doesNotMatch(await chart.locator('.recharts-xAxis').textContent(),/1 Sept|3 Sept/);
   await page.evaluate(rows=>window.renderHistory(rows),[row(1,null),row(2,null)]);
   await chart.getByText('No daily accuracy data yet.',{exact:true}).waitFor();
   assert.equal(await chart.locator('.recharts-wrapper').count(),0);
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Combined accuracy screenshots:',directory);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
