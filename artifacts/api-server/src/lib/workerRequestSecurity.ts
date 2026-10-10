import type { D1Database } from '@cloudflare/workers-types';
type SecurityEnv = { DB: D1Database; PUBLIC_APP_URL?: string; CORS_ALLOWED_ORIGINS?: string };
export function allowedRequestOrigin(request: Request, env: SecurityEnv) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  const allowed = [env.PUBLIC_APP_URL, new URL(request.url).origin, ...(env.CORS_ALLOWED_ORIGINS ?? '').split(',')];
  return allowed.some(value => { try { return Boolean(value?.trim()) && new URL(value!.trim()).origin === origin; } catch { return false; } });
}
export async function allowLoginAttempt(request: Request, env: SecurityEnv, identifier: string) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  for (const [key, window, limit] of [[`ip:${ip}`, 60_000, 30], [`account:${identifier.toLowerCase()}`, 300_000, 10]] as const) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const bucket = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const start = Math.floor(Date.now() / window) * window;
    const row = await env.DB.prepare(`INSERT INTO auth_rate_limits(bucket,window_start,attempts) VALUES(?,?,1)
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,
      window_start=excluded.window_start RETURNING attempts`).bind(bucket, start).first<{ attempts: number }>();
    if (!row || row.attempts > limit) return false;
  }
  return true;
}
