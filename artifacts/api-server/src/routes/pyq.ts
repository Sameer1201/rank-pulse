import { pyqContentRepairStatements } from "../lib/pyqContentRepair";
import { pendingReportMessage, pyqReportInsert } from "../lib/pending-question-report";
import { JAM_SINGLE_SUBMISSION_PROGRESS_SQL } from "../lib/jamPyqProgress";
import { pyqExamFilter as examFilter } from "../lib/pyqExamFilter";
import { Router } from "express";
import { getSignedUserId } from "../lib/authUtils";
import { db, executeD1Sql, executeD1Batch } from "@workspace/db";
import {readEditablePyq,correctPyqQuestion,PyqCorrectionError} from '../lib/pyqQuestionCorrection';
import type {ResetStore} from '../lib/testAttemptReset';
import { usersTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { normalizeExamKey } from "../lib/examCatalog";

const router = Router();

type PyqValue = string | number | boolean | null;
type PyqRow = Record<string, unknown>;

function getAuth(req: any, res: any) {
  const userId = getSignedUserId(req);
  const role = String(req.cookies?.userRole ?? "");
  if (!userId || !role) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  if (role !== "admin" && role !== "student" && role !== "super_admin") {
    res.status(403).json({ error: "PYQ is not available for this account" });
    return null;
  }
  return { userId, role };
}

async function requireAdmin(req: any, res: any) {
  const auth = getAuth(req, res);
  if (!auth) return null;
  if (auth.role !== "admin" && auth.role !== "super_admin") {
    res.status(403).json({ error: "Only admins can manage PYQ questions" });
    return null;
  }
  const rows = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  const actualRole = rows[0]?.role;
  if (actualRole !== auth.role || (actualRole !== "admin" && actualRole !== "super_admin")) {
    res.status(403).json({ error: "Only admins can manage PYQ questions" });
    return null;
  }
  return auth;
}

function getWorkerConfig(exam?: unknown) {
  const isJamChemistry = normalizeExamKey(exam) === "jam-chemistry";
  const url = (isJamChemistry ? process.env.JAM_PYQ_PROXY_URL : process.env.PYQ_PROXY_URL)?.trim().replace(/\/$/u, "");
  const token = (isJamChemistry ? process.env.JAM_PYQ_PROXY_TOKEN : process.env.PYQ_PROXY_TOKEN)?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function workerQuery<T extends PyqRow = PyqRow>(
  method: "all" | "first" | "run",
  sql: string,
  params: PyqValue[] = [],
  exam?: unknown,
): Promise<{ results: T[]; meta?: Record<string, unknown> }> {
  const config = getWorkerConfig(exam);
  if (!config) throw new Error(normalizeExamKey(exam) === "jam-chemistry" ? "JAM Chemistry PYQ database is not configured on the API server" : "PYQ Worker is not configured on the API server");

  const response = await fetch(`${config.url}/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ method, sql, params }),
  });
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    results?: T[];
    meta?: Record<string, unknown>;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `PYQ Worker request failed (${response.status})`);
  }
  return { results: payload.results ?? [], meta: payload.meta };
}

async function syncJamSubmissionProgress(studentId: number, questionId: number, exam: string, answer: unknown, isCorrect: boolean, submittedAt: number) {
  if (normalizeExamKey(exam) !== "jam-chemistry") return;
  await workerQuery("run", JAM_SINGLE_SUBMISSION_PROGRESS_SQL, [
    questionId, studentId, isCorrect ? 1 : 0, isCorrect ? 0 : 1,
    JSON.stringify(answer), isCorrect ? 1 : 0, submittedAt, submittedAt,
    isCorrect ? submittedAt : null,
  ], exam);
}

async function workerBatch(statements: { sql: string; params: PyqValue[] }[], exam?: unknown) {
  const config = getWorkerConfig(exam);
  if (!config) throw new Error(normalizeExamKey(exam) === "jam-chemistry" ? "JAM Chemistry PYQ database is not configured on the API server" : "PYQ Worker is not configured on the API server");
  const response = await fetch(`${config.url}/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ method: "batch", statements }),
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? `PYQ Worker request failed (${response.status})`);
}

function parseOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 6);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function parseNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((item) => Number.isInteger(item) && item >= 0).slice(0, 6);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter((item) => Number.isInteger(item) && item >= 0).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function parseProgress(value: unknown) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    return {
      attemptCount: Number(row.attemptCount ?? row.attempt_count ?? 0),
      correctCount: Number(row.correctCount ?? row.correct_count ?? 0),
      incorrectCount: Number(row.incorrectCount ?? row.incorrect_count ?? 0),
      lastIsCorrect: Boolean(Number(row.lastIsCorrect ?? row.last_is_correct ?? 0)),
      firstAttemptedAt: row.firstAttemptedAt ?? row.first_attempted_at ?? null,
      lastAttemptedAt: row.lastAttemptedAt ?? row.last_attempted_at ?? null,
      solvedAt: row.solvedAt ?? row.solved_at ?? null,
    };
  } catch {
    return null;
  }
}

function serializeRow(row: PyqRow) {
  return {
    id: Number(row.id),
    exam: String(row.exam ?? ""),
    subject: String(row.subject ?? ""),
    chapter: String(row.chapter ?? ""),
    chapterOrder: Number(row.chapterOrder ?? row.chapter_order ?? 0),
    questionNumber: row.questionNumber == null && row.question_number == null ? null : Number(row.questionNumber ?? row.question_number),
    marks: row.marks == null ? null : String(row.marks),
    year: Number(row.year),
    paper: row.paper == null ? null : String(row.paper),
    question: String(row.question ?? ""),
    questionType: String(row.questionType ?? row.question_type ?? "mcq"),
    options: parseOptions(row.optionsJson ?? row.options_json),
    correctAnswer: row.correctAnswer == null && row.correct_answer == null
      ? null
      : Number(row.correctAnswer ?? row.correct_answer),
    correctAnswerMulti: parseNumberArray(row.correctAnswerMulti ?? row.correct_answer_multi),
    answerText: row.answerText == null && row.answer_text == null ? null : String(row.answerText ?? row.answer_text),
    answerMin: row.answerMin == null && row.answer_min == null ? null : Number(row.answerMin ?? row.answer_min),
    answerMax: row.answerMax == null && row.answer_max == null ? null : Number(row.answerMax ?? row.answer_max),
    progress: parseProgress(row.progressJson ?? row.progress_json),
    isSaved: Boolean(Number(row.isSaved ?? row.is_saved ?? 0)),
    explanation: row.explanation == null ? null : String(row.explanation),
    sourceUrl: row.sourceUrl == null && row.source_url == null ? null : String(row.sourceUrl ?? row.source_url),
    sourceName: row.sourceName == null && row.source_name == null ? null : String(row.sourceName ?? row.source_name),
    imageData: row.imageData == null && row.image_data == null ? null : String(row.imageData ?? row.image_data),
    createdBy: row.createdBy == null && row.created_by == null ? null : Number(row.createdBy ?? row.created_by),
    createdAt: row.createdAt == null && row.created_at == null ? null : String(row.createdAt ?? row.created_at),
    updatedAt: row.updatedAt == null && row.updated_at == null ? null : String(row.updatedAt ?? row.updated_at),
  };
}

