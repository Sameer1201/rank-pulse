import type { D1Database } from "@cloudflare/workers-types";

export type AiAccount = "question-bank" | "pyq" | "test";

export interface AiPoolEnv {
  DB: D1Database;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  QB_PROXY_URL?: string;
  QB_PROXY_TOKEN?: string;
  AI_HINT_PYQ_URL?: string;
  AI_HINT_PYQ_TOKEN?: string;
}

export class AiPoolExhaustedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("All available Workers AI accounts are temporarily at their limit");
    this.name = "AiPoolExhaustedError";
  }
}

const TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const JSON_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function available(env: AiPoolEnv, account: AiAccount): boolean {
  if (account === "test") return Boolean(env.AI);
  if (account === "question-bank") return Boolean(env.QB_PROXY_URL && env.QB_PROXY_TOKEN);
  return Boolean(env.AI_HINT_PYQ_URL && env.AI_HINT_PYQ_TOKEN);
}

function accountOrder(preferred: AiAccount): AiAccount[] {
  return [preferred, ...(["question-bank", "pyq", "test"] as AiAccount[]).filter((account) => account !== preferred)];
}

function failureKind(status: number | undefined, detail: string): "daily" | "capacity" | "transient" | "other" {
  if (/\b3036\b|daily free allocation|daily allocation|neurons per day|quota exhausted/i.test(detail)) return "daily";
  if (status === 429 || /\b3040\b|out of capacity|rate limit/i.test(detail)) return "capacity";
  // Older gateway deployments mask provider failures as 502. One bounded
  // failover keeps them usable until the gateway's richer errors are deployed.
  if (status === 502 || status === 503 || status === 504 || /timeout|timed out|aborted|fetch failed|network error|empty response|empty hint/i.test(detail)) return "transient";
  return "other";
}

function nextMidnightUtc(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

async function cooldowns(db: D1Database, now: number): Promise<Map<string, number>> {
  try {
    const rows = await db.prepare("SELECT account_key, blocked_until FROM ai_account_cooldowns WHERE blocked_until > ?")
      .bind(now).all<{ account_key: string; blocked_until: number }>();
    return new Map((rows.results ?? []).map((row) => [row.account_key, Number(row.blocked_until)]));
  } catch (error) {
    console.error("Could not read AI account cooldowns", error);
    return new Map();
  }
}

async function markCooldown(db: D1Database, account: AiAccount, reason: "daily" | "capacity" | "transient", now: number): Promise<void> {
  const blockedUntil = reason === "daily" ? nextMidnightUtc(now) : now + (reason === "capacity" ? 60_000 : 30_000);
  try {
    await db.prepare("INSERT INTO ai_account_cooldowns (account_key, blocked_until, reason, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_key) DO UPDATE SET blocked_until = excluded.blocked_until, reason = excluded.reason, updated_at = excluded.updated_at")
      .bind(account, blockedUntil, reason, now).run();
  } catch (error) {
    console.error("Could not record AI account cooldown", error);
  }
}

function responseText(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const value = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  return value.response ?? value.choices?.[0]?.message?.content;
}

async function invokeAccount(env: AiPoolEnv, account: AiAccount, input: Record<string, unknown>): Promise<{ response: unknown }> {
  if (account === "test") {
    try {
      const model = (input.response_format as { type?: string } | undefined)?.type === "json_schema" ? JSON_MODEL : TEXT_MODEL;
      const result = await env.AI!.run(model, input);
      const response = responseText(result);
      if (response === undefined || response === null || response === "") throw new Error("Workers AI returned an empty response");
      return { response };
    } catch (error) {
      const provider = error as { code?: unknown; errors?: Array<{ code?: unknown }> } | null;
      const code = provider?.code ?? provider?.errors?.[0]?.code;
      const detail = `${code ?? ""} ${error instanceof Error ? error.message : String(error)}`.trim();
      const wrapped = new Error(detail) as Error & { status?: number };
      wrapped.status = /\b3036\b|\b3040\b|429/.test(detail) ? 429 : undefined;
      throw wrapped;
    }
  }
  const base = account === "question-bank" ? env.QB_PROXY_URL! : env.AI_HINT_PYQ_URL!;
  const token = account === "question-bank" ? env.QB_PROXY_TOKEN! : env.AI_HINT_PYQ_TOKEN!;
  const response = await fetch(`${base.replace(/\/+$/, "")}/ai-hint`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null) as { response?: unknown; error?: string; code?: number } | null;
  if (!response.ok) {
    const detail = `${payload?.code ?? ""} ${payload?.error ?? ""}`.trim() || `HTTP ${response.status}`;
    const error = new Error(detail) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (payload?.response === undefined || payload.response === null || payload.response === "") throw new Error("Workers AI returned an empty response");
  return { response: payload.response };
}

/** Keep a section on its own account; only fail over for quota or temporary capacity. */
export async function runPooledAi(env: AiPoolEnv, preferred: AiAccount, input: Record<string, unknown>): Promise<{ response: unknown; account: AiAccount }> {
  const now = Date.now();
  const blocked = await cooldowns(env.DB, now);
  const configured = accountOrder(preferred).filter((account) => available(env, account));
  const candidates = configured.filter((account) => (blocked.get(account) ?? 0) <= now);
  if (!configured.length) throw new Error("No Workers AI account is configured");
  if (!candidates.length) throw new AiPoolExhaustedError(Math.max(1, Math.ceil((Math.min(...configured.map((account) => blocked.get(account) ?? now)) - now) / 1000)));
  let lastError: unknown;
  for (const account of candidates) {
    try {
      const result = await invokeAccount(env, account, input);
      return { ...result, account };
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const reason = failureKind(status, error instanceof Error ? error.message : String(error));
      if (reason === "other") throw error;
      await markCooldown(env.DB, account, reason, Date.now());
      console.warn(`Workers AI ${account} unavailable (${reason}); trying next account`);
    }
  }
  const refreshed = await cooldowns(env.DB, Date.now());
  if (configured.every((account) => (refreshed.get(account) ?? 0) > Date.now())) {
    throw new AiPoolExhaustedError(Math.max(1, Math.ceil((Math.min(...configured.map((account) => refreshed.get(account) ?? Date.now())) - Date.now()) / 1000)));
  }
  throw lastError ?? new Error("No Workers AI account is currently available");
}

export async function aiCacheKey(kind: string, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([kind, value]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readAiCache<T>(db: D1Database, key: string): Promise<T | null> {
  try {
    const row = await db.prepare("SELECT response_json FROM ai_response_cache WHERE cache_key = ? AND expires_at > ?")
      .bind(key, Date.now()).first<{ response_json: string }>();
    return row ? JSON.parse(row.response_json) as T : null;
  } catch (error) {
    console.error("Could not read AI response cache", error);
    return null;
  }
}

export async function writeAiCache(db: D1Database, key: string, response: unknown, ttlMs: number): Promise<void> {
  try {
    await db.prepare("INSERT INTO ai_response_cache (cache_key, response_json, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET response_json = excluded.response_json, expires_at = excluded.expires_at")
      .bind(key, JSON.stringify(response), Date.now() + ttlMs).run();
  } catch (error) {
    console.error("Could not write AI response cache", error);
  }
}
