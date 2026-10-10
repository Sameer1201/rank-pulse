import assert from 'node:assert/strict';
import {test} from 'node:test';
import pyq from '../../pyq-ai-worker/src/index.js';
import qb from '../../qbank-worker/src/index.js';

for (const [name,worker,tokenName] of [['PYQ',pyq,'AI_HINT_GATEWAY_TOKEN'],['Q Bank',qb,'QB_PROXY_TOKEN']]) {
  test(`${name} authenticates and normalizes both structured AI and text hints`,async()=>{
    const calls=[];
    const env={[tokenName]:'test-gateway-token',AI:{run:async(model,input)=>{
      calls.push(model);
      return input.response_format?{choices:[{message:{content:'{"question":"Fresh question"}'}}]}:{response:'A small hint.'};
    }}};
    const request=(input,authenticated=true)=>new Request('https://gateway.test/ai-hint',{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer test-gateway-token'}:{})},body:JSON.stringify(input)});
    const input={messages:[{role:'user',content:'Practice'}],response_format:{type:'json_schema',json_schema:{type:'object'}}};
    assert.equal((await worker.fetch(request(input,false),env)).status,401);
    assert.equal(calls.length,0);
    const result=await worker.fetch(request(input),env);
    assert.equal(result.status,200);
    assert.equal(JSON.parse((await result.json()).response).question,'Fresh question');
    assert.equal(calls[0],'@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    const hint=await worker.fetch(request({messages:input.messages}),env);
    assert.equal((await hint.json()).response,'A small hint.');
    assert.equal(calls[1],'@cf/meta/llama-3.2-3b-instruct');
  });

  test(`${name} preserves daily-quota and temporary-capacity errors for failover`,async()=>{
    const request=()=>new Request('https://gateway.test/ai-hint',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-gateway-token'},body:JSON.stringify({messages:[{role:'user',content:'Practice'}]})});
    for(const [code, expected] of [[3036,'daily'],[3040,'capacity']]) {
      const env={[tokenName]:'test-gateway-token',AI:{run:async()=>{throw new Error(`Workers AI error ${code}`)}}};
      const response=await worker.fetch(request(),env);
      assert.equal(response.status,429);
      const body=await response.json();
      assert.equal(body.code,code);
      assert.match(body.error,new RegExp(expected,'i'));
    }
  });
}
