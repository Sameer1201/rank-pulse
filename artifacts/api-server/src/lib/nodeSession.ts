import type { Request, Response, NextFunction } from 'express';
import type { D1Database } from '@cloudflare/workers-types';
import { executeD1Sql } from '@workspace/db';
import { createWorkerSession, readWorkerSessionUserId, revokeWorkerSession } from './workerSession';

// Share the same revocable opaque session format as the deployed Worker.
export const nodeSessionEnv = { DB: { prepare(query: string) {
  let params: unknown[] = [];
  return {
    bind(...values: unknown[]) { params = values; return this; },
    async first() { return (await executeD1Sql(query, params)).rows[0] ?? null; },
    async run() { return executeD1Sql(query, params); },
  };
} } as unknown as D1Database };

function sessionRequest(req: Request) {
  return new globalThis.Request('https://session.internal/', { headers: { cookie: req.headers.cookie ?? '' } });
}
export const createNodeSession = (id: number) => createWorkerSession(nodeSessionEnv, id);
export const revokeNodeSession = (req: Request) => revokeWorkerSession(sessionRequest(req), nodeSessionEnv);
export const revokeNodeUserSessions = (id: number) => executeD1Sql('DELETE FROM auth_sessions WHERE user_id = ?', [id]);

export async function authenticateNodeSession(req: Request, res: Response, next: NextFunction) {
  // Client-supplied role cookies are never authorization evidence. Legacy route
  // helpers see only server-hydrated cookies, after a database session lookup.
  req.cookies = { ...(req.cookies ?? {}), userId: undefined, userRole: undefined };
  req.signedCookies = { userId: undefined };
  try {
    const userId = await readWorkerSessionUserId(sessionRequest(req), nodeSessionEnv);
    if (userId) {
      const row = (await executeD1Sql('SELECT id, role, status FROM users WHERE id = ? LIMIT 1', [userId])).rows[0];
      if (row && !['blocked', 'disabled', 'suspended', 'inactive'].includes(String(row.status))) {
        (req as any).authenticatedUserId = Number(row.id);
        req.signedCookies.userId = String(row.id);
        req.cookies.userRole = String(row.role);
      }
    }
    next();
  } catch { res.status(503).json({ error: 'Session verification is temporarily unavailable.' }); }
}
