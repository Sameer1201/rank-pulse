import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import { sql, type SQL } from "drizzle-orm";
import { D1_SCHEMA_SQL } from "./d1Schema";

type D1Value = string | number | boolean | null;

type D1QueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
  meta: Record<string, unknown>;
};

type DrizzleRemoteRows = unknown[];

type D1Response = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: Array<{
    success?: boolean;
    results?: Record<string, unknown>[];
    meta?: Record<string, unknown>;
    errors?: Array<{ message?: string }>;
  }>;
};

const D1_JSON_COLUMNS = new Set([
  "additional_exams",
  "review_bucket_dismissed_question_ids",
  "assigned_teacher_ids",
  "file_names",
  "rows",
]);

const dialect = new SQLiteAsyncDialect({});

function getD1Config() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.DATABASE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID ?? process.env.DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.DATABASE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "Cloudflare D1 env vars must be configured: CLOUDFLARE_ACCOUNT_ID/DATABASE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID/DATABASE_ID, and CLOUDFLARE_API_TOKEN/DATABASE_API_TOKEN",
    );
  }

  return {
    accountId,
    databaseId,
    apiToken,
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
  };
}

function normalizeSql(query: string) {
  return query
    .replace(/\bilike\b/gi, "like")
    .replace(/::[a-zA-Z_][a-zA-Z0-9_]*/g, "");
}

function normalizeParam(value: unknown): D1Value {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

function normalizeD1Row(row: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (D1_JSON_COLUMNS.has(key) && typeof value === "string") {
      try {
        normalized[key] = JSON.parse(value);
        continue;
      } catch {
        // Keep malformed legacy JSON as-is so a query response is not lost.
      }
    }
    normalized[key] = value;
  }

  return normalized;
}

async function requestD1(
  query: string,
  params: unknown[],
): Promise<D1QueryResult> {
  const { endpoint, apiToken } = getD1Config();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: normalizeSql(query),
      params: params.map(normalizeParam),
    }),
  });

  let payload: D1Response;
  try {
    payload = (await response.json()) as D1Response;
  } catch {
    throw new Error(`Cloudflare D1 returned invalid JSON (HTTP ${response.status})`);
  }

  const result = payload.result?.[0];
  const errorMessage =
    payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
    result?.errors?.map((error) => error.message).filter(Boolean).join("; ");

  if (!response.ok || !payload.success || result?.success === false || errorMessage) {
    throw new Error(
      `Cloudflare D1 query failed (HTTP ${response.status}): ${errorMessage || "unknown error"}`,
    );
  }

  const meta = result?.meta ?? {};
  return {
    rows: result?.results ?? [],
    rowCount: Number(meta.changes ?? 0),
    meta,
  };
}

export async function executeD1Sql(
  query: string,
  params: unknown[] = [],
): Promise<D1QueryResult> {
  return requestD1(query, params);
}

/** Atomic D1 transaction for scoped admin operations, never fire-and-forget. */
export async function executeD1Batch(statements: Array<{sql: string; params: unknown[]}>) {
  const {endpoint,apiToken}=getD1Config();
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${apiToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({batch:statements.map(item=>({sql:normalizeSql(item.sql),params:item.params.map(normalizeParam)}))})});
  const payload=await response.json() as D1Response;
  if(!response.ok||!payload.success||payload.result?.some(item=>item.success===false))throw new Error('Atomic D1 transaction failed');
}

function splitSqlStatements(script: string) {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;

  for (let index = 0; index < script.length; index += 1) {
    const character = script[index];
    const nextCharacter = script[index + 1];

    if (character === "'" && nextCharacter === "'") {
      current += "''";
      index += 1;
      continue;
    }

    if (character === "'") {
      inSingleQuote = !inSingleQuote;
    }

    if (character === ";" && !inSingleQuote) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += character;
  }

  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

export async function initializeD1Schema() {
  for (const statement of splitSqlStatements(D1_SCHEMA_SQL)) {
    await requestD1(statement, []);
  }
}

export async function d1Callback(
  query: string,
  params: unknown[],
  method: "run" | "all" | "values" | "get",
): Promise<{ rows: DrizzleRemoteRows }> {
  const result = await requestD1(query, params);
  const rows = result.rows.map((row) => Object.values(normalizeD1Row(row)));

  // Cloudflare D1 returns row objects, while Drizzle's sqlite proxy maps
  // selected columns by positional index. Convert rows before returning them.
  // `get` expects one row; all other read methods expect a list of rows.
  // Drizzle's get mapper uses undefined for no match, despite its callback
  // declaration requiring an array. Keep that runtime empty-result contract.
  return { rows: method === "get" ? rows[0]! : rows };
}

export async function d1BatchCallback(
  queries: Array<{
    sql: string;
    params: unknown[];
    method: "run" | "all" | "values" | "get";
  }>,
): Promise<Array<{ rows: DrizzleRemoteRows }>> {
  const { endpoint, apiToken } = getD1Config();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      batch: queries.map(({ sql: query, params }) => ({
        sql: normalizeSql(query),
        params: params.map(normalizeParam),
      })),
    }),
  });

  const payload = (await response.json()) as D1Response;
  if (!response.ok || !payload.success || !payload.result) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(
      `Cloudflare D1 batch failed (HTTP ${response.status}): ${message || "unknown error"}`,
    );
  }

  return payload.result.map((result, index) => {
    if (result.success === false || result.errors?.length) {
      throw new Error(
        result.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
          "Cloudflare D1 batch query failed",
      );
    }
    const rows = (result.results ?? []).map((row) => Object.values(normalizeD1Row(row)));
    return { rows: queries[index]?.method === "get" ? rows[0]! : rows };
  });
}

export function buildD1Sql(query: unknown) {
  return dialect.sqlToQuery(query as SQL);
}

export { sql };