function readText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readQuestionType(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return normalized === "INTEGER" || normalized === "NAT" || normalized === "NUMERICAL"
    ? "integer"
    : normalized === "MULTI" || normalized === "MSQ" || normalized === "MCQ_MULTI" || normalized === "MULTIPLE"
      ? "multi"
      : "mcq";
}

function questionSelect(includeSaved = false, includeProgress = false) {
  return `id, exam, subject, chapter, chapter_order AS chapterOrder, question_number AS questionNumber,
    marks, year, paper, question, question_type AS questionType, options_json AS optionsJson,
    correct_answer AS correctAnswer, correct_answer_multi AS correctAnswerMulti, answer_text AS answerText,
    answer_min AS answerMin, answer_max AS answerMax, explanation, source_url AS sourceUrl,
    source_name AS sourceName, image_data AS imageData, created_by AS createdBy,
    created_at AS createdAt, updated_at AS updatedAt${includeSaved ? ", EXISTS (SELECT 1 FROM pyq_saved_questions saved WHERE saved.question_id = pyq_questions.id AND saved.student_id = ?) AS isSaved" : ""}${includeProgress ? ", (SELECT json_object('attemptCount', attempt_count, 'correctCount', correct_count, 'incorrectCount', incorrect_count, 'lastIsCorrect', last_is_correct, 'firstAttemptedAt', first_attempted_at, 'lastAttemptedAt', last_attempted_at, 'solvedAt', solved_at) FROM pyq_question_progress progress WHERE progress.question_id = pyq_questions.id AND progress.student_id = ?) AS progressJson" : ""}`;
}

