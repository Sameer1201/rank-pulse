import { Router } from "express";
import { pendingReportMessage, psuReportInsert } from "../lib/pending-question-report";
import { getSignedUserId } from "../lib/authUtils";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();
type Value = string | number | boolean | null;
type Row = Record<string, unknown>;

function getAuth(req: any, res: any) {
  const userId = getSignedUserId(req);
  const role = String(req.cookies?.userRole ?? "");
  if (!userId || !role) { res.status(401).json({ error: "Not authenticated" }); return null; }
  if (!["admin", "student", "super_admin"].includes(role)) { res.status(403).json({ error: "PSU is not available for this account" }); return null; }
  return { userId, role };
}

async function requireAdmin(req: any, res: any) {
  const current = getAuth(req, res);
  if (!current) return null;
  if (current.role !== "admin" && current.role !== "super_admin") { res.status(403).json({ error: "Only admins can manage PSU content" }); return null; }
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, current.userId)).limit(1);
  if (user?.role !== "admin" && user?.role !== "super_admin") { res.status(403).json({ error: "Only admins can manage PSU content" }); return null; }
  return current;
}

function workerConfig() {
  const url = process.env.PSU_PROXY_URL?.trim().replace(/\/$/u, "");
  const token = process.env.PSU_PROXY_TOKEN?.trim();
  if (!url || !token) throw new Error("PSU Worker is not configured on the API server");
  return { url, token };
}

async function workerQuery<T extends Row = Row>(method: "all" | "first" | "run", sql: string, params: Value[] = []) {
  const config = workerConfig();
  const response = await fetch(`${config.url}/query`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify({ method, sql, params }) });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; results?: T[] };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? `PSU Worker request failed (${response.status})`);
  return payload.results ?? [];
}

async function workerBatch(statements: Array<{ sql: string; params: Value[] }>) {
  const config = workerConfig();
  const response = await fetch(`${config.url}/query`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify({ method: "batch", statements }) });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? `PSU Worker batch failed (${response.status})`);
}

function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `psu-${Date.now()}`; }
function text(value: unknown, length: number) { return typeof value === "string" ? value.trim().slice(0, length) : ""; }
function serializePSU(row: Row) {
  return { id: Number(row.id), name: String(row.name ?? ""), slug: String(row.slug ?? ""), description: row.description == null ? null : String(row.description), isPublished: Boolean(Number(row.is_published ?? row.isPublished ?? 0)), testCount: Number(row.test_count ?? row.testCount ?? 0), questionCount: Number(row.question_count ?? row.questionCount ?? 0) };
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value ?? "")) as T; } catch { return fallback; }
}

function answered(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function correctPsuAnswer(question: any, answer: unknown) {
  if (question.questionType === "integer") {
    const numeric = Number(answer);
    if (!Number.isFinite(numeric)) return false;
    if (question.correctAnswerMin != null && question.correctAnswerMax != null) return numeric >= Number(question.correctAnswerMin) && numeric <= Number(question.correctAnswerMax);
    return numeric === Number(question.correctAnswer);
  }
  if (question.questionType === "multi") {
    return JSON.stringify((Array.isArray(answer) ? answer : []).map(Number).sort()) === JSON.stringify((Array.isArray(question.correctAnswerMulti) ? question.correctAnswerMulti : []).map(Number).sort());
  }
  return Number(answer) === Number(question.correctAnswer);
}

function gradePsuAttempt(questions: any[], answers: Record<string, unknown>) {
  let score = 0; let totalPoints = 0; let correctCount = 0; let wrongCount = 0; let skippedCount = 0;
  const perQuestion = questions.map((question, index) => {
    const answer = Number(answers.__indexBase) === 0
      ? answers[String(index)] ?? null
      : answers[String(index + 1)] ?? answers[String(index)] ?? answers[String(question.order ?? index)] ?? null;
    const hasAnswer = answered(answer);
    const isCorrect = hasAnswer && correctPsuAnswer(question, answer);
    const points = Number(question.points ?? 1) || 1;
    const negativeMarks = Number(question.negativeMarks ?? 0) || 0;
    totalPoints += points;
    if (!hasAnswer) skippedCount += 1;
    else if (isCorrect) { correctCount += 1; score += points; }
    else { wrongCount += 1; score -= negativeMarks; }
    return { answer, hasAnswer, isCorrect, points, negativeMarks };
  });
  return { score, totalPoints, percentage: totalPoints > 0 ? (score / totalPoints) * 100 : 0, correctCount, wrongCount, skippedCount, perQuestion };
}

function withPsuQuestions(bundle: any, rows: Row[]) {
  const parsed = bundle && typeof bundle === "object" ? bundle : { test: {} };
  parsed.test = parsed.test && typeof parsed.test === "object" ? parsed.test : {};
  if (rows.length) parsed.test.questions = rows.map((row) => parseJson<Record<string, unknown>>(row.questionJson, {}));
  return parsed;
}

router.get("/psus", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  try {
    const where = current.role === "student" ? "WHERE is_published = 1" : "";
    const rows = await workerQuery("all", `SELECT * FROM psus ${where} ORDER BY name COLLATE NOCASE ASC, id ASC`);
    const ids = JSON.stringify(rows.map(row => Number(row.id)));
    const [tests, questions] = rows.length ? await Promise.all([
      workerQuery('all', 'SELECT psu_id, COUNT(*) AS count FROM psu_tests WHERE psu_id IN (SELECT value FROM json_each(?)) GROUP BY psu_id', [ids]),
      workerQuery('all', 'SELECT psu_id, COUNT(*) AS count FROM psu_questions WHERE psu_id IN (SELECT value FROM json_each(?)) GROUP BY psu_id', [ids]),
    ]) : [[], []];
    const testCounts = new Map(tests.map(row => [Number(row.psu_id), Number(row.count)]));
    const questionCounts = new Map(questions.map(row => [Number(row.psu_id), Number(row.count)]));
    res.json(rows.map(row => serializePSU({ ...row, test_count: testCounts.get(Number(row.id)) ?? 0, question_count: questionCounts.get(Number(row.id)) ?? 0 })));
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "PSU service unavailable" }); }
});

