import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('weekly smooth curve preserves daily dots, hides modes/years and uses no extra requests on desktop/mobile', {timeout:60000}, async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-weekly-six-hour-'));
 await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Chart from'./src/components/student/WeeklyActivityChart';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><main style={{padding:12,maxWidth:1100,margin:'auto'}}><Chart studentId={2}/></main></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},plugins:[{name:'fixture-api',setup(b){b.onResolve({filter:/^@\/lib\/api$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:"export const api={get:async path=>(await fetch('/api'+path)).json()};"}));}}]});
 const app=await readFile(path.join(directory,'app.js'));
 const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
 const siteCss=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
 const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
 const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const currentWeek=shift(today,-6);
 const requests=[];let empty=false,archived=false;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://test');
  const send=(type,value)=>{res.setHeader('Content-Type',type);res.end(value);};
  if(url.pathname==='/app.js')return send('application/javascript',app);
  if(url.pathname==='/site.css')return send('text/css',siteCss);
  if(url.pathname==='/api/student/activity/week'){
   let start=url.searchParams.get('start');requests.push(start);
   const first=shift(currentWeek,archived?-14:-7),last=currentWeek;
   if(!empty)start=start<first?first:start>last?last:start;
   return send('application/json',JSON.stringify({start,end:shift(start,6),today,currentWeek,firstAvailableWeek:empty?null:first,lastAvailableWeek:empty?null:last,trackingStartedAt:shift(currentWeek,-28)+'T00:00:00Z',days:Array.from({length:7},(_,i)=>{
    const date=shift(start,i),available=date<=today && i!==3,n=[0,28,5,0,18,3,12][i];
    return {date,available,partial:false,correct:available?(empty?0:n):null,wrong:available?(empty?0:i):null,unanswered:available?(empty?0:7-i):null,seconds:available?(empty?0:n*61):null,ungraded:0};
   })}));
  }
  send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  for(const [width,dark] of [[1440,false],[390,true],[320,false]]){
   const context=await browser.newContext({viewport:{width,height:800}});
   if(dark)await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('dark')));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin);await page.getByText('Weekly practice activity',{exact:true}).waitFor();
   assert.equal(requests.at(-1),shift(today,-6),'default request covers today and the previous six days');
   const currentDots=Array.from({length:7},(_,i)=>i).filter(i=>shift(currentWeek,i)<=today && i!==3).length*5;
   await page.waitForFunction(n=>document.querySelectorAll('.recharts-line-dot').length===n,currentDots/5);
   assert.equal(await page.getByRole('checkbox',{name:'Total answered',exact:true}).isChecked(),true);
   assert.equal(await page.locator('.recharts-line').count(),1,'only total is plotted by default');
   for(const name of ['Correct','Wrong','Visited, not answered','Time spent'])assert.equal(await page.getByRole('checkbox',{name,exact:true}).isChecked(),false);
   const chartBox=await page.locator('[aria-label="Daily activity line chart"]').boundingBox();
   const sundayBox=await page.locator('.recharts-xAxis').getByText('Sun',{exact:true}).boundingBox();
   assert.ok(sundayBox.x+sundayBox.width<=chartBox.x+chartBox.width,'Sunday label is not clipped when the time axis is hidden');
   await page.screenshot({path:path.join(directory,`${width}-total-default.png`),fullPage:true});
   for(const name of ['Correct','Wrong','Visited, not answered','Time spent'])await page.getByRole('checkbox',{name,exact:true}).locator('..').click();
   await page.waitForFunction(n=>document.querySelectorAll('.recharts-line-dot').length===n,currentDots);
   await page.getByRole('button',{name:'Previous 7 days'}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.recharts-line-dot').length===30);
   assert.equal(await page.getByRole('button',{name:'Previous 7 days'}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Next 7 days'}).isDisabled(),false);
   await page.waitForFunction(()=>[...document.querySelectorAll('.recharts-line-curve')].every(el=>el.getAttribute('d').includes('C')));
   for(const name of ['Correct','Wrong','Visited, not answered','Time spent','Total answered']){
    const label=page.getByRole('checkbox',{name,exact:true}).locator('..');
    assert.equal(await label.getAttribute('title'),null,'no delayed native-title duplicate');
    await label.hover();
    await page.getByRole('tooltip').waitFor({state:'attached',timeout:400});
    assert.equal(await page.getByRole('tooltip').textContent(),name,'each icon names its parameter immediately');
    // Radix calls even a 0ms first-hover timer "delayed-open"; the bounded
    // wait above catches its normal 700ms delay without relying on that flag.
    assert.match(await label.getAttribute('data-state'),/^(instant|delayed)-open$/);
    assert.equal(await page.locator('[data-radix-popper-content-wrapper]').evaluate(node=>getComputedStyle(node.firstElementChild).animationName),'none','tooltip does not fade or zoom in');
    if(name==='Correct')await page.screenshot({path:path.join(directory,`${width}-instant-tooltip.png`),fullPage:true});
    await page.mouse.move(2,2);
    await page.getByRole('tooltip').waitFor({state:'detached'});
   }
   const positions=()=>page.locator('.recharts-line-dot').evaluateAll(dots=>dots.map(dot=>[dot.getAttribute('cx'),dot.getAttribute('cy')]));
   const exact=await positions(),reads=requests.length;
   assert.equal(await page.getByRole('button',{name:'Exact',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'Smooth',exact:true}).count(),0);
   assert.doesNotMatch(await page.locator('[aria-live="polite"]').textContent(),/\d{4}/);
   await page.locator('.recharts-line').last().locator('.recharts-line-dot').nth(1).hover();
   await page.locator('.recharts-tooltip-wrapper').getByText('28m 28s',{exact:true}).waitFor();
   assert.equal(await page.locator('.recharts-tooltip-wrapper').getByText('28',{exact:true}).count(),1);
   assert.equal(await page.locator('.recharts-tooltip-wrapper').getByText('29',{exact:true}).count(),1,'total excludes six unanswered visits');
   await page.mouse.move(2,2);
   const svg=await page.locator('.recharts-surface').boundingBox();
   const dots=await page.locator('.recharts-line').last().locator('.recharts-line-dot').evaluateAll(nodes=>nodes.map(n=>({x:Number(n.getAttribute('cx')),y:Number(n.getAttribute('cy'))})));
   await page.mouse.move(svg.x+dots[0].x+(dots[1].x-dots[0].x)/4,svg.y+70);
   await page.locator('.recharts-tooltip-wrapper').getByText(/Estimated$/).waitFor();
   await page.locator('.recharts-tooltip-wrapper').getByText('≈ 4.53',{exact:true}).waitFor();
   await page.mouse.move(2,2);
   assert.deepEqual(await positions(),exact);
   assert.equal(requests.length,reads,'six-hour calculation makes no new request');
   await page.screenshot({path:path.join(directory,`${width}-smooth.png`),fullPage:true});
   const time=page.getByRole('checkbox',{name:'Time spent'});
   await time.locator('..').click();assert.equal(await time.isChecked(),false);assert.equal(await page.locator('.recharts-line').count(),4);
   await time.locator('..').click();assert.equal(await time.isChecked(),true);assert.equal(await page.locator('.recharts-line').count(),5);
   await page.getByRole('button',{name:'Next 7 days'}).focus();
   await time.focus();
   await page.getByRole('tooltip').waitFor({state:'attached',timeout:400});
   assert.equal(await page.getByRole('tooltip').textContent(),'Time spent','keyboard focus also explains the metric');
   await page.keyboard.press('Space');assert.equal(await time.isChecked(),false);
   await page.keyboard.press('Space');assert.equal(await time.isChecked(),true);
   assert.deepEqual(await positions(),exact);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'compact controls do not overflow mobile');
   await page.getByRole('button',{name:'Next 7 days'}).click();
   await page.waitForFunction(n=>document.querySelectorAll('.recharts-line-dot').length===n,currentDots);
   assert.equal(await page.getByRole('button',{name:'Next 7 days'}).isDisabled(),true,'last available week is the upper bound');
   assert.deepEqual(errors,[]);await context.close();
  }
  archived=true;const historyContext=await browser.newContext();const historyPage=await historyContext.newPage();await historyPage.goto(origin);
  await historyPage.waitForFunction(()=>document.querySelectorAll('.recharts-line-dot').length>0);
  assert.equal(await historyPage.getByRole('button',{name:'Next 7 days'}).isDisabled(),true,'current range still ends today when earlier activity exists');
  await historyPage.getByRole('button',{name:'Previous 7 days'}).click();
  await historyPage.getByRole('button',{name:'Last 7 days',exact:true}).waitFor();
  assert.equal(await historyPage.getByRole('button',{name:'Previous 7 days'}).isDisabled(),false);
  await historyPage.getByRole('button',{name:'Last 7 days',exact:true}).click();
  await historyPage.waitForFunction(()=>!document.body.textContent.includes('Last 7 days'));
  assert.equal(await historyPage.getByRole('button',{name:'Next 7 days'}).isDisabled(),true);await historyContext.close();
  empty=true;archived=false;const context=await browser.newContext();const page=await context.newPage();await page.goto(origin);
  await page.waitForFunction(()=>document.querySelectorAll('.recharts-line-dot').length>0);
  assert.equal(await page.getByRole('button',{name:'Previous 7 days'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Next 7 days'}).isDisabled(),true);
  await context.close();
  console.log('Weekly six-hour smooth screenshots:',directory);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
