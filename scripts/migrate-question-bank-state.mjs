import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sourceDatabaseId = process.argv[2] ?? process.env.DATABASE_ID;
const targetDatabaseId = process.argv[3] ?? process.env.QB_D1_DATABASE_ID;
const deleteSource = process.argv.includes("--delete-source");
const backupOnly = process.argv.includes("--backup-only");
const deleteOnly = process.argv.includes("--delete-only");
const envPath = new URL("../artifacts/api-server/.env.local", import.meta.url);

function readEnvFile() {
  const values = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

const env = { ...readEnvFile(), ...process.env };
const sourceAccountId = (env.CLOUDFLARE_ACCOUNT_ID ?? env.DATABASE_ACCOUNT_ID)?.trim();
const sourceApiToken = (env.CLOUDFLARE_API_TOKEN ?? env.DATABASE_API_TOKEN)?.trim();
const targetAccountId = env.QB_D1_ACCOUNT_ID?.trim();
const targetApiToken = env.QB_D1_API_TOKEN?.trim();
if (!sourceAccountId || !sourceApiToken || !sourceDatabaseId || !targetAccountId || !targetApiToken || !targetDatabaseId) {
  throw new Error("Cross-account QBank migration requires source credentials from .env.local and QB_D1_ACCOUNT_ID, QB_D1_DATABASE_ID, QB_D1_API_TOKEN.");
}

const sourceClient = { name: "source", accountId: sourceAccountId, databaseId: sourceDatabaseId, apiToken: sourceApiToken };
const targetClient = { name: "target", accountId: targetAccountId, databaseId: targetDatabaseId, apiToken: targetApiToken };
const endpoint = ({ accountId, databaseId }) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const pageSize = 100;
const includeContent = process.argv.includes("--include-content");

const allTables = {
  question_bank_questions: [
    "id", "class_id", "subject_id", "chapter_id", "question", "question_type", "options", "option_images",
    "correct_answer", "correct_answer_multi", "correct_answer_min", "correct_answer_max", "answer", "explanation",
    "topic_tag", "difficulty", "points", "order", "image_data", "source_test_id", "source_test_question_id",
    "created_by", "created_at", "updated_at",
  ],
  question_bank_question_progress: [
    "id", "question_id", "student_id", "class_id", "subject_id", "chapter_id", "attempt_count", "correct_count",
    "incorrect_count", "last_answer", "last_is_correct", "first_attempted_at", "last_attempted_at", "solved_at",
  ],
  question_bank_saved_questions: ["id", "question_id", "student_id", "created_at"],
  question_bank_reports: [
    "id", "question_id", "class_id", "subject_id", "chapter_id", "reported_by", "teacher_id", "reason", "status",
    "created_at", "updated_at",
  ],
  test_question_bank_links: ["id", "test_id", "test_question_id", "question_bank_question_id", "created_at"],
};
// Content was migrated by migrate-question-bank-d1.mjs already. Keeping the
// default state-only avoids rewriting large image payloads during resume runs.
const tables = includeContent
  ? allTables
  : Object.fromEntries(Object.entries(allTables).filter(([table]) => table !== "question_bank_questions"));

async function d1Request(client, body) {
  const response = await fetch(endpoint(client), {
    method: "POST",
    headers: { Authorization: `Bearer ${client.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || "unknown D1 error";
    throw new Error(`${client.name} D1 request failed (${response.status}) for account ${client.accountId}: ${message}`);
  }
  return payload.result ?? [];
}

async function query(client, sql, params = []) {
  return (await d1Request(client, { sql, params }))[0]?.results ?? [];
}

function quote(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function applySchema() {
  const schemaPath = new URL("../artifacts/api-server/migrations/20260920_question_bank_database.sql", import.meta.url);
  const statements = readFileSync(schemaPath, "utf8")
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const sql of statements) await d1Request(targetClient, { sql });
}

async function readAll(client, table, columns) {
  const rows = [];
  let lastId = 0;
  while (true) {
    const page = await query(
      client,
      `SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)} WHERE id > ? ORDER BY id ASC LIMIT ?`,
      [lastId, pageSize],
    );
    if (page.length === 0) break;
    rows.push(...page);
    lastId = Number(page.at(-1).id);
  }
  return rows;
}

async function insertRows(table, columns, rows) {
  if (rows.length === 0) return;
  const sql = `INSERT OR REPLACE INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  for (let offset = 0; offset < rows.length; offset += 50) {
    const batch = rows.slice(offset, offset + 50).map((row) => ({ sql, params: columns.map((column) => row[column] ?? null) }));
    await d1Request(targetClient, { batch });
  }
}

async function snapshot(label) {
  const snapshot = { label, createdAt: new Date().toISOString(), sourceAccountId, sourceDatabaseId, tables: {} };
  for (const [table, columns] of Object.entries(tables)) {
    snapshot.tables[table] = await readAll(sourceClient, table, columns);
  }
  const backupPath = resolve(new URL("../artifacts/api-server/backups/", import.meta.url).pathname, `qbank-before-separation-${Date.now()}.json`);
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  console.log(`Backup written: ${backupPath}`);
  return { snapshot, backupPath };
}

async function countRows(client, table) {
  const result = await query(client, `SELECT COUNT(*) AS count FROM ${quote(table)}`);
  return Number(result[0]?.count ?? 0);
}

async function migrate() {
  await applySchema();
  const counts = {};
  for (const [table, columns] of Object.entries(tables)) {
    const rows = await readAll(sourceClient, table, columns);
    await insertRows(table, columns, rows);
    const sourceCount = rows.length;
    const targetCount = await countRows(targetClient, table);
    if (sourceCount !== targetCount) throw new Error(`${table} verification failed: source=${sourceCount}, target=${targetCount}`);
    counts[table] = sourceCount;
    console.log(`${table}: ${sourceCount} rows copied and verified`);
  }
  return counts;
}

async function deleteSourceRows() {
  for (const table of Object.keys(tables)) {
    const [sourceCount, targetCount] = await Promise.all([
      countRows(sourceClient, table),
      countRows(targetClient, table),
    ]);
    if (sourceCount !== targetCount) {
      throw new Error(`Refusing source cleanup: ${table} source=${sourceCount}, target=${targetCount}`);
    }
  }
  // Child/state tables are removed first; questions are removed last so the
  // backup and target verification remain valid even if foreign keys are on.
  const order = [
    "test_question_bank_links",
    "question_bank_reports",
    "question_bank_saved_questions",
    "question_bank_question_progress",
    "question_bank_questions",
  ];
  for (const table of order) await d1Request(sourceClient, { sql: `DELETE FROM ${quote(table)}` });
  for (const table of Object.keys(tables)) {
    const remaining = await countRows(sourceClient, table);
    if (remaining !== 0) throw new Error(`Source cleanup verification failed for ${table}: ${remaining} rows remain`);
  }
  console.log("Source Question Bank tables are empty after verified migration.");
}

async function main() {
  if (backupOnly) {
    await snapshot("backup-only");
    return;
  }
  if (deleteSource) await snapshot("pre-delete");
  const counts = deleteOnly ? {} : await migrate();
  if (!deleteOnly) console.log(`Question Bank migration complete: ${JSON.stringify(counts)}`);
  if (deleteSource) await deleteSourceRows();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