router.get("/psus/:id", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid PSU id" });
  try {
    const psu = (await workerQuery("all", "SELECT * FROM psus WHERE id = ? LIMIT 1", [id]))[0];
    if (!psu || (current.role === "student" && Number(psu.is_published) !== 1)) return res.status(404).json({ error: "PSU not found" });
    const tests = await workerQuery("all", `SELECT id, title, description, duration_minutes AS durationMinutes, question_count AS questionCount, is_published AS isPublished, bundle_json AS bundleJson FROM psu_tests WHERE psu_id = ? ${current.role === "student" ? "AND is_published = 1" : ""} ORDER BY created_at DESC, id DESC`, [id]);
    const subjects = await workerQuery("all", `SELECT exam, subject, COUNT(*) AS questionCount, COUNT(DISTINCT NULLIF(chapter, '')) AS chapterCount FROM psu_questions WHERE psu_id = ? GROUP BY exam, subject ORDER BY subject COLLATE NOCASE ASC, exam COLLATE NOCASE ASC`, [id]);
    const questionCount = subjects.reduce((sum, row) => sum + Number(row.questionCount ?? row.question_count ?? 0), 0);
    res.json({ ...serializePSU({ ...psu, test_count: tests.length, question_count: questionCount }), tests: tests.map((row) => {
      const bundle = parseJson<Record<string, any>>(row.bundleJson, {});
      const test = bundle.test && typeof bundle.test === "object" ? bundle.test : {};
      const metadata = test.metadata && typeof test.metadata === "object" ? test.metadata : {};
      return {
        id: Number(row.id),
        title: String(row.title ?? ""),
        description: row.description == null ? null : String(row.description),
        questionCount: Number(row.questionCount ?? 0),
        durationMinutes: Number(row.durationMinutes ?? 30),
        isPublished: Boolean(Number(row.isPublished ?? 0)),
        exam: typeof metadata.exam === "string" ? metadata.exam : (typeof test.examType === "string" ? test.examType : null),
        examType: typeof test.examType === "string" ? test.examType : null,
      };
    }), questionBank: { subjects: subjects.map((row) => ({ exam: String(row.exam ?? ""), subject: String(row.subject ?? ""), questionCount: Number(row.questionCount ?? row.question_count ?? 0), chapterCount: Math.max(1, Number(row.chapterCount ?? row.chapter_count ?? 0)) })), questionCount } });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "PSU service unavailable" }); }
});

