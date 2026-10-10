import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const targets = {
  main: {
    account: '044791c24ac1de2cb822a0df91b2ab5f', database: 'rank',
    id: '832a1c3f-79d9-4b07-85de-06ca4b85ba56', config: 'artifacts/api-server/wrangler.toml',
    migration: 'artifacts/api-server/migrations/20260921_main_pending_users_index.sql',
    index: 'users_role_status_created_at_id_idx', table: 'users',
    query: "SELECT id, username, full_name FROM users WHERE role = 'student' AND status = 'pending' ORDER BY created_at, id",
  },
  qbank: {
    account: '7a94feb19c9db9b7efb44b20cb249203', database: 'qbank',
    id: '30921235-2543-4fb5-a970-fb4164590de6', config: 'artifacts/qbank-worker/wrangler.toml',
    migration: 'artifacts/api-server/migrations/20260921_qbank_report_cursor_index.sql',
    index: 'question_bank_reports_created_at_id_idx', table: 'question_bank_reports',
    query: `SELECT * FROM question_bank_reports WHERE (created_at, id) < (${Date.now()}, 9007199254740991) ORDER BY created_at DESC, id DESC LIMIT 101`,
  },
};
const [targetName, confirmation] = process.argv.slice(2);
const target = targets[targetName];
if (!target || confirmation !== '--apply') throw new Error('Usage: node scripts/apply-d1-optimization.mjs main|qbank --apply');
if (process.env.CLOUDFLARE_ACCOUNT_ID !== target.account) throw new Error('Refusing to use a different Cloudflare account');
if (!readFileSync(target.config, 'utf8').includes(target.id)) throw new Error('Database binding does not match the audited target');
const sql = readFileSync(target.migration, 'utf8');
const ddl = sql.replace(/--[^\n]*/g, '').trim();
if (!/^CREATE INDEX IF NOT EXISTS\s+"[a-z_]+"\s+ON\s+"[a-z_]+"\s*\([^;]+\);$/.test(ddl)) {
  throw new Error('Only the audited single additive CREATE INDEX migration is permitted');
}
const directory = resolve('artifacts/api-server/verification/20260922');
mkdirSync(directory, { recursive: true });
const recordPath = resolve(directory, `${targetName}-migration-${Date.now()}.json`);
const record = { target: targetName, accountId: target.account, databaseId: target.id, startedAt: new Date().toISOString(), migration: target.migration, sql: ddl };
const save = () => writeFileSync(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
const wrangler = (args) => {
  const result = spawnSync('npx', ['--yes', 'wrangler@4.136.1', ...args, '--config', target.config, '--env', 'production', '--json'], {
    env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Wrangler command failed');
  return JSON.parse(result.stdout);
};
const execute = (statement) => wrangler(['d1', 'execute', target.database, '--remote', '--command', statement]);
const measure = () => {
  const [result] = execute(target.query);
  // Save counts/plans, not private query result records.
  return { rowsReturned: result.results.length, meta: result.meta };
};
try {
  record.recovery = wrangler(['d1', 'time-travel', 'info', target.database]);
  if (!record.recovery.bookmark) throw new Error('No recovery bookmark returned; migration not applied');
  save();
  record.indexesBefore = execute(`SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = '${target.table}'`);
  record.planBefore = execute(`EXPLAIN QUERY PLAN ${target.query}`);
  record.measurementBefore = measure();
  save();
  console.log(`${targetName}: recovery bookmark saved; applying ${target.index}`);
  record.applied = execute(ddl);
  save();
  record.optimize = execute('PRAGMA optimize');
  record.planAfter = execute(`EXPLAIN QUERY PLAN ${target.query}`);
  record.measurementAfter = measure();
  record.indexAfter = execute(`SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND name = '${target.index}'`);
  if (record.indexAfter[0]?.results.length !== 1) throw new Error('Index creation was not verified');
  record.completedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ target: targetName, before: record.measurementBefore, after: record.measurementAfter, recordPath }));
} catch (error) {
  record.error = error.message;
  save();
  throw error;
}
