import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { fixture } from './helpers/worker-fixture.mjs';

function passwordHash(password) {
  const salt = '0123456789abcdef0123456789abcdef';
  return `scrypt$16384$8$5$${salt}$${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 67108864 }).toString('hex')}`;
}
function identity(f, { email = 'admin@example.test', verified = false, provider = 'password', tokenProvider = provider } = {}) {
  f.env.FIREBASE_WEB_API_KEY = 'public-test-api-key';
  const claims = { sub: 'firebase-user', email, firebase: { sign_in_provider: tokenProvider } };
  const token = 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
  globalThis.fetch = async () => Response.json({ users: [{ localId: claims.sub, email, emailVerified: verified, providerUserInfo: [{ providerId: 'google.com' }, { providerId: provider }] }] });
  return token;
}
async function withNetwork(fn) {
  const old = globalThis.fetch;
  try { await fn(); } finally { globalThis.fetch = old; }
}

test('onboarding draft cannot change paid locks/pricing/payments or overwrite server metadata', async () => {
  const f = fixture();
  const protectedProfile = { featureAccess: { questionBankLocked: true }, studentFeatureAccess: { testsLocked: true }, featureUnlockPricing: { questionBank: 899 }, paymentHistory: [{ paymentId: 'paid-server-record' }], dashboard: { dailyQuestionGoal: 50 }, securityBinding: 'server-only', preparation: { collegeName: 'Old college' } };
  f.sql.prepare('UPDATE users SET student_profile_data=?, status=? WHERE id=2').run(JSON.stringify(protectedProfile), 'active');
  const res = await f.request('/api/auth/student-onboarding/draft', { profileDetails: { featureAccess: { questionBankLocked: false }, studentFeatureAccess: { testsLocked: false }, featureUnlockPricing: { questionBank: 0 }, paymentHistory: [], dashboard: { dailyQuestionGoal: 100000 }, securityBinding: 'forged', preparation: { collegeName: 'New college', maliciousField: true }, __proto__: { admin: true } } }, { userId: 2 });
  assert.equal(res.status, 200);
  const saved = JSON.parse(f.student().student_profile_data);
  for (const key of ['featureAccess', 'studentFeatureAccess', 'featureUnlockPricing', 'paymentHistory', 'dashboard', 'securityBinding']) assert.deepEqual(saved[key], protectedProfile[key]);
  assert.equal(saved.preparation.collegeName, 'New college');
  assert.equal(saved.preparation.maliciousField, undefined);
  assert.equal(f.student().status, 'active');
  await f.finish();
});

test('omitted onboarding profile preserves existing locks, final submission never elevates role', async () => {
  const f = fixture();
  f.sql.prepare('UPDATE users SET student_profile_data=? WHERE id=2').run(JSON.stringify({ featureAccess: { pyqLocked: true }, serverOnly: 1 }));
  assert.equal((await f.request('/api/auth/student-onboarding/draft', { fullName: 'Updated' }, { userId: 2 })).status, 200);
  assert.equal(JSON.parse(f.student().student_profile_data).featureAccess.pyqLocked, true);
  assert.equal((await f.request('/api/auth/student-onboarding', { profileDetails: { featureAccess: {} }, role: 'super_admin', status: 'approved' }, { userId: 2 })).status, 200);
  assert.equal(JSON.parse(f.student().student_profile_data).serverOnly, 1);
  assert.equal(f.student().role, 'student');
  assert.equal(f.student().status, 'pending');
  await f.finish();
});

test('unverified Firebase victim email cannot link an admin session or reset its password', () => withNetwork(async () => {
  const f = fixture(); const token = identity(f);
  for (const path of ['/api/auth/firebase-email', '/api/auth/google']) {
    const res = await f.request(path, { idToken: token, password: 'wrong' });
    assert.equal(res.status, 401); assert.equal(res.headers.get('set-cookie'), null);
  }
  assert.equal((await f.request('/api/auth/password-reset/finalize', { idToken: token, email: 'admin@example.test', newPassword: 'attacker123' })).status, 400);
  assert.equal(f.sql.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash, 'test');
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
}));

test('Google login requires actual sign-in provider and verified email, not a linked provider', () => withNetwork(async () => {
  const f = fixture();
  assert.equal((await f.request('/api/auth/google', { idToken: identity(f, { verified: true, tokenProvider: 'password' }) })).status, 401);
  assert.equal((await f.request('/api/auth/google', { idToken: identity(f, { provider: 'google.com' }) })).status, 401);
  const res = await f.request('/api/auth/google', { idToken: identity(f, { verified: true, provider: 'google.com' }) });
  assert.equal(res.status, 200); assert.match(res.headers.get('set-cookie'), /userId=v2\./);
}));

