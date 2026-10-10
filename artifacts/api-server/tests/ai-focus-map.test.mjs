import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

const map = {
  headline: 'Practise feedback circuits',
  focusAreas: [{ topic: 'Feedback', priority: 'high', evidence: 'One incorrect answer', action: 'Review feedback signs' }],
  strengths: [{ topic: 'Amplifiers', evidence: 'One correct answer' }],
  studyFlow: ['Review concepts', 'Practise five questions', 'Take a short retest'],
};

function setup(result) {
  const f = fixture();
  f.sql.exec(`UPDATE users SET status='active', priority_access=1 WHERE id=2;
    INSERT INTO tests (id, title) VALUES (1, 'Circuit practice');
    INSERT INTO test_questions (id, test_id, question, options, correct_answer) VALUES
      (1, 1, 'Amplifier question', '["A","B"]', 0),
      (2, 1, 'Feedback question', '["A","B"]', 0),
      (3, 1, 'Skipped question', '["A","B"]', 1);
    INSERT INTO test_submissions (id, test_id, student_id, answers, question_timings, percentage)
      VALUES (1, 1, 2, '{"1":0,"2":1}', '{"1":30,"2":60}', 33.33);`);
  let calls = 0;
  f.env.AI = { run: async (_model, input) => {
    calls++;
    const data = JSON.parse(input.messages[1].content);
    assert.equal(data.questions.length, 3);
    assert.equal(data.result.totalTimeSeconds, 90);
    return result;
  } };
  return { ...f, calls: () => calls, run: () => f.request('/api/ai/test-result', { testId: 1 }, { userId: 2 }) };
}

for (const [name, response] of [
  ['structured Workers AI JSON (production regression)', { response: map }],
  ['legacy text JSON', { response: JSON.stringify(map) }],
  ['fenced JSON', { response: '```json\n' + JSON.stringify(map) + '\n```' }],
  ['chat completion content', { response: null, choices: [{ message: { content: JSON.stringify(map) } }] }],
]) test(`focus map accepts ${name} and returns server-calculated results`, async () => {
  const f = setup(response);
  const r = await f.run();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.focusMap.headline, map.headline);
  assert.deepEqual(body.focusMap.focusAreas, map.focusAreas);
  assert.deepEqual(body.focusMap.result, { percentage: 33.33, correct: 1, incorrect: 1, skipped: 1 });
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('reopening the same submitted result reuses the focus map without another AI call', async () => {
  const f = setup({ response: map });
  const first = await f.run();
  const second = await f.run();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(f.calls(), 1);
});

test('empty, truncated and wrong-shaped model output cannot become a successful empty map', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (const response of [null, '', '{}', '{"headline":"Cut off', { headline: 'Wrong shape', focusAreas: [null], strengths: [], studyFlow: ['Review'] }]) {
      const f = setup({ response });
      const r = await f.run();
      assert.equal(r.status, 503);
      assert.equal((await r.json()).focusMap, undefined);
    }
  } finally { console.error = original; }
});

test('a skipped-only attempt gets an honest diagnostic map without consuming AI quota', async () => {
  const f = setup({ response: map });
  f.sql.exec(`UPDATE test_submissions SET answers='{}', percentage=0`);
  const r = await f.run();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.focusMap.strengths, []);
  assert.deepEqual(body.focusMap.focusAreas, []);
  assert.equal(body.focusMap.source, 'attempt-data');
  assert.match(body.focusMap.notice, /most marks in this paper/);
  assert.equal(body.focusMap.preparationPlan.blocks[0].subject, 'Mixed practice');
  assert.equal(body.focusMap.preparationPlan.blocks[0].practiceCount, 3);
  assert.equal(f.calls(), 0);
  assert.deepEqual(body.focusMap.result, { percentage: 0, correct: 0, incorrect: 0, skipped: 3 });
});

test('the starter plan ranks actual subjects by marks and includes topics and bounded practice targets', async () => {
  const f = setup({ response: map });
  f.sql.exec(`UPDATE test_submissions SET answers='{}';
    UPDATE test_questions SET points=2, meta='{"subject":"Control Systems","chapter":"Feedback"}' WHERE id IN (1,2);
    UPDATE test_questions SET points=3, question_type='integer', meta='{"subject":"Analog Circuits","chapter":"Diodes"}' WHERE id=3;`);
  const r = await f.run();
  assert.equal(r.status, 200);
  const { preparationPlan: plan } = (await r.json()).focusMap;
  assert.equal(plan.totalMarks, 7);
  assert.equal(plan.coveredMarks, 7);
  assert.equal(plan.totalQuestions, 3);
  assert.deepEqual(plan.blocks.map(b => b.subject), ['Control Systems', 'Analog Circuits']);
  assert.deepEqual(plan.blocks.map(b => b.paperShare), [57, 43]);
  assert.deepEqual(plan.blocks[0].topics, ['Feedback']);
  assert.deepEqual(plan.blocks[1].formats, ['NAT']);
  assert.equal(plan.blocks[0].practiceCount, 2);
  assert.equal(plan.blocks[0].targetCorrect, 2);
  assert.equal(plan.blocks[1].practiceCount, 1);
  assert.equal(plan.sessionMinutes, 50);
  assert.equal(f.calls(), 0);
});

test('sign-in, priority access and submission ownership are checked before invoking AI', async () => {
  const f = setup({ response: map });
  assert.equal((await f.request('/api/ai/test-result', { testId: 1 })).status, 401);
  f.sql.exec('UPDATE users SET priority_access=0 WHERE id=2');
  assert.equal((await f.run()).status, 403);
  f.sql.exec('UPDATE users SET priority_access=1 WHERE id=2; UPDATE test_submissions SET student_id=1');
  assert.equal((await f.run()).status, 404);
  assert.equal(f.calls(), 0);
});
