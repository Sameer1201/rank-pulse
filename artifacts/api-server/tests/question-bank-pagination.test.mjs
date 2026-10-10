import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: "export { questionBankRouter as router } from './src/routes/questionBank.ts'; export { drizzle } from 'drizzle-orm/sqlite-proxy';", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'local-db-and-email', setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: 'db', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/lib\/brevo$/ }, () => ({ path: 'mail', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/lib\/pushNotification$/ }, () => ({ path: 'notification', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'db'
      ? 'export const db = new Proxy({}, { get: (_, key) => globalThis.__qbRouteDb[key] });'
      : path === 'notification' ? 'export const pushNotification = async () => {};'
        : 'export const sendTeacherQuestionReportAlertEmail = async () => {}; export const sendStudentQuestionReportAcknowledgementEmail = async () => {}; export const sendStudentQuestionUpdatedEmail = async () => {}; export const sendStudentQuestionReportRejectedEmail = async () => {};'
    }));
  } }],
});
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { router, drizzle } = module.exports;
const schemaSource = await readFile(new URL('../../../lib/db/src/d1Schema.ts', import.meta.url), 'utf8');
const schema = schemaSource.slice(schemaSource.indexOf('`') + 1, schemaSource.lastIndexOf('`'));

function setup(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(schema);
  sql.exec(`INSERT INTO users (id, username, email, password_hash, full_name, role, subject, status) VALUES
    (1, 'admin', 'admin@example.test', 'fixture', 'Admin', 'super_admin', null, 'active'),
    (2, 'student', 'student@example.test', 'fixture', 'Student', 'student', 'GATE', 'approved'),
    (3, 'teacher', 'teacher@example.test', 'fixture', 'Teacher', 'admin', null, 'active');
    INSERT INTO classes (id, title, subject) VALUES (1, 'GATE', 'GATE'), (2, 'JEE', 'JEE');
    INSERT INTO subjects (id, class_id, title) VALUES (1, 1, 'Signals'), (2, 2, 'Math');
    INSERT INTO chapters (id, subject_id, title) VALUES (1, 1, 'LTI'), (2, 2, 'Algebra');`);
  const queries = [];
  globalThis.__qbRouteDb = drizzle(async (query, params, method) => {
    assert.ok(params.length <= 100);
    queries.push(query);
    const statement = sql.prepare(query);
    statement.setReturnArrays(true);
    return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
  });
  t.after(() => sql.close());
  const request = async (path, query = {}, role = 'student') => {
    const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods.get);
    const req = { query, signedCookies: { userId: role === 'student' ? '2' : role === 'admin' ? '3' : '1' }, cookies: { userRole: role } };
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await route.route.stack[0].handle(req, response);
    return response;
  };
  return { sql, request, queries };
}

test('Express saved pagination/count preserve exam restrictions and replace per-question lookups', async (t) => {
  const f = setup(t);
  const insert = f.sql.prepare("INSERT INTO question_bank_questions (id, class_id, subject_id, chapter_id, question, image_data, option_images) VALUES (?, ?, ?, ?, 'Question', 'large-image', '[null]')");
  const bookmark = f.sql.prepare('INSERT INTO question_bank_saved_questions (question_id, student_id, created_at) VALUES (?, 2, 1000)');
  for (let id = 1; id <= 206; id++) {
    const context = id === 206 ? 2 : 1;
    insert.run(id, context, context, context);
    bookmark.run(id);
  }
  const count = await f.request('/question-bank/saved-questions', { countOnly: '1' });
  assert.equal(count.statusCode, 200);
  assert.deepEqual(count.body, { count: 205 });
  const ids = [];
  let cursor;
  do {
    const before = f.queries.length;
    const result = await f.request('/question-bank/saved-questions', { limit: '100', ...(cursor ? { cursor } : {}) });
    assert.equal(result.statusCode, 200);
    assert.ok(f.queries.length - before <= 3, 'No per-question database calls');
    assert.ok(result.body.questions.every((question) => question.hasImage && !question.hasOptionImages && question.examKey === 'gate'));
    ids.push(...result.body.questions.map((question) => question.id));
    cursor = result.body.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, Array.from({ length: 205 }, (_, i) => 205 - i));
});

test('Express report pages retain teacher ownership/status filtering and legacy response shape', async (t) => {
  const f = setup(t);
  f.sql.exec("INSERT INTO question_bank_questions (id, class_id, subject_id, chapter_id, question) VALUES (1, 1, 1, 1, 'Reported question')");
  const report = f.sql.prepare("INSERT INTO question_bank_reports (id, question_id, class_id, subject_id, chapter_id, reported_by, teacher_id, status, created_at) VALUES (?, 1, 1, 1, 1, 2, ?, ?, 1000)");
  for (let id = 1; id <= 105; id++) report.run(id, 3, 'open');
  report.run(106, 1, 'open');
  report.run(107, 3, 'resolved');
  const first = await f.request('/question-bank/reports', { limit: '100' }, 'admin');
  assert.equal(first.body.reports.length, 100);
  assert.equal(first.body.reports[0].id, 105);
  assert.equal(first.body.reports[0].questionText, 'Reported question');
  const second = await f.request('/question-bank/reports', { limit: '100', cursor: first.body.nextCursor }, 'admin');
  assert.equal(second.body.reports.length, 5);
  assert.equal(second.body.nextCursor, null);
  const legacy = await f.request('/question-bank/reports', {}, 'super_admin');
  assert.equal(Array.isArray(legacy.body), true);
  assert.equal(legacy.body.length, 107);
  assert.equal((await f.request('/question-bank/reports', {}, 'student')).statusCode, 403);
  assert.equal((await f.request('/question-bank/reports', { limit: '100', cursor: 'bad' }, 'admin')).statusCode, 400);
});
