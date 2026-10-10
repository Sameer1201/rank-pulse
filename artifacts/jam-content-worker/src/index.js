import { readCatalogCount, writeCatalog } from '../../shared/catalog-read-cache.js';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function authorized(request, env) {
  const expected = env.JAM_CONTENT_PROXY_TOKEN?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && received && received === expected);
}

function validateSql(sql) {
  const normalized = String(sql ?? "").trim();
  if (!normalized || normalized.includes(";")) return "Only one parameterized SQL statement is allowed.";
  if (!/^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(normalized)) return "Only JAM content queries are allowed.";
  if (/\b(PRAGMA|ATTACH|DETACH|VACUUM|CREATE|DROP|ALTER|REINDEX)\b/i.test(normalized)) {
    return "Schema and database-admin statements are not allowed.";
  }
  return null;
}

function normalizeSql(sql) {
  return String(sql ?? "").trim().replace(/;\s*$/, "");
}

function normalizeParams(params) {
  if (!Array.isArray(params)) return null;
  return params.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    throw new Error("Only primitive SQL parameters are allowed.");
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ ok: true, service: "jam-chemistry-content" });
    }
    if (url.pathname !== "/query") return json({ ok: false, error: "Not found" }, 404);
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
    if (!authorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);

    try {
      const body = await request.json();
      const method = body?.method;
      if (method === "batch") {
        if (!Array.isArray(body?.statements) || body.statements.length === 0 || body.statements.length > 200) {
          return json({ ok: false, error: "statements must contain between 1 and 200 queries" }, 400);
        }
        const statements = body.statements.map((item) => {
          const sql = normalizeSql(item?.sql);
          const sqlError = validateSql(sql);
          if (sqlError) throw new Error(sqlError);
          const params = normalizeParams(item?.params);
          if (!params) throw new Error("params must be an array");
          return env.JAM_DB.prepare(sql).bind(...params);
        });
        const result = await writeCatalog(env.JAM_DB, body.statements.map(item => item.sql), () => env.JAM_DB.batch(statements));
        return json({ ok: true, results: [], meta: result?.meta });
      }

      const sql = normalizeSql(body?.sql);
      const sqlError = validateSql(sql);
      if (sqlError) return json({ ok: false, error: sqlError }, 400);
      const params = normalizeParams(body?.params);
      if (!params) return json({ ok: false, error: "params must be an array" }, 400);
      if (!["all", "first", "run"].includes(method)) {
        return json({ ok: false, error: "method must be all, first, or run" }, 400);
      }

      const statement = env.JAM_DB.prepare(sql).bind(...params);
      if (method === "first") {
        return json(await readCatalogCount(env.JAM_DB, sql, params, method, () => writeCatalog(env.JAM_DB, [sql], async () => {
          const row = await statement.first(); return { ok: true, results: row ? [row] : [] };
        })));
      }
      if (method === "all") {
        return json(await readCatalogCount(env.JAM_DB, sql, params, method, () => writeCatalog(env.JAM_DB, [sql], async () => {
          const result = await statement.all(); return { ok: true, results: result.results ?? [], meta: result.meta };
        })));
      }
      const result = await writeCatalog(env.JAM_DB, [sql], () => statement.run());
      return json({ ok: true, results: [], meta: result.meta });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "JAM content query failed" }, 500);
    }
  },
};
