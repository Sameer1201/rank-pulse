import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

test('GATE count-only reads share the API gateway cache while saved counts, credentials and permissions remain fresh', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  f.sql.exec("UPDATE users SET status='active',subject='GATE' WHERE id=2");
  Object.assign(f.env,{PYQ_PROXY_URL:'https://gate-catalog-cache.example.test',PYQ_PROXY_TOKEN:'fixture-gate-token-one'});
  const queries = [];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(new URL(url).hostname,'gate-catalog-cache.example.test');
    const body = JSON.parse(options.body); queries.push(body.sql);
    assert.match(body.sql,/SELECT COUNT\(\*\)/);
    return Response.json({ok:true,results:[{totalCount:body.sql.includes('pyq_saved_questions')?2:123}]});
  });
  const path = '/api/pyq/questions?exam=GATE&countOnly=1';
  const get = async suffix => {
    const response = await f.request(path+(suffix??''),undefined,{method:'GET',userId:2});
    const data = await response.json(); assert.equal(response.status,200,JSON.stringify(data)); return data;
  };
  assert.deepEqual(await get(),{total:123});
  assert.deepEqual(await get(),{total:123}); assert.equal(queries.length,1,'a new per-request proxy object does not rerun the count');
  await get('&saved=1'); await get('&saved=1'); assert.equal(queries.length,3,'private bookmarks are never shared or cached');
  f.env.PYQ_PROXY_TOKEN='fixture-gate-token-two'; await get(); assert.equal(queries.length,4,'credential changes isolate proxy caches');
  const anonymous = await f.request(path,undefined,{method:'GET'}); assert.equal(anonymous.status,401);
  f.sql.exec("UPDATE users SET status='blocked' WHERE id=2");
  const blocked = await f.request(path,undefined,{method:'GET',userId:2}); assert.equal(blocked.status,401);
  assert.equal(queries.length,4,'authorization remains a fresh per-request database check');
});
