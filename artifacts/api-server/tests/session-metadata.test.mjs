import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';
const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const options = { userId: 2, headers: { 'user-agent': desktop, 'cf-connecting-ip': '203.0.113.17' }, cf: { city: 'Mumbai', region: 'Maharashtra', country: 'IN' } };
const start = '/api/activity/session/start';
const heartbeat = '/api/activity/heartbeat';
const session = (f) => f.sql.prepare('SELECT * FROM user_sessions WHERE user_id = 2 ORDER BY id DESC LIMIT 1').get();

test('token-only session start derives location, device and browser on the server', async () => {
  const f = fixture();
  assert.equal((await f.request(start, { sessionToken: 'browser-tab' }, options)).status, 200);
  const row = session(f);
  assert.equal(row.location_label, 'Mumbai, Maharashtra, India');
  assert.equal(row.browser_name, 'Safari');
  assert.equal(row.device_type, 'Desktop');
  assert.equal(row.ip_address, '203.0.113.17');
});

test('resuming a tab updates metadata without creating a duplicate session', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) await f.request(start, { sessionToken: 'browser-tab' }, options);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 1);
  await f.request(heartbeat, { sessionToken: 'browser-tab' }, { ...options, headers: { ...options.headers, 'user-agent': android } });
  assert.equal(session(f).browser_name, 'Chrome');
  assert.equal(session(f).device_type, 'Mobile');
});

test('heartbeat repairs blank metadata for an old active session', async () => {
  const f = fixture();
  f.sql.prepare('INSERT INTO user_sessions (user_id, session_token, user_agent, started_at, last_active_at, is_active) VALUES (2, ?, ?, ?, ?, 1)').run('old-tab', desktop, Date.now(), Date.now());
  await f.request(heartbeat, { sessionToken: 'old-tab' }, options);
  assert.equal(session(f).location_label, 'Mumbai, Maharashtra, India');
  assert.equal(session(f).browser_name, 'Safari');
});

test('country-only metadata and missing metadata have honest fallbacks; body cannot override detection', async () => {
  const f = fixture();
  await f.request(start, { sessionToken: 'country-tab', browserName: 'Fake Browser', deviceType: 'Fake Device', locationLabel: 'Fake Location' }, { userId: 2, headers: { 'user-agent': android, 'cf-ipcountry': 'IN' } });
  assert.equal(session(f).location_label, 'India');
  assert.equal(session(f).browser_name, 'Chrome');
  await f.request(start, { sessionToken: 'unknown-tab' }, { userId: 2, cf: { country: 'XX' } });
  assert.equal(session(f).location_label, null);
  assert.equal(session(f).browser_name, null);
  assert.equal(session(f).device_type, null);
});

test('location is not carried across different IP addresses without new location data', async () => {
  const f = fixture();
  await f.request(start, { sessionToken: 'moving-tab' }, options);
  await f.request(heartbeat, { sessionToken: 'moving-tab' }, { userId: 2, headers: { 'cf-connecting-ip': '203.0.113.18', 'user-agent': desktop } });
  assert.equal(session(f).ip_address, '203.0.113.18');
  assert.equal(session(f).location_label, null);
});

test('activity overview counts a user online when any session has a fresh heartbeat', async () => {
  const f = fixture();
  const now = Date.now();
  f.sql.prepare(`INSERT INTO user_sessions (user_id, session_token, started_at, last_active_at, is_active)
    VALUES (2, 'active-tab', ?, ?, 1)`).run(now - 60_000, now - 20_000);
  f.sql.prepare(`INSERT INTO user_sessions (user_id, session_token, started_at, last_active_at, ended_at, is_active)
    VALUES (2, 'closed-tab', ?, ?, ?, 0)`).run(now - 60_000, now - 5_000, now - 5_000);

  const response = await f.request('/api/activity/overview', undefined, { userId: 1, method: 'GET' });
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.equal(overview.find((user) => user.id === 2).isOnline, true);
});

test('activity overview expires online status after a session heartbeat goes stale', async () => {
  const f = fixture();
  const now = Date.now();
  f.sql.prepare(`INSERT INTO user_sessions (user_id, session_token, started_at, last_active_at, is_active)
    VALUES (2, 'stale-tab', ?, ?, 1)`).run(now - 6 * 60_000, now - 4 * 60_000);

  const response = await f.request('/api/activity/overview', undefined, { userId: 1, method: 'GET' });
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.equal(overview.find((user) => user.id === 2).isOnline, false);
});

for (const [ua, browser, device] of [
  [android.replace('Mobile ', ''), 'Chrome', 'Tablet'],
  [android + ' EdgA/128.0', 'Edge', 'Mobile'],
  [android + ' SamsungBrowser/25.0', 'Samsung Internet', 'Mobile'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FxiOS/128.0 Mobile/15 Safari/605.1', 'Firefox', 'Mobile'],
  ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/128.0 Mobile/15 Safari/605.1', 'Chrome', 'Tablet'],
]) test(`${browser} on ${device} is identified`, async () => {
  const f = fixture();
  await f.request(start, { sessionToken: 'device-test' }, { userId: 2, headers: { 'user-agent': ua } });
  assert.equal(session(f).browser_name, browser);
  assert.equal(session(f).device_type, device);
});

test('historical sessions use their stored User-Agent when browser/device columns are blank', async () => {
  const f = fixture();
  f.sql.prepare('INSERT INTO user_sessions (user_id, session_token, user_agent, started_at, last_active_at) VALUES (2, ?, ?, ?, ?)').run('historical-tab', desktop, Date.now(), Date.now());
  const response = await f.request('/api/activity/user/2', undefined, { userId: 1, method: 'GET' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sessions[0].browserName, 'Safari');
  assert.equal(payload.sessions[0].deviceType, 'Desktop');
});