router.post("/psus", async (req, res) => {
  const current = await requireAdmin(req, res); if (!current) return;
  const name = text(req.body?.name, 120); if (!name) return res.status(400).json({ error: "PSU name is required" });
  try { const created = (await workerQuery("first", "INSERT INTO psus (name, slug, description, is_published, created_by) VALUES (?, ?, ?, 0, ?) RETURNING *", [name, slugify(name), text(req.body?.description, 500) || null, current.userId]))[0]; res.status(201).json(serializePSU(created ?? {})); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Could not create PSU" }); }
});

router.patch("/psus/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const id = Number(req.params.id); const fields: string[] = []; const params: Value[] = [];
  if (req.body?.name !== undefined) { fields.push("name = ?"); params.push(text(req.body.name, 120)); }
  if (req.body?.description !== undefined) { fields.push("description = ?"); params.push(text(req.body.description, 500) || null); }
  if (typeof req.body?.isPublished === "boolean") { fields.push("is_published = ?"); params.push(req.body.isPublished ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: "No PSU changes supplied" });
  try { params.push(id); const updated = (await workerQuery("first", `UPDATE psus SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`, params))[0]; if (!updated) return res.status(404).json({ error: "PSU not found" }); res.json(serializePSU(updated)); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not update PSU" }); }
});

router.delete("/psus/:id", async (req, res) => { if (!await requireAdmin(req, res)) return; await workerQuery("run", "DELETE FROM psus WHERE id = ?", [Number(req.params.id)]); res.status(204).end(); });

router.post("/psus/:id/tests/import", async (req, res) => {
  const current = await requireAdmin(req, res); if (!current) return;
  const psuId = Number(req.params.id); const bundle = req.body?.test ? req.body : null;
  if (!Number.isInteger(psuId) || !bundle?.test || typeof bundle.test.title !== "string") return res.status(400).json({ error: "PSU and valid test bundle are required" });
  const questions = Array.isArray(bundle.test.questions) ? bundle.test.questions : [];
  try {
    const metadataBundle = { ...bundle, test: { ...bundle.test, questions: [] } };
    const inserted = (await workerQuery("first", `INSERT INTO psu_tests (psu_id, title, description, duration_minutes, question_count, is_published, bundle_json, created_by) VALUES (?, ?, ?, ?, ?, 0, ?, ?) RETURNING id, title, question_count AS questionCount`, [psuId, text(bundle.test.title, 240), text(bundle.test.description, 1000) || null, Number(bundle.test.durationMinutes) || 30, questions.length, JSON.stringify(metadataBundle), current.userId]))[0];
    const testId = Number(inserted?.id);
    const statements = questions.map((question: any, index: number) => ({ sql: "INSERT OR REPLACE INTO psu_test_questions (test_id, question_order, question_json) VALUES (?, ?, ?)", params: [testId, Number.isInteger(Number(question?.order)) ? Number(question.order) : index, JSON.stringify(question)] as Value[] }));
    for (let offset = 0; offset < statements.length; offset += 50) await workerBatch(statements.slice(offset, offset + 50));
    await workerQuery("run", "UPDATE psu_tests SET is_published = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND psu_id = ?", [testId, psuId]);
    res.status(201).json({ ...inserted, id: testId, imported: questions.length });
  }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not import PSU test" }); }
});

router.post("/psus/:id/tests/import/start", async (req, res) => {
  const current = await requireAdmin(req, res); if (!current) return;
  const psuId = Number(req.params.id); const bundle = req.body?.test ? req.body : null;
  if (!Number.isInteger(psuId) || !bundle?.test || typeof bundle.test.title !== "string") return res.status(400).json({ error: "PSU and valid test bundle are required" });
  const inlineQuestionCount = Array.isArray(bundle.test.questions) ? bundle.test.questions.length : 0;
  const totalQuestions = inlineQuestionCount > 0 ? inlineQuestionCount : Number(bundle.test.questionCount ?? bundle.test.metadata?.importedQuestionCount ?? 0);
  if (!totalQuestions) return res.status(400).json({ error: "At least one test question is required" });
  try {
    const metadataBundle = { ...bundle, test: { ...bundle.test, questions: [] } };
    const inserted = (await workerQuery("first", `INSERT INTO psu_tests (psu_id, title, description, duration_minutes, question_count, is_published, bundle_json, created_by) VALUES (?, ?, ?, ?, ?, 0, ?, ?) RETURNING id, title, question_count AS questionCount`, [psuId, text(bundle.test.title, 240), text(bundle.test.description, 1000) || null, Number(bundle.test.durationMinutes) || 30, totalQuestions, JSON.stringify(metadataBundle), current.userId]))[0];
    res.status(201).json({ ...inserted, id: Number(inserted?.id), totalQuestions, importedQuestions: 0 });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not start PSU test import" }); }
});

router.post("/psus/:id/tests/:testId/import-chunk", async (req, res) => {
  const current = await requireAdmin(req, res); if (!current) return;
  const psuId = Number(req.params.id); const testId = Number(req.params.testId); const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  const offset = Number(req.body?.offset ?? 0);
  if (!Number.isInteger(psuId) || !Number.isInteger(testId) || !Number.isInteger(offset) || offset < 0 || questions.length === 0 || questions.length > 25) return res.status(400).json({ error: "A valid test and a 1–25 question chunk are required" });
  try {
    const test = (await workerQuery("first", "SELECT id FROM psu_tests WHERE id = ? AND psu_id = ? LIMIT 1", [testId, psuId]))[0];
    if (!test) return res.status(404).json({ error: "PSU test not found" });
    await workerBatch(questions.map((question: any, index: number) => ({ sql: "INSERT OR REPLACE INTO psu_test_questions (test_id, question_order, question_json) VALUES (?, ?, ?)", params: [testId, offset + index, JSON.stringify(question)] as Value[] })));
    const count = (await workerQuery("first", "SELECT COUNT(*) AS count FROM psu_test_questions WHERE test_id = ?", [testId]))[0];
    res.json({ imported: questions.length, importedQuestions: Number(count?.count ?? 0), nextOffset: offset + questions.length });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not import PSU test chunk" }); }
});

router.post("/psus/:id/tests/:testId/import-complete", async (req, res) => {
  const current = await requireAdmin(req, res); if (!current) return;
  const psuId = Number(req.params.id); const testId = Number(req.params.testId); const expected = Number(req.body?.totalQuestions ?? 0);
  if (!Number.isInteger(psuId) || !Number.isInteger(testId) || expected <= 0) return res.status(400).json({ error: "Valid PSU test and totalQuestions are required" });
  try {
    const count = (await workerQuery("first", "SELECT COUNT(*) AS count FROM psu_test_questions WHERE test_id = ?", [testId]))[0];
    const importedQuestions = Number(count?.count ?? 0);
    if (importedQuestions !== expected) return res.status(409).json({ error: `Import incomplete: ${importedQuestions}/${expected} questions received`, importedQuestions, totalQuestions: expected });
    const updated = (await workerQuery("first", "UPDATE psu_tests SET is_published = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND psu_id = ? RETURNING id, title, question_count AS questionCount", [testId, psuId]))[0];
    if (!updated) return res.status(404).json({ error: "PSU test not found" });
    res.json({ ...updated, id: Number(updated.id), importedQuestions });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not complete PSU test import" }); }
});

router.get("/psus/:id/tests/:testId", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  const row = (await workerQuery("all", "SELECT id, psu_id AS psuId, title, duration_minutes AS durationMinutes, is_published AS isPublished, bundle_json AS bundleJson FROM psu_tests WHERE id = ? AND psu_id = ? LIMIT 1", [Number(req.params.testId), Number(req.params.id)]))[0];
  if (!row || (current.role === "student" && Number(row.isPublished) !== 1)) return res.status(404).json({ error: "Test not found" });
  const questionRows = await workerQuery("all", "SELECT question_order AS questionOrder, question_json AS questionJson FROM psu_test_questions WHERE test_id = ? ORDER BY question_order ASC", [Number(req.params.testId)]);
  let bundle: unknown = withPsuQuestions(parseJson<unknown>(row.bundleJson, null), questionRows);
  res.json({ id: Number(row.id), psuId: Number(row.psuId), title: row.title, durationMinutes: Number(row.durationMinutes ?? 30), bundle });
});

router.post("/psus/:id/tests/:testId/attempts", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  if (current.role !== "student") return res.status(403).json({ error: "Only students can submit PSU tests" });
  const psuId = Number(req.params.id); const testId = Number(req.params.testId);
  try {
    const row = (await workerQuery("all", "SELECT id, title, duration_minutes AS durationMinutes, is_published AS isPublished, bundle_json AS bundleJson FROM psu_tests WHERE id = ? AND psu_id = ? LIMIT 1", [testId, psuId]))[0];
    if (!row || Number(row.isPublished) !== 1) return res.status(404).json({ error: "Test not found" });
    const questionRows = await workerQuery("all", "SELECT question_order AS questionOrder, question_json AS questionJson FROM psu_test_questions WHERE test_id = ? ORDER BY question_order ASC", [testId]);
    const bundle = withPsuQuestions(parseJson<unknown>(row.bundleJson, null), questionRows) as any;
    const questions = Array.isArray(bundle.test?.questions) ? bundle.test.questions : [];
    const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers as Record<string, unknown> : {};
    const graded = gradePsuAttempt(questions, answers);
    const attemptNumberRow = (await workerQuery("first", "SELECT COALESCE(MAX(attempt_number), 0) AS maxAttempt FROM psu_test_attempts WHERE test_id = ? AND student_id = ?", [testId, current.userId]))[0];
    const attemptNumber = Number(attemptNumberRow?.maxAttempt ?? 0) + 1;
    const inserted = (await workerQuery("first", `INSERT INTO psu_test_attempts (psu_id, test_id, student_id, attempt_number, answers_json, question_timings_json, interaction_log_json, flagged_questions_json, score, total_points, percentage, correct_count, wrong_count, skipped_count, total_time_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, submitted_at AS submittedAt`, [psuId, testId, current.userId, attemptNumber, JSON.stringify(answers), JSON.stringify(req.body?.questionTimings ?? {}), JSON.stringify(Array.isArray(req.body?.interactionLog) ? req.body.interactionLog : []), JSON.stringify(Array.isArray(req.body?.flaggedQuestions) ? req.body.flaggedQuestions : []), graded.score, graded.totalPoints, graded.percentage, graded.correctCount, graded.wrongCount, graded.skippedCount, Number(req.body?.totalTimeSeconds) || 0]))[0];
    res.status(201).json({ id: Number(inserted?.id), attemptNumber, submittedAt: inserted?.submittedAt ?? new Date().toISOString(), score: graded.score, totalPoints: graded.totalPoints, percentage: graded.percentage, correctCount: graded.correctCount, wrongCount: graded.wrongCount, skippedCount: graded.skippedCount });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not submit PSU test" }); }
});

router.get("/psus/:id/tests/:testId/analysis", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  if (current.role !== "student") return res.status(403).json({ error: "Only students can view PSU test analysis" });
  const psuId = Number(req.params.id); const testId = Number(req.params.testId);
  try {
    const row = (await workerQuery("first", "SELECT id, title, description, duration_minutes AS durationMinutes, is_published AS isPublished, bundle_json AS bundleJson FROM psu_tests WHERE id = ? AND psu_id = ? LIMIT 1", [testId, psuId]))[0];
    if (!row || Number(row.isPublished) !== 1) return res.status(404).json({ error: "Test not found" });
    const questionRows = await workerQuery("all", "SELECT question_order AS questionOrder, question_json AS questionJson FROM psu_test_questions WHERE test_id = ? ORDER BY question_order ASC", [testId]);
    const bundle = withPsuQuestions(parseJson<unknown>(row.bundleJson, null), questionRows) as any;
    const questions = Array.isArray(bundle.test?.questions) ? bundle.test.questions : [];
    const attempt = (await workerQuery("first", "SELECT * FROM psu_test_attempts WHERE test_id = ? AND student_id = ? ORDER BY submitted_at DESC, id DESC LIMIT 1", [testId, current.userId]))[0];
    if (!attempt) return res.status(404).json({ error: "Submit this PSU test first to view analysis" });
    const answers = parseJson<Record<string, unknown>>(attempt.answers_json, {});
    const timings = parseJson<Record<string, number>>(attempt.question_timings_json, {});
    const flagged = parseJson<number[]>(attempt.flagged_questions_json, []);
    const interactionLog = parseJson<any[]>(attempt.interaction_log_json, []);
    const perQuestion = questions.map((question: any, index: number) => {
      const answer = Number(answers.__indexBase) === 0
        ? answers[String(index)] ?? null
        : answers[String(index + 1)] ?? answers[String(index)] ?? answers[String(question.order ?? index)] ?? null;
      return { id: index + 1, order: index, question: question.question ?? "", options: question.options ?? [], questionType: question.questionType ?? "mcq", points: Number(question.points ?? 1), negativeMarks: Number(question.negativeMarks ?? 0), myAnswer: answer, correctAnswer: question.correctAnswer ?? null, correctAnswerMulti: question.correctAnswerMulti ?? null, correctAnswerMin: question.correctAnswerMin ?? null, correctAnswerMax: question.correctAnswerMax ?? null, isCorrect: answered(answer) && correctPsuAnswer(question, answer), isSkipped: !answered(answer), isFlagged: flagged.includes(index), myTime: Number(timings[String(index)] ?? timings[String(question.order ?? index)] ?? 0), subjectLabel: question.subjectLabel ?? bundle.test.metadata?.subject ?? bundle.test.title, subjectName: question.subjectLabel ?? bundle.test.metadata?.subject ?? null, chapterName: question.meta?.chapter ?? "General", meta: question.meta ?? {}, solutionText: question.solutionText ?? null };
    });
    const attempts = await workerQuery("all", "SELECT student_id AS studentId, score FROM psu_test_attempts WHERE test_id = ? ORDER BY submitted_at DESC, id DESC", [testId]);
    const latestByStudent = new Map<number, number>();
    attempts.forEach((item) => { const studentId = Number(item.studentId); if (!latestByStudent.has(studentId)) latestByStudent.set(studentId, Number(item.score ?? 0)); });
    const scores = [...latestByStudent.values()]; const score = Number(attempt.score ?? 0); const rank = 1 + scores.filter((value) => value > score).length; const classAvg = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : score;
    const totalPoints = Number(attempt.total_points ?? 0); const sections = Array.isArray(bundle.test.sections) && bundle.test.sections.length ? bundle.test.sections.map((section: any, index: number) => ({ id: index + 1, title: section.title ?? `Section ${index + 1}`, subjectLabel: section.subjectLabel ?? section.title ?? "General", questionCount: section.questionCount ?? questions.length, order: section.order ?? index, meta: section.meta ?? null })) : [{ id: 1, title: bundle.test.title, subjectLabel: bundle.test.metadata?.subject ?? "General", questionCount: questions.length, order: 0 }];
    res.json({ test: { id: testId, title: row.title, description: row.description ?? null, examType: bundle.test.examType ?? "custom", examHeader: bundle.test.metadata?.exam ?? null, examSubheader: bundle.test.metadata?.subject ?? null, durationMinutes: Number(row.durationMinutes ?? 30), totalQuestions: questions.length }, sections, submission: { score, totalPoints, percentage: Number(attempt.percentage ?? 0), passed: score >= totalPoints * 0.4, submittedAt: attempt.submitted_at ?? null, totalTime: Number(attempt.total_time_seconds ?? 0), correctCount: Number(attempt.correct_count ?? 0), wrongCount: Number(attempt.wrong_count ?? 0), skippedCount: Number(attempt.skipped_count ?? 0), flaggedCount: flagged.length, questionTimings: timings, flaggedQuestions: flagged, visitedQuestionIds: interactionLog.filter((item) => item?.action === "open").map((item) => Number(item.questionId)).filter(Number.isFinite), reviewQuestionIds: flagged, interactionLog }, classStats: { totalSubs: scores.length, classAvg, classPassRate: scores.length ? scores.filter((value) => value >= totalPoints * 0.4).length / scores.length * 100 : 0, rank, percentile: scores.length > 1 ? ((scores.length - rank) / (scores.length - 1)) * 100 : 100 }, perQuestion, advancedInsights: null });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not load PSU test analysis" }); }
});

router.get("/psus/:id/question-bank/subjects", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  const psuId = Number(req.params.id);
  const rows = await workerQuery("all", "SELECT exam, subject, COUNT(*) AS questionCount, COUNT(DISTINCT NULLIF(chapter, '')) AS chapterCount FROM psu_questions WHERE psu_id = ? GROUP BY exam, subject ORDER BY subject COLLATE NOCASE ASC", [psuId]);
  res.json(rows.map((row) => ({ exam: String(row.exam ?? ""), subject: String(row.subject ?? ""), questionCount: Number(row.questionCount ?? 0), chapterCount: Math.max(1, Number(row.chapterCount ?? 0)) })));
});

router.get("/psus/:id/question-bank/questions", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  const psuId = Number(req.params.id); const exam = text(req.query.exam, 120); const subject = text(req.query.subject, 160); const chapter = text(req.query.chapter, 160); const savedOnly = String(req.query.saved ?? "") === "1";
  const conditions = ["psu_id = ?"]; const params: Value[] = [psuId];
  if (exam) { conditions.push("exam = ?"); params.push(exam); }
  if (subject) { conditions.push("subject = ?"); params.push(subject); }
  if (chapter) { conditions.push("chapter = ?"); params.push(chapter); }
  if (savedOnly) { conditions.push("EXISTS (SELECT 1 FROM psu_saved_questions saved_filter WHERE saved_filter.question_id = psu_questions.id AND saved_filter.student_id = ?)"); params.push(current.userId); }
  try {
    const rows = await workerQuery("all", `SELECT id, exam, subject, chapter, year, paper, question, question_type AS questionType, options_json AS optionsJson, correct_answer AS correctAnswer, correct_answer_multi AS correctAnswerMulti, answer_text AS answerText, answer_min AS answerMin, answer_max AS answerMax, explanation, marks, EXISTS (SELECT 1 FROM psu_saved_questions saved WHERE saved.question_id = psu_questions.id AND saved.student_id = ?) AS isSaved FROM psu_questions WHERE ${conditions.join(" AND ")} ORDER BY chapter_order ASC, question_number ASC, year DESC, id DESC LIMIT 100`, [current.userId, ...params]);
    res.json(rows.map((row) => { let options: unknown[] = []; let multi: unknown[] = []; try { options = JSON.parse(String(row.optionsJson ?? "[]")); } catch {} try { multi = JSON.parse(String(row.correctAnswerMulti ?? "[]")); } catch {} return { ...row, id: Number(row.id), options, correctAnswer: row.correctAnswer == null ? null : Number(row.correctAnswer), correctAnswerMulti: multi.map(Number), answerMin: row.answerMin == null ? null : Number(row.answerMin), answerMax: row.answerMax == null ? null : Number(row.answerMax), isSaved: Boolean(Number(row.isSaved ?? 0)) }; }));
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "PSU question bank unavailable" }); }
});