test('unverified email login is permitted only with the existing app password; unknown users cannot be auto-created', () => withNetwork(async () => {
  const f = fixture(); f.sql.prepare('UPDATE users SET password_hash=? WHERE id=2').run(passwordHash('valid-password'));
  const token = identity(f, { email: 'student@example.test' });
  assert.equal((await f.request('/api/auth/firebase-email', { idToken: token, password: 'wrong' })).status, 401);
  assert.equal((await f.request('/api/auth/firebase-email', { idToken: token, password: 'valid-password' })).status, 200);
  assert.equal((await f.request('/api/auth/firebase-email', { idToken: identity(f, { email: 'unknown@example.test', verified: true }) })).status, 401);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM users').get().n, 2);
}));

test('password reset requires a valid one-use code and revokes all existing sessions', () => withNetwork(async () => {
  const f = fixture(); f.env.FIREBASE_WEB_API_KEY = 'test';
  const oldSession = f.sessionCookie(1); let used = false; let consumes = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (used || body.oobCode !== 'one-use-code') return Response.json({ error: {} }, { status: 400 });
    if (body.newPassword) { used = true; consumes++; }
    return Response.json({ email: 'admin@example.test', requestType: 'PASSWORD_RESET' });
  };
  const res = await f.request('/api/auth/password-reset/finalize', { oobCode: 'one-use-code', email: 'admin@example.test', newPassword: 'new-password' });
  assert.equal(res.status, 200); assert.equal(consumes, 1);
  assert.match(f.sql.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash, /^scrypt\$/);
  assert.equal((await f.request('/api/auth/me', undefined, { method: 'GET', cookie: oldSession })).status, 401);
  assert.equal((await f.request('/api/auth/password-reset/finalize', { oobCode: 'one-use-code', newPassword: 'other-password' })).status, 401);
  assert.equal(consumes, 1);
}));

test('reset email mismatch is rejected before consuming the code', () => withNetwork(async () => {
  const f = fixture(); f.env.FIREBASE_WEB_API_KEY = 'test'; let consumes = 0;
  globalThis.fetch = async (_url, options) => { if (JSON.parse(options.body).newPassword) consumes++; return Response.json({ email: 'student@example.test', requestType: 'PASSWORD_RESET' }); };
  assert.equal((await f.request('/api/auth/password-reset/finalize', { oobCode: 'valid', email: 'admin@example.test', newPassword: 'attacker123' })).status, 401);
  assert.equal(consumes, 0); assert.equal(f.student().password_hash, 'test');
}));

test('fake reset link signature and future expiry cannot validate an invalid Firebase code', () => withNetwork(async () => {
  const f = fixture(); f.env.FIREBASE_WEB_API_KEY = 'test'; globalThis.fetch = async () => Response.json({ error: {} }, { status: 400 });
  assert.equal((await f.request('/api/auth/password-reset-link/validate', { oobCode: 'invalid', sig: 'forged', expiresAt: Date.now() + 9999999 })).status, 400);
}));

test('student cannot read another profile, forge a role cookie, or review a staff account', async () => {
  const f = fixture();
  assert.equal((await f.request('/api/users/1', undefined, { method: 'GET', cookie: f.sessionCookie(2) + '; userRole=super_admin' })).status, 403);
  assert.equal((await f.request('/api/users/2', undefined, { method: 'GET', userId: 2 })).status, 200);
  assert.equal((await f.request('/api/users/1/approve', { status: 'approved' }, { userId: 1, method: 'PATCH' })).status, 403);
});

test('oversized auth payload without Content-Length is rejected before token verification', () => withNetwork(async () => {
  const f = fixture(); let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not call'); };
  const res = await f.request('/api/auth/firebase-email', { idToken: 'x'.repeat(70000) });
  assert.equal(res.status, 413); assert.equal(calls, 0);
}));

test('historically exposed privileged demo credentials cannot create password sessions', () => withNetwork(async () => {
  const f = fixture(); f.sql.prepare('UPDATE users SET password_hash=? WHERE id=1').run(passwordHash('Tapu@123'));
  let res = await f.request('/api/auth/login', { username: 'admin', password: 'Tapu@123' });
  assert.equal(res.status, 403); assert.equal(res.headers.get('set-cookie'), null);
  res = await f.request('/api/auth/firebase-email', { idToken: identity(f, { verified: true }), password: 'Tapu@123' });
  assert.equal(res.status, 403); assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
}));

test('verified Firebase password tokens cannot bypass a later application password change', () => withNetwork(async () => {
  const f = fixture(); f.sql.prepare('UPDATE users SET password_hash=? WHERE id=1').run(passwordHash('current-strong-password'));
  const idToken = identity(f, { verified: true });
  for (const password of [undefined, 'Tapu@123', 'previous-password']) {
    const res = await f.request('/api/auth/firebase-email', { idToken, password });
    assert.equal(res.status, 401); assert.equal(res.headers.get('set-cookie'), null);
  }
  const res = await f.request('/api/auth/firebase-email', { idToken, password: 'current-strong-password' });
  assert.equal(res.status, 200);
}));
