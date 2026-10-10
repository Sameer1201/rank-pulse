import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const frontend = 'https://rank-cu1.pages.dev';
const api = 'https://rankpulse-api.rankpulsee.workers.dev';
const qbank = 'https://rankpulse-qbank.rankpulse-qbank.workers.dev';
const checks = [];
async function request(base, path, expected, init = {}) {
  const start = performance.now();
  const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  checks.push({ url: base + path, status: response.status, expected, milliseconds: Math.round(performance.now() - start) });
  assert.equal(response.status, expected, `${path}: unexpected status`);
  return { response, body };
}

try {
  for (const base of [api, frontend]) {
    assert.equal(JSON.parse((await request(base, '/api/healthz', 200)).body).probe, 1);
    assert.ok(Array.isArray(JSON.parse((await request(base, '/api/auth/exams', 200)).body)));
    for (const path of ['/api/auth/me', '/api/question-bank/saved-questions?limit=10', '/api/question-bank/reports?limit=10', '/api/dashboard/student']) {
      await request(base, path, 401);
    }
  }
  await request(qbank, '/healthz', 200);
  await request(qbank, '/query', 401, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'first', sql: 'SELECT 1', params: [] }) });
  const localHtml = await readFile(new URL('../artifacts/edtech/dist/public/index.html', import.meta.url), 'utf8');
  const asset = localHtml.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  assert.ok((await request(frontend, '/', 200)).body.includes(asset), 'Production must serve the newly built frontend');
  await request(frontend, asset, 200);

  // Optional legitimate login; credentials and session cookies remain in memory only.
  if (process.env.SMOKE_USERNAME && process.env.SEED_SUPER_ADMIN_PASSWORD) {
    const login = await request(frontend, '/api/auth/login', 200, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: frontend },
      body: JSON.stringify({ username: process.env.SMOKE_USERNAME, password: process.env.SEED_SUPER_ADMIN_PASSWORD }),
    });
    const cookie = login.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    assert.ok(cookie.includes('userId='), 'Login must issue a session');
    const headers = { cookie, origin: frontend };
    const me = JSON.parse((await request(frontend, '/api/auth/me', 200, { headers })).body);
    assert.ok(me.user || me.id, 'Session must restore a user');
    for (const path of ['/api/question-bank/exams', '/api/question-bank/reports?limit=10', '/api/tests', '/api/dashboard/super-admin']) {
      await request(frontend, path, 200, { headers });
    }
    await request(frontend, '/api/auth/logout', 200, { method: 'POST', headers });
  }
} finally {
  await writeFile(new URL('../artifacts/api-server/verification/20260922/live-smoke.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + '\n');
  console.log(JSON.stringify(checks, null, 2));
}