async function getPyqTimerTotals(studentId: number, exam: string) {
  const examKey = normalizeExamKey(exam) ?? "";
  const timerResult = await executeD1Sql(`SELECT question_id AS questionId, time_spent_seconds AS timeSpentSeconds
    FROM student_question_timers WHERE student_id = ? AND source_type = 'pyq' AND exam_key = ?`, [studentId, examKey]);
  const timerRows = timerResult.rows
    .map((row) => ({ id: Number(row.questionId ?? row.question_id), seconds: Number(row.timeSpentSeconds ?? row.time_spent_seconds ?? 0) }))
    .filter((row) => Number.isInteger(row.id) && row.id > 0 && row.seconds > 0);
  if (timerRows.length === 0) return { bySubject: new Map<string, number>(), byChapter: new Map<string, number>() };
  const metadata = await workerQuery("all", `SELECT id, subject, chapter FROM pyq_questions
    WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(timerRows.map((row) => row.id))], exam);
  const secondsById = new Map(timerRows.map((row) => [row.id, row.seconds]));
  const bySubject = new Map<string, number>();
  const byChapter = new Map<string, number>();
  for (const row of metadata.results) {
    const id = Number(row.id);
    const seconds = secondsById.get(id) ?? 0;
    const subject = String(row.subject ?? "");
    const chapter = String(row.chapter ?? "") || "General";
    bySubject.set(subject, (bySubject.get(subject) ?? 0) + seconds);
    const key = `${subject}\u0000${chapter}`;
    byChapter.set(key, (byChapter.get(key) ?? 0) + seconds);
  }
  return { bySubject, byChapter };
}

router.get("/pyq/subjects", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  const selectedExam = readText(req.query.exam, 80);
  try {
    const selectedExamFilter = selectedExam ? examFilter("pyq_questions.exam", selectedExam) : { clause: "", params: [] as PyqValue[] };
    const examClause = selectedExam ? `WHERE ${selectedExamFilter.clause}` : "";
    const [result, timerTotals] = await Promise.all([workerQuery("all", `
      SELECT exam, subject, COUNT(*) AS questionCount,
        COUNT(DISTINCT NULLIF(chapter, '')) AS chapterCount,
        COUNT(DISTINCT progress.question_id) AS attemptedCount
      FROM pyq_questions
      LEFT JOIN pyq_question_progress progress
        ON progress.question_id = pyq_questions.id AND progress.student_id = ?
      ${examClause}
      GROUP BY exam, subject
      ORDER BY subject COLLATE NOCASE ASC, exam COLLATE NOCASE ASC
    `, [auth.userId, ...selectedExamFilter.params], selectedExam), getPyqTimerTotals(auth.userId, selectedExam)]);
    res.json({ subjects: result.results.map((row) => ({
      exam: String(row.exam ?? ""),
      subject: String(row.subject ?? ""),
      questionCount: Number(row.questionCount ?? row.question_count ?? 0),
      chapterCount: Math.max(1, Number(row.chapterCount ?? row.chapter_count ?? 0)),
      attemptedCount: Number(row.attemptedCount ?? row.attempted_count ?? 0),
      totalTimeSpentSeconds: timerTotals.bySubject.get(String(row.subject ?? "")) ?? 0,
    })) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "PYQ service unavailable" });
  }
});

router.get("/pyq/chapters", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  const exam = readText(req.query.exam, 80);
  const subject = readText(req.query.subject, 80);
  if (!exam || !subject) {
    res.status(400).json({ error: "Exam and subject are required" });
    return;
  }
  try {
    const selectedExamFilter = examFilter("exam", exam);
    const [result, timerTotals] = await Promise.all([workerQuery("all", `
      SELECT CASE WHEN chapter = '' THEN 'General' ELSE chapter END AS chapter,
        MIN(chapter_order) AS chapterOrder, COUNT(*) AS questionCount,
        COUNT(DISTINCT progress.question_id) AS attemptedCount
      FROM pyq_questions
      LEFT JOIN pyq_question_progress progress
        ON progress.question_id = pyq_questions.id AND progress.student_id = ?
      WHERE ${selectedExamFilter.clause} AND subject = ?
      GROUP BY CASE WHEN chapter = '' THEN 'General' ELSE chapter END
      ORDER BY chapterOrder ASC, chapter COLLATE NOCASE ASC
    `, [auth.userId, ...selectedExamFilter.params, subject], exam), getPyqTimerTotals(auth.userId, exam)]);
    res.json({ chapters: result.results.map((row) => ({
      chapter: String(row.chapter ?? "General"),
      chapterOrder: Number(row.chapterOrder ?? row.chapter_order ?? 0),
      questionCount: Number(row.questionCount ?? row.question_count ?? 0),
      attemptedCount: Number(row.attemptedCount ?? row.attempted_count ?? 0),
      totalTimeSpentSeconds: timerTotals.byChapter.get(`${subject}\u0000${String(row.chapter ?? "General")}`) ?? 0,
    })) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "PYQ service unavailable" });
  }
});

router.get("/pyq/questions", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const requestedLimit = Number(req.query.limit ?? 50);
  const requestedPage = Number(req.query.page ?? 1);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: PyqValue[] = [];

  const exam = readText(req.query.exam, 80);
  const subject = readText(req.query.subject, 80);
  const chapter = readText(req.query.chapter, 160);
  const savedOnly = String(req.query.saved ?? "") === "1";
  const questionType = readText(req.query.type, 20);
  const marksParam = typeof req.query.marks === "string" ? req.query.marks.trim() : "";
  const marksFilter = marksParam ? Number(marksParam) : Number.NaN;
  const year = Number(req.query.year);
  if (exam) {
    const selectedExamFilter = examFilter("exam", exam);
    where.push(selectedExamFilter.clause);
    params.push(...selectedExamFilter.params);
  }
  if (subject) { where.push("subject = ?"); params.push(subject); }
  if (chapter) { where.push(chapter === "General" ? "(chapter = ? OR chapter = '')" : "chapter = ?"); params.push(chapter); }
  if (Number.isInteger(year) && year >= 1900 && year <= 2200) { where.push("year = ?"); params.push(year); }
  if (["mcq", "multi", "integer"].includes(questionType)) { where.push("question_type = ?"); params.push(questionType); }
  if (Number.isInteger(marksFilter) && marksFilter >= 0 && marksFilter <= 20) { where.push("CAST(marks AS REAL) = ?"); params.push(marksFilter); }
  if (savedOnly) { where.push("EXISTS (SELECT 1 FROM pyq_saved_questions saved_filter WHERE saved_filter.question_id = pyq_questions.id AND saved_filter.student_id = ?)"); params.push(auth.userId); }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const result = await workerQuery("all", `
      SELECT ${questionSelect(true, true)}
      FROM pyq_questions ${clause}
      ORDER BY chapter_order ASC, question_number ASC, year DESC, id DESC LIMIT ? OFFSET ?
    `, [auth.userId, auth.userId, ...params, limit, offset], exam);
    const count = await workerQuery("first", `SELECT COUNT(*) AS totalCount FROM pyq_questions ${clause}`, params, exam);
    const jamSolutionMode = auth.role === "student" && normalizeExamKey(exam) === "jam-chemistry"
      ? Boolean((await executeD1Sql("SELECT student_id FROM jam_pyq_solution_access WHERE student_id = ? LIMIT 1", [auth.userId])).rows.length)
      : false;
    const questions = result.results.map(serializeRow);
    if (auth.role === "student" && questions.length > 0) {
      const questionIds = questions.map((question) => Number(question.id)).filter((id) => Number.isInteger(id) && id > 0);
      const examKey = normalizeExamKey(exam);
      const timerRows = await executeD1Sql(`SELECT question_id AS questionId, time_spent_seconds AS timeSpentSeconds
        FROM student_question_timers WHERE student_id = ? AND source_type = 'pyq' AND exam_key = ? AND question_id IN (SELECT value FROM json_each(?))`, [auth.userId, examKey ?? "", JSON.stringify(questionIds)]);
      const timerByQuestion = new Map(timerRows.rows.map((row) => [Number(row.questionId ?? row.question_id), Number(row.timeSpentSeconds ?? row.time_spent_seconds ?? 0)]));
      for (const question of questions) Object.assign(question, { timeSpentSeconds: timerByQuestion.get(Number(question.id)) ?? 0 });
    }
    if (jamSolutionMode && questions.length) {
      const questionIds = questions.map((question) => Number(question.id)).filter((id) => Number.isInteger(id) && id > 0);
      const submissions = questionIds.length
        ? await executeD1Sql(`SELECT question_id AS questionId, answer_json AS answerJson, is_correct AS isCorrect FROM jam_pyq_submissions WHERE student_id = ? AND question_id IN (SELECT value FROM json_each(?))`, [auth.userId, JSON.stringify(questionIds)])
        : { rows: [] };
      const submissionByQuestion = new Map(submissions.rows.map((row) => [Number(row.questionId ?? row.question_id), row]));
      for (const question of questions) {
        const submission = submissionByQuestion.get(Number(question.id));
        if (!submission) continue;
        let submittedAnswer: unknown = null;
        try { submittedAnswer = JSON.parse(String(submission.answerJson ?? submission.answer_json ?? "null")); } catch {}
        Object.assign(question, { jamSolutionMode: true, jamSubmitted: true, jamSubmittedAnswer: submittedAnswer, jamSubmittedCorrect: Boolean(Number(submission.isCorrect ?? submission.is_correct)) });
      }
    }
    if (jamSolutionMode) for (const question of questions) Object.assign(question, { jamSolutionMode: true });
    res.json({ questions, jamSolutionMode, page, limit, total: Number(count.results[0]?.totalCount ?? count.results[0]?.total_count ?? 0) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "PYQ service unavailable" });
  }
});

router.post("/pyq/questions/:id/time", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") {
    res.status(403).json({ error: "Only students can save PYQ question time" });
    return;
  }
  const questionId = Number(req.params.id);
  const exam = readText(req.body?.exam, 80);
  const seconds = Number(req.body?.timeSpentSeconds);
  const examKey = normalizeExamKey(exam);
  if (!examKey || !Number.isInteger(questionId) || questionId <= 0 || !["gate", "jam-chemistry"].includes(examKey)) {
    res.status(400).json({ error: "Invalid GATE/JAM PYQ question" });
    return;
  }
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 31_536_000) {
    res.status(400).json({ error: "Question time must be between 0 and one year" });
    return;
  }
  try {
    const priorAttempt = await workerQuery("first",
      "SELECT attempt_count FROM pyq_question_progress WHERE student_id = ? AND question_id = ? LIMIT 1",
      [auth.userId, questionId], exam);
    if (Number(priorAttempt.results[0]?.attempt_count ?? 0) > 0) {
      const firstTime = await executeD1Sql(`SELECT time_spent_seconds AS timeSpentSeconds FROM student_question_timers
        WHERE student_id = ? AND source_type = 'pyq' AND exam_key = ? AND question_id = ?`,
      [auth.userId, examKey, questionId]);
      return res.json({ timeSpentSeconds: Number(firstTime.rows[0]?.timeSpentSeconds ?? 0) });
    }
    const result = await executeD1Sql(`INSERT INTO student_question_timers (student_id, source_type, exam_key, question_id, time_spent_seconds, updated_at)
      VALUES (?, 'pyq', ?, ?, ?, ?) ON CONFLICT(student_id, source_type, exam_key, question_id) DO UPDATE SET
      time_spent_seconds = MAX(student_question_timers.time_spent_seconds, excluded.time_spent_seconds),
      updated_at = excluded.updated_at RETURNING time_spent_seconds AS timeSpentSeconds`, [auth.userId, examKey, questionId, seconds, Date.now()]);
    res.json({ timeSpentSeconds: Number(result.rows[0]?.timeSpentSeconds ?? result.rows[0]?.time_spent_seconds ?? seconds) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not save question timer" });
  }
});

router.get("/pyq/jam-solution-access", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  try {
    const result = await executeD1Sql("SELECT student_id AS studentId FROM jam_pyq_solution_access ORDER BY student_id", []);
    res.json({ studentIds: result.rows.map((row) => Number(row.studentId ?? row.student_id)).filter((id) => Number.isInteger(id) && id > 0) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not load JAM solution access" });
  }
});

router.patch("/pyq/jam-solution-access", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const studentId = Number(req.body?.studentId);
  const enabled = req.body?.enabled === true;
  if (!Number.isInteger(studentId) || studentId <= 0) {
    res.status(400).json({ error: "A valid student account is required" });
    return;
  }
  try {
    const student = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, studentId)).limit(1);
    if (student[0]?.role !== "student") {
      res.status(404).json({ error: "Student account not found" });
      return;
    }
    if (enabled) {
      await executeD1Sql("INSERT INTO jam_pyq_solution_access (student_id, enabled_by, updated_at) VALUES (?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET enabled_by = excluded.enabled_by, updated_at = excluded.updated_at", [studentId, auth.userId, Date.now()]);
    } else {
      await executeD1Sql("DELETE FROM jam_pyq_solution_access WHERE student_id = ?", [studentId]);
    }
    res.json({ studentId, enabled });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not update JAM solution access" });
  }
});

router.post("/pyq/questions/:id/jam-submit", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") {
    res.status(403).json({ error: "Only students can submit PYQ answers" });
    return;
  }
  const questionId = Number(req.params.id);
  const exam = readText(req.body?.exam, 80);
  if (!Number.isInteger(questionId) || questionId <= 0 || normalizeExamKey(exam) !== "jam-chemistry") {
    res.status(400).json({ error: "Invalid JAM Chemistry question" });
    return;
  }
  try {
    const access = await executeD1Sql("SELECT student_id FROM jam_pyq_solution_access WHERE student_id = ? LIMIT 1", [auth.userId]);
    if (!access.rows.length) {
      res.status(403).json({ error: "One-time JAM solution review is not enabled for this account" });
      return;
    }
    const questionResult = await workerQuery("first", `SELECT question_type AS questionType, correct_answer AS correctAnswer,
      correct_answer_multi AS correctAnswerMulti, answer_min AS answerMin, answer_max AS answerMax, answer_text AS answerText
      FROM pyq_questions WHERE id = ? AND exam = ? LIMIT 1`, [questionId, exam], exam);
    const question = questionResult.results[0];
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const answer = req.body?.answer;
    if (answer == null || (typeof answer === "string" && !answer.trim()) || (Array.isArray(answer) && answer.length === 0)) {
      res.status(400).json({ error: "Submit an answer before continuing" });
      return;
    }
    const questionType = String(question.questionType ?? question.question_type ?? "mcq");
    let isCorrect = false;
    if (questionType === "multi") {
      const expected = parseNumberArray(question.correctAnswerMulti ?? question.correct_answer_multi).sort((a, b) => a - b);
      const selected = parseNumberArray(answer).sort((a, b) => a - b);
      isCorrect = JSON.stringify(expected) === JSON.stringify(selected);
    } else if (questionType === "integer") {
      const numeric = Number(answer);
      const min = question.answerMin == null && question.answer_min == null ? null : Number(question.answerMin ?? question.answer_min);
      const max = question.answerMax == null && question.answer_max == null ? null : Number(question.answerMax ?? question.answer_max);
      if (min !== null && max !== null) isCorrect = Number.isFinite(numeric) && numeric >= min && numeric <= max;
      else {
        const exact = Number(question.correctAnswer ?? question.correct_answer ?? String(question.answerText ?? question.answer_text ?? "").replace(/<[^>]+>/g, ""));
        isCorrect = Number.isFinite(numeric) && Number.isFinite(exact) && Math.abs(numeric - exact) < 1e-9;
      }
    } else {
      isCorrect = Number(answer) === Number(question.correctAnswer ?? question.correct_answer);
    }
    const now = Date.now();
    const inserted = await executeD1Sql("INSERT OR IGNORE INTO jam_pyq_submissions (student_id, question_id, answer_json, is_correct, submitted_at) VALUES (?, ?, ?, ?, ?)", [auth.userId, questionId, JSON.stringify(answer), isCorrect ? 1 : 0, now]);
    const saved = await executeD1Sql("SELECT answer_json AS answerJson, is_correct AS isCorrect, submitted_at AS submittedAt FROM jam_pyq_submissions WHERE student_id = ? AND question_id = ? LIMIT 1", [auth.userId, questionId]);
    const row = saved.rows[0];
    let savedAnswer: unknown = null;
    try { savedAnswer = JSON.parse(String(row?.answerJson ?? row?.answer_json ?? "null")); } catch {}
    await syncJamSubmissionProgress(auth.userId, questionId, exam, savedAnswer, Boolean(Number(row?.isCorrect ?? row?.is_correct)), Number(row?.submittedAt ?? row?.submitted_at ?? now));
    res.json({ submitted: true, alreadySubmitted: inserted.rowCount === 0, answer: savedAnswer, isCorrect: Boolean(Number(row?.isCorrect ?? row?.is_correct)) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not save JAM solution submission" });
  }
});

router.post("/pyq/questions", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const exam = readText(req.body?.exam, 80);
  const subject = readText(req.body?.subject, 80);
  const chapter = readText(req.body?.chapter, 160) || "General";
  const chapterOrder = Number.isInteger(Number(req.body?.chapterOrder)) ? Number(req.body.chapterOrder) : 0;
  const questionNumber = Number.isInteger(Number(req.body?.questionNumber)) ? Number(req.body.questionNumber) : null;
  const marks = readText(req.body?.marks, 40) || null;
  const paper = readText(req.body?.paper, 80) || null;
  const question = readText(req.body?.question, 12000);
  const year = Number(req.body?.year);
  const questionType = readQuestionType(req.body?.questionType);
  const options = parseOptions(req.body?.options);
  const correctAnswer = req.body?.correctAnswer === null || req.body?.correctAnswer === ""
    ? null
    : Number(req.body?.correctAnswer);
  const explanation = readText(req.body?.explanation, 12000) || null;
  const answerText = readText(req.body?.answerText, 2000) || null;
  const answerMin = req.body?.answerMin === null || req.body?.answerMin === "" || req.body?.answerMin === undefined ? null : Number(req.body.answerMin);
  const answerMax = req.body?.answerMax === null || req.body?.answerMax === "" || req.body?.answerMax === undefined ? null : Number(req.body.answerMax);
  const sourceUrl = readText(req.body?.sourceUrl, 2000) || null;
  const sourceName = readText(req.body?.sourceName, 160) || null;
  const imageData = readText(req.body?.imageData, 2_000_000) || null;

  if (!exam || !subject || !question || !Number.isInteger(year) || year < 1900 || year > 2200) {
    res.status(400).json({ error: "Exam, subject, year and question are required" });
    return;
  }
  if (questionType === "mcq" && options.length < 2) {
    res.status(400).json({ error: "MCQ questions need at least two options" });
    return;
  }
  if (correctAnswer !== null && (!Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer >= options.length)) {
    res.status(400).json({ error: "Correct answer must point to one of the options" });
    return;
  }

  try {
    const result = await workerQuery("first", `
      INSERT INTO pyq_questions
        (exam, subject, chapter, chapter_order, question_number, marks, year, paper, question, question_type,
         options_json, correct_answer, correct_answer_multi, answer_text, answer_min, answer_max, explanation,
         image_data, source_url, source_name, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      RETURNING ${questionSelect()}
    `, [exam, subject, chapter, chapterOrder, questionNumber, marks, year, paper, question, questionType, JSON.stringify(options), correctAnswer, JSON.stringify([]), answerText, answerMin, answerMax, explanation, imageData, sourceUrl, sourceName, auth.userId], exam);
    res.status(201).json({ question: result.results[0] ? serializeRow(result.results[0]) : null });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not upload PYQ question" });
  }
});

router.post("/pyq/repair-content", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  let statements: ReturnType<typeof pyqContentRepairStatements>;
  try { statements = pyqContentRepairStatements(req.body); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid repair" }); return; }
  try {
    await workerBatch(statements);
    res.json({ processed: statements.length });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not repair content" }); }
});

router.post("/pyq/import", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const exam = readText(req.body?.exam, 80);
  const subject = readText(req.body?.subject, 120);
  const replaceChapter = readText(req.body?.replaceChapter, 160) || null;
  const sourceName = readText(req.body?.sourceName, 200) || null;
  const incoming = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (!exam || !subject || incoming.length === 0 || incoming.length > 500) {
    res.status(400).json({ error: "Exam, subject and between 1 and 500 questions are required" });
    return;
  }

  const questions = incoming.map((item: any, index: number) => {
    const type = readQuestionType(item?.questionType ?? item?.type);
    const options = parseOptions(item?.options);
    const correctAnswers = parseNumberArray(item?.correctAnswers ?? (item?.correctAnswer == null ? [] : [item.correctAnswer]))
      .filter((answer) => answer < options.length);
    const correctRaw = item?.correctAnswer === null || item?.correctAnswer === "" || item?.correctAnswer === undefined ? null : Number(item.correctAnswer);
    const year = Number(item?.year);
    return {
      chapter: readText(item?.chapter, 160) || "General",
      chapterOrder: Number.isInteger(Number(item?.chapterOrder)) ? Number(item.chapterOrder) : 0,
      questionNumber: Number.isInteger(Number(item?.questionNumber)) ? Number(item.questionNumber) : index + 1,
      marks: readText(item?.marks, 40) || null,
      year,
      paper: readText(item?.paper, 160) || null,
      question: readText(item?.question, 2_000_000),
      type,
      options,
      correctAnswer: correctRaw,
      correctAnswers,
      answerText: readText(item?.answerText, 4000) || null,
      answerMin: item?.answerMin === null || item?.answerMin === "" || item?.answerMin === undefined ? null : Number(item.answerMin),
      answerMax: item?.answerMax === null || item?.answerMax === "" || item?.answerMax === undefined ? null : Number(item.answerMax),
      explanation: readText(item?.explanation, 2_000_000) || null,
      sourceUrl: readText(item?.sourceUrl, 2000) || null,
      imageData: readText(item?.imageData, 2_000_000) || null,
    };
  });

  // Some official PYQ source files contain valid questions whose answer key is
  // explicitly unavailable (for example, "MTA / Marks to All"). Keep those
  // questions importable with a null answer instead of rejecting the entire
  // subject. Option/answer rows are normalized above because source HTML can
  // contain incomplete or decorative answer rows.
  const invalid = questions.find((item: any) => !item.question || !Number.isInteger(item.year) || (item.year !== 0 && (item.year < 1900 || item.year > 2200)) || (item.type === "integer" && (item.answerMin != null && !Number.isFinite(item.answerMin) || item.answerMax != null && !Number.isFinite(item.answerMax))));
  if (invalid) {
    res.status(400).json({ error: "Every imported question needs valid year, question content and answer metadata" });
    return;
  }

  try {
    const statements = (items: typeof questions) => items.map((item: any) => ({
      sql: `INSERT INTO pyq_questions
        (exam, subject, chapter, chapter_order, question_number, marks, year, paper, question, question_type,
         options_json, correct_answer, correct_answer_multi, answer_text, answer_min, answer_max, explanation,
         image_data, source_url, source_name, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      params: [exam, subject, item.chapter, item.chapterOrder, item.questionNumber, item.marks, item.year, item.paper, item.question, item.type, JSON.stringify(item.options), item.correctAnswers[0] ?? null, JSON.stringify(item.correctAnswers), item.answerText, item.answerMin, item.answerMax, item.explanation, item.imageData, item.sourceUrl, sourceName, auth.userId],
    }));
    const deleteStatement = replaceChapter
      ? { sql: "DELETE FROM pyq_questions WHERE exam = ? AND subject = ? AND (chapter = ? OR (chapter = '' AND ? = 'General'))", params: [exam, subject, replaceChapter, replaceChapter] }
      : { sql: "DELETE FROM pyq_questions WHERE exam = ? AND subject = ?", params: [exam, subject] };
    await workerBatch([deleteStatement, ...statements(questions.slice(0, 99))], exam);
    for (let offset = 99; offset < questions.length; offset += 100) await workerBatch(statements(questions.slice(offset, offset + 100)), exam);
    res.status(201).json({ imported: questions.length, subject, exam, chapters: new Set(questions.map((item: any) => item.chapter)).size });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not import PYQ subject" });
  }
});

