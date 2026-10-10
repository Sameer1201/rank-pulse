import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status TEXT,full_name TEXT);
CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER,created_at INTEGER);
CREATE TABLE classes(id INTEGER PRIMARY KEY,admin_id INTEGER,assigned_teacher_ids TEXT);
CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
INSERT INTO users VALUES(1,'super_admin','active','Admin'),(2,'student','approved','Student');
INSERT INTO classes VALUES(7,1,'[]'); INSERT INTO enrollments VALUES(1,7,2);`);
globalThis.__securitySql = async (query, params = []) => {
  const statement = sql.prepare(query);
  return statement.columns().length ? { rows: statement.all(...params) } : { rows: [], meta: statement.run(...params) };
};
async function load(path) {
  const output = await build({ entryPoints: [new URL(path, import.meta.url).pathname], platform: 'node', bundle: true, format: 'cjs', write: false,
    plugins: [{ name: 'local-security-db', setup(b) {
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: 'db', namespace: 'test' }));
      b.onResolve({ filter: /(?:\.\/|\.\.\/)lib\/logger$/ }, () => ({ path: 'logger', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'db' ? 'export const executeD1Sql = (...args) => globalThis.__securitySql(...args);' : 'export const logger={error(){},warn(){},info(){}};' }));
    } }],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports;
}
const sessions = await load('../src/lib/nodeSession.ts');
const helpers = await load('../src/lib/authUtils.ts');

function authenticate(cookie, cookies = {}) {
  const req = { headers: { cookie }, cookies, signedCookies: { userId: '1' } };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  return sessions.authenticateNodeSession(req, res, () => { res.next = true; }).then(() => ({ req, res }));
}
test('plain/signed numeric cookies and forged role cookies cannot authenticate Node API', async () => {
  for (const cookie of ['userId=1; userRole=super_admin', 'userId=s%3A1.fake-signature; userRole=super_admin', 'userId=%E0%A4%A; userRole=super_admin']) {
    const { req, res } = await authenticate(cookie, { userId: '1', userRole: 'super_admin' });
    assert.equal(res.next, true); assert.equal(helpers.getSignedUserId(req), null); assert.equal(req.cookies.userRole, undefined); assert.equal(req.signedCookies.userId, undefined);
  }
});
test('opaque Node sessions derive role from database, honor revocation and disabled status', async () => {
  const token = await sessions.createNodeSession(2);
  let result = await authenticate(`userId=${token}; userRole=super_admin`, { userRole: 'super_admin' });
  assert.equal(helpers.getSignedUserId(result.req), 2); assert.equal(result.req.cookies.userRole, 'student');
  sql.prepare('UPDATE users SET status=? WHERE id=2').run('disabled');
  assert.equal(helpers.getSignedUserId((await authenticate(`userId=${token}`)).req), null);
  sql.prepare('UPDATE users SET status=? WHERE id=2').run('approved');
  await sessions.revokeNodeSession({ headers: { cookie: `userId=${token}` } });
  assert.equal(helpers.getSignedUserId((await authenticate(`userId=${token}`)).req), null);
});
test('revoking one device retains another; revoking all devices removes both', async () => {
  const first = await sessions.createNodeSession(2); const second = await sessions.createNodeSession(2);
  await sessions.revokeNodeSession({ headers: { cookie: `userId=${first}` } });
  assert.equal(helpers.getSignedUserId((await authenticate(`userId=${second}`)).req), 2);
  await sessions.revokeNodeUserSessions(2);
  assert.equal(helpers.getSignedUserId((await authenticate(`userId=${second}`)).req), null);
});

const live = await load('../src/live.ts');
test('live upgrade rejects anonymous sockets, hostile origins and unenrolled students', async () => {
  const wss = { handleUpgrade() { throw new Error('Unauthorized connection upgraded'); } };
  for (const headers of [{ cookie: 'userId=1' }, { cookie: `userId=${await sessions.createNodeSession(2)}`, origin: 'https://evil.example.test' }]) {
    const socket = { destroy() { this.destroyed = true; } };
    await live.handleUpgrade(wss, { url: '/api/live/7', headers: { host: 'app.example.test', ...headers } }, socket, Buffer.alloc(0));
    assert.equal(socket.destroyed, true);
  }
  sql.exec('DELETE FROM enrollments');
  const socket = { destroy() { this.destroyed = true; } };
  await live.handleUpgrade(wss, { url: '/api/live/7', headers: { host: 'app.example.test', cookie: `userId=${await sessions.createNodeSession(2)}` } }, socket, Buffer.alloc(0));
  assert.equal(socket.destroyed, true);
  sql.exec('INSERT INTO enrollments VALUES(1,7,2)');
});

test('student join cannot spoof teacher role, user ID or display name', () => {
  const wss = live.createLiveServer();
  const sent = [];
  const ws = new EventEmitter(); ws.readyState = 1; ws.send = data => sent.push(JSON.parse(data));
  wss.emit('connection', ws, {}, { classId: 7, userId: 2, role: 'student', name: 'Verified Student' });
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'join', userId: 1, role: 'teacher', name: 'Forged Admin' })));
  assert.equal(sent[0].hasTeacher, false);
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'chat', text: 'Hello' })));
  assert.equal(sent[1].senderId, 2); assert.equal(sent[1].senderRole, 'student'); assert.equal(sent[1].senderName, 'Verified Student');
  ws.emit('close'); wss.close();
});
