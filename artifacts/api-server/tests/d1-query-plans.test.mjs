import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const source = await readFile(new URL('../../../lib/db/src/d1Schema.ts', import.meta.url), 'utf8');
const mainSchema = source.slice(source.indexOf('`') + 1, source.lastIndexOf('`'));
const migration = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const qbSchema = await migration('20260920_question_bank_database.sql');
const pendingIndex = await migration('20260921_main_pending_users_index.sql');
const reportIndex = await migration('20260921_qbank_report_cursor_index.sql');
const plan = (db, query, params = []) => db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params).map((row) => row.detail).join('\n');

test('pending-user migration is additive/idempotent and narrows the existing role index', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(mainSchema);
  // Only remove the new index in this isolated fixture to reproduce the old schema.
  db.exec('DROP INDEX users_role_status_created_at_id_idx');
  db.exec("INSERT INTO users (username, email, password_hash, full_name, role, status) VALUES ('one', 'one@example.test', 'fixture', 'One', 'student', 'pending'), ('two', 'two@example.test', 'fixture', 'Two', 'student', 'approved')");
  const query = "SELECT id, username, full_name FROM users WHERE role = 'student' AND status = 'pending' ORDER BY created_at, id";
  const rows = db.prepare('SELECT * FROM users').all();
  const before = plan(db, query);
  assert.match(before, /users_role_created_at_id_idx/);
  db.exec(pendingIndex);
  db.exec(pendingIndex);
  const after = plan(db, query);
  assert.match(after, /SEARCH users USING INDEX users_role_status_created_at_id_idx \(role=\? AND status=\?\)/);
  assert.doesNotMatch(after, /TEMP B-TREE/);
  assert.deepEqual(db.prepare('SELECT * FROM users').all(), rows);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  t.diagnostic(JSON.stringify({ before, after }));
});

test('report migration replaces the global scan/sort with a cursor index without changing rows', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(qbSchema);
  db.exec('DROP INDEX question_bank_reports_created_at_id_idx');
  db.exec("INSERT INTO question_bank_questions (id, class_id, subject_id, chapter_id, question) VALUES (1, 1, 1, 1, 'Question')");
  db.exec("INSERT INTO question_bank_reports (question_id, reported_by, created_at) VALUES (1, 1, 100), (1, 2, 200), (1, 3, 200)");
  const query = 'SELECT * FROM question_bank_reports WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?';
  const params = [200, 3, 101];
  const rows = db.prepare('SELECT * FROM question_bank_reports').all();
  const page = db.prepare(query).all(...params);
  const before = plan(db, query, params);
  assert.match(before, /SCAN question_bank_reports/);
  assert.match(before, /TEMP B-TREE FOR ORDER BY/);
  db.exec(reportIndex);
  db.exec(reportIndex);
  const after = plan(db, query, params);
  assert.match(after, /SEARCH question_bank_reports USING INDEX question_bank_reports_created_at_id_idx/);
  assert.doesNotMatch(after, /TEMP B-TREE/);
  assert.deepEqual(db.prepare(query).all(...params), page);
  assert.deepEqual(db.prepare('SELECT * FROM question_bank_reports').all(), rows);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  t.diagnostic(JSON.stringify({ before, after }));
});

test('existing indexes cover auth, test questions, history, sessions, bookmarks and batched progress', (t) => {
  const main = new DatabaseSync(':memory:');
  const qb = new DatabaseSync(':memory:');
  t.after(() => { main.close(); qb.close(); });
  main.exec(mainSchema);
  qb.exec(qbSchema);
  const patterns = [
    [main, 'SELECT id, role FROM users WHERE id = ? LIMIT 1', [2], /INTEGER PRIMARY KEY/],
    [main, 'SELECT id FROM subjects WHERE id = ? LIMIT 1', [2], /INTEGER PRIMARY KEY/],
    [main, 'SELECT id FROM users WHERE lower(email) = lower(?)', ['User@Example.test'], /users_lower_email_idx/],
    [main, 'SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1', ['User', 'User'], /MULTI-INDEX OR/],
    [main, 'SELECT * FROM test_questions WHERE test_id = ? ORDER BY "order", id', [1], /test_questions_test_id_order_id_idx/],
    [main, 'SELECT id FROM test_submissions WHERE student_id = ? ORDER BY submitted_at DESC, id DESC', [2], /test_submissions_student_id_submitted_at_id_idx/],
    [main, 'SELECT * FROM user_sessions WHERE user_id = ? ORDER BY last_active_at DESC LIMIT 40', [2], /user_sessions_user_id_last_active_at_id_idx/],
    [main, "SELECT * FROM classes WHERE workflow_type = 'question_bank' ORDER BY title, id", [], /classes_workflow_type_title_id_idx/],
    [qb, 'SELECT * FROM question_bank_saved_questions WHERE student_id = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT 101', [2, 1000, 100], /question_bank_saved_questions_student_id_created_at_id_idx/],
    [qb, 'SELECT count(*), sum(attempt_count) FROM question_bank_question_progress WHERE student_id = ?', [2], /SEARCH question_bank_question_progress USING INDEX.*student_id/],
    [qb, 'SELECT * FROM question_bank_question_progress WHERE student_id = ? AND question_id IN (SELECT value FROM json_each(?))', [2, '[1,2,3]'], /question_bank_question_progress_unique \(question_id=\? AND student_id=\?\)/],
  ];
  for (const [db, query, params, expected] of patterns) {
    const details = plan(db, query, params);
    assert.match(details, expected, query);
    assert.doesNotMatch(details, /TEMP B-TREE/, query);
    t.diagnostic(JSON.stringify({ query, plan: details }));
  }
});
