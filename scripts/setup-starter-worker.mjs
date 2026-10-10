import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const account='1e65bed301120c0c392ae4989b3ed6b0';
const auth=spawnSync('npx',['--yes','wrangler@4.137.0','auth','token','--json'],{encoding:'utf8'});
if(auth.status!==0)throw Error('Authentication unavailable');
const {token}=JSON.parse(auth.stdout);
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`;
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const existing=await (await fetch(endpoint,{headers})).json();
if(!existing.result?.subdomain){
 const response=await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({subdomain:'rankpulse-starter-1e65'})});
 const body=await response.json();if(!body.success)throw Error(JSON.stringify(body.errors));
 console.log('Registered Workers subdomain:',body.result.subdomain);
}else console.log('Existing Workers subdomain:',existing.result.subdomain);
// A dedicated random shared secret, sent through stdin only, never printed or saved to source.
const secret=randomBytes(48).toString('base64url');
for(const [id,config]of [[account,'artifacts/starter-worker/wrangler.toml'],['044791c24ac1de2cb822a0df91b2ab5f','artifacts/api-server/wrangler.toml']]){
 const p=spawnSync('npx',['--yes','wrangler@4.137.0','secret','put','STARTER_PROXY_TOKEN','--config',config,'--env','production'],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:id},input:secret,encoding:'utf8'});
 if(p.status!==0)throw Error('Could not configure secret: '+p.stderr);
 console.log('Dedicated proxy secret configured on',config);
}