router.post("/pyq/questions/:id/save", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") {
    res.status(403).json({ error: "Only students can save PYQ questions" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid question id" });
    return;
  }
  try {
    const existing = await workerQuery("first", "SELECT question_id FROM pyq_saved_questions WHERE student_id = ? AND question_id = ?", [auth.userId, id]);
    if (existing.results[0]) {
      await workerQuery("run", "DELETE FROM pyq_saved_questions WHERE student_id = ? AND question_id = ?", [auth.userId, id]);
      res.json({ saved: false });
      return;
    }
    await workerQuery("run", "INSERT OR IGNORE INTO pyq_saved_questions (student_id, question_id) VALUES (?, ?)", [auth.userId, id]);
    res.json({ saved: true });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not update saved PYQ" });
  }
});

router.post("/pyq/questions/:id/attempt", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") {
    res.status(403).json({ error: "Only students can submit PYQ attempts" });
    return;
  }
  const questionId = Number(req.params.id);
  if (!Number.isInteger(questionId) || questionId <= 0) {
    res.status(400).json({ error: "Invalid question id" });
    return;
  }
  try {
    const exam = readText(req.body?.exam, 80);
    const questionResult = await workerQuery("first", `
      SELECT question_type AS questionType, correct_answer AS correctAnswer,
        correct_answer_multi AS correctAnswerMulti, answer_min AS answerMin,
        answer_max AS answerMax, answer_text AS answerText
      FROM pyq_questions WHERE id = ? LIMIT 1
    `, [questionId], exam);
    const question = questionResult.results[0];
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const answer = req.body?.answer;
    const questionType = String(question.questionType ?? question.question_type ?? "mcq");
    let isCorrect: boolean | null = null;
    if (questionType === "multi") {
      const expected = parseNumberArray(question.correctAnswerMulti ?? question.correct_answer_multi).sort((a, b) => a - b);
      const selected = parseNumberArray(answer).sort((a, b) => a - b);
      isCorrect = JSON.stringify(expected) === JSON.stringify(selected);
    } else if (questionType === "integer") {
      const numeric = Number(answer);
      const min = question.answerMin == null && question.answer_min == null ? null : Number(question.answerMin ?? question.answer_min);
      const max = question.answerMax == null && question.answer_max == null ? null : Number(question.answerMax ?? question.answer_max);
      if (min !== null && max !== null) isCorrect = Number.isFinite(numeric) && numeric >= min && numeric <= max;
      else {
        const exactValue = question.correctAnswer ?? question.correct_answer ?? String(question.answerText ?? question.answer_text ?? "").replace(/<[^>]+>/g, "");
        const exact = Number(exactValue);
        isCorrect = Number.isFinite(numeric) && Number.isFinite(exact) && Math.abs(numeric - exact) < 1e-9;
      }
    } else {
      isCorrect = Number(answer) === Number(question.correctAnswer ?? question.correct_answer);
    }
    const existing = await workerQuery("first", "SELECT * FROM pyq_question_progress WHERE student_id = ? AND question_id = ? LIMIT 1", [auth.userId, questionId], exam);
    const current = existing.results[0];
    const now = Date.now();
    const storedAnswer = JSON.stringify(answer ?? null) ?? "null";
    const attemptCount = Number(current?.attempt_count ?? 0) + 1;
    const correctCount = Number(current?.correct_count ?? 0) + (isCorrect ? 1 : 0);
    const incorrectCount = Number(current?.incorrect_count ?? 0) + (isCorrect ? 0 : 1);
    const previousSolvedAt = current?.solved_at == null ? null : Number(current.solved_at);
    const solvedAt = isCorrect ? now : previousSolvedAt;
    if (current) {
      await workerQuery("run", `UPDATE pyq_question_progress
        SET attempt_count = ?, correct_count = ?, incorrect_count = ?, last_answer = ?, last_is_correct = ?, last_attempted_at = ?, solved_at = ?
        WHERE id = ?`, [attemptCount, correctCount, incorrectCount, storedAnswer, isCorrect ? 1 : 0, now, solvedAt, Number(current.id)], exam);
    } else {
      await workerQuery("run", `INSERT INTO pyq_question_progress
        (question_id, student_id, attempt_count, correct_count, incorrect_count, last_answer, last_is_correct, first_attempted_at, last_attempted_at, solved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [questionId, auth.userId, 1, isCorrect ? 1 : 0, isCorrect ? 0 : 1, storedAnswer, isCorrect ? 1 : 0, now, now, solvedAt], exam);
    }
    res.json({ isCorrect, progress: { attemptCount, correctCount, incorrectCount, lastIsCorrect: Boolean(isCorrect), lastAttemptedAt: now, solvedAt } });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not save PYQ progress" });
  }
});

router.all("/pyq/questions/:id/report", async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) return res.sendStatus(405);
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") {
    res.status(403).json({ error: "Only students can report PYQ questions" });
    return;
  }
  const questionId = Number(req.params.id);
  const reason = readText(req.body?.reason, 1000);
  if (!Number.isInteger(questionId) || questionId <= 0) {
    res.status(400).json({ error: "Invalid question id" });
    return;
  }
  if (req.method === "POST" && !reason) {
    res.status(400).json({ error: "Reason is required" });
    return;
  }
  try {
    const exam = req.body?.exam ?? req.query.exam;
    const question = await workerQuery("first", "SELECT id FROM pyq_questions WHERE id = ? LIMIT 1", [questionId], exam);
    if (!question.results[0]) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const now = Date.now();
    if (req.method === "GET") {
      const pending = await workerQuery("first", "SELECT id FROM pyq_reports WHERE question_id = ? AND reported_by = ? AND status = 'open' LIMIT 1", [questionId, auth.userId], exam);
      return res.json({ pending: pending.results.length > 0 });
    }
    const inserted = await workerQuery("first", pyqReportInsert, [questionId, auth.userId, reason, now, now, questionId, auth.userId], exam);
    if (!inserted.results.length) return res.status(409).json({ error: pendingReportMessage, pending: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not submit PYQ report" });
  }
});

router.get("/pyq/progress/summary", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") {
    res.status(403).json({ error: "Only students can view PYQ progress" });
    return;
  }
  const selectedExam = readText(req.query.exam, 80);
  try {
    const selectedExamFilter = selectedExam ? examFilter("questions.exam", selectedExam) : { clause: "", params: [] as PyqValue[] };
    const examClause = selectedExam ? ` AND ${selectedExamFilter.clause}` : "";
    const examParams: PyqValue[] = [auth.userId, ...selectedExamFilter.params];
    const summary = await workerQuery("first", `SELECT COUNT(*) AS totalAttemptedQuestions,
      COALESCE(SUM(CASE WHEN solved_at IS NOT NULL OR correct_count > 0 THEN 1 ELSE 0 END), 0) AS totalSolvedQuestions,
      COALESCE(SUM(attempt_count), 0) AS totalAttempts, COALESCE(SUM(correct_count), 0) AS correctAttempts,
      COALESCE(SUM(CASE WHEN last_is_correct = 1 THEN 1 ELSE 0 END), 0) AS latestCorrectQuestions
      FROM pyq_question_progress progress INNER JOIN pyq_questions questions ON questions.id = progress.question_id WHERE progress.student_id = ?${examClause}`, examParams, selectedExam);
    const row = summary.results[0] ?? {};
    const totalAttempts = Number(row.totalAttempts ?? 0);
    const daily = await workerQuery("all", `SELECT strftime('%Y-%m-%d', progress.first_attempted_at / 1000, 'unixepoch') AS date,
      COUNT(*) AS questions
      FROM pyq_question_progress progress INNER JOIN pyq_questions questions ON questions.id = progress.question_id
      WHERE progress.student_id = ? AND progress.first_attempted_at IS NOT NULL
      GROUP BY date ORDER BY date`, examParams, selectedExam);
    res.json({
      totalAttemptedQuestions: Number(row.totalAttemptedQuestions ?? 0),
      totalSolvedQuestions: Number(row.totalSolvedQuestions ?? 0),
      totalAttempts,
      correctAttempts: Number(row.correctAttempts ?? 0),
      latestCorrectQuestions: Number(row.latestCorrectQuestions ?? 0),
      accuracy: totalAttempts > 0 ? Math.round((Number(row.correctAttempts ?? 0) / totalAttempts) * 100) : 0,
      dailyAttemptedCounts: daily.results.map((entry) => ({ date: String(entry.date ?? ""), questions: Number(entry.questions ?? 0) })),
    });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not load PYQ progress" });
  }
});

router.get("/pyq/progress/admin-summary", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const selectedExam = readText(req.query.exam, 80);
  try {
    const selectedExamFilter = selectedExam ? examFilter("questions.exam", selectedExam) : { clause: "", params: [] as PyqValue[] };
    const summary = await workerQuery("first", `SELECT COUNT(DISTINCT student_id) AS students, COUNT(*) AS attemptedQuestions,
      COALESCE(SUM(attempt_count), 0) AS attempts, COALESCE(SUM(correct_count), 0) AS correctAttempts,
      COALESCE(SUM(CASE WHEN solved_at IS NOT NULL OR correct_count > 0 THEN 1 ELSE 0 END), 0) AS solvedQuestions
      FROM pyq_question_progress progress INNER JOIN pyq_questions questions ON questions.id = progress.question_id
      ${selectedExam ? `WHERE ${selectedExamFilter.clause}` : ""}`, selectedExamFilter.params, selectedExam);
    const row = summary.results[0] ?? {};
    const attempts = Number(row.attempts ?? 0);
    res.json({ students: Number(row.students ?? 0), attemptedQuestions: Number(row.attemptedQuestions ?? 0), solvedQuestions: Number(row.solvedQuestions ?? 0), attempts, correctAttempts: Number(row.correctAttempts ?? 0), accuracy: attempts > 0 ? Math.round((Number(row.correctAttempts ?? 0) / attempts) * 100) : 0 });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not load PYQ admin progress" });
  }
});

router.get("/pyq/reports", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const selectedExam = readText(req.query.exam, 80);
  const status = readText(req.query.status, 20) || "open";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  try {
    const result = await workerQuery("all", `SELECT reports.id, reports.question_id AS questionId, reports.reported_by AS reportedBy,
      reports.reason, reports.status, reports.created_at AS createdAt, reports.updated_at AS updatedAt,
      questions.question, questions.exam, questions.subject, questions.chapter, questions.year
      FROM pyq_reports reports JOIN pyq_questions questions ON questions.id = reports.question_id
      WHERE reports.status = ? ORDER BY reports.created_at DESC, reports.id DESC LIMIT ?`, [status, limit], selectedExam);
    const reporterIds = [...new Set(result.results.map((row) => Number(row.reportedBy ?? row.reported_by)).filter((id) => Number.isInteger(id) && id > 0))];
    const reporters = reporterIds.length > 0 ? await db.select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username }).from(usersTable).where(inArray(usersTable.id, reporterIds)) : [];
    const reporterMap = new Map(reporters.map((user) => [user.id, user]));
    res.json({ reports: result.results.map((row) => ({
      id: Number(row.id), questionId: Number(row.questionId ?? row.question_id), reportedBy: Number(row.reportedBy ?? row.reported_by), reporterName: reporterMap.get(Number(row.reportedBy ?? row.reported_by))?.fullName ?? reporterMap.get(Number(row.reportedBy ?? row.reported_by))?.username ?? "Student", reason: String(row.reason ?? ""), status: String(row.status ?? "open"), createdAt: row.createdAt ?? row.created_at ?? null, updatedAt: row.updatedAt ?? row.updated_at ?? null, questionText: String(row.question ?? ""), exam: String(row.exam ?? ""), subject: String(row.subject ?? ""), chapter: String(row.chapter ?? ""), year: Number(row.year ?? 0),
    })) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not load PYQ reports" });
  }
});

router.patch("/pyq/reports/:id/reject", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }
  try {
    await workerQuery("run", "UPDATE pyq_reports SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'open'", [Date.now(), id], req.query.exam);
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not reject PYQ report" });
  }
});

router.delete("/pyq/chapters", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const exam = readText(req.query.exam, 80);
  const subject = readText(req.query.subject, 120);
  const chapter = readText(req.query.chapter, 200);
  if (!exam || !subject || !chapter) {
    res.status(400).json({ error: "Exam, subject and chapter are required" });
    return;
  }
  try {
    await workerQuery("run", "DELETE FROM pyq_saved_questions WHERE question_id IN (SELECT id FROM pyq_questions WHERE exam = ? AND subject = ? AND chapter = ?)", [exam, subject, chapter], exam);
    await workerQuery("run", "DELETE FROM pyq_question_progress WHERE question_id IN (SELECT id FROM pyq_questions WHERE exam = ? AND subject = ? AND chapter = ?)", [exam, subject, chapter], exam);
    await workerQuery("run", "DELETE FROM pyq_reports WHERE question_id IN (SELECT id FROM pyq_questions WHERE exam = ? AND subject = ? AND chapter = ?)", [exam, subject, chapter], exam);
    await workerQuery("run", "DELETE FROM pyq_questions WHERE exam = ? AND subject = ? AND chapter = ?", [exam, subject, chapter], exam);
    res.status(204).end();
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not delete PYQ chapter" });
  }
});

router.patch("/pyq/chapters", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const exam = readText(req.body?.exam, 80);
  const subject = readText(req.body?.subject, 120);
  const chapter = readText(req.body?.chapter, 200);
  const nextChapter = readText(req.body?.nextChapter, 200);
  if (!exam || !subject || !chapter || !nextChapter) {
    res.status(400).json({ error: "Exam, subject, current chapter and new chapter are required" });
    return;
  }
  if (chapter === nextChapter) {
    res.json({ ok: true, exam, subject, chapter: nextChapter });
    return;
  }
  try {
    const duplicate = await workerQuery("first", `SELECT id FROM pyq_questions
      WHERE exam = ? AND subject = ? AND (chapter = ? OR (chapter = '' AND ? = 'General')) LIMIT 1`, [exam, subject, nextChapter, nextChapter], exam);
    if (duplicate.results[0]) {
      res.status(409).json({ error: "A chapter with this name already exists for the selected subject" });
      return;
    }
    await workerQuery("run", `UPDATE pyq_questions SET chapter = ?, updated_at = CURRENT_TIMESTAMP
      WHERE exam = ? AND subject = ? AND (chapter = ? OR (chapter = '' AND ? = 'General'))`, [nextChapter, exam, subject, chapter, chapter], exam);
    res.json({ ok: true, exam, subject, chapter: nextChapter });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not rename PYQ chapter" });
  }
});

router.delete("/pyq/subjects", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const exam = readText(req.query.exam, 80);
  const subject = readText(req.query.subject, 120);
  if (!exam || !subject) {
    res.status(400).json({ error: "Exam and subject are required" });
    return;
  }
  try {
    await workerQuery("run", "DELETE FROM pyq_saved_questions WHERE question_id IN (SELECT id FROM pyq_questions WHERE exam = ? AND subject = ?)", [exam, subject], exam);
    await workerQuery("run", "DELETE FROM pyq_question_progress WHERE question_id IN (SELECT id FROM pyq_questions WHERE exam = ? AND subject = ?)", [exam, subject], exam);
    await workerQuery("run", "DELETE FROM pyq_reports WHERE question_id IN (SELECT id FROM pyq_questions WHERE exam = ? AND subject = ?)", [exam, subject], exam);
    await workerQuery("run", "DELETE FROM pyq_questions WHERE exam = ? AND subject = ?", [exam, subject], exam);
    res.status(204).end();
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not delete PYQ subject" });
  }
});

router.patch("/pyq/subjects", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const exam = readText(req.body?.exam, 80);
  const subject = readText(req.body?.subject, 120);
  const nextSubject = readText(req.body?.nextSubject, 120);
  if (!exam || !subject || !nextSubject) {
    res.status(400).json({ error: "Exam, current subject and new subject are required" });
    return;
  }
  if (subject === nextSubject) {
    res.json({ ok: true, exam, subject: nextSubject });
    return;
  }
  try {
    const duplicate = await workerQuery("first", "SELECT id FROM pyq_questions WHERE exam = ? AND subject = ? LIMIT 1", [exam, nextSubject], exam);
    if (duplicate.results[0]) {
      res.status(409).json({ error: "A subject with this name already exists for the selected exam" });
      return;
    }
    await workerQuery("run", "UPDATE pyq_questions SET subject = ?, updated_at = CURRENT_TIMESTAMP WHERE exam = ? AND subject = ?", [nextSubject, exam, subject], exam);
    res.json({ ok: true, exam, subject: nextSubject });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not rename PYQ subject" });
  }
});

router.delete("/pyq/questions/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const exam = readText(req.query.exam, 80);
  if (!Number.isInteger(id) || id <= 0 || !exam) {
    res.status(400).json({ error: "A valid question id and exam are required" });
    return;
  }
  try {
    const exists = await workerQuery("first", "SELECT id FROM pyq_questions WHERE id = ? AND exam = ? LIMIT 1", [id, exam], exam);
    if (!exists.results[0]) {
      res.status(404).json({ error: "PYQ question not found" });
      return;
    }
    await workerBatch([
      { sql: "DELETE FROM pyq_saved_questions WHERE question_id = ?", params: [id] },
      { sql: "DELETE FROM pyq_question_progress WHERE question_id = ?", params: [id] },
      { sql: "DELETE FROM pyq_reports WHERE question_id = ?", params: [id] },
      { sql: "DELETE FROM pyq_questions WHERE id = ? AND exam = ?", params: [id, exam] },
    ], exam);
    res.status(204).end();
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not delete PYQ question" });
  }
});

router.route('/pyq/questions/:id').get(editPyq).patch(editPyq);
async function editPyq(req:any,res:any){
  if(!await requireAdmin(req,res))return;
  res.setHeader('Cache-Control','no-store');
  try{
    const id=Number(req.params.id),exam=readText(req.query.exam,80);
    const bank:ResetStore={all:async(sql,params=[]) => (await workerQuery('all',sql,params,exam)).results,batch:statements=>workerBatch(statements,exam)};
    const main:ResetStore={all:async(sql,params=[]) => (await executeD1Sql(sql,params)).rows,batch:executeD1Batch};
    if(req.method==='GET')return res.json({question:serializeRow(await readEditablePyq(bank,id,exam))});
    return res.json(await correctPyqQuestion(bank,main,id,exam,req.body));
  }catch(error){res.status(error instanceof PyqCorrectionError?error.status:503).json({error:error instanceof PyqCorrectionError?error.message:'Could not complete the correction. Reload the question and retry; reports stay open until saved.'});}
}
export default router;
