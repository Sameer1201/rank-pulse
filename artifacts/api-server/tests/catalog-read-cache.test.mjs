import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { isCatalogCountRead, readCatalogCount, writeCatalog, catalogProxyIdentity } from '../../shared/catalog-read-cache.js';
import jam from '../../jam-content-worker/src/index.js';
import qb from '../../qbank-worker/src/index.js';
import pyq from '../../pyq-worker/src/index.js';
import psu from '../../psu-worker/src/index.js';
import starter from '../../starter-worker/src/index.js';

const sql = 'SELECT class_id AS classId, COUNT(*) AS count FROM question_bank_questions WHERE class_id = ? GROUP BY class_id';
const result = count => ({ ok: true, results: [{ classId: 1, count }], meta: { rows_read: 3200, rows_written: 0 } });

test('only content catalog aggregates are cacheable; student state, answers, arbitrary expressions and locks are excluded', () => {
  for (const allowed of [sql,
    'SELECT COUNT(*) AS total FROM pyq_questions WHERE exam = ?',
    'SELECT exam, subject, COUNT(*) AS questionCount, COUNT(DISTINCT NULLIF(chapter, \'\')) AS chapterCount FROM psu_questions WHERE id = ? GROUP BY exam, subject ORDER BY subject COLLATE NOCASE',
    'SELECT COALESCE(SUM(question_count),0) AS totalCount FROM jam_pyq_catalog_counts WHERE exam = ?',
    'SELECT chapter_id AS chapterId, SUM(question_count) AS questionCount FROM jam_qb_catalog_counts WHERE class_id IN (SELECT value FROM json_each(?)) GROUP BY chapter_id',
    'SELECT COUNT(*) AS count FROM question_bank_questions WHERE (chapter_id = ?) AND (question_bank_questions.id NOT IN (1, 2) AND question_bank_questions.id <= 4000000000000)',
  ]) assert.equal(isCatalogCountRead(allowed), true, allowed);
  for (const denied of [
    'SELECT correct_answer FROM question_bank_questions WHERE id = ?',
    'SELECT COUNT(*), correct_answer FROM question_bank_questions',
    'SELECT COUNT(*) FROM question_bank_question_progress WHERE student_id = ?',
    'SELECT COUNT(*) FROM question_bank_questions WHERE id IN (SELECT question_id FROM question_bank_question_progress)',
    'SELECT COUNT(*) FROM question_bank_questions JOIN question_bank_question_progress ON question_id = id',
    'SELECT COUNT(*) FROM question_bank_questions WHERE created_by = ?',
    'SELECT COUNT(*) FROM users',
    'SELECT COUNT(*) FROM question_bank_questions WHERE is_locked = 0',
    'SELECT COUNT(*) FROM question_bank_questions UNION SELECT COUNT(*) FROM users',
    'SELECT COUNT(*) FROM question_bank_questions -- ignored',
  ]) assert.equal(isCatalogCountRead(denied), false, denied);
});

test('hits skip D1, scopes/methods are isolated, expiry is fixed at 30 seconds and cached objects cannot be poisoned', async () => {
  const db = {}; let reads = 0;
  const load = async () => result(++reads);
  const first = await readCatalogCount(db, sql, [1], 'all', load, 1000);
  first.results[0].count = 99;
  const hit = await readCatalogCount(db, sql, [1], 'all', load, 30999);
  assert.equal(hit.results[0].count, 1); assert.equal(hit.meta.rows_read, 0); assert.equal(hit.meta.catalog_cache_hit, true);
  assert.equal(reads, 1);
  await readCatalogCount(db, sql, [1], 'all', load, 31000); assert.equal(reads, 2);
  await readCatalogCount(db, sql, [2], 'all', load, 31001);
  await readCatalogCount({}, sql, [1], 'all', load, 31001);
  await readCatalogCount(db, sql, [1], 'first', load, 31001);
  assert.equal(reads, 5);
});

test('simultaneous cache misses coalesce, failures never populate the cache and private reads never coalesce', async () => {
  const db = {}; let reads = 0;
  let release;
  const load = () => { reads++; return new Promise(resolve => { release = () => resolve(result(7)); }); };
  const calls = Array.from({ length: 8 }, () => readCatalogCount(db, sql, [1], 'all', load, 1000));
  await Promise.resolve(); release();
  const outputs = await Promise.all(calls);
  assert.equal(reads, 1); assert.equal(outputs.filter(row => row.meta.catalog_cache_hit).length, 7);
  await assert.rejects(readCatalogCount(db, sql, [2], 'all', async () => { throw new Error('offline'); }, 1000), /offline/);
  await readCatalogCount(db, sql, [2], 'all', async () => { reads++; return result(0); }, 1000);
  assert.equal(reads, 2);
  const personal = 'SELECT COUNT(*) FROM question_bank_question_progress WHERE student_id = ?';
  await Promise.all(Array.from({ length: 3 }, () => readCatalogCount(db, personal, [1], 'all', async () => { reads++; return result(0); }, 1000)));
  assert.equal(reads, 5);
});

