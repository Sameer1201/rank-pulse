import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

const orderPath = '/api/users/me/student-feature-unlock/order';
const verifyPath = '/api/users/me/student-feature-unlock/verify';
const features = ['tests', 'analysis', 'question-bank'];
const accessKeys = { tests: 'testsLocked', analysis: 'analysisLocked', 'question-bank': 'questionBankLocked' };

function setup(t) {
  const f = fixture();
  Object.assign(f.env, { RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'test-only-secret' });
  f.sql.prepare('UPDATE users SET status = ?, student_profile_data = ? WHERE id = 2').run('approved', JSON.stringify({ featureAccess: { testsLocked: true, analysisLocked: true, questionBankLocked: true }, featureUnlockPricing: { testsAmount: 100, analysisAmount: 200, questionBankAmount: 300 } }));
  const orders = new Map();
  const payments = new Map();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls++;
    assert.match(String(url), /^https:\/\/api.razorpay.com\/v1\//);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from('rzp_test_fixture:test-only-secret').toString('base64')}`);
    const path = new URL(url).pathname.replace('/v1', '');
    if (path === '/orders') {
      const body = JSON.parse(init.body);
      const order = { ...body, id: `order_${orders.size + 1}` };
      orders.set(order.id, order);
      return Response.json(order);
    }
    if (path.startsWith('/orders/')) return Response.json(orders.get(path.split('/')[2]));
    const id = path.split('/')[2];
    const payment = payments.get(id);
    if (path.endsWith('/capture')) {
      assert.equal(JSON.parse(init.body).currency, 'INR');
      payment.status = 'captured';
    }
    return Response.json(payment);
  });
  const start = async (feature = 'tests') => {
    const response = await f.request(orderPath, { feature }, { userId: 2 });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const paymentId = `pay_${orders.size}`;
    payments.set(paymentId, { id: paymentId, order_id: payload.orderId, amount: payload.amountPaise, currency: 'INR', status: 'captured' });
    const signature = createHmac('sha256', f.env.RAZORPAY_KEY_SECRET).update(`${payload.orderId}|${paymentId}`).digest('hex');
    return { feature, orderId: payload.orderId, paymentId, signature };
  };
  const verify = (body) => f.request(verifyPath, body, { userId: 2 });
  return { ...f, start, verify, orders, payments, calls: () => calls };
}

