import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { project_id: 'test-project', client_email: 'service@test-project.iam.gserviceaccount.com', private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
const path = '/api/auth/forgot-password-request';

function setup(t, failAt) {
  const f = fixture();
  f.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(account);
  delete f.env.QB_DB;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push(String(url));
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      const jwt = init.body.get('assertion');
      const [header, body, signature] = jwt.split('.');
      assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${body}`), publicKey, Buffer.from(signature, 'base64url')), true);
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
      assert.equal(claims.iss, account.client_email);
      assert.equal(claims.aud, String(url));
      assert.equal(claims.exp - claims.iat, 3600);
      return Response.json(failAt === 'oauth' ? { error: 'invalid_grant' } : { access_token: 'mock-access-token' }, { status: failAt === 'oauth' ? 401 : 200 });
    }
    assert.equal(String(url), 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode');
    assert.equal(init.headers.Authorization, 'Bearer mock-access-token');
    const body = JSON.parse(init.body);
    assert.equal(body.requestType, 'PASSWORD_RESET');
    assert.equal(body.returnOobLink, true); // Firebase must not send the email.
    assert.equal(body.targetProjectId, 'test-project');
    assert.match(body.email, /^(student|admin)@example.test$/);
    return Response.json(failAt === 'firebase' ? { error: { message: 'PERMISSION_DENIED' } } : { oobLink: 'https://test-project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=one-use-test-code&apiKey=fake-public-key' }, { status: failAt === 'firebase' ? 403 : 200 });
  });
  return { ...f, requests };
}

test('username request sends a real reset template through Gmail SMTP, never exposing the link in API or logs', async (t) => {
  const f = setup(t);
  const response = await f.request(path, { identifier: 'STUDENT' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.delivery, 'server');
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /From: RankPulse <admin@example.test>/);
  assert.match(f.messages[0], /To: student@example.test/);
  assert.match(f.messages[0], /https:\/\/app.example.test\/reset-password\?oobCode=one-use-test-code/);
  assert.match(f.messages[0], /A &lt;Student&gt;/);
  assert.doesNotMatch(JSON.stringify(payload), /one-use-test-code|mock-access-token/);
  const log = f.sql.prepare('SELECT * FROM email_send_logs').get();
  assert.equal(log.message_type, 'password-reset');
  assert.equal(log.status, 'sent');
  assert.doesNotMatch(JSON.stringify(log), /one-use-test-code|mock-access-token/);
  assert.ok(f.student().last_password_reset_email_at);
  assert.equal(f.student().password_hash, 'test'); // Requesting reset must not change a password.
});

test('registered email matches case-insensitively, for admins as well as students', async (t) => {
  const f = setup(t);
  assert.equal((await f.request(path, { identifier: ' ADMIN@EXAMPLE.TEST ' })).status, 200);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /To: admin@example.test/);
});

test('unknown accounts use the same generic response and send no mail', async (t) => {
  const f = setup(t);
  const absent = await f.request(path, { identifier: 'absent@example.test' });
  assert.equal(absent.status, 200);
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.length, 0);
  const actual = await f.request(path, { identifier: 'student' });
  assert.deepEqual(await absent.json(), await actual.json());
});

test('concurrent reset requests send one email and respect the 2 hour cooldown', async (t) => {
  const f = setup(t);
  const responses = await Promise.all([f.request(path, { identifier: 'student' }), f.request(path, { identifier: 'student' })]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal(f.messages.length, 1);
  assert.equal(f.requests.length, 2);
  f.sql.prepare('UPDATE users SET last_password_reset_email_at = ? WHERE id = 2').run(Date.now() - 2 * 3600000 - 1);
  assert.equal((await f.request(path, { identifier: 'student' })).status, 200);
  assert.equal(f.messages.length, 2);
});

for (const failure of ['oauth', 'firebase', 'smtp']) {
  test(`${failure} failure is not reported as success and releases cooldown for retry`, async (t) => {
    const f = setup(t, failure);
    if (failure === 'smtp') globalThis.__reviewTestSocket = () => { throw new Error('simulated SMTP failure'); };
    const response = await f.request(path, { identifier: 'student' });
    assert.equal(response.status, 503);
    assert.equal(f.student().last_password_reset_email_at, null);
    assert.equal(f.messages.length, 0);
    assert.equal(f.sql.prepare('SELECT status FROM email_send_logs').get().status, 'failed');
    assert.doesNotMatch(JSON.stringify(await response.json()), /mock-access-token|one-use-test-code/);
  });
}

test('missing credentials fail explicitly, with no Firebase client-delivery fallback', async (t) => {
  const f = setup(t);
  t.mock.method(console, 'error', () => {});
  delete f.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const response = await f.request(path, { identifier: 'student' });
  assert.equal(response.status, 503);
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.length, 0);
  assert.equal((await response.json()).delivery, undefined);
});

test('individual service-account environment variables are supported', async (t) => {
  const f = setup(t);
  delete f.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  Object.assign(f.env, { FIREBASE_PROJECT_ID: account.project_id, FIREBASE_CLIENT_EMAIL: account.client_email, FIREBASE_PRIVATE_KEY: account.private_key.replaceAll('\n', '\\n') });
  assert.equal((await f.request(path, { identifier: 'student' })).status, 200);
  assert.equal(f.messages.length, 1);
});

test('invalid input fails before contacting Firebase or Gmail', async (t) => {
  const f = setup(t);
  for (const body of [null, {}, { identifier: '  ' }, { identifier: 7 }, { identifier: 'x'.repeat(255) }]) {
    assert.equal((await f.request(path, body)).status, 400);
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.length, 0);
});

test('email log failure after delivery keeps cooldown and does not falsely report delivery failure', async (t) => {
  const f = setup(t);
  t.mock.method(console, 'error', () => {});
  f.sql.exec('DROP TABLE email_send_logs');
  assert.equal((await f.request(path, { identifier: 'student' })).status, 200);
  assert.equal(f.messages.length, 1);
  assert.ok(f.student().last_password_reset_email_at);
});