test('edits invalidate counts, including failed batches and old reads finishing after a write', async () => {
  const db = {}; let count = 1; let reads = 0; let release;
  const load = async () => { reads++; return result(count); };
  await readCatalogCount(db, sql, [1], 'all', load, 1000);
  await writeCatalog(db, ['UPDATE question_bank_questions SET chapter_id = ? WHERE id = ?'], async () => { count = 2; });
  assert.equal((await readCatalogCount(db, sql, [1], 'all', load, 1001)).results[0].count, 2);
  await assert.rejects(writeCatalog(db, ['DELETE FROM question_bank_questions WHERE id = ?'], async () => { throw new Error('transaction failed'); }));
  await readCatalogCount(db, sql, [1], 'all', load, 1002); assert.equal(reads, 3);
  const old = readCatalogCount(db, sql, [2], 'all', () => new Promise(resolve => { release = () => resolve(result(2)); }), 1002);
  await Promise.resolve();
  await writeCatalog(db, ['INSERT INTO question_bank_questions(id) VALUES (?)'], async () => { count = 3; });
  release(); await old;
  assert.equal((await readCatalogCount(db, sql, [2], 'all', load, 1003)).results[0].count, 3);
});

test('bounded eviction does not create an unbounded catalog cache', async () => {
  const db = {}; let reads = 0;
  const load = async () => { reads++; return result(1); };
  for (let id = 0; id < 160; id++) await readCatalogCount(db, sql, [id], 'all', load, 1000);
  await readCatalogCount(db, sql, [159], 'all', load, 1001); assert.equal(reads, 160);
  await readCatalogCount(db, sql, [0], 'all', load, 1001); assert.equal(reads, 161);
});

test('proxy credentials/endpoints stay isolated and stacked caches cannot extend the source TTL', async () => {
  const scope = catalogProxyIdentity('https://local/query','credential-one');
  assert.equal(scope,catalogProxyIdentity('https://local/query','credential-one'));
  assert.notEqual(scope,catalogProxyIdentity('https://local/query','credential-two'));
  assert.notEqual(scope,catalogProxyIdentity('https://other/query','credential-one'));
  let reads = 0;
  const load = async () => { reads++; return {...result(3),meta:{catalog_read_at:1000}}; };
  await readCatalogCount(scope,sql,[1],'all',load,30000);
  await readCatalogCount(scope,sql,[1],'all',load,30999); assert.equal(reads,1);
  await readCatalogCount(scope,sql,[1],'all',load,31000); assert.equal(reads,2);
});

for (const [name, worker, binding, token] of [
  ['JAM', jam, 'JAM_DB', 'JAM_CONTENT_PROXY_TOKEN'], ['QBank', qb, 'QB_DB', 'QB_PROXY_TOKEN'],
  ['PYQ', pyq, 'PYQ_DB', 'PYQ_PROXY_TOKEN'], ['PSU', psu, 'PSU_DB', 'PSU_PROXY_TOKEN'],
  ['Starter', starter, 'STARTER_DB', 'STARTER_PROXY_TOKEN'],
]) test(`${name} live handler skips repeated count SQL but still checks auth and reads fresh answer/progress`, async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE question_bank_questions(id INTEGER PRIMARY KEY,class_id INTEGER,subject_id INTEGER,chapter_id INTEGER,correct_answer INTEGER);
    INSERT INTO question_bank_questions VALUES(1,1,2,3,0),(2,1,2,3,1);
    CREATE TABLE question_bank_question_progress(question_id INTEGER,student_id INTEGER,attempt_count INTEGER);
    INSERT INTO question_bank_question_progress VALUES(1,7,1);`);
  let dbReads = 0;
  const db = { prepare(query) { return { bind(...params) {
    const stmt = sqlite.prepare(query);
    return { async first() { dbReads++; return stmt.get(...params) ?? null; },
      async all() { dbReads++; return {results: stmt.all(...params), meta: { rows_read: 3 }}; },
      async run() { stmt.run(...params); return {meta:{changes:1}}; } };
  } }; }, async batch(statements) { for (const stmt of statements) await stmt.run(); } };
  const env = { [binding]: db, [token]: 'local-test-only' };
  const query = async (sql, params = [], method = 'all', valid = true, statements) => {
    const response = await worker.fetch(new Request('https://local.test/query', {method:'POST',
      headers:{authorization:`Bearer ${valid ? 'local-test-only' : 'wrong'}`, 'content-type':'application/json'},
      body:JSON.stringify({sql,params,method,statements})}), env);
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await query(sql, [1])).data.results[0].count, 2);
  const hit = await query(sql, [1]);
  assert.equal(hit.data.meta.catalog_cache_hit, true); assert.equal(hit.data.meta.rows_read, 0); assert.equal(dbReads, 1);
  assert.equal((await query(sql, [1], 'all', false)).status, 401); assert.equal(dbReads, 1);
  await query('SELECT correct_answer FROM question_bank_questions WHERE id = ?', [1]);
  await query('SELECT correct_answer FROM question_bank_questions WHERE id = ?', [1]); assert.equal(dbReads, 3);
  await query('SELECT COUNT(*) AS count FROM question_bank_question_progress WHERE student_id = ?', [7]);
  await query('SELECT COUNT(*) AS count FROM question_bank_question_progress WHERE student_id = ?', [7]); assert.equal(dbReads, 5);
  await query('UPDATE question_bank_questions SET class_id = ? WHERE id = ? RETURNING id', [9,2], 'first');
  assert.equal((await query(sql, [1])).data.results[0].count, 1);
  await query('UPDATE question_bank_questions SET class_id = ? WHERE id = ? RETURNING id', [1,2], 'all');
  assert.equal((await query(sql, [1])).data.results[0].count, 2);
  await query(undefined, undefined, 'batch', true, [{sql:'DELETE FROM question_bank_questions WHERE id = ?',params:[2]}]);
  assert.equal((await query(sql, [1])).data.results[0].count, 1);
});