router.post("/psus/:id/question-bank/questions/:questionId/save", async (req, res) => {
  const current = getAuth(req, res); if (!current) return;
  if (current.role !== "student") return res.status(403).json({ error: "Only students can save PSU questions" });
  const psuId = Number(req.params.id); const questionId = Number(req.params.questionId);
  if (!Number.isInteger(psuId) || psuId <= 0 || !Number.isInteger(questionId) || questionId <= 0) return res.status(400).json({ error: "Invalid PSU or question id" });
  try {
    const question = await workerQuery("first", "SELECT id FROM psu_questions WHERE id = ? AND psu_id = ? LIMIT 1", [questionId, psuId]);
    if (!question[0]) return res.status(404).json({ error: "PSU question not found" });
    const existing = await workerQuery("first", "SELECT question_id FROM psu_saved_questions WHERE student_id = ? AND question_id = ?", [current.userId, questionId]);
    if (existing[0]) { await workerQuery("run", "DELETE FROM psu_saved_questions WHERE student_id = ? AND question_id = ?", [current.userId, questionId]); return res.json({ saved: false }); }
    await workerQuery("run", "INSERT OR IGNORE INTO psu_saved_questions (student_id, question_id) VALUES (?, ?)", [current.userId, questionId]);
    res.json({ saved: true });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not update saved PSU question" }); }
});

router.all("/psus/:id/question-bank/questions/:questionId/report", async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) return res.sendStatus(405);
  const current = getAuth(req, res); if (!current) return;
  if (current.role !== "student") return res.status(403).json({ error: "Only students can report PSU questions" });
  const psuId = Number(req.params.id); const questionId = Number(req.params.questionId); const reason = text(req.body?.reason, 1000);
  if (!Number.isInteger(psuId) || psuId <= 0 || !Number.isInteger(questionId) || questionId <= 0) return res.status(400).json({ error: "Invalid PSU or question id" });
  if (req.method === "POST" && !reason) return res.status(400).json({ error: "Reason is required" });
  try {
    const question = await workerQuery("first", "SELECT id FROM psu_questions WHERE id = ? AND psu_id = ? LIMIT 1", [questionId, psuId]);
    if (!question[0]) return res.status(404).json({ error: "PSU question not found" });
    if (req.method === "GET") {
      const pending = await workerQuery("first", "SELECT id FROM psu_question_reports WHERE psu_id = ? AND question_id = ? AND reported_by = ? AND status = 'open' LIMIT 1", [psuId, questionId, current.userId]);
      return res.json({ pending: pending.length > 0 });
    }
    const inserted = await workerQuery("first", psuReportInsert, [psuId, questionId, current.userId, reason, psuId, questionId, current.userId]);
    if (!inserted.length) return res.status(409).json({ error: pendingReportMessage, pending: true });
    res.json({ ok: true });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not submit PSU question report" }); }
});

