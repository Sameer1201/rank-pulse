import { Router, type IRouter } from "express";
import { executeD1Sql } from "@workspace/db";
import { getSignedUserId } from "../lib/authUtils";
import { normalizeExamKey } from "../lib/examCatalog";

const router: IRouter = Router();

function getUser(req: any) {
  const userId = getSignedUserId(req);
  const userRole = req.cookies?.userRole ?? null;
  return { userId, userRole };
}

router.get("/leaderboard", async (req, res): Promise<void> => {
  const { userId } = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const requestedExamKey = normalizeExamKey(req.query.exam);

  const studentRows = (await executeD1Sql(
    `SELECT id, full_name AS fullName, username, avatar_url AS avatarUrl, subject, additional_exams AS additionalExams FROM users WHERE role = ? AND (status = ? OR status = ?)`,
    ["student", "approved", "active"],
  )).rows as Record<string, unknown>[];

  const scopedStudentRows = requestedExamKey
    ? studentRows.filter((row) => {
      const values = [row.subject, ...(() => { try { const parsed = JSON.parse(String(row.additionalExams ?? "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })()];
      return values.some((value) => normalizeExamKey(value) === requestedExamKey);
    })
    : studentRows;

  const students = scopedStudentRows.map((student) => ({
    id: Number(student.id ?? 0),
    fullName: String(student.fullName ?? ""),
    username: String(student.username ?? ""),
    avatarUrl: student.avatarUrl ?? null,
  }));

  const studentIds = students.map((student) => student.id);

  if (studentIds.length === 0) { res.json([]); return; }

  const placeholders = studentIds.map(() => "?").join(",");
  const [testRows, questionBankRows, pyqRows] = await Promise.all([
    executeD1Sql(
      `SELECT student_id AS studentId,
        COALESCE(SUM(score), 0) AS score,
        COALESCE(SUM(total_points), 0) AS totalPoints,
        COUNT(*) AS testsCompleted
       FROM test_submissions
       WHERE student_id IN (${placeholders}) AND total_points > 0
       GROUP BY student_id`,
      studentIds,
    ),
    executeD1Sql(
      `SELECT student_id AS studentId,
        COALESCE(SUM(attempt_count), 0) AS attempts,
        COALESCE(SUM(correct_count), 0) AS correct,
        COUNT(DISTINCT CASE WHEN attempt_count > 0 THEN question_id END) AS questionsAttempted,
        COUNT(DISTINCT CASE WHEN correct_count > 0 THEN question_id END) AS questionsSolved
       FROM question_bank_question_progress
       WHERE student_id IN (${placeholders})
       GROUP BY student_id`,
      studentIds,
    ).catch(() => ({ rows: [] })),
    executeD1Sql(
      `SELECT student_id AS studentId,
        COALESCE(SUM(attempt_count), 0) AS attempts,
        COALESCE(SUM(correct_count), 0) AS correct,
        COUNT(DISTINCT CASE WHEN attempt_count > 0 THEN question_id END) AS questionsAttempted,
        COUNT(DISTINCT CASE WHEN correct_count > 0 THEN question_id END) AS questionsSolved
       FROM pyq_question_progress
       WHERE student_id IN (${placeholders})
       GROUP BY student_id`,
      studentIds,
    ).catch(() => ({ rows: [] })),
  ]);

  const allSubs = testRows.rows as Record<string, unknown>[];
  const questionBankProgress = questionBankRows.rows as Record<string, unknown>[];
  const pyqProgress = pyqRows.rows as Record<string, unknown>[];

  const leaderboard = students.map((student) => {
    const testStats = allSubs.find((s) => Number(s.studentId ?? 0) === student.id);
    const questionBankStats = questionBankProgress.find((s) => Number(s.studentId ?? 0) === student.id);
    const pyqStats = pyqProgress.find((s) => Number(s.studentId ?? 0) === student.id);
    const testScore = Number(testStats?.score ?? 0);
    const maxPossible = Number(testStats?.totalPoints ?? 0);
    const avgTestPct = maxPossible > 0 ? Math.round((testScore / maxPossible) * 100) : 0;
    const qbankAttempts = Number(questionBankStats?.attempts ?? 0);
    const qbankCorrect = Number(questionBankStats?.correct ?? 0);
    const qbankPct = qbankAttempts > 0 ? Math.round((qbankCorrect / qbankAttempts) * 100) : 0;
    const pyqAttempts = Number(pyqStats?.attempts ?? 0);
    const pyqCorrect = Number(pyqStats?.correct ?? 0);
    const pyqPct = pyqAttempts > 0 ? Math.round((pyqCorrect / pyqAttempts) * 100) : 0;
    const testsCount = Number(testStats?.testsCompleted ?? 0);
    const questionsAttempted = Number(questionBankStats?.questionsAttempted ?? 0)
      + Number(pyqStats?.questionsAttempted ?? 0);
    const qbankSolved = Number(questionBankStats?.questionsSolved ?? 0);
    const pyqSolved = Number(pyqStats?.questionsSolved ?? 0);
    const rankPoints = avgTestPct * testsCount + questionsAttempted + qbankSolved * 2 + pyqSolved * 3;

    return {
      id: student.id,
      fullName: student.fullName,
      username: student.username,
      avatarUrl: student.avatarUrl,
      points: rankPoints,
      questionsAttempted,
      avgTestScore: avgTestPct,
      questionBankScore: qbankPct,
      pyqScore: pyqPct,
      avgAssignmentGrade: 0,
      attendancePercentage: 0,
      testsCompleted: testsCount,
      questionBankAttempts: qbankAttempts,
      pyqAttempts,
      activityCount: testsCount + questionsAttempted,
      assignmentsSubmitted: 0,
    };
  }).filter((student) => student.activityCount > 0 || student.id === Number(userId));

  leaderboard.sort((a, b) => b.points - a.points || b.activityCount - a.activityCount || a.fullName.localeCompare(b.fullName));
  const ranked = leaderboard.map((s, i) => ({ ...s, rank: i + 1 }));

  res.json(ranked);
});

export default router;
