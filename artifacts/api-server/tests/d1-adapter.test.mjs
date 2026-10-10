import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../../../lib/db/src/d1.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs',
});
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { d1Callback, d1BatchCallback } = module.exports;

function mockD1(t, results) {
  for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']) {
    const previous = process.env[key];
    process.env[key] = 'fixture';
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    success: true, result: results.map((rows) => ({ success: true, results: rows })),
  }));
}

test('D1 get preserves the absent-row contract', async (t) => {
  mockD1(t, [[]]);
  assert.equal((await d1Callback('SELECT id FROM users WHERE id = ?', [1], 'get')).rows, undefined);
});

test('D1 get and all preserve positional columns and decoded JSON', async (t) => {
  mockD1(t, [[{ id: 1, assigned_teacher_ids: '[2,3]' }]]);
  assert.deepEqual((await d1Callback('SELECT id, assigned_teacher_ids FROM classes', [], 'get')).rows, [1, [2, 3]]);
  assert.deepEqual((await d1Callback('SELECT id, assigned_teacher_ids FROM classes', [], 'all')).rows, [[1, [2, 3]]]);
});

test('D1 batch maps each result according to its requested method', async (t) => {
  mockD1(t, [[{ id: 1 }], [], [{ id: 2 }, { id: 3 }]]);
  const results = await d1BatchCallback(['get', 'get', 'all'].map((method) => ({ sql: 'SELECT id FROM users', params: [], method })));
  assert.deepEqual(results, [{ rows: [1] }, { rows: undefined }, { rows: [[2], [3]] }]);
});
