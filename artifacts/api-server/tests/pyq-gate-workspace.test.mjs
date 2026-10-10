import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers/worker-fixture.mjs';

test('GATE students see legacy stream subjects and progress; JAM stays in its own database', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  for (const name of ['0001_initial.sql', '0002_subject_chapters.sql', '0003_pyq_attempt_features.sql', '0004_pyq_progress_reports.sql']) {
    f.sql.exec(await readFile(new URL(`../../pyq-worker/migrations/${name}`, import.meta.url), 'utf8'));
  }
  f.sql.exec(await readFile(new URL('../migrations/20261002_jam_pyq_question_time.sql', import.meta.url), 'utf8'));
  f.sql.exec(await readFile(new URL('../migrations/20261002_student_question_timers.sql', import.meta.url), 'utf8'));
  f.sql.exec(await readFile(new URL('../../jam-content-worker/migrations/0002_read_efficiency.sql', import.meta.url), 'utf8'));
  f.sql.exec(`UPDATE users SET status = 'active', subject = 'gate' WHERE id = 2;
    INSERT INTO pyq_questions (id, exam, subject, chapter, question, year, created_by) VALUES
      (1, 'GATE EC', 'Networks', 'Circuits', 'Question', 2020, 1),
      (2, 'GATE ECE', 'Signals', 'Fourier', 'Question', 2021, 1),
      (3, 'JAM Chemistry', 'Organic Chemistry', 'Reactions', 'Question', 2022, 1);
    INSERT INTO pyq_question_progress (question_id, student_id, attempt_count, correct_count, last_is_correct, first_attempted_at, last_attempted_at, solved_at)
    VALUES (1, 2, 1, 1, 1, 1000, 1000, 1000), (3, 2, 1, 1, 1, 1000, 1000, 1000);`);
  Object.assign(f.env, { PYQ_PROXY_URL: 'https://gate.example.test', PYQ_PROXY_TOKEN: 'test', JAM_PYQ_PROXY_URL: 'https://jam.example.test', JAM_PYQ_PROXY_TOKEN: 'test' });
  const destinations = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    destinations.push(new URL(url).hostname);
    const { sql, params } = JSON.parse(options.body);
    return Response.json({ ok: true, results: f.sql.prepare(sql).all(...params) });
  });
  for (const exam of ['GATE', 'gate', 'gate-ec', 'GATE Ece']) {
    const response = await f.request(`/api/pyq/subjects?exam=${encodeURIComponent(exam)}`, undefined, { method: 'GET', userId: 2 });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.deepEqual(data.subjects.map(x => x.subject), ['Networks', 'Signals']);
  }
  const progress = await f.request('/api/pyq/progress/summary?exam=GATE', undefined, { method: 'GET', userId: 2 });
  assert.equal((await progress.json()).totalAttemptedQuestions, 1);
  const chapters = await f.request('/api/pyq/chapters?exam=GATE%20EC&subject=Networks', undefined, { method: 'GET', userId: 2 });
  assert.equal((await chapters.json()).chapters[0].chapter, 'Circuits');
  assert(destinations.every(x => x === 'gate.example.test'));
  const jam = await f.request('/api/pyq/subjects?exam=JAM%20Chemistry', undefined, { method: 'GET', userId: 2 });
  assert.deepEqual((await jam.json()).subjects.map(x => x.subject), ['Organic Chemistry']);
  assert.equal(destinations.at(-1), 'jam.example.test');
});
