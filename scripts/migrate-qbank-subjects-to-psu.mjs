import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCE = {
  label: "qbank",
  accountId: "7a94feb19c9db9b7efb44b20cb249203",
  databaseId: "30921235-2543-4fb5-a970-fb4164590de6",
};
const TARGET = {
  label: "psu",
  accountId: "c8cdcd5acfd39d60f7cfe7989d6a6608",
  databaseId: "47eeafc4-8bfa-47e5-b200-332a04882828",
};
const SUBJECT_IDS = [33, 39, 44];
const ID_OFFSET = 1_000_000_000_000;
const BATCH_MAX_BYTES = 4 * 1024 * 1024;
const BACKUP_DIR = resolve("/Users/sameermajhi/Documents/qbank-psu-migration-backups");

const tableColumns = {
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

const config = await readFile(resolve(homedir(), "Library/Preferences/.wrangler/config/default.toml"), "utf8");
const tokenLine = config.match(/^oauth_token\s*=\s*(.+)$/m)?.[1];
if (!tokenLine) throw new Error("Wrangler OAuth token was not found; run `npx wrangler login` first.");
const token = JSON.parse(tokenLine);

function endpoint(database) {
  return `https://api.cloudflare.com/client/v4/accounts/${database.accountId}/d1/database/${database.databaseId}/query`;
}

async function d1(database, request) {
  const response = await fetch(endpoint(database), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((item) => item.message).filter(Boolean).join("; ") || "unknown D1 error";
    throw new Error(`${database.label} D1 request failed (${response.status}): ${message}`);
  }
  return payload.result?.[0] ?? {};
}

async function query(database, sql, params = []) {
  return (await d1(database, { sql, params })).results ?? [];
}

function quote(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function readRows(database, table, columns, whereSql, whereParams = [], pageSize = 100) {
  const rows = [];
  let lastId = 0;
  while (true) {
    const page = await query(database,
      `SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)} WHERE ${whereSql} AND id > ? ORDER BY id ASC LIMIT ?`,
      [...whereParams, lastId, pageSize]);
    if (!page.length) break;
    rows.push(...page);
    lastId = Number(page.at(-1).id);
  }
  return rows;
}

async function readSelectedQuestions() {
  const rows = [];
  let lastId = 0;
  while (true) {
    const page = await query(SOURCE,
      `SELECT ${tableColumns.question_bank_questions.map(quote).join(", ")} FROM question_bank_questions WHERE subject_id IN (SELECT value FROM json_each(?)) AND id > ? ORDER BY id ASC LIMIT 20`,
      [JSON.stringify(SUBJECT_IDS), lastId]);
    if (!page.length) break;
    rows.push(...page);
    lastId = Number(page.at(-1).id);
  }
  return rows;
}

async function insertRows(table, columns, rows) {
  const sql = `INSERT OR REPLACE INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  let batch = [];
  let batchBytes = 0;
  let inserted = 0;
  for (const row of rows) {
    const statement = { sql, params: columns.map((column) => row[column] ?? null) };
    const size = Buffer.byteLength(JSON.stringify(statement));
    if (batch.length && batchBytes + size > BATCH_MAX_BYTES) {
      await d1(TARGET, { batch });
      inserted += batch.length;
      console.log(`${table}: ${inserted}/${rows.length} inserted`);
      batch = [];
      batchBytes = 0;
    }
    batch.push(statement);
    batchBytes += size;
  }
  if (batch.length) {
    await d1(TARGET, { batch });
    inserted += batch.length;
    console.log(`${table}: ${inserted}/${rows.length} inserted`);
  }
}

function digest(rows) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function schemaStatements(sql) {
  return sql.replace(/--[^\n]*/g, "").split(";").map((value) => value.trim()).filter(Boolean);
}

const questions = await readSelectedQuestions();
if (questions.length !== 948) {
  throw new Error(`Expected 948 selected questions across subjects ${SUBJECT_IDS.join(",")}; found ${questions.length}. Refusing to proceed.`);
}
const questionIds = questions.map((row) => Number(row.id));
const idsJson = JSON.stringify(questionIds);
const snapshot = {
  createdAt: new Date().toISOString(),
  source: SOURCE,
  target: TARGET,
  subjectIds: SUBJECT_IDS,
  tables: { question_bank_questions: questions },
};
for (const table of Object.keys(tableColumns).filter((name) => name !== "question_bank_questions")) {
  const fk = table === "test_question_bank_links" ? "question_bank_question_id" : "question_id";
  snapshot.tables[table] = await readRows(SOURCE, table, tableColumns[table], `${quote(fk)} IN (SELECT value FROM json_each(?))`, [idsJson]);
}

await mkdir(BACKUP_DIR, { recursive: true });
const backupPath = resolve(BACKUP_DIR, `qbank-psu-subject-shard-${new Date().toISOString().replaceAll(":", "-")}.json`);
await writeFile(backupPath, JSON.stringify(snapshot));
console.log(`Source backup saved: ${backupPath}`);
for (const [table, rows] of Object.entries(snapshot.tables)) console.log(`${table}: ${rows.length} rows snapshotted`);

const schema = await readFile(new URL("../artifacts/api-server/migrations/20260920_question_bank_database.sql", import.meta.url), "utf8");
for (const sql of schemaStatements(schema)) await d1(TARGET, { sql });

const existingQuestions = await readSelectedQuestionsFromTarget();
if (existingQuestions.length && digest(existingQuestions) !== digest(questions)) {
  throw new Error("Target already contains different questions in a selected subject; refusing to overwrite.");
}
for (const table of Object.keys(tableColumns).filter((name) => name !== "question_bank_questions")) {
  const column = table === "test_question_bank_links" ? "question_bank_question_id" : "question_id";
  const existingRows = await readRows(TARGET, table, tableColumns[table], `${quote(column)} IN (SELECT value FROM json_each(?))`, [idsJson]);
  const expectedRows = snapshot.tables[table];
  if (existingRows.length && digest(existingRows) !== digest(expectedRows)) {
    throw new Error(`Target already contains different ${table} rows; refusing to overwrite.`);
  }
}

// Keep IDs globally disjoint between D1 shards. Existing references in the
// copied state/link rows are rewritten together; source rows remain untouched.
const migratedTables = structuredClone(snapshot.tables);
for (const rows of Object.values(migratedTables)) {
  for (const row of rows) row.id = Number(row.id) + ID_OFFSET;
}
for (const row of migratedTables.question_bank_question_progress) row.question_id = Number(row.question_id) + ID_OFFSET;
for (const row of migratedTables.question_bank_saved_questions) row.question_id = Number(row.question_id) + ID_OFFSET;
for (const row of migratedTables.question_bank_reports) row.question_id = Number(row.question_id) + ID_OFFSET;
for (const row of migratedTables.test_question_bank_links) row.question_bank_question_id = Number(row.question_bank_question_id) + ID_OFFSET;

if (existingQuestions.length) {
  await d1(TARGET, { sql: "DELETE FROM test_question_bank_links WHERE question_bank_question_id IN (SELECT id FROM question_bank_questions WHERE subject_id IN (SELECT value FROM json_each(?)))", params: [JSON.stringify(SUBJECT_IDS)] });
  for (const table of ["question_bank_reports", "question_bank_saved_questions", "question_bank_question_progress"]) {
    await d1(TARGET, { sql: `DELETE FROM ${quote(table)} WHERE question_id IN (SELECT id FROM question_bank_questions WHERE subject_id IN (SELECT value FROM json_each(?)))`, params: [JSON.stringify(SUBJECT_IDS)] });
  }
  await d1(TARGET, { sql: "DELETE FROM question_bank_questions WHERE subject_id IN (SELECT value FROM json_each(?))", params: [JSON.stringify(SUBJECT_IDS)] });
}

for (const [table, rows] of Object.entries(migratedTables)) {
  console.log(`Copying ${table} (${rows.length} rows)`);
  await insertRows(table, tableColumns[table], rows);
}

const mappedQuestionIds = JSON.stringify(questionIds.map((id) => id + ID_OFFSET));
for (const [table, rows] of Object.entries(migratedTables)) {
  const targetRows = table === "question_bank_questions"
    ? await readSelectedQuestionsFromTarget()
    : await readRows(TARGET, table, tableColumns[table], `${quote(table === "test_question_bank_links" ? "question_bank_question_id" : "question_id")} IN (SELECT value FROM json_each(?))`, [mappedQuestionIds]);
  if (rows.length !== targetRows.length || digest(rows) !== digest(targetRows)) {
    throw new Error(`${table} verification failed: source=${rows.length}/${digest(rows)}, target=${targetRows.length}/${digest(targetRows)}`);
  }
  console.log(`${table}: ${rows.length} copied and SHA-256 verified`);
}
console.log(`Copy complete. Target IDs are offset by ${ID_OFFSET}; source QBank rows were not deleted.`);

async function readSelectedQuestionsFromTarget() {
  const rows = [];
  let lastId = 0;
  while (true) {
    const page = await query(TARGET,
      `SELECT ${tableColumns.question_bank_questions.map(quote).join(", ")} FROM question_bank_questions WHERE subject_id IN (SELECT value FROM json_each(?)) AND id > ? ORDER BY id ASC LIMIT 20`,
      [JSON.stringify(SUBJECT_IDS), lastId]);
    if (!page.length) break;
    rows.push(...page);
    lastId = Number(page.at(-1).id);
  }
  return rows;
}
