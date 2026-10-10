import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Run the deployed Worker with real SQLite SQL and a local SMTP double. No network or real emails.
const bundled = await build({
  entryPoints: [new URL('../../src/cloudflare-worker.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:crypto'],
  plugins: [{ name: 'smtp-double', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:sockets$/ }, () => ({ path: 'smtp', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const connect = () => globalThis.__reviewTestSocket();` }));
  } }],
});
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const signingBundle = await build({ entryPoints: [new URL('../../src/lib/workerStudentReview.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { buildWorkerStudentReviewUrl } = await import(`data:text/javascript;base64,${Buffer.from(signingBundle.outputFiles[0].text).toString('base64')}`);
const schemaSource = await readFile(new URL('../../../../lib/db/src/d1Schema.ts', import.meta.url), 'utf8');
const schema = schemaSource.slice(schemaSource.indexOf('`') + 1, schemaSource.lastIndexOf('`'));
const authSchema = await readFile(new URL('../../migrations/20261004_auth_security.sql', import.meta.url), 'utf8');
const timerSchema = (await readFile(new URL('../../migrations/20261002_student_question_timers.sql', import.meta.url), 'utf8')).split('INSERT INTO student_question_timers')[0];
const activitySchema = await readFile(new URL('../../migrations/20261004_student_weekly_activity.sql', import.meta.url), 'utf8');
const dashboardSchema = await readFile(new URL('../../migrations/20261004_student_dashboard_cache.sql', import.meta.url), 'utf8');
const dailyCacheSchema = (await readFile(new URL('../../migrations/20261005_student_read_efficiency.sql', import.meta.url), 'utf8')).split('CREATE INDEX')[0];

export function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(schema);
  sql.exec(authSchema);
  sql.exec(timerSchema);
  sql.exec(activitySchema);
  sql.exec(dashboardSchema);
  sql.exec(dailyCacheSchema);
  sql.exec(`INSERT INTO users (id, username, password_hash, full_name, email, role, status) VALUES (1, 'admin', 'test', 'Super Admin', 'admin@example.test', 'super_admin', 'active');
    INSERT INTO users (id, username, password_hash, full_name, email, role, status, onboarding_complete, pending_review_started_at) VALUES (2, 'student', 'test', 'A <Student>', 'student@example.test', 'student', 'pending', 1, 1000);`);
  const DB = { batch(statements) {
    sql.exec("BEGIN");
    try { const results = statements.map((statement) => statement.execute()); sql.exec("COMMIT"); return Promise.resolve(results); } catch (error) { sql.exec("ROLLBACK"); return Promise.reject(error); }
  }, prepare(query) {
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() { return sql.prepare(query).get(...params) ?? null; },
      async all() { return { results: sql.prepare(query).all(...params) }; },
      execute() { const result = sql.prepare(query).run(...params); return { success: true, meta: { last_row_id: result.lastInsertRowid, changes: result.changes } }; },
      async run() { return this.execute(); },
    };
  } };
  const env = { DB, QB_DB: DB, SESSION_SECRET: 'test-session-secret-at-least-32-characters-long', PUBLIC_APP_URL: 'https://app.example.test', GMAIL_USER: 'admin@example.test', GMAIL_APP_PASSWORD: 'fake smtp password', STUDENT_REVIEW_EMAIL_ACTION_SECRET: 'test-only-secret-that-is-not-a-real-credential' };
  const messages = [];
  globalThis.__reviewTestSocket = () => ({
    readable: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('220 ready\r\n250 hello\r\n235 authenticated\r\n250 sender\r\n250 recipient\r\n354 send\r\n250 accepted\r\n221 bye\r\n')); } }),
    writable: new WritableStream({ write(chunk) { const text = new TextDecoder().decode(chunk); if (text.startsWith('Date:')) messages.push(text); } }),
    close() {},
  });
  const sessionCookie = (userId, expiresAt = Date.now() + 7 * 86400000) => {
    const token = 'v2.' + randomBytes(32).toString('hex');
    sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),userId,expiresAt,Date.now());
    return `userId=${token}`;
  };
  const background = [];
  const ctx = { waitUntil(promise) { background.push(promise); } };
  const student = () => sql.prepare('SELECT * FROM users WHERE id = 2').get();
  const recipient = { reviewerId: 1, reviewerName: 'Super Admin', email: 'admin@example.test' };
  const link = (action = 'approve', who = recipient) => buildWorkerStudentReviewUrl(env, env.PUBLIC_APP_URL, student(), who, action);
  const fetch = (url, method = 'GET', reason) => {
    const body = new URL(url).searchParams;
    if (reason !== undefined) body.set('reason', reason);
    return worker.fetch(new Request(url, method === 'POST' ? { method, body } : { method }), env, ctx);
  };
  const finish = () => Promise.all(background);
  const onboard = (final = true, id = 2) => worker.fetch(new Request(`${env.PUBLIC_APP_URL}/api/auth/student-onboarding${final ? '' : '/draft'}`, { method: 'POST', headers: { cookie: sessionCookie(id), 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'A <Student>', profileDetails: { preparation: { targetExam: 'NEET' } } }) }), env, ctx);
  const request = (path, body, options = {}) => {
    const req = new Request(`${env.PUBLIC_APP_URL}${path}`, { method: options.method ?? 'POST', headers: { 'content-type': 'application/json', ...(options.userId ? { cookie: sessionCookie(options.userId) } : {}), ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (options.cf) Object.defineProperty(req, 'cf', { value: options.cf });
    return worker.fetch(req, env, ctx);
  };
  return { sql, env, student, link, fetch, finish, messages, onboard, request, sessionCookie };
}
