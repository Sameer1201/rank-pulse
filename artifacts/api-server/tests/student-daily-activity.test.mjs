import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fixture as workerFixture } from './helpers/worker-fixture.mjs';

const bundle = await build({ entryPoints: [new URL('../src/lib/studentDailyActivity.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { indiaActivityDay, answeredQuestionIds, readStudentDailyActivity } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now = Date.parse('2026-09-29T20:00:00Z'); // Sept 30 in India, Sept 29 UTC.

function fixture() {
  const stores = Object.fromEntries(['main', 'question-bank', 'pyq', 'jam-pyq', 'psu'].map(key => [key, new DatabaseSync(':memory:')]));
  stores.main.exec(`CREATE TABLE jam_pyq_submissions (student_id, question_id, submitted_at);
    CREATE TABLE test_submissions (student_id, test_id, answers, submitted_at);`);
  stores['question-bank'].exec(`CREATE TABLE question_bank_question_progress (student_id, question_id, last_attempted_at);
    CREATE TABLE test_question_bank_links (test_id, test_question_id, question_bank_question_id);
    CREATE TABLE question_bank_questions (id, source_test_id, source_test_question_id);`);
  for (const key of ['pyq', 'jam-pyq']) stores[key].exec('CREATE TABLE pyq_question_progress (student_id, question_id, last_attempted_at)');
  stores.psu.exec('CREATE TABLE psu_test_attempts (student_id, test_id, answers_json, submitted_at)');
  return { stores, query: async (store, sql, params) => stores[store].prepare(sql).all(...params) };
}

test('day resets at IST midnight, not UTC midnight or a device timezone', () => {
  const day = indiaActivityDay(now);
  assert.equal(day.date, '2026-09-30');
  assert.equal(new Date(day.start).toISOString(), '2026-09-29T18:30:00.000Z');
  assert.equal(indiaActivityDay(day.start - 1).date, '2026-09-29');
  assert.equal(indiaActivityDay(day.end).date, '2026-10-01');
});

test('numeric zero and wrong/nonempty responses count, blanks/skips and metadata do not', () => {
  assert.deepEqual(answeredQuestionIds(JSON.stringify({ 1: 0, 2: '', 3: null, 4: [], 5: ['A'], 6: 'B', 7: '  ', __indexBase: 0 })), ['1', '5', '6']);
});

test('all exam stores, one-time JAM submissions, tests and Q Bank count once', async () => {
  const { stores, query } = fixture();
  const { start, end } = indiaActivityDay(now);
  for (const key of ['pyq', 'jam-pyq']) {
    const insert = stores[key].prepare('INSERT INTO pyq_question_progress VALUES (?,?,?)');
    insert.run(7, 1, start); // same numeric ID on different shards: two questions
    insert.run(7, 2, start - 1); // yesterday
    insert.run(7, 3, end); // tomorrow
    insert.run(8, 4, now); // another student
  }
  stores.main.prepare('INSERT INTO jam_pyq_submissions VALUES (?,?,?)').run(7, 1, now); // duplicate projection
  stores.main.prepare('INSERT INTO jam_pyq_submissions VALUES (?,?,?)').run(7, 5, now); // not projected yet
  const qbInsert = stores['question-bank'].prepare('INSERT INTO question_bank_question_progress VALUES (?,?,?)');
  for (const id of [11, 12, 13]) qbInsert.run(7, id, now);
  stores['question-bank'].exec('INSERT INTO test_question_bank_links VALUES (10,101,11); INSERT INTO question_bank_questions VALUES (12,10,102)');
  const answers = JSON.stringify({101: 'A', 102: 0, 103: '', 104: []});
  stores.main.prepare('INSERT INTO test_submissions VALUES (?,?,?,?)').run(7, 10, answers, now);
  stores.main.prepare('INSERT INTO test_submissions VALUES (?,?,?,?)').run(7, 10, answers, now); // retry does not inflate
  stores.psu.prepare('INSERT INTO psu_test_attempts VALUES (?,?,?,?)').run(7, 10, '{"101":"B"}', '2026-09-29 20:00:00');
  const result = await readStudentDailyActivity(query, 7, now);
  assert.deepEqual(result.bySource, { questionBank: 1, pyq: 1, jamPyq: 2, tests: 2, psuTests: 1 });
  assert.equal(result.attemptedToday, 7);
  assert.equal((await readStudentDailyActivity(query, 99, now)).attemptedToday, 0);
  assert.deepEqual(await readStudentDailyActivity(query, 7, now), result); // no device-local input
});

test('a failed store is an error, never a misleading partial/zero count', async () => {
  await assert.rejects(readStudentDailyActivity(async store => { if (store === 'jam-pyq') throw new Error('offline'); return []; }, 7, now), /offline/);
});

test('deployed route authenticates, queries every shard and returns a non-cacheable count', async t => {
  const f = workerFixture();
  t.after(() => f.sql.close());
  f.sql.exec(`CREATE TABLE IF NOT EXISTS jam_pyq_submissions (student_id, question_id, submitted_at);
    CREATE TABLE pyq_question_progress (student_id, question_id, last_attempted_at);
    CREATE TABLE psu_test_attempts (student_id, test_id, answers_json, submitted_at);
    UPDATE users SET status = 'active' WHERE id = 2;`);
  Object.assign(f.env, {
    PYQ_PROXY_URL: 'https://gate.example.test', PYQ_PROXY_TOKEN: 'test',
    JAM_PYQ_PROXY_URL: 'https://jam.example.test', JAM_PYQ_PROXY_TOKEN: 'test',
    JAM_QB_PROXY_URL: 'https://jam.example.test', JAM_QB_PROXY_TOKEN: 'test', JAM_QB_CLASS_IDS: '2',
    PSU_PROXY_URL: 'https://psu.example.test', PSU_PROXY_TOKEN: 'test',
  });
  const destinations = new Set();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    destinations.add(new URL(url).hostname);
    const { sql, params } = JSON.parse(options.body);
    return Response.json({ ok: true, results: f.sql.prepare(sql).all(...params) });
  });
  const response = await f.request('/api/student/activity/today', undefined, { method: 'GET', userId: 2 });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.attemptedToday, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...destinations].sort(), ['gate.example.test', 'jam.example.test', 'psu.example.test']);
  destinations.clear();
  const cached = await f.request('/api/student/activity/today', undefined, { method: 'GET', userId: 2 });
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).attemptedToday, 0);
  assert.equal(destinations.size, 0, 'fresh daily count skips every remote shard');
  assert.equal((await f.request('/api/student/activity/today', undefined, { method: 'GET', userId: 1 })).status, 403);
});
