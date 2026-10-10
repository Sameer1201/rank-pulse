import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import psuWorker from '../../psu-worker/src/index.js';
import { fixture } from './helpers/worker-fixture.mjs';

test('PSU cards keep exact counts while warmed navigation reads only fresh publication metadata', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../../psu-worker/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(`INSERT INTO psus(id,name,slug,is_published) VALUES (1,'Visible PSU','visible',1),(2,'Hidden PSU','hidden',0);
    INSERT INTO psu_tests(psu_id,title,bundle_json,is_published) VALUES (1,'Test 1','{}',1),(1,'Draft test','{}',0),(2,'Hidden test','{}',1);
    INSERT INTO psu_questions(psu_id,exam,subject,chapter,year,question) VALUES
    (1,'GATE','ECE','Semiconductor',2020,'Question'),(1,'GATE','ECE','Semiconductor',2021,'Question'),(2,'GATE','ECE','Hidden',2020,'Hidden');`);
  const reads = [];
  const db = { prepare(query) { return { bind(...params) {
    const stmt = sqlite.prepare(query);
    return { async first() { reads.push(query); return stmt.get(...params) ?? null; },
      async all() { reads.push(query); return { results: stmt.all(...params) }; },
      async run() { stmt.run(...params); return { meta: { changes: 1 } }; } };
  } }; } };
  const env = { PSU_DB: db, PSU_PROXY_TOKEN: 'local-test' };
  f.env.PSU_PROXY_URL = 'https://psu.example.test'; f.env.PSU_PROXY_TOKEN = 'local-test';
  t.mock.method(globalThis, 'fetch', (url, options) => psuWorker.fetch(new Request(url, options), env));
  const get = async path => {
    const response = await f.request(path, undefined, {method:'GET',userId:2});
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const first = await get('/api/psus');
  assert.deepEqual(first.map(row => [row.id, row.testCount, row.questionCount]), [[1,2,2]]);
  assert.equal(reads.length,3); assert.ok(reads.every(sql => !sql.includes('(SELECT COUNT')));
  reads.length = 0;
  assert.deepEqual(await get('/api/psus'), first);
  assert.equal(reads.length,1,'only fresh PSU publication/name metadata, not another count scan');
  const subjects = await get('/api/psus/1/question-bank/subjects');
  assert.equal(subjects[0].questionCount,2);
  reads.length = 0;
  assert.deepEqual(await get('/api/psus/1/question-bank/subjects'), subjects);
  assert.equal(reads.length,1); assert.ok(!reads[0].includes('COUNT'));
  const detail = await get('/api/psus/1');
  assert.equal(detail.testCount,1,'detail counts only visible tests, preserving the existing contract');
  assert.equal(detail.questionCount,2);
  sqlite.exec('UPDATE psus SET is_published=0 WHERE id=1');
  assert.deepEqual(await get('/api/psus'), [], 'publication permission is not cached');
  const blocked = await f.request('/api/psus/1/question-bank/subjects',undefined,{method:'GET',userId:2});
  assert.equal(blocked.status,404);
});
