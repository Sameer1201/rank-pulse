import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

const qbSchema = await readFile(new URL('../migrations/20260920_question_bank_database.sql', import.meta.url), 'utf8');
const student = { userId: 2, method: 'GET' };
const admin = { userId: 1, method: 'GET' };

function recordedDatabase(sql, database, queries) {
  return {
    prepare(query) {
      let params = [];
      const record = (method, rows) => queries.push({ database, query, params, method, rows });
      return {
        bind(...values) {
          assert.ok(values.length <= 100, `D1 parameter limit exceeded: ${values.length}`);
          params = values;
          return this;
        },
        async first() {
          const row = sql.prepare(query).get(...params) ?? null;
          record('first', row ? [row] : []);
          return row;
        },
        async all() {
          const rows = sql.prepare(query).all(...params);
          record('all', rows);
          return { results: rows };
        },
        execute() {
          const result = sql.prepare(query).run(...params);
          record('run', []);
          return { success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
        },
        async run() { return this.execute(); },
      };
    },
    async batch(statements) {
      assert.ok(statements.length <= 200, 'QBank proxy batch limit exceeded');
      sql.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function setup(t, count = 5) {
  const f = fixture();
  const qb = new DatabaseSync(':memory:');
  qb.exec(qbSchema);
  const queries = [];
  f.env.DB = recordedDatabase(f.sql, 'main', queries);
  f.env.QB_DB = recordedDatabase(qb, 'qbank', queries);
  f.sql.exec(`UPDATE users SET subject = 'GATE EC', status = 'approved' WHERE id = 2;
    INSERT INTO classes (id, title, subject) VALUES (1, 'GATE EC', 'GATE EC');
    INSERT INTO subjects (id, class_id, title) VALUES (1, 1, 'Signals');
    INSERT INTO chapters (id, subject_id, title) VALUES (1, 1, 'LTI');`);
  const question = qb.prepare(`INSERT INTO question_bank_questions
    (id, class_id, subject_id, chapter_id, question, correct_answer, explanation, image_data, option_images)
    VALUES (?, 1, 1, 1, ?, 1, 'Explanation retained for detail/export', ?, ?)`);
  for (let id = 1; id <= count; id++) question.run(id, `Question ${id}`, id === 1 ? 'image-data'.repeat(1000) : '', id === 1 ? '["option-image"]' : '[null, ""]');
  const save = (id, studentId = 2) => qb.prepare('INSERT INTO question_bank_saved_questions (question_id, student_id, created_at) VALUES (?, ?, 1000)').run(id, studentId);
  const progress = (id, values = {}) => {
    const { attempts = 2, correct = 1, lastCorrect = 0, at = Date.now(), solved = at, studentId = 2 } = values;
    qb.prepare(`INSERT INTO question_bank_question_progress
      (question_id, student_id, class_id, subject_id, chapter_id, attempt_count, correct_count, incorrect_count, first_attempted_at, last_attempted_at, solved_at, last_is_correct)
      VALUES (?, ?, 1, 1, 1, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, studentId, attempts, correct, attempts - correct, at, at, solved, lastCorrect);
  };
  t.after(async () => { await f.finish(); qb.close(); f.sql.close(); });
  return { ...f, qb, queries, save, progress };
}

async function get(f, path, options = student) {
  const response = await f.request(path, undefined, options);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('dashboard saved count reads no questions or metadata and remains student scoped', async (t) => {
  const f = setup(t, 150);
  for (let id = 1; id <= 150; id++) f.save(id);
  f.save(1, 3);
  assert.deepEqual(await get(f, '/api/question-bank/saved-questions?countOnly=1'), { count: 150 });
  const queries = f.queries.filter((entry) => entry.database === 'qbank');
  assert.equal(queries.length, 1);
  assert.match(queries[0].query, /COUNT\(\*\).*question_bank_saved_questions WHERE student_id/s);
  assert.equal(queries[0].rows.length, 1);
});

test('saved pagination includes all tied-timestamp rows, scoped progress and lazy image flags', async (t) => {
  const f = setup(t, 205);
  for (let id = 1; id <= 205; id++) f.save(id);
  f.progress(205);
  f.progress(204, { studentId: 3 });
  const ids = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await get(f, `/api/question-bank/saved-questions?limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    assert.ok(page.questions.length <= 100);
    if (pages === 0) {
      assert.equal(page.questions[0].progress.attemptCount, 2);
      assert.equal(page.questions[1].progress, null);
    }
    for (const question of page.questions) {
      assert.equal('imageData' in question, false);
      assert.equal(question.hasImage, question.id === 1);
      assert.equal(question.hasOptionImages, question.id === 1);
      assert.equal(question.subjectTitle, 'Signals');
      assert.equal(question.chapterTitle, 'LTI');
    }
    ids.push(...page.questions.map((question) => question.id));
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  assert.equal(pages, 3);
  assert.deepEqual(ids, Array.from({ length: 205 }, (_, i) => 205 - i));
  const questionQueries = f.queries.filter((entry) => entry.database === 'qbank' && /FROM question_bank_questions WHERE id IN/.test(entry.query));
  assert.ok(questionQueries.every((entry) => entry.rows.length <= 100));
  const legacy = await get(f, '/api/question-bank/saved-questions');
  assert.equal(legacy.questions.length, 205);
  assert.ok(legacy.questions.at(-1).imageData);
  assert.equal(legacy.questions[0].explanation, 'Explanation retained for detail/export');
});

test('report queue paginates equal timestamps and rejects unauthorized or invalid requests', async (t) => {
  const f = setup(t, 105);
  const report = f.qb.prepare("INSERT INTO question_bank_reports (id, question_id, reported_by, reason, created_at) VALUES (?, ?, 2, 'Check answer', 1000)");
  for (let id = 1; id <= 105; id++) report.run(id, id);
  const first = await get(f, '/api/question-bank/reports?limit=500', admin);
  assert.equal(first.reports.length, 100);
  const second = await get(f, `/api/question-bank/reports?limit=100&cursor=${first.nextCursor}`, admin);
  assert.deepEqual([...first.reports, ...second.reports].map((row) => row.id), Array.from({ length: 105 }, (_, i) => 105 - i));
  assert.equal(second.nextCursor, null);
  assert.equal(first.reports[0].questionText, 'Question 105');
  assert.equal(first.reports[0].reporterName, 'A <Student>');
  for (const [path, options, status] of [
    ['/api/question-bank/reports', student, 403],
    ['/api/question-bank/reports', { method: 'GET' }, 401],
    ['/api/question-bank/reports?cursor=broken', admin, 400],
    ['/api/question-bank/saved-questions?limit=10&cursor=broken', student, 400],
  ]) assert.equal((await f.request(path, undefined, options)).status, status);
});

test('progress aggregation preserves lifetime and UTC daily counts without leaking another student', async (t) => {
  const f = setup(t);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  f.progress(1, { attempts: 3, correct: 2, lastCorrect: 1, at: today, solved: today - 1 });
  f.progress(2, { attempts: 1, correct: 0, at: today - 1, solved: null });
  f.progress(3, { attempts: 2, correct: 1, at: today - 20 * 86400000, solved: null });
  f.progress(4, { attempts: 10, correct: 10, studentId: 3 });
  const summary = await get(f, '/api/question-bank/progress/summary');
  assert.equal(summary.totalAttemptedQuestions, 3);
  assert.equal(summary.totalSolvedQuestions, 2);
  assert.equal(summary.totalAttempts, 6);
  assert.equal(summary.correctAttempts, 3);
  assert.equal(summary.latestCorrectQuestions, 1);
  assert.equal(summary.accuracy, 50);
  assert.deepEqual(summary.dailyAttemptedCounts.slice(-2).map((day) => day.questions), [1, 1]);
  assert.deepEqual(summary.dailySolvedCounts.slice(-2).map((day) => day.questions), [1, 0]);
  assert.equal(f.queries.filter((q) => q.database === 'qbank').length, 1);
  assert.equal(f.queries.find((q) => q.database === 'qbank').rows.length, 1);
});

test('large chapter and export retain questions, explanations, bookmarks and progress', async (t) => {
  const f = setup(t, 150);
  f.save(1);
  f.progress(1);
  const report = f.qb.prepare("INSERT INTO question_bank_reports (question_id, reported_by, created_at) VALUES (?, ?, 1000)");
  const user = f.sql.prepare("INSERT INTO users (id, username, email, password_hash, full_name) VALUES (?, ?, ?, 'test', 'Reporter')");
  for (let id = 1; id <= 150; id++) {
    user.run(id + 10, `reporter${id}`, `reporter${id}@example.test`);
    report.run(id, id + 10);
  }
  const chapter = await get(f, '/api/question-bank/chapters/1/questions');
  assert.equal(chapter.questions.length, 150);
  assert.equal(chapter.questions[0].progress.attemptCount, 2);
  assert.equal(chapter.questions[0].isSaved, true);
  assert.equal(chapter.questions[0].reports[0].reporterName, 'Reporter');
  assert.equal(chapter.questions[0].explanation, 'Explanation retained for detail/export');
  assert.equal(chapter.questions[1].hasOptionImages, false);
  const structure = await get(f, '/api/question-bank/exams/gate/structure');
  assert.equal(structure.subjects[0].chapters[0].questionCount, 150);
  assert.equal(structure.subjects[0].chapters[0].attemptedCount, 1);
  const full = await get(f, '/api/question-bank/exams/gate?includeImages=1&includeExplanations=1', admin);
  assert.equal(full.subjects[0].chapters[0].questions.length, 150);
  assert.ok(full.subjects[0].chapters[0].questions[0].imageData);
  assert.equal(full.subjects[0].chapters[0].questions[0].explanation, 'Explanation retained for detail/export');
  const legacy = await get(f, '/api/question-bank/classes/1');
  const questions = legacy.subjects[0].chapters[0].questions;
  assert.equal(questions.length, 150);
  assert.equal(questions[0].progress.attemptCount, 2);
  assert.equal(questions[0].isSaved, true);
  assert.equal(questions[0].reports[0].reporterName, 'Reporter');
  assert.equal(questions[0].hasImage, true);
  assert.equal(questions[1].hasOptionImages, false);
});

function testQuestions(f, count, testId = 1) {
  f.sql.prepare("INSERT INTO tests (id, title, exam_type, is_published) VALUES (?, 'Test', 'gate', 1)").run(testId);
  const question = f.sql.prepare(`INSERT INTO test_questions (id, test_id, question, correct_answer, image_data, solution_text) VALUES (?, ?, 'Question', 1, ?, 'Large solution')`);
  for (let id = 1; id <= count; id++) question.run(id, testId, 'image'.repeat(1000));
}

test('large test grading and atomic QBank sync preserve scores, counters and historical solves', async (t) => {
  const f = setup(t, 150);
  testQuestions(f, 150);
  f.qb.exec('UPDATE question_bank_questions SET source_test_id = 1, source_test_question_id = id');
  f.progress(1, { attempts: 2, correct: 2, at: 1000, solved: 1000, lastCorrect: 1 });
  const answers = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [String(i + 1), i === 0 ? 0 : 1]));
  const response = await f.request('/api/tests/1/submit', { answers, questionTimings: { 1: 42 } }, { userId: 2 });
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json();
  assert.equal(result.score, 149);
  assert.equal(result.totalPoints, 150);
  assert.equal(result.questionBankProgressSynced, 150);
  assert.equal(f.qb.prepare('SELECT COUNT(*) AS n FROM test_question_bank_links').get().n, 150);
  const progress = f.qb.prepare('SELECT * FROM question_bank_question_progress WHERE question_id = 1 AND student_id = 2').get();
  assert.equal(progress.attempt_count, 3);
  assert.equal(progress.correct_count, 2);
  assert.equal(progress.incorrect_count, 1);
  assert.equal(progress.first_attempted_at, 1000);
  assert.equal(progress.solved_at, 1000);
  assert.equal(progress.last_answer, '0');
  const grading = f.queries.find((q) => q.database === 'main' && /FROM test_questions WHERE test_id/.test(q.query));
  assert.equal('image_data' in grading.rows[0], false);
  assert.equal('solution_text' in grading.rows[0], false);
  assert.equal(f.queries.filter((q) => q.database === 'qbank' && q.method === 'run').length, 2);
  assert.equal(f.queries.some((q) => q.database === 'qbank' && /SELECT \*\s+FROM question_bank_question_progress/.test(q.query)), false);
});

test('QBank sync transaction rolls back progress when repairing a link fails', async (t) => {
  const f = setup(t, 2);
  testQuestions(f, 2);
  f.qb.exec(`UPDATE question_bank_questions SET source_test_id = 1, source_test_question_id = id;
    CREATE TRIGGER fail_link BEFORE INSERT ON test_question_bank_links BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
  t.mock.method(console, 'error', () => {});
  const response = await f.request('/api/tests/1/submit', { answers: { 1: 1, 2: 1 } }, { userId: 2 });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).questionBankProgressSynced, 0);
  assert.equal(f.qb.prepare('SELECT COUNT(*) AS n FROM question_bank_question_progress').get().n, 0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM test_submissions').get().n, 1);
});

test('review bucket handles over 100 attempted tests and uses only each latest attempt', async (t) => {
  const f = setup(t);
  const insertTest = f.sql.prepare("INSERT INTO tests (id, title, exam_type, is_published) VALUES (?, 'Review', 'gate', 1)");
  const insertQuestion = f.sql.prepare("INSERT INTO test_questions (id, test_id, question, correct_answer) VALUES (?, ?, 'Review question', 1)");
  const submit = f.sql.prepare('INSERT INTO test_submissions (test_id, student_id, answers, question_timings, submitted_at) VALUES (?, 2, ?, ?, ?)');
  for (let id = 1; id <= 110; id++) {
    insertTest.run(id);
    insertQuestion.run(id, id);
    submit.run(id, JSON.stringify({ [id]: 1 }), '{}', 1000);
    submit.run(id, JSON.stringify({ [id]: 0 }), JSON.stringify({ [id]: 12 }), 2000);
  }
  f.sql.exec('UPDATE tests SET is_published = 0 WHERE id = 110');
  const summary = await get(f, '/api/tests/review-bucket?summary=1');
  assert.equal(summary.length, 109);
  assert.ok(summary.every((row) => row.status === 'incorrect'));
  assert.equal(f.queries.some((q) => /FROM test_question_reports/.test(q.query)), false);
  const full = await get(f, '/api/tests/review-bucket');
  assert.deepEqual(full.map((row) => row.questionId), summary.map((row) => row.questionId));
  assert.ok(full.every((row) => row.analytics.myTimeSeconds === 12));
});

test('analytics keeps exact metrics and fetches at most eight student profiles', async (t) => {
  const f = setup(t);
  testQuestions(f, 1);
  for (let id = 3; id <= 20; id++) f.sql.prepare("INSERT INTO users (id, username, email, password_hash, full_name) VALUES (?, ?, ?, 'test', 'Ranked Student')").run(id, `student${id}`, `student${id}@example.test`);
  for (let id = 2; id <= 20; id++) f.sql.prepare("INSERT INTO test_submissions (test_id, student_id, answers, score, total_points, passed) VALUES (1, ?, '{}', ?, 100, ?)").run(id, id, id >= 10 ? 1 : 0);
  const analytics = await get(f, '/api/analytics', admin);
  assert.equal(analytics.summary.totalSubmissions, 19);
  assert.equal(analytics.summary.avgScore, 11);
  assert.equal(analytics.summary.passRate, 58);
  assert.equal(analytics.topStudents.length, 8);
  assert.equal(analytics.topStudents[0].id, 20);
  assert.equal(analytics.testMetrics[0].totalSubmissions, 19);
  const profiles = f.queries.find((q) => /FROM users WHERE id IN/.test(q.query));
  assert.equal(profiles.rows.length, 8);
});
