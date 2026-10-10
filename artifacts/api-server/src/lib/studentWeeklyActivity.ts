import type { D1Database } from '@cloudflare/workers-types';
import { indiaActivityDay } from './studentDailyActivity';

export function hasActivityAnswerKey(question: Record<string, unknown>) {
  const type = String(question.question_type ?? question.questionType ?? 'mcq');
  if (type === 'multi') {
    try {
      const raw = question.correct_answer_multi ?? question.correctAnswerMulti;
      const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(values) && values.length > 0;
    } catch { return false; }
  }
  if (type === 'integer') {
    const min = question.correct_answer_min ?? question.answer_min ?? question.answerMin;
    const max = question.correct_answer_max ?? question.answer_max ?? question.answerMax;
    if (min != null && max != null && Number.isFinite(Number(min)) && Number.isFinite(Number(max))) return true;
  }
  const exact = question.correct_answer ?? question.correctAnswer ?? question.answer_text ?? question.answerText;
  const text = exact == null ? '' : String(exact).replace(/<[^>]+>/g, '').trim();
  return text !== '' && Number.isFinite(Number(text));
}

export function activityWeekStart(now = Date.now()) {
  return new Date(Date.parse(`${indiaActivityDay(now).date}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
}

/** Historical seven-day windows are anchored to today, not calendar Mondays. */
export function activityWeekForDay(day: string, now = Date.now()) {
  const anchor = Date.parse(`${activityWeekStart(now)}T00:00:00Z`);
  const offset = Math.floor((Date.parse(`${day}T00:00:00Z`) - anchor) / (7 * 86400000));
  return new Date(anchor + Math.min(0, offset) * 7 * 86400000).toISOString().slice(0, 10);
}

export function validActivityWeek(start: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  const date = new Date(`${start}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === start
    && start <= activityWeekStart(now) && start >= '2020-01-01';
}

export async function readWeeklyActivity(db: D1Database, studentId: number, start: string, now = Date.now()) {
  const today = indiaActivityDay(now).date;
  // Two covering-index seeks, not MIN/MAX scans over raw attempts or all users.
  const tracking = await db.prepare(`SELECT started_at,
    (SELECT day FROM student_daily_activity_totals WHERE student_id = ?
      AND day >= date(student_activity_tracking.started_at / 1000, 'unixepoch', '+330 minutes') AND day <= ?
      ORDER BY day ASC LIMIT 1) AS first_day,
    (SELECT day FROM student_daily_activity_totals WHERE student_id = ?
      AND day >= date(student_activity_tracking.started_at / 1000, 'unixepoch', '+330 minutes') AND day <= ?
      ORDER BY day DESC LIMIT 1) AS last_day
    FROM student_activity_tracking WHERE id = 1`).bind(studentId, today, studentId, today)
    .first<{ started_at: number; first_day: string | null; last_day: string | null }>();
  if (!tracking) throw new Error('Activity tracking is not configured');
  const currentWeek = activityWeekStart(now);
  const firstAvailableWeek = tracking.first_day ? activityWeekForDay(tracking.first_day, now) : null;
  // Always show the last seven days, even if the student's latest activity was
  // earlier. Tracked quiet days are real zeros, not missing history.
  const lastAvailableWeek = tracking.last_day ? currentWeek : null;
  if (start > currentWeek) start = currentWeek;
  if (firstAvailableWeek && lastAvailableWeek) start = start < firstAvailableWeek ? firstAvailableWeek : start > lastAvailableWeek ? lastAvailableWeek : start;
  const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  const totals = await db.prepare('SELECT day, correct, wrong, unanswered, ungraded, seconds FROM student_daily_activity_totals WHERE student_id = ? AND day >= ? AND day <= ? ORDER BY day')
    .bind(studentId, start, dates[6]).all<{ day: string; correct: number; wrong: number; unanswered: number; ungraded: number; seconds: number }>();
  const firstDay = indiaActivityDay(tracking.started_at).date;
  const rows = new Map(totals.results.map(row => [row.day, row]));
  return {
    start, end: dates[6], today, currentWeek, timezone: 'Asia/Kolkata',
    trackingStartedAt: new Date(tracking.started_at).toISOString(),
    firstAvailableWeek, lastAvailableWeek,
    days: dates.map(date => {
      const available = date >= firstDay && date <= today;
      const row = rows.get(date);
      return { date, available, partial: date === firstDay,
        correct: available ? row?.correct ?? 0 : null,
        wrong: available ? row?.wrong ?? 0 : null,
        unanswered: available ? row?.unanswered ?? 0 : null,
        ungraded: available ? row?.ungraded ?? 0 : null,
        seconds: available ? row?.seconds ?? 0 : null };
    }),
  };
}

/** Server-graded practice outcome. Re-answering changes that day's outcome, not its question count. */
export function activityRegradeStatement(db: D1Database, studentId: number, key: string, correct: boolean, answeredAt: number) {
  // Never create a new visit or move historical work to the admin's edit day.
  return db.prepare(`UPDATE student_daily_question_activity SET outcome = ?, updated_at = ?
    WHERE student_id = ? AND day = ? AND question_key = ? AND answered_at = ? AND outcome IN (0,1,2) AND outcome != ?`)
    .bind(Number(correct), Date.now(), studentId, indiaActivityDay(answeredAt).date, key, answeredAt, Number(correct));
}

export function activityAnswerStatement(db: D1Database, studentId: number, key: string, correct: boolean | null, at = Date.now()) {
  return db.prepare(`INSERT INTO student_daily_question_activity (student_id, day, question_key, outcome, updated_at, answered_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ? >= (SELECT started_at FROM student_activity_tracking WHERE id = 1)
    ON CONFLICT(student_id, day, question_key) DO UPDATE SET outcome = excluded.outcome,
      answered_at = excluded.answered_at, updated_at = MAX(updated_at, excluded.updated_at)
    WHERE excluded.answered_at >= student_daily_question_activity.answered_at`)
    .bind(studentId, indiaActivityDay(at).date, key, correct === null ? 2 : correct ? 1 : 0, at, at, at);
}

/** Test timings belong to the submission day. Each submitted test attempt is a separate session. */
export async function recordTestActivity(db: D1Database, studentId: number, sessionKey: string,
  questions: Array<{ id: number; visited: boolean; answered: boolean; correct: boolean | null; seconds: number }>, at = Date.now(), totalSeconds = 0) {
  const statements = questions.filter(q => q.visited || q.answered || q.seconds > 0).map(q => db.prepare(`
    INSERT OR IGNORE INTO student_daily_question_activity (student_id, day, question_key, outcome, seconds, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(studentId, indiaActivityDay(at).date, `${sessionKey}:${q.id}`,
      q.answered ? q.correct === null ? 2 : q.correct ? 1 : 0 : -1,
      Number.isFinite(q.seconds) ? Math.min(86400, Math.max(0, Math.floor(q.seconds))) : 0, at));
  const remainingSeconds = Math.min(86400, Math.max(0, Math.floor(totalSeconds - questions.reduce((sum, q) => sum + (Number.isFinite(q.seconds) ? Math.max(0, q.seconds) : 0), 0))));
  if (Number.isFinite(remainingSeconds) && remainingSeconds > 0) statements.push(db.prepare(`
    INSERT OR IGNORE INTO student_daily_question_activity (student_id, day, question_key, outcome, seconds, updated_at)
    VALUES (?, ?, ?, 3, ?, ?)`).bind(studentId, indiaActivityDay(at).date, `${sessionKey}:total-time`, remainingSeconds, at));
  for (let offset = 0; offset < statements.length; offset += 80) await db.batch(statements.slice(offset, offset + 80));
}
