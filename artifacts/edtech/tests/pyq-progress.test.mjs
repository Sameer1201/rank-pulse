import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';

async function load(file) {
  const result = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const { getPyqProgress, getPyqStatusColor } = await load('../src/lib/pyq-progress.ts');
const { JAM_SUBMISSION_PROGRESS_SQL } = await load('../../api-server/src/lib/jamPyqProgress.ts');

test('JAM progress from another device drives count, bubbles and strip without local history', () => {
  const questions = Array.from({ length: 56 }, (_, i) => i < 14 ? { progress: { attemptCount: 1, lastIsCorrect: i < 10 } } : {});
  assert.equal(questions.filter(q => getPyqProgress(q).attempted).length, 14);
  assert.equal(getPyqStatusColor(questions[0]), 'bg-emerald-400');
  assert.equal(getPyqStatusColor(questions[12]), 'bg-red-500');
  assert.equal(getPyqStatusColor(questions[20]), 'bg-muted');
  assert.equal(getPyqStatusColor({ practiceVisited: true }), 'bg-amber-300');
});

test('one-time submissions, including incorrect answers, count once and beat stale local results', () => {
  const wrong = { jamSubmitted: true, jamSubmittedCorrect: false, practiceResult: true };
  assert.equal(getPyqProgress(wrong).attemptCount, 1);
  assert.equal(getPyqStatusColor(wrong), 'bg-red-500');
  assert.equal(getPyqStatusColor({ ...wrong, jamSubmittedCorrect: true }), 'bg-emerald-400');
  assert.equal(getPyqStatusColor({ progress: { attemptCount: 3, lastIsCorrect: false }, practiceResult: true }), 'bg-red-500');
});

test('one-time progress projection is idempotent, student/exam scoped and preserves history', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pyq_questions (id INTEGER PRIMARY KEY, exam TEXT); INSERT INTO pyq_questions VALUES (1,\'JAM Chemistry\'),(2,\'JAM Chemistry\'),(3,\'GATE\');');
  db.exec(readFileSync(new URL('../../pyq-worker/migrations/0004_pyq_progress_reports.sql', import.meta.url), 'utf8'));
  const saved = JSON.stringify([1, 2, 3, 999].map(id => ({ question_id: id, answer_json: '0', is_correct: id === 1 ? 1 : 0, submitted_at: 1000 })));
  const project = student => db.prepare(JAM_SUBMISSION_PROGRESS_SQL).run(student, saved, 'JAM Chemistry', student);
  project(10);
  project(10);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pyq_question_progress').get().n, 2);
  assert.equal(db.prepare('SELECT SUM(attempt_count) AS n FROM pyq_question_progress').get().n, 2);
  assert.equal(db.prepare('SELECT solved_at FROM pyq_question_progress WHERE question_id=1').get().solved_at, 1000);
  assert.equal(db.prepare('SELECT solved_at FROM pyq_question_progress WHERE question_id=2').get().solved_at, null);
  db.exec('UPDATE pyq_question_progress SET attempt_count=5, last_is_correct=0 WHERE question_id=1');
  project(10);
  assert.equal(db.prepare('SELECT attempt_count FROM pyq_question_progress WHERE question_id=1').get().attempt_count, 5);
  project(20);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pyq_question_progress WHERE student_id=20').get().n, 2);
  db.close();
});
