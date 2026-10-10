import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../src/lib/workerAiPool.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { AiPoolExhaustedError, runPooledAi, aiCacheKey, readAiCache, writeAiCache } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE ai_account_cooldowns (account_key TEXT PRIMARY KEY, blocked_until INTEGER, reason TEXT, updated_at INTEGER);
    CREATE TABLE ai_response_cache (cache_key TEXT PRIMARY KEY, response_json TEXT, expires_at INTEGER);`);
  const DB = { prepare(query) { let args=[]; return { bind(...values) { args=values; return this; }, async all() { return { results: sql.prepare(query).all(...args) }; }, async first() { return sql.prepare(query).get(...args) ?? null; }, async run() { sql.prepare(query).run(...args); } }; } };
  return { sql, DB };
}

test('daily exhaustion fails over once and skips the depleted account until UTC reset', async () => {
  const { sql, DB } = database();
  let primaryCalls=0;
  let fallbackCalls=0;
  const env={ DB, QB_PROXY_URL:'https://qb.test', QB_PROXY_TOKEN:'private', AI:{run:async()=>{ fallbackCalls++; return { response:'Fallback hint' }; }} };
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{ primaryCalls++; return Response.json({ code:3036, error:'Daily Workers AI allocation exhausted' },{status:429}); };
  const originalWarn=console.warn;
  console.warn=()=>{};
  try {
    assert.equal((await runPooledAi(env,'question-bank',{messages:[]})).response,'Fallback hint');
    assert.equal((await runPooledAi(env,'question-bank',{messages:[]})).response,'Fallback hint');
    assert.equal(primaryCalls,1);
    assert.equal(fallbackCalls,2);
    const cooldown=sql.prepare("SELECT blocked_until, reason FROM ai_account_cooldowns WHERE account_key='question-bank'").get();
    assert.equal(cooldown.reason,'daily');
    assert.ok(cooldown.blocked_until>Date.now());
  } finally { globalThis.fetch=originalFetch; console.warn=originalWarn; }
});

test('identical cache keys reuse stored AI output without another model call', async () => {
  const { DB }=database();
  const first=await aiCacheKey('hint-v2',{source:'pyq',question:'What is gain?'});
  const same=await aiCacheKey('hint-v2',{source:'pyq',question:'What is gain?'});
  const different=await aiCacheKey('hint-v2',{source:'pyq',question:'What is resistance?'});
  assert.equal(first,same);
  assert.notEqual(first,different);
  await writeAiCache(DB,first,{hint:'Use output divided by input.'},10000);
  assert.deepEqual(await readAiCache(DB,first),{hint:'Use output divided by input.'});
  assert.equal(await readAiCache(DB,different),null);
});

test('test account capacity error moves its request to a gateway for a short cooldown', async () => {
  const { sql, DB }=database();
  let testCalls=0;
  const env={ DB, QB_PROXY_URL:'https://qb.test', QB_PROXY_TOKEN:'private', AI:{run:async()=>{ testCalls++; throw new Error('3040 Out of Capacity'); }} };
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({response:'Gateway response'});
  const originalWarn=console.warn;
  console.warn=()=>{};
  try {
    assert.equal((await runPooledAi(env,'test',{messages:[]})).response,'Gateway response');
    assert.equal(testCalls,1);
    const cooldown=sql.prepare("SELECT blocked_until, reason FROM ai_account_cooldowns WHERE account_key='test'").get();
    assert.equal(cooldown.reason,'capacity');
    assert.ok(cooldown.blocked_until>Date.now());
    assert.ok(cooldown.blocked_until<Date.now()+61000);
  } finally { globalThis.fetch=originalFetch; console.warn=originalWarn; }
});

test('all cooled-down accounts return a retry time without invoking a model', async () => {
  const { sql, DB }=database();
  sql.prepare("INSERT INTO ai_account_cooldowns VALUES ('test', ?, 'daily', ?)").run(Date.now()+60000,Date.now());
  let calls=0;
  const env={DB, AI:{run:async()=>{calls++;return {response:'unexpected'}}}};
  await assert.rejects(runPooledAi(env,'test',{messages:[]}), (error)=>error instanceof AiPoolExhaustedError && error.retryAfterSeconds>0);
  assert.equal(calls,0);
});

test('gateway timeout fails over instead of aborting all generation',async()=>{
 const {DB}=database();let calls=0;
 const env={DB,AI:{run:async()=>({response:'Recovered response'})},QB_PROXY_URL:'https://qb.test',QB_PROXY_TOKEN:'private'};
 const originalFetch=globalThis.fetch,originalWarn=console.warn;console.warn=()=>{};
 globalThis.fetch=async()=>{calls++;throw new DOMException('The operation was aborted due to timeout','TimeoutError')};
 try{assert.equal((await runPooledAi(env,'question-bank',{messages:[]})).response,'Recovered response');assert.equal(calls,1);}
 finally{globalThis.fetch=originalFetch;console.warn=originalWarn;}
});
