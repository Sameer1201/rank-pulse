import type { D1Database } from '@cloudflare/workers-types';
import { indiaActivityDay, type readStudentDailyActivity } from './studentDailyActivity';

// In-flight promises only; no cross-request authentication or completed-result
// memory cache. The DB binding and authenticated student ID isolate tenants.
const flights = new WeakMap<object, Map<string, Promise<unknown>>>();
const identities = new WeakMap<object, Map<string, object>>();
/** Request-local Starter wrappers are new objects on every request. Key only
 * in-flight summaries by the original binding plus content-routing topology. */
export function studentReadIdentity(db: object, topology: string): object {
  let scopes = identities.get(db);
  if (!scopes) { scopes = new Map(); identities.set(db, scopes); }
  let identity = scopes.get(topology);
  if (!identity) {
    if (scopes.size >= 8) scopes.delete(scopes.keys().next().value!);
    identity = {}; scopes.set(topology, identity);
  }
  return identity;
}
export async function coalesceStudentRead<T>(db: object, key: string, load: () => Promise<T>): Promise<T> {
  let entries = flights.get(db);
  if (!entries) { entries = new Map(); flights.set(db, entries); }
  const running = entries.get(key);
  if (running) return running as Promise<T>;
  const promise = Promise.resolve().then(load);
  entries.set(key, promise);
  try { return await promise; }
  finally { if (entries.get(key) === promise) entries.delete(key); }
}

type DailyActivity = Awaited<ReturnType<typeof readStudentDailyActivity>>;
export function cachedDailyActivity(db: D1Database, studentId: number, load: () => Promise<DailyActivity>, now = Date.now(), identity: object = db) {
  const day = indiaActivityDay(now).date;
  return coalesceStudentRead(identity, `daily:${studentId}:${day}`, async () => {
    const cached = await db.prepare('SELECT payload FROM student_daily_activity_cache WHERE student_id = ? AND day = ? AND updated_at > ?')
      .bind(studentId, day, now - 60000).first<{ payload: string }>();
    if (cached) {
      try { const value = JSON.parse(cached.payload) as DailyActivity; if (value.date === day) return value; }
      catch { /* Rebuild a malformed cache, never change the saved progress. */ }
    }
    const value = await load(); // Failed/partial source reads must never become zero totals.
    await db.prepare(`INSERT INTO student_daily_activity_cache(student_id,day,payload,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(student_id) DO UPDATE SET day=excluded.day,payload=excluded.payload,updated_at=excluded.updated_at
      WHERE excluded.updated_at >= student_daily_activity_cache.updated_at`)
      .bind(studentId, value.date, JSON.stringify(value), now).run();
    return value;
  });
}
