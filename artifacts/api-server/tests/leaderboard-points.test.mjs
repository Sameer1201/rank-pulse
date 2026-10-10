import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: "export {default as router} from './src/routes/leaderboard.ts'", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'local-db', setup(b) {
    b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: 'db', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const db={}, examTemplatesTable={}, classesTable={}, usersTable={}; export const executeD1Sql=(query,params)=>Promise.resolve({rows:globalThis.leaderboardDb.prepare(query).all(...params)});' }));
  } }],
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const handler = mod.exports.router.stack.find(layer => layer.route?.path === '/leaderboard').route.stack[0].handle;

test('unique attempts earn points, retries cannot inflate rank, correct answers add a one-time bonus', async () => {
  const db = new DatabaseSync(':memory:');
  globalThis.leaderboardDb = db;
  db.exec(`
    CREATE TABLE users (id INTEGER, full_name TEXT, username TEXT, avatar_url TEXT, subject TEXT, additional_exams TEXT, role TEXT, status TEXT);
    CREATE TABLE test_submissions (student_id INTEGER, score REAL, total_points REAL);
    CREATE TABLE question_bank_question_progress (student_id INTEGER, question_id INTEGER, attempt_count INTEGER, correct_count INTEGER);
    CREATE TABLE pyq_question_progress (student_id INTEGER, question_id INTEGER, attempt_count INTEGER, correct_count INTEGER);
    INSERT INTO users VALUES (1,'One','one',NULL,'GATE','[]','student','approved'),(2,'Two','two',NULL,'GATE','[]','student','approved'),(3,'Jam','jam',NULL,'JAM Chemistry','[]','student','approved');
    INSERT INTO question_bank_question_progress VALUES (1,10,1,0),(1,11,1,0),(1,12,0,0),(2,10,1,0);
    INSERT INTO pyq_question_progress VALUES (1,10,1,0),(3,10,1,0);
  `);
  const request = async (exam = 'gate') => {
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler({ query: { exam }, authenticatedUserId: 1, signedCookies: { userId: '1' }, cookies: { userRole: 'student' } }, response);
    return response.body;
  };
  try {
    let rows = await request();
    assert.deepEqual(rows.map(row => [row.id, row.points, row.rank]), [[1,3,1],[2,1,2]]);
    assert.equal(rows[0].questionsAttempted, 3, 'unattempted rows do not earn points; QBank/PYQ IDs are independent');
    db.exec('UPDATE question_bank_question_progress SET attempt_count=50 WHERE student_id=2');
    rows = await request();
    assert.equal(rows.find(row => row.id === 2).points, 1);
    assert.equal(rows.find(row => row.id === 2).activityCount, 1, 'retries do not inflate the tie-breaker');
    db.exec('UPDATE question_bank_question_progress SET correct_count=1 WHERE student_id=1 AND question_id=10; UPDATE pyq_question_progress SET correct_count=1 WHERE student_id=1');
    assert.equal((await request())[0].points, 8);
    db.exec('UPDATE question_bank_question_progress SET attempt_count=50,correct_count=50 WHERE student_id=1 AND question_id=10; UPDATE pyq_question_progress SET attempt_count=50,correct_count=50 WHERE student_id=1');
    assert.equal((await request())[0].points, 8, 'correct-answer retries do not farm points');
    db.exec('INSERT INTO test_submissions VALUES (1,7,10)');
    assert.equal((await request())[0].points, 78, 'existing test points remain additive');
    assert.deepEqual((await request('jam-chemistry')).map(row => row.id), [3], 'exam membership filter is preserved');
  } finally { db.close(); }
});
