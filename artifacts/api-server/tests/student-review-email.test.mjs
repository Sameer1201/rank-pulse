import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

test('email GET and HEAD never approve; POST saves once and sends student email without a session', async () => {
  const f = fixture();
  delete f.env.QB_DB; // Review must not depend on the question-bank service.
  const url = await f.link();
  const preview = await f.fetch(url);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /Confirm Approval/);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  assert.equal((await f.fetch(url, 'HEAD')).status, 200);
  assert.equal(f.student().status, 'pending');
  assert.equal((await f.fetch(url, 'POST')).status, 200);
  assert.equal(f.student().status, 'approved');
  assert.equal(f.student().reviewed_by_id, 1);
  assert.equal(f.student().approved_by_id, 1);
  assert.equal(f.student().pending_review_started_at, null);
  assert.equal((await f.fetch(url, 'POST')).status, 409);
  await f.finish();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /Your profile has been approved/);
});

test('reject requires a bounded reason, preserves it, escapes HTML, and notifies the student', async () => {
  const f = fixture();
  const url = await f.link('reject');
  assert.match(await (await f.fetch(url)).text(), /textarea/);
  for (const reason of ['', '    ', 'no', 'x'.repeat(2001)]) {
    assert.equal((await f.fetch(url, 'POST', reason)).status, 400);
    assert.equal(f.student().status, 'pending');
  }
  const reason = '  Please correct <script>address</script> & phone.  ';
  assert.equal((await f.fetch(url, 'POST', reason)).status, 200);
  assert.equal(f.student().rejection_reason, reason.trim());
  assert.equal(f.student().approved_at, null);
  await f.finish();
  assert.match(f.messages[0], /&lt;script&gt;address&lt;\/script&gt; &amp; phone/);
  assert.doesNotMatch(f.messages[0], /<script>/);
});

test('tampering with signed fields is rejected', async () => {
  const f = fixture();
  const url = await f.link();
  for (const [key, value] of Object.entries({ studentId: '3', reviewerId: '2', action: 'reject', cycleAt: '2000', expiresAt: String(Date.now() + 99999999), email: 'other@example.test', sig: 'a'.repeat(64) })) {
    const tampered = new URL(url);
    tampered.searchParams.set(key, value);
    assert.equal((await f.fetch(tampered, 'POST')).status, 403, key);
  }
  assert.equal(f.student().status, 'pending');
});

test('expired links, disabled actions, and removed super admins cannot decide', async () => {
  const f = fixture();
  const realNow = Date.now;
  let expired;
  try { Date.now = () => realNow() - 8 * 86400000; expired = await f.link(); } finally { Date.now = realNow; }
  assert.equal((await f.fetch(expired, 'POST')).status, 410);
  const url = await f.link();
  f.sql.exec('INSERT INTO platform_settings (id, student_review_email_actions_enabled) VALUES (1, 0)');
  assert.equal((await f.fetch(url, 'POST')).status, 423);
  f.sql.exec("UPDATE platform_settings SET student_review_email_actions_enabled = 1; UPDATE users SET role = 'admin' WHERE id = 1");
  assert.equal((await f.fetch(url, 'POST')).status, 403);
});

test('concurrent approve and reject cannot overwrite the first decision', async () => {
  const f = fixture();
  const [approve, reject] = await Promise.all([f.link(), f.link('reject')]);
  const results = await Promise.all([f.fetch(approve, 'POST'), f.fetch(reject, 'POST', 'Details incorrect')]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  await f.finish();
  assert.equal(f.messages.length, 1);
});

test('final resubmission resets rejection and sends working action links; drafts do not send email', async () => {
  const f = fixture();
  const oldLink = await f.link();
  f.sql.exec("UPDATE users SET status = 'rejected', rejection_reason = 'Wrong phone', reviewed_by_id = 1, reviewed_at = 10 WHERE id = 2");
  assert.equal((await f.onboard(false)).status, 200);
  assert.equal(f.messages.length, 0);
  assert.equal(f.student().status, 'rejected');
  assert.equal((await f.onboard()).status, 200);
  assert.equal(f.student().status, 'pending');
  assert.equal(f.student().rejection_reason, null);
  assert.equal(f.student().reviewed_at, null);
  assert.equal((await f.fetch(oldLink, 'POST')).status, 409);
  await f.finish();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /Approve Student/);
  assert.match(f.messages[0], /Reject with Reason/);
  const approve = f.messages[0].match(/href="([^"]+action=approve[^"]+)"/)[1].replaceAll('&amp;', '&');
  assert.equal((await f.fetch(approve, 'POST')).status, 200);
  await f.finish();
  assert.equal((await f.onboard(true, 1)).status, 403);
});

test('email quick action setting hides buttons, while email setting suppresses review mail', async () => {
  const f = fixture();
  f.sql.exec('INSERT INTO platform_settings (id, student_review_email_actions_enabled) VALUES (1, 0)');
  await f.onboard();
  await f.finish();
  assert.equal(f.messages.length, 1);
  assert.doesNotMatch(f.messages[0], /action=approve/);
  assert.match(f.messages[0], /Open Student Approvals/);
  f.sql.exec('UPDATE platform_settings SET student_review_email_enabled = 0');
  await f.onboard();
  await f.finish();
  assert.equal(f.messages.length, 1);
});

test('configured review mailbox can decide and SMTP secret fallback works without a public fallback', async () => {
  const f = fixture();
  delete f.env.STUDENT_REVIEW_EMAIL_ACTION_SECRET;
  f.env.SUPER_ADMIN_REVIEW_EMAIL = 'reviews@example.test';
  const url = await f.link('approve', { reviewerId: null, reviewerName: 'Super Admin', email: 'reviews@example.test' });
  assert.equal((await f.fetch(url, 'POST')).status, 200);
  await f.finish();
  delete f.env.GMAIL_APP_PASSWORD;
  await assert.rejects(() => f.link(), /signing secret is not configured/);
});
