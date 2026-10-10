import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {chromium} from 'playwright';

test('report dialog checks only on demand; pending survives reload and an admin response unlocks sending', {timeout:60000}, async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rank-pending-report-'));
  const mocks={
    '@/contexts/AuthContext':'export const useAuth=()=>({user:{id:2}});',
    '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
    '@/lib/api':`const request=async(path,body)=>{const res=await fetch('/api'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error),{status:res.status});return data;};export const api={get:path=>request(path),post:(path,body)=>request(path,body)};`,
  };
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{useQuestionReport}from'./src/hooks/use-question-report';
    function App(){const[open,setOpen]=useState(false);const r=useQuestionReport('/pyq/questions/50/report',open,()=>setOpen(false),'jam-chemistry');return <><button onClick={()=>setOpen(true)}>Report question</button>{open?<section role="dialog"><p role="status">{r.message}</p><button onClick={()=>setOpen(false)}>Close</button><button disabled={r.blocked||r.mutation.isPending} onClick={()=>r.mutation.mutate({reason:'Synthetic issue'})}>Send report</button></section>:null}</>}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:path.join(directory,'app.js'),jsx:'automatic',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname,plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
  const script=await readFile(path.join(directory,'app.js'));
  let pending=false,reads=0,writes=0,available=true;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture.test');
    if(url.pathname==='/app.js'){res.setHeader('Content-Type','application/javascript');return res.end(script);}
    if(url.pathname.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');
      if(req.method==='GET'){
        reads++;assert.equal(url.searchParams.get('exam'),'jam-chemistry');
        if(!available){res.statusCode=503;return res.end(JSON.stringify({error:'Synthetic network failure'}));}
        return setTimeout(()=>res.end(JSON.stringify({pending})),100);
      }
      let raw='';for await(const chunk of req)raw+=chunk;
      assert.equal(JSON.parse(raw).exam,'jam-chemistry');writes++;
      if(pending){res.statusCode=409;return res.end(JSON.stringify({error:'Already reported'}));}
      pending=true;return res.end(JSON.stringify({ok:true}));
    }
    res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'Report question'}).waitFor();assert.equal(reads,0);
    const send=page.getByRole('button',{name:'Send report'});
    await page.getByRole('button',{name:'Report question'}).click();
    assert.equal(await send.isDisabled(),true,'send disabled before status is known');
    await page.waitForFunction(()=>!document.querySelector('[role=dialog] button:last-child').disabled);
    await send.click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(writes,1);
    await page.getByRole('button',{name:'Report question'}).click();
    await page.getByText('Already reported — waiting for an admin response.').waitFor();assert.equal(await send.isDisabled(),true);
    await page.reload();await page.getByRole('button',{name:'Report question'}).click();
    await page.getByText('Already reported — waiting for an admin response.').waitFor();assert.equal(await send.isDisabled(),true);
    await page.getByRole('button',{name:'Close',exact:true}).click();pending=false;
    await page.getByRole('button',{name:'Report question'}).click();
    await page.waitForFunction(()=>!document.querySelector('[role=dialog] button:last-child').disabled);
    await send.click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(writes,2);
    available=false;await page.getByRole('button',{name:'Report question'}).click();
    await page.getByText('Could not check report status. Close and reopen to retry.').waitFor();assert.equal(await send.isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
