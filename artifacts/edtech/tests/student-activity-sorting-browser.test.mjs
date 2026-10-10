import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('real admin and super-admin lists sort all activity categories in both directions on desktop/mobile', {timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rankpulse-student-sort-'));
  const mocks={
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/lib/api-origin':'export const buildApiUrl=path=>path;',
    '@/components/student/StudentProfileInsightsPanel':'export const StudentProfileInsightsPanel=()=>null;',
    '@workspace/api-client-react':`import{useQuery}from'@tanstack/react-query';export const getListUsersQueryKey=()=>['users'];export const useListUsers=()=>useQuery({queryKey:['users'],queryFn:()=>fetch('/api/users?role=student').then(r=>r.json())});export const useApproveStudent=()=>({isPending:false});`,
  };
  await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Admin from'./src/pages/admin/Students';import Super from'./src/pages/super-admin/Students';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{location.pathname.startsWith('/super')?<Super/>:<Admin/>}</QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,define:{'import.meta.env':'{}'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^(@\/|@workspace\/)/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:new URL('..',import.meta.url).pathname}));}}]});
  const app=await readFile(path.join(directory,'app.js'));
  const cssName=(await readdir(new URL('../dist/public/assets',import.meta.url))).find(f=>/^index-.*\.css$/.test(f));
  const css=await readFile(new URL('../dist/public/assets/'+cssName,import.meta.url));
  const students=['Beta','Alpha','Gamma'].map((fullName,i)=>({id:i+1,fullName,username:fullName.toLowerCase(),email:fullName+'@test.invalid',status:'approved',onboardingComplete:true,createdAt:`2026-0${i+1}-01T00:00:00Z`,subject:'GATE EC',profileDetails:{address:{state:i===2?'Odisha':'Delhi'},preparation:{collegeName:'College '+(i+1)}}}));
  const metrics=[{studentId:1,activityCount:12,pyqAttempts:1,questionBankAttempts:10,testCount:1},{studentId:2,activityCount:8,pyqAttempts:5,questionBankAttempts:0,testCount:3},{studentId:3,activityCount:0,pyqAttempts:0,questionBankAttempts:0,testCount:0}];
  let unavailable=false;
  const resetRequests=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://test');
    const send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);};
    const json=value=>send('application/json',JSON.stringify(value));
    if(url.pathname==='/app.js')return send('application/javascript',app);
    if(url.pathname==='/site.css')return send('text/css',css);
    if(url.pathname==='/api/users/1/attempted-tests')return json({items:[{source:'regular',testId:41,psuId:null,title:'Mock exam',attemptCount:2,latestAttemptId:7,percentage:60,submittedAt:'2026-10-07T06:00:00Z'},{source:'psu',testId:12,psuId:4,title:'PSU exam',attemptCount:1,latestAttemptId:9,percentage:80,submittedAt:'2026-10-07T05:00:00Z'}].filter(row=>row.title.toLowerCase().includes((url.searchParams.get('search')??'').toLowerCase())),total:2,hasMore:false,psuUnavailable:false});
    if(url.pathname==='/api/users/1/test-attempts/reset') {
      let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{resetRequests.push({studentId:1,...JSON.parse(body)});json({ok:true,resetAttempts:2});});return;
    }
    if(url.pathname==='/api/users/student-activity')return json({students:unavailable?metrics.map(m=>({...m,pyqAttempts:null,activityCount:null})):metrics,unavailableSources:unavailable?['GATE PYQ']:[]});
    if(url.pathname==='/api/users')return json(url.searchParams.get('role')==='admin'?[]:students);
    if(/\/api\/users\/\d+\/profile-insights$/.test(url.pathname))return json(null);
    if(url.pathname.startsWith('/api/'))return json({});
    send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const role of ['admin','super-admin'])for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/'+role+'/students');await page.getByText(/All-time, across exams/).waitFor();
      const resetStudent=page.getByTestId('button-reset-student-tests-1');
      assert.equal(await resetStudent.count(),0,'reset icon is not exposed on the student list');
      if(role==='admin')await page.getByTestId(viewport.width===390?'button-view-profile-1':'button-view-profile-desktop-1').click();
      else await page.getByRole('button',{name:'Open Beta profile',exact:true}).click();
      assert.equal(await resetStudent.count(),0,'reset icon is not on the profile overview');
      await page.getByRole('button',{name:'Settings',exact:true}).or(page.getByRole('tab',{name:'Settings',exact:true})).click();
      assert.equal(await resetStudent.locator('svg').count(),1);assert.equal(await resetStudent.textContent(),'','settings action is icon-only');
      if(viewport.width===390)await page.screenshot({path:path.join(directory,role+'-settings-mobile.png')});
      await resetStudent.click();const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/^(Reset attempted test|Confirm test reset)$/})});await dialog.getByText('Mock exam',{exact:true}).waitFor();
      assert.ok((await dialog.textContent()).includes('Beta'));
      const before=resetRequests.length;
      await dialog.getByTestId('button-reset-test-regular-41').click();assert.equal(resetRequests.length,before,'choosing a test must not reset without confirmation');
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(resetRequests.length,before);
      await dialog.getByTestId('button-reset-test-psu-12').click();await dialog.getByTestId('button-confirm-test-reset').click();
      await dialog.getByRole('heading',{name:'Reset attempted test'}).waitFor();assert.deepEqual(resetRequests.at(-1),{studentId:1,source:'psu',testId:12,latestAttemptId:9});
      await dialog.getByTestId('button-reset-test-regular-41').click();
      if(viewport.width===390)await page.screenshot({path:path.join(directory,role+'-reset-mobile.png')});
      await dialog.getByTestId('button-confirm-test-reset').click();
      await dialog.getByRole('heading',{name:'Reset attempted test'}).waitFor();assert.deepEqual(resetRequests.at(-1),{studentId:1,source:'regular',testId:41,latestAttemptId:7});
      await dialog.getByRole('textbox',{name:'Search attempted tests'}).fill('PSU');await dialog.getByText('PSU exam',{exact:true}).waitFor();assert.equal(await dialog.getByText('Mock exam',{exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'reset dialog fits mobile and desktop');
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await page.getByRole('dialog').count(),1,'closing reset returns to student profile settings');
      await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
      assert.equal(await resetStudent.count(),0,'reset action remains absent from the list');
      const rowPrefix=role==='admin'?'row-student-':'student-row-';
      const rows=page.locator(`[data-testid^="${rowPrefix}"]`);
      const order=()=>rows.evaluateAll(els=>els.map(el=>Number(el.dataset.testid.split('-').at(-1))));
      assert.deepEqual(await order(),[1,2,3]);
      const expected={activity:[1,2,3],pyq:[2,1,3],'question-bank':[1,2,3],tests:[2,1,3],name:[3,1,2],newest:[3,2,1]};
      const directionButton=page.getByTestId('button-student-sort-direction');
      const setDirection=async(direction)=>{
        if(await directionButton.getAttribute('data-direction')!==direction)await directionButton.click();
        assert.equal(await directionButton.getAttribute('data-direction'),direction);
        assert.equal(await directionButton.textContent(),'','direction button has no visible text');
        assert.equal(await directionButton.locator('svg').count(),1);
      };
      for(const [key,desc]of Object.entries(expected)){
        await page.getByTestId('select-student-sort').selectOption(key);
        await setDirection('desc');
        assert.deepEqual(await order(),desc,role+' '+key+' desc');
        await setDirection('asc');
        assert.deepEqual(await order(),key==='question-bank'?[2,3,1]:[...desc].reverse(),role+' '+key+' asc');
      }
      await directionButton.focus();await page.keyboard.press('Enter');
      assert.equal(await directionButton.getAttribute('data-direction'),'desc','keyboard toggles order');
      await page.keyboard.press('Enter');
      assert.equal(await directionButton.getAttribute('data-direction'),'asc');
      const search=page.getByTestId(role==='admin'?'input-search-students':'input-search-super-admin-students');
      await search.fill('Alpha');assert.deepEqual(await order(),[2]);await search.fill('');
      if(role==='super-admin'){
        await page.getByTestId('select-student-state').selectOption('Odisha');assert.deepEqual(await order(),[3]);
        await page.getByTestId('select-student-state').selectOption('all');
        await page.getByTestId('select-student-college').selectOption('College 2');assert.deepEqual(await order(),[2]);
        await page.getByTestId('select-student-college').selectOption('all');
      }else{
        await page.evaluate(()=>{localStorage.setItem('admin-selected-exam','jam-chemistry');window.dispatchEvent(new Event('admin-exam-changed'));});
        await page.getByText('No students enrolled yet.').waitFor();assert.equal(await rows.count(),0);
        await page.evaluate(()=>{localStorage.removeItem('admin-selected-exam');window.dispatchEvent(new Event('admin-exam-changed'));});
      }
      await page.getByTestId('select-student-sort').selectOption('pyq');
      assert.ok((await rows.first().textContent()).includes('PYQ 0'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
      if(viewport.width===390){await page.getByTestId('select-student-sort').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,role+'-mobile.png')});}
      assert.deepEqual(errors,[]);await context.close();
      console.log('Verified',role,viewport.width);
    }
    unavailable=true;
    const page=await browser.newPage();await page.goto(origin+'/admin/students');
    await page.getByText(/Some activity counts are unavailable/).waitFor();
    assert.ok((await page.locator('[data-testid="row-student-1"]').textContent()).includes('PYQ —'));
    await page.close();console.log('Screenshots:',directory);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
