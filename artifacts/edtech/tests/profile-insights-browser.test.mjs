import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';
import { fixture } from '../../api-server/tests/helpers/worker-fixture.mjs';

test('student insights show Q Bank/PYQ names, totals and a readable header in both themes', {timeout:60000}, async(t)=>{
  const f=fixture();f.sql.exec(`PRAGMA foreign_keys=OFF;
    INSERT INTO subjects(id,title) VALUES(39,'EDC');
    INSERT INTO chapters(id,subject_id,title) VALUES(295,39,'Basics of SC Physics'),(296,39,'Hall Effect');
    INSERT INTO question_bank_question_progress(question_id,student_id,class_id,subject_id,chapter_id,attempt_count,correct_count)
    VALUES(1000,2,1,39,295,10,7),(1001,2,1,39,296,5,0);`);
  f.sql.exec(`CREATE TABLE jam_pyq_submissions(student_id,question_id,is_correct);`);
  Object.assign(f.env,{PYQ_PROXY_URL:'https://fixture-gate.example.test',PYQ_PROXY_TOKEN:'fake-token',JAM_PYQ_PROXY_URL:'https://fixture-jam.example.test',JAM_PYQ_PROXY_TOKEN:'fake-token'});
  t.mock.method(globalThis,'fetch',async url=>Response.json({ok:true,results:new URL(url).hostname.includes('gate')
    ? [{question_id:1,subject:'Digital Electronics',chapter:'Logic Gates',attempt_count:3,correct_count:2}]
    : [{question_id:1,subject:'Organic Chemistry',chapter:'Name Reactions',attempt_count:2,correct_count:1}]}));
  const response=await f.request('/api/users/2/profile-insights',undefined,{method:'GET',userId:1});
  assert.equal(response.status,200);const insights=await response.json();f.sql.close();
  const dir=await mkdtemp(path.join(tmpdir(),'rank-profile-insights-'));
  await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{Dialog,DialogContent,DialogDescription}from'./src/components/ui/dialog';import{StudentProfileInsightsHeader}from'./src/components/student/StudentProfileInsightsHeader';import{StudentProfileInsightsPanel}from'./src/components/student/StudentProfileInsightsPanel';const insights=${JSON.stringify(insights)};createRoot(document.getElementById('root')).render(<Dialog open><DialogContent className="max-w-[min(calc(100vw-0.75rem),72rem)] overflow-hidden p-0"><StudentProfileInsightsHeader username="@fixture-student"/><DialogDescription className="sr-only">Student performance</DialogDescription><div className="max-h-[calc(100dvh-7rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-6"><StudentProfileInsightsPanel insights={insights} mode="full"/></div></DialogContent></Dialog>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(dir,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'}});
  const app=await readFile(path.join(dir,'app.js'));
  const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
  const css=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://test');
    if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(app);}
    if(url.pathname==='/site.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const [width,dark] of [[1440,false],[1440,true],[390,true]]){
      const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      if(dark)await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('dark')));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole('heading',{name:'Question Bank Performance',exact:true}).waitFor();
      await page.getByText('Last 4 weeks of activity',{exact:true}).waitFor();
      assert.equal(await page.getByText('Last 12 weeks of activity',{exact:true}).count(),0);
      const heatmap=page.locator('[aria-label="Study activity for the last 4 weeks"]');
      assert.equal(await heatmap.locator(':scope > div').count(),4);
      assert.equal(await heatmap.locator('[title]').count(),28);
      const table=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Subject',exact:true})}).filter({hasNot:page.getByRole('columnheader',{name:'Exam',exact:true})});
      assert.equal(await table.getByText('EDC',{exact:true}).count(),1);
      assert.equal(await table.getByText('Basics of SC Physics',{exact:true}).count(),0);
      assert.equal(await table.getByText('Hall Effect',{exact:true}).count(),0);
      assert.match(await table.textContent(),/46.7%/);
      assert.equal(await page.getByRole('columnheader',{name:'Topic',exact:true}).count(),0);
      await page.getByText('15 questions · 46.7% overall accuracy',{exact:true}).waitFor();
      const heading=page.getByRole('heading',{name:/Student profile insights/});
      const contrast=await heading.evaluate(node=>{
        const style=getComputedStyle(node),surface=getComputedStyle(node.parentElement);
        const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=s=>rgb(s).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
        const fg=luminance(style.color),bg=luminance(surface.backgroundColor);
        return {ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05),gradient:surface.backgroundImage};
      });
      assert.ok(contrast.ratio>=4.5,`header contrast ${contrast.ratio} for dark=${dark}`);
      assert.equal(contrast.gradient,'none','no unthemed pale gradient');
      await table.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(dir,`${width}-${dark?'dark':'light'}.png`),fullPage:true});
      const pyq=page.getByRole('table',{name:'PYQ performance by exam and subject'});
      await page.getByRole('heading',{name:'PYQ Performance',exact:true}).waitFor();
      assert.equal(await pyq.getByText('GATE',{exact:true}).count(),1);
      assert.equal(await pyq.getByText('JAM Chemistry',{exact:true}).count(),1);
      assert.equal(await pyq.getByText('Logic Gates',{exact:true}).count(),0);
      assert.equal(await pyq.getByText('Name Reactions',{exact:true}).count(),0);
      assert.equal(await pyq.getByText('Digital Electronics',{exact:true}).count(),1);
      assert.equal(await pyq.getByText('Organic Chemistry',{exact:true}).count(),1);
      assert.equal(await pyq.getByText('66.7%',{exact:true}).count(),1);
      assert.equal(await pyq.getByText('50%',{exact:true}).count(),1);
      await page.getByText('5 attempts · 60% overall accuracy',{exact:true}).waitFor();
      await pyq.scrollIntoViewIfNeeded();
      const pyqBox=await pyq.boundingBox();
      const dialog=await page.getByRole('dialog').boundingBox();
      assert.ok(dialog.x>=0&&dialog.x+dialog.width<=width,'modal fits the screen');
      if(width<500)assert.ok(pyqBox.width>dialog.width,'wide PYQ table has its own horizontal scroll on mobile');
      await page.screenshot({path:path.join(dir,`${width}-${dark?'dark':'light'}-pyq.png`),fullPage:true});
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('Profile insights browser screenshots:',dir);
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
