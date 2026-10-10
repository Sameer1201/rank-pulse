import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
test('student reset hook clears old browser state and refreshes bucket without resetting a newer draft',{timeout:30000},async()=>{
  const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider,useQuery}from'@tanstack/react-query';import{useTestAttemptResets}from'./src/hooks/use-test-attempt-resets';const client=new QueryClient({defaultOptions:{queries:{retry:false}}});let received=0;window.addEventListener('student-test-attempt-reset',()=>{document.querySelector('#events').textContent=String(++received)});function App(){useTestAttemptResets(2);const q=useQuery({queryKey:['student-review-bucket-count'],queryFn:()=>fetch('/api/tests/review-bucket').then(r=>r.json())});return <><p id="bucket">{q.data?.length??'loading'}</p><p id="events">0</p><button onClick={async()=>{await fetch('/fixture-reset',{method:'POST'});client.invalidateQueries({queryKey:['student-test-reset-events']})}}>Apply admin reset</button></>}createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,plugins:[{name:'api-url',setup(b){b.onResolve({filter:/^@\/lib\/api-origin$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const buildApiUrl=path=>path;'}));}}]});
  let reset=false;const event={id:'event1',source:'regular',testId:1,psuId:null,resetAt:1000,questionIds:[11]};
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://test');const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
    if(url.pathname==='/app.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].text);}
    if(url.pathname==='/fixture-reset'){reset=true;return json({ok:true});}
    if(url.pathname==='/api/users/me/test-attempt-resets')return json({items:reset&&url.searchParams.get('afterId')!=='event1'?[event]:[],hasMore:false,nextCursor:reset?{resetAt:1000,id:'event1'}:null});
    if(url.pathname==='/api/tests/review-bucket')return json(reset?[]:[{questionId:11}]);
    res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const savedAt of [500,1500]){
      reset=false;const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.addInitScript(({savedAt})=>{localStorage.setItem('educonnect-test-draft-1',JSON.stringify({savedAt}));localStorage.setItem('educonnect-test-draft-2','{"savedAt":500}');localStorage.setItem('rankpulse-review-bucket-removed-question-ids','[11,22]');},{savedAt});
      await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#bucket').textContent==='1');
      await page.getByRole('button',{name:'Apply admin reset'}).click();await page.waitForFunction(()=>document.querySelector('#bucket').textContent==='0'&&document.querySelector('#events').textContent==='1');
      const state=await page.evaluate(()=>({draft:localStorage.getItem('educonnect-test-draft-1'),other:localStorage.getItem('educonnect-test-draft-2'),dismissed:JSON.parse(localStorage.getItem('rankpulse-review-bucket-removed-question-ids'))}));
      assert.equal(state.draft===null,savedAt<1000);assert.notEqual(state.other,null);assert.deepEqual(state.dismissed,[22]);
      await page.getByRole('button',{name:'Apply admin reset'}).click();assert.equal(await page.locator('#events').textContent(),'1');assert.deepEqual(errors,[]);await context.close();
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
