type Row = Record<string, unknown>;
export type ActivityStore = "main" | "question-bank" | "pyq" | "jam-pyq" | "psu";
export type ActivityQuery = (store: ActivityStore, sql: string, params: (string | number)[]) => Promise<Row[]>;

// All devices use the same exam day, including devices with different OS zones.
export function indiaActivityDay(now = Date.now()) {
  const offset = 330 * 60_000;
  const date = new Date(now + offset).toISOString().slice(0, 10);
  const start = Date.parse(`${date}T00:00:00Z`) - offset;
  return { date, start, end: start + 86_400_000 };
}

export function answeredQuestionIds(raw: unknown): string[] {
  const answers = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return Object.entries(answers).filter(([questionId, answer]) => {
    if (!/^\d+$/.test(questionId)) return false;
    if (answer == null) return false;
    if (Array.isArray(answer)) return answer.length > 0;
    if (typeof answer === "object") return Object.keys(answer as object).length > 0;
    return String(answer).trim() !== ""; // Numeric zero is an answer too.
  }).map(([id]) => id);
}

/** Read persisted answers, not browser cache or correct-answer totals. */
export async function readStudentDailyActivity(query: ActivityQuery, studentId: number, now = Date.now()) {
  const { date, start, end } = indiaActivityDay(now);
  const params = [studentId, start, end];
  const progressSql = `SELECT question_id FROM pyq_question_progress
    WHERE student_id = ? AND last_attempted_at >= ? AND last_attempted_at < ?`;
  const [qb, pyq, jam, jamSubmissions, tests, psuTests] = await Promise.all([
    query("question-bank", `SELECT question_id FROM question_bank_question_progress
      WHERE student_id = ? AND last_attempted_at >= ? AND last_attempted_at < ?`, params),
    query("pyq", progressSql, params),
    query("jam-pyq", progressSql, params),
    query("main", `SELECT question_id FROM jam_pyq_submissions
      WHERE student_id = ? AND submitted_at >= ? AND submitted_at < ?`, params),
    query("main", `SELECT test_id, answers FROM test_submissions
      WHERE student_id = ? AND submitted_at >= ? AND submitted_at < ?`, params),
    query("psu", `SELECT test_id, answers_json AS answers FROM psu_test_attempts
      WHERE student_id = ? AND submitted_at >= ? AND submitted_at < ?`,
    [studentId, new Date(start).toISOString().slice(0, 19).replace("T", " "), new Date(end).toISOString().slice(0, 19).replace("T", " ")]),
  ]);

  const qbIds = new Set(qb.map(row => String(row.question_id)));
  const testQuestions = new Set(tests.flatMap(row => answeredQuestionIds(row.answers).map(id => `${row.test_id}:${id}`)));
  // Test submissions are also mirrored into Q Bank progress. Count that answer
  // once, even when the mirror or the source-field link is repaired later.
  const testIds = [...new Set(tests.map(row => Number(row.test_id)))];
  if (testQuestions.size > 0) {
    const ids = JSON.stringify(testIds);
    const [links, sources] = await Promise.all([
      query("question-bank", `SELECT test_id, test_question_id, question_bank_question_id
        FROM test_question_bank_links WHERE test_id IN (SELECT value FROM json_each(?))`, [ids]),
      query("question-bank", `SELECT id, source_test_id, source_test_question_id
        FROM question_bank_questions WHERE source_test_id IN (SELECT value FROM json_each(?))`, [ids]),
    ]);
    for (const row of links) {
      if (testQuestions.has(`${row.test_id}:${row.test_question_id}`)) qbIds.delete(String(row.question_bank_question_id));
    }
    for (const row of sources) {
      if (testQuestions.has(`${row.source_test_id}:${row.source_test_question_id}`)) qbIds.delete(String(row.id));
    }
  }
  const bySource = {
    questionBank: qbIds.size,
    pyq: new Set(pyq.map(row => String(row.question_id))).size,
    jamPyq: new Set([...jam, ...jamSubmissions].map(row => String(row.question_id))).size,
    tests: testQuestions.size,
    psuTests: new Set(psuTests.flatMap(row => answeredQuestionIds(row.answers).map(id => `${row.test_id}:${id}`))).size,
  };
  return { date, timezone: "Asia/Kolkata", attemptedToday: Object.values(bySource).reduce((sum, count) => sum + count, 0), bySource };
}
