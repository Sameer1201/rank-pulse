import type { ActivityQuery, ActivityStore } from './studentDailyActivity';

type Row = Record<string, unknown>;
const count = (value: unknown) => Math.max(0, Number(value) || 0);

/** Bulk all-time submission metrics. Never fetch question bodies or one dashboard per student. */
export async function readStudentActivityRanking(query: ActivityQuery, studentIds: number[]) {
  const ids = [...new Set(studentIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return { students: [], unavailableSources: [] as string[] };
  const unavailableSources = new Set<string>();
  const read = async (source: string, store: ActivityStore, sql: string, params: (string | number)[]) => {
    try { return await query(store, sql, params); }
    catch (error) {
      unavailableSources.add(source);
      console.error('Student ranking source unavailable', source, error instanceof Error ? error.message : String(error));
      return [] as Row[];
    }
  };
  const selected = JSON.stringify(ids);
  const locked = await read('JAM PYQ submissions', 'main', `SELECT student_id AS studentId, question_id AS questionId
    FROM jam_pyq_submissions WHERE student_id IN (SELECT value FROM json_each(?))`, [selected]);
  const lockedKeys = JSON.stringify(locked.map(row => `${row.studentId}:${row.questionId}`));
  const progress = `SELECT student_id AS studentId, COALESCE(SUM(attempt_count),0) AS attempts
    FROM pyq_question_progress WHERE student_id IN (SELECT value FROM json_each(?)) AND attempt_count > 0 GROUP BY student_id`;
  const [qb, gate, jam, tests, psu] = await Promise.all([
    read('QBank', 'question-bank', `SELECT student_id AS studentId, COALESCE(SUM(attempt_count),0) AS attempts
      FROM question_bank_question_progress WHERE student_id IN (SELECT value FROM json_each(?)) AND attempt_count > 0 GROUP BY student_id`, [selected]),
    read('GATE PYQ', 'pyq', progress, [selected]),
    read('JAM PYQ', 'jam-pyq', `SELECT student_id AS studentId, COALESCE(SUM(attempt_count),0) AS attempts,
      SUM(CASE WHEN student_id || ':' || question_id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END) AS lockedCount
      FROM pyq_question_progress WHERE student_id IN (SELECT value FROM json_each(?)) AND attempt_count > 0 GROUP BY student_id`, [lockedKeys, selected]),
    read('Tests', 'main', `SELECT student_id AS studentId, COUNT(*) AS attempts FROM test_submissions
      WHERE student_id IN (SELECT value FROM json_each(?)) GROUP BY student_id`, [selected]),
    read('PSU tests', 'psu', `SELECT student_id AS studentId, COUNT(*) AS attempts FROM psu_test_attempts
      WHERE student_id IN (SELECT value FROM json_each(?)) GROUP BY student_id`, [selected]),
  ]);
  const map = (rows: Row[]) => new Map(rows.map(row => [Number(row.studentId), row]));
  const [qbMap, gateMap, jamMap, testsMap, psuMap] = [qb, gate, jam, tests, psu].map(map);
  const lockedCount = new Map<number, number>();
  for (const row of locked) lockedCount.set(Number(row.studentId), (lockedCount.get(Number(row.studentId)) ?? 0) + 1);
  return {
    students: ids.map(studentId => {
      const questionBankAttempts = unavailableSources.has('QBank') ? null : count(qbMap.get(studentId)?.attempts);
      const pyqAttempts = ['GATE PYQ', 'JAM PYQ', 'JAM PYQ submissions'].some(source => unavailableSources.has(source)) ? null
        : count(gateMap.get(studentId)?.attempts) + count(jamMap.get(studentId)?.attempts)
          + Math.max(0, (lockedCount.get(studentId) ?? 0) - count(jamMap.get(studentId)?.lockedCount));
      const testCount = ['Tests', 'PSU tests'].some(source => unavailableSources.has(source)) ? null
        : count(testsMap.get(studentId)?.attempts) + count(psuMap.get(studentId)?.attempts);
      return { studentId, questionBankAttempts, pyqAttempts, testCount,
        activityCount: questionBankAttempts === null || pyqAttempts === null || testCount === null ? null
          : questionBankAttempts + pyqAttempts + testCount };
    }),
    unavailableSources: [...unavailableSources],
  };
}