router.get("/psus/:id/question-bank/reports", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const psuId = Number(req.params.id); const status = text(req.query.status, 20) || "open";
  try {
    const rows = await workerQuery("all", `SELECT reports.id, reports.question_id AS questionId, reports.reported_by AS reportedBy, reports.reason, reports.status, reports.created_at AS createdAt, reports.updated_at AS updatedAt, questions.question, questions.exam, questions.subject, questions.chapter, questions.year FROM psu_question_reports reports JOIN psu_questions questions ON questions.id = reports.question_id WHERE reports.psu_id = ? AND reports.status = ? ORDER BY reports.created_at DESC, reports.id DESC LIMIT 100`, [psuId, status]);
    res.json({ reports: rows.map((row) => ({ id: Number(row.id), questionId: Number(row.questionId), reportedBy: Number(row.reportedBy), reason: String(row.reason ?? ""), status: String(row.status ?? "open"), createdAt: row.createdAt ?? null, updatedAt: row.updatedAt ?? null, questionText: String(row.question ?? ""), exam: String(row.exam ?? ""), subject: String(row.subject ?? ""), chapter: String(row.chapter ?? ""), year: Number(row.year ?? 0) })) });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not load PSU question reports" }); }
});

router.patch("/psus/:id/question-bank/reports/:reportId/reject", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const psuId = Number(req.params.id); const reportId = Number(req.params.reportId);
  if (!Number.isInteger(psuId) || psuId <= 0 || !Number.isInteger(reportId) || reportId <= 0) return res.status(400).json({ error: "Invalid PSU or report id" });
  try { await workerQuery("run", "UPDATE psu_question_reports SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND psu_id = ? AND status = 'open'", [reportId, psuId]); res.json({ ok: true }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not reject PSU question report" }); }
});

router.patch("/psus/:id/tests/:testId", async (req, res) => { if (!await requireAdmin(req, res)) return; if (typeof req.body?.isPublished !== "boolean") return res.status(400).json({ error: "isPublished is required" }); await workerQuery("run", "UPDATE psu_tests SET is_published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND psu_id = ?", [req.body.isPublished ? 1 : 0, Number(req.params.testId), Number(req.params.id)]); res.json({ ok: true }); });

router.post("/psus/:id/question-bank/import", async (req, res) => {
  const current = await requireAdmin(req, res); if (!current) return;
  const psuId = Number(req.params.id); const exam = text(req.body?.exam, 120); const subject = text(req.body?.subject, 160); const incoming = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (!Number.isInteger(psuId) || !exam || !subject || !incoming.length || incoming.length > 500) return res.status(400).json({ error: "PSU, exam, subject and 1–500 questions are required" });
  try {
    const statements = incoming.map((item: any, index: number) => {
      const options = Array.isArray(item?.options) ? item.options : [];
      return { sql: `INSERT INTO psu_questions (psu_id, exam, subject, chapter, chapter_order, question_number, marks, year, paper, question, question_type, options_json, correct_answer, correct_answer_multi, answer_text, answer_min, answer_max, explanation, source_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [psuId, exam, subject, text(item?.chapter, 160) || "General", Number(item?.chapterOrder) || 0, Number(item?.questionNumber) || index + 1, text(item?.marks, 40) || null, Number(item?.year) || new Date().getFullYear(), text(item?.paper, 160) || null, text(item?.question, 2_000_000), text(item?.questionType ?? item?.type, 20) || "mcq", JSON.stringify(options), item?.correctAnswer == null ? null : Number(item.correctAnswer), JSON.stringify(Array.isArray(item?.correctAnswers) ? item.correctAnswers : []), text(item?.answerText, 4000) || null, item?.answerMin == null ? null : Number(item.answerMin), item?.answerMax == null ? null : Number(item.answerMax), text(item?.explanation, 2_000_000) || null, text(req.body?.sourceName, 200) || null, current.userId] };
    });
    await workerBatch([{ sql: "DELETE FROM psu_questions WHERE psu_id = ? AND exam = ? AND subject = ?", params: [psuId, exam, subject] }, ...statements.slice(0, 99)]);
    for (let offset = 99; offset < statements.length; offset += 100) await workerBatch(statements.slice(offset, offset + 100));
    res.status(201).json({ imported: incoming.length, chapters: new Set(incoming.map((item: any) => text(item?.chapter, 160) || "General")).size });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not import PSU question bank" }); }
});

export default router;
