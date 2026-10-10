import { readCatalogCount, writeCatalog } from '../../shared/catalog-read-cache.js';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function authorized(request, env) {
  const expected = env.QB_PROXY_TOKEN?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && received && received === expected);
}

function aiFailure(error) {
  const detail = error instanceof Error ? error.message : String(error);
  const code = Number(error?.code ?? error?.errors?.[0]?.code ?? (/\b(3036|3040)\b/.exec(detail)?.[1]));
  if (code === 3036 || /daily free allocation|neurons per day/i.test(detail)) return json({ ok: false, code: 3036, error: "Daily Workers AI allocation exhausted" }, 429);
  if (code === 3040 || /out of capacity|rate limit|429/i.test(detail)) return json({ ok: false, code: 3040, error: "Workers AI is temporarily at capacity" }, 429);
  return json({ ok: false, error: "Could not generate a hint" }, 502);
}

function validateSql(sql) {
  const normalized = String(sql ?? "").trim();
  if (!normalized || normalized.includes(";")) return "Only one parameterized SQL statement is allowed.";
  if (!/^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(normalized)) {
    return "Only Question Bank data queries are allowed.";
  }
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
      return json({ ok: true, service: "question-bank" });
    }
    if (url.pathname === "/ai-hint" && request.method === "POST") {
      if (!authorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      if (!env.AI) return json({ ok: false, error: "Workers AI is not configured" }, 503);
      try {
        const input = await request.json();
        if (!Array.isArray(input?.messages) || input.messages.length < 1 || input.messages.length > 3) {
          return json({ ok: false, error: "Invalid AI input" }, 400);
        }
        const model = input.response_format?.type === "json_schema" ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast" : "@cf/meta/llama-3.2-3b-instruct";
        const result = await env.AI.run(model, input);
        const completion = result?.choices?.[0]?.message?.content;
        if (typeof completion === "string" && completion.trim()) return json({ response: completion.trim() });
        if (result?.response && typeof result.response === "object" && !Array.isArray(result.response)) return json({ response: result.response });
        if (typeof result?.response !== "string" || !result.response.trim()) {
          return json({ ok: false, error: "Workers AI returned an empty hint" }, 502);
        }
        return json({ response: result.response.trim() });
      } catch (error) {
        console.error("Workers AI generation failed", error instanceof Error ? error.message : "Unknown provider error");
        return aiFailure(error);
      }
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
          return env.QB_DB.prepare(sql).bind(...params);
        });
        const result = await writeCatalog(env.QB_DB, body.statements.map(item => item.sql), () => env.QB_DB.batch(statements));
        return json({ ok: true, results: [], meta: result?.meta });
      }
      const sql = normalizeSql(body?.sql);
      const sqlError = validateSql(sql);
      if (sqlError) return json({ ok: false, error: sqlError }, 400);
      const params = normalizeParams(body?.params);
      if (!params) return json({ ok: false, error: "params must be an array" }, 400);
      if (!['all', 'first', 'run'].includes(method)) {
        return json({ ok: false, error: "method must be all, first, or run" }, 400);
      }

      const statement = env.QB_DB.prepare(sql).bind(...params);
      if (method === "first") {
        return json(await readCatalogCount(env.QB_DB, sql, params, method, () => writeCatalog(env.QB_DB, [sql], async () => {
          const row = await statement.first(); return { ok: true, results: row ? [row] : [] };
        })));
      }
      if (method === "all") {
        return json(await readCatalogCount(env.QB_DB, sql, params, method, () => writeCatalog(env.QB_DB, [sql], async () => {
          const result = await statement.all(); return { ok: true, results: result.results ?? [], meta: result.meta };
        })));
      }
      const result = await writeCatalog(env.QB_DB, [sql], () => statement.run());
      return json({ ok: true, results: [], meta: result.meta });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Question Bank query failed" }, 500);
    }
  },
};
