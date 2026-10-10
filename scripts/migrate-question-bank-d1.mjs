import { readFileSync } from "node:fs";

const sourceDatabaseId = process.argv[2] ?? process.env.DATABASE_ID;
const targetDatabaseId = process.argv[3] ?? process.env.QB_D1_DATABASE_ID;
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
  throw new Error(
    "Cross-account D1 migration requires source credentials from .env.local and QB_D1_ACCOUNT_ID, QB_D1_DATABASE_ID, QB_D1_API_TOKEN in the environment.",
  );
}

const sourceClient = { name: "source", accountId: sourceAccountId, databaseId: sourceDatabaseId, apiToken: sourceApiToken };
const targetClient = { name: "target", accountId: targetAccountId, databaseId: targetDatabaseId, apiToken: targetApiToken };
const endpoint = ({ accountId, databaseId }) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const pageSize = 20;
const columns = [
  "id", "class_id", "subject_id", "chapter_id", "question", "question_type",
  "options", "option_images", "correct_answer", "correct_answer_multi",
  "correct_answer_min", "correct_answer_max", "answer", "explanation", "topic_tag",
  "difficulty", "points", "order", "image_data", "source_test_id",
  "source_test_question_id", "created_by", "created_at", "updated_at",
];

async function d1Request(client, body) {
  const response = await fetch(endpoint(client), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.apiToken}`,
      "Content-Type": "application/json",
    },
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

async function insertBatch(rows) {
  const insertSql = `INSERT OR REPLACE INTO question_bank_questions (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  await d1Request(targetClient, {
    batch: rows.map((row) => ({
      sql: insertSql,
      params: columns.map((column) => row[column]),
    })),
  });
}

async function applySchema() {
  const schemaPath = new URL("../artifacts/api-server/migrations/20260920_question_bank_database.sql", import.meta.url);
  const statements = readFileSync(schemaPath, "utf8")
    .split(";")
    .map((statement) => statement.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);
  for (const sql of statements) {
    await d1Request(targetClient, { sql });
  }
}

async function main() {
  await applySchema();
  let lastId = 0;
  let copied = 0;
  while (true) {
    const rows = await query(
      sourceClient,
      `SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM question_bank_questions WHERE id > ? ORDER BY id ASC LIMIT ?`,
      [lastId, pageSize],
    );
    if (rows.length === 0) break;
    await insertBatch(rows);
    copied += rows.length;
    lastId = Number(rows[rows.length - 1].id);
    console.log(`Copied ${copied} question-bank rows (through id ${lastId})`);
  }

  const sourceCount = Number((await query(sourceClient, "SELECT COUNT(*) AS count FROM question_bank_questions"))[0]?.count ?? 0);
  const targetCount = Number((await query(targetClient, "SELECT COUNT(*) AS count FROM question_bank_questions"))[0]?.count ?? 0);
  if (sourceCount !== targetCount) {
    throw new Error(`Row-count verification failed: source=${sourceCount}, target=${targetCount}`);
  }
  console.log(`Question-bank migration verified: ${targetCount} rows copied without changing IDs.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
