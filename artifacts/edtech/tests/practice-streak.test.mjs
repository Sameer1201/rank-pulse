import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';

const output = await build({ entryPoints: [new URL('../src/lib/practice-streak.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node' });
const { createPracticeStreak } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
const memory = () => {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
test('admin regrade updates saved result silently and preserves submitted answer', () => {
  const storage=memory(), s=createPracticeStreak(storage);
  const id=s.begin(5597,'A',false); s.settle(id,false);
  s.regrade(id,true);
  assert.equal(s.getSnapshot().count,1);
  assert.equal(s.getSnapshot().celebration,null);
  assert.equal(s.getSnapshot().attempts.length,1);
  assert.equal(s.getSnapshot().attempts[0].answer,'A');
  assert.equal(createPracticeStreak(storage).getSnapshot().attempts[0].isCorrect,true);
  const snapshot=s.getSnapshot(); s.regrade(id,true); assert.equal(s.getSnapshot(),snapshot);
  s.regrade(id,false); assert.equal(s.getSnapshot().count,0);
});
function submit(store, question, correct) {
  const id = store.begin(question, 0, correct);
  assert.notEqual(id, null);
  store.settle(id, correct);
  return id;
}

test('13 counts actual submissions, independent of question position, with a wrong-answer reset', () => {
  const s = createPracticeStreak();
  for (let i = 0; i < 13; i++) submit(s, 100 - i * 3, true);
  assert.equal(s.getSnapshot().count, 13);
  submit(s, 12, false);
  assert.equal(s.getSnapshot().count, 0);
  submit(s, 13, true);
  assert.equal(s.getSnapshot().count, 1);
});

test('double click, revisit and repeated callbacks cannot increment a question twice', () => {
  const s = createPracticeStreak();
  const id = s.begin(100, 0, true);
  assert.equal(s.begin(100, 0, true), null);
  s.settle(id, true);
  s.settle(id, true);
  assert.equal(s.begin(100, 0, true), null);
  assert.equal(s.getSnapshot().count, 1);
});

test('late response corrects its original answer without overwriting later wrong answers', () => {
  const s = createPracticeStreak();
  const a = s.begin(1, 0, true);
  const b = s.begin(2, 0, false);
  const c = s.begin(3, 0, true);
  s.settle(c, true);
  s.settle(b, false);
  s.settle(a, true);
  assert.equal(s.getSnapshot().count, 1);
  assert.equal(s.getSnapshot().celebration, null);
});

test('server disagreement recomputes following answers in submission order', () => {
  const s = createPracticeStreak();
  const ids = [1, 2, 3, 4].map(q => s.begin(q, 0, true));
  s.settle(ids[3], true);
  s.settle(ids[2], true);
  s.settle(ids[1], false);
  s.settle(ids[0], true);
  assert.equal(s.getSnapshot().count, 2);
  assert.equal(s.getSnapshot().celebration, null);
});

test('save failure is removed; retry is counted once and at its new submission position', () => {
  const s = createPracticeStreak();
  const a = s.begin(1, 0, true);
  submit(s, 2, true);
  s.settle(a, null);
  assert.equal(s.getSnapshot().count, 1);
  const retry = submit(s, 1, true);
  assert.notEqual(retry, a);
  s.settle(a, true);
  assert.equal(s.getSnapshot().count, 2);
});

test('refresh restores confirmed answers and count without replaying celebrations', () => {
  const storage = memory();
  const s = createPracticeStreak(storage, 'student:chapter');
  for (let i = 1; i <= 13; i++) submit(s, i, true);
  const restored = createPracticeStreak(storage, 'student:chapter');
  assert.equal(restored.getSnapshot().count, 13);
  assert.equal(restored.getSnapshot().celebration, null);
  assert.equal(restored.begin(1, 0, true), null);
  assert.equal(createPracticeStreak(storage, 'other:chapter').getSnapshot().count, 0);
  assert.equal(createPracticeStreak(storage, 'student:other').getSnapshot().count, 0);
});

test('interrupted request on refresh is retryable and does not bridge a streak', () => {
  const storage = memory();
  const s = createPracticeStreak(storage);
  submit(s, 1, true);
  s.begin(2, 0, true);
  submit(s, 3, true);
  const restored = createPracticeStreak(storage);
  assert.equal(restored.getSnapshot().count, 1);
  submit(restored, 2, true);
  assert.equal(restored.getSnapshot().count, 2);
});

test('celebrations wait for verified sequence, fire once, and continue at 15 and 20', () => {
  const s = createPracticeStreak();
  const ids = [1, 2, 3].map(q => s.begin(q, 0, true));
  s.settle(ids[2], true);
  s.settle(ids[1], true);
  assert.equal(s.getSnapshot().celebration, null);
  s.settle(ids[0], true);
  const first = s.getSnapshot().celebration;
  assert.equal(first.count, 3);
  submit(s, 4, true);
  assert.equal(s.getSnapshot().celebration, first);
  for (let i = 5; i <= 20; i++) {
    submit(s, i, true);
    if ([5, 10, 15, 20].includes(i)) assert.equal(s.getSnapshot().celebration.count, i);
  }
});

test('a late milestone response cannot celebrate a streak already broken by a pending answer', () => {
  const s = createPracticeStreak();
  const ids = [1, 2, 3].map(q => s.begin(q, 0, true));
  s.begin(4, 0, false);
  s.begin(5, 0, true);
  ids.forEach(id => s.settle(id, true));
  assert.equal(s.getSnapshot().celebration, null);
});

test('blocked or corrupt storage cannot break practice', () => {
  const s = createPracticeStreak({ getItem: () => '{bad', setItem: () => { throw Error('blocked'); } });
  submit(s, 1, true);
  assert.equal(s.getSnapshot().count, 1);
});

test('an older wrong answer does not dismiss a celebration in the new run', () => {
  const s = createPracticeStreak();
  submit(s, 1, false);
  for (let i = 2; i <= 4; i++) submit(s, i, true);
  const celebration = s.getSnapshot().celebration;
  assert.equal(celebration.count, 3);
  submit(s, 5, true);
  assert.equal(s.getSnapshot().celebration, celebration);
});