for (const feature of features) test(`${feature}: successful payment unlocks only purchased feature and persists through refresh`, async (t) => {
  const f = setup(t);
  const body = await f.start(feature);
  const response = await f.verify(body);
  assert.equal(response.status, 200, await response.clone().text());
  const { user } = await response.json();
  assert.equal(user.role, 'student');
  for (const other of features) assert.equal(user.studentFeatureAccess[accessKeys[other]], other !== feature);
  assert.equal(user.studentFeaturePricing.testsAmount, 100);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM payment_history').get().count, 1);
  const refreshed = await f.request('/api/auth/me', undefined, { userId: 2, method: 'GET' });
  assert.equal((await refreshed.json()).studentFeatureAccess[accessKeys[feature]], false);
  assert.equal((await f.verify(body)).status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM payment_history').get().count, 1);
});

test('admin pricing edits affect checkout amount and retain independent feature locks', async (t) => {
  const f = setup(t);
  const result = await f.request('/api/users/2/student-feature-access', { testsLocked: true, testsAmount: 149.5 }, { method: 'PATCH', userId: 1 });
  assert.equal(result.status, 200);
  const user = await result.json();
  assert.equal(user.studentFeaturePricing.testsAmount, 149.5);
  const body = await f.start();
  assert.equal(f.orders.get(body.orderId).amount, 14950);
  assert.equal((await f.verify(body)).status, 200);
  assert.equal(JSON.parse(f.student().student_profile_data).studentFeatureAccess.questionBankLocked, true);
});

test('invalid signature, wrong owner, feature, currency and amount never unlock', async (t) => {
  const f = setup(t);
  const body = await f.start();
  assert.equal((await f.verify({ ...body, signature: 'a'.repeat(64) })).status, 400);
  const order = f.orders.get(body.orderId);
  for (const change of [{ notes: { studentId: '3', feature: 'tests' } }, { notes: { studentId: '2', feature: 'analysis' } }, { currency: 'USD' }, { amount: 1 }]) {
    const saved = structuredClone(order);
    Object.assign(order, change);
    assert.equal((await f.verify(body)).status, 400);
    Object.assign(order, saved);
  }
  const payment = f.payments.get(body.paymentId);
  for (const change of [{ order_id: 'order_other' }, { id: 'pay_other' }, { amount: 1 }, { currency: 'USD' }, { status: 'failed' }]) {
    const saved = structuredClone(payment);
    Object.assign(payment, change);
    assert.equal((await f.verify(body)).status, 400);
    Object.assign(payment, saved);
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM payment_history').get().count, 0);
});

test('authorized payment is captured before unlock', async (t) => {
  const f = setup(t);
  const body = await f.start();
  f.payments.get(body.paymentId).status = 'authorized';
  assert.equal((await f.verify(body)).status, 200);
  assert.equal(f.payments.get(body.paymentId).status, 'captured');
});

test('old payment cannot unlock a newly relocked feature', async (t) => {
  const f = setup(t);
  const body = await f.start();
  assert.equal((await f.verify(body)).status, 200);
  await f.request('/api/users/2/student-feature-access', { testsLocked: true }, { method: 'PATCH', userId: 1 });
  assert.equal((await f.verify(body)).status, 409);
  assert.equal(JSON.parse(f.student().student_profile_data).studentFeatureAccess.testsLocked, true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM payment_history').get().count, 1);
});

test('simultaneous purchases for different features preserve both payment records and locks', async (t) => {
  const f = setup(t);
  const a = await f.start('tests');
  const b = await f.start('analysis');
  const responses = await Promise.all([f.verify(a), f.verify(b)]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM payment_history').get().count, 2);
  const profile = JSON.parse(f.student().student_profile_data);
  assert.equal(profile.studentFeatureAccess.testsLocked, false);
  assert.equal(profile.studentFeatureAccess.analysisLocked, false);
  assert.equal(profile.studentFeatureAccess.questionBankLocked, true);
});

test('failed ledger insert rolls back unlock so verification can be retried', async (t) => {
  const f = setup(t);
  const body = await f.start();
  f.sql.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON payment_history BEGIN SELECT RAISE(ABORT, 'test ledger failure'); END;");
  assert.equal((await f.verify(body)).status, 502);
  assert.equal(JSON.parse(f.student().student_profile_data).featureAccess.testsLocked, true);
  f.sql.exec('DROP TRIGGER fail_payment');
  assert.equal((await f.verify(body)).status, 200);
});

test('unauthenticated callers cannot create orders', async (t) => {
  const f = setup(t);
  assert.equal((await f.request(orderPath, { feature: 'tests' })).status, 401);
  assert.equal(f.calls(), 0);
});

test('portal reject sends reason to student, requires a reason and skips a repeated decision', async () => {
  const f = fixture();
  const options = { method: 'PATCH', userId: 1 };
  assert.equal((await f.request('/api/users/2/approve', { status: 'rejected' }, options)).status, 400);
  assert.equal(f.student().status, 'pending');
  const decision = { status: 'rejected', reason: 'Please correct your college name.' };
  assert.equal((await f.request('/api/users/2/approve', decision, options)).status, 200);
  await f.finish();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /To: student@example.test/);
  assert.match(f.messages[0], /Please correct your college name/);
  assert.equal((await f.request('/api/users/2/approve', decision, options)).status, 200);
  await f.finish();
  assert.equal(f.messages.length, 1);
});

test('forged user-ID cookies, modified signed cookies and expired sessions cannot start payments', async (t) => {
  const f = setup(t);
  const cookies = ['userId=2', 'userId=1; userRole=super_admin', f.sessionCookie(2).slice(0,-1) + 'z', f.sessionCookie(2, Date.now() - 1000), 'userId=%bad'];
  for (const cookie of cookies) {
    assert.equal((await f.request(orderPath, { feature: 'tests' }, { cookie })).status, 401);
    assert.equal((await f.request('/api/auth/me', undefined, { cookie, method: 'GET' })).status, 401);
  }
  assert.equal(f.calls(), 0);
});

test('password login issues a revocable session accepted by account refresh', async () => {
  const f = fixture();
  const { createHash } = await import('node:crypto');
  const password = 'fixture-password';
  f.sql.prepare('UPDATE users SET password_hash = ? WHERE id = 2').run(createHash('sha256').update(password + 'edtech_salt_2024').digest('hex'));
  const login = await f.request('/api/auth/login', { username: 'student', password });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().find((value) => value.startsWith('userId=')).split(';')[0];
  assert.match(cookie, /userId=v2\.[a-f0-9]{64}/);
  const me = await f.request('/api/auth/me', undefined, { cookie, method: 'GET' });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, 2);
});
