import type { D1Database } from '@cloudflare/workers-types';
type SessionEnv = { DB: D1Database };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

function sessionToken(request: Request) {
  const cookie = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('userId='));
  if (!cookie) return null;
  try {
    const token = decodeURIComponent(cookie.slice(7));
    // Retire non-revocable v1 tokens at rollout. Never accept a plain user ID.
    return /^v2\.[a-f0-9]{64}$/.test(token) ? token : null;
  } catch { return null; }
}

export async function createWorkerSession(env: SessionEnv, userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid session user.");
  const token = 'v2.' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  await env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .bind(await tokenHash(token), userId, now + SESSION_TTL_MS, now).run();
  return token;
}

export async function readWorkerSessionUserId(request: Request, env: SessionEnv): Promise<number | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const row = await env.DB.prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await tokenHash(token), Date.now()).first<{ user_id: number }>();
  return row?.user_id ?? null;
}

export async function revokeWorkerSession(request: Request, env: SessionEnv) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
}
export async function revokeUserSessions(env: SessionEnv, userId: number) {
  await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
}
