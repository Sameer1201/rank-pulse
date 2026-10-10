import { choicesMatch } from "../lib/choice-answer";
import { pendingReportMessage, questionBankReportInsert } from "../lib/pending-question-report";
import { Router } from "express";
import { getSignedUserId } from "../lib/authUtils";
import { db, executeD1Sql } from "@workspace/db";
import {
  questionBankQuestionsTable,
  questionBankReportsTable,
  questionBankSavedQuestionsTable,
  questionBankQuestionProgressTable,
  chaptersTable,
  subjectsTable,
  classesTable,
  usersTable,
  enrollmentsTable,
  testQuestionsTable,
  testQuestionBankLinksTable,
} from "@workspace/db/schema";
import { and, desc, eq, exists, getTableColumns, inArray, sql } from "drizzle-orm";
import { ensureStudentFeatureUnlocked } from "../lib/studentFeatureAccess";
import { pushNotification } from "../lib/pushNotification";
import {
  sendTeacherQuestionReportAlertEmail,
  sendStudentQuestionReportAcknowledgementEmail,
  sendStudentQuestionUpdatedEmail,
  sendStudentQuestionReportRejectedEmail,
} from "../lib/brevo";
import { buildPublicAppUrl } from "../lib/publicAppUrl";
import { parseNumericValue } from "../lib/numericAnswers";
import { ensureJamChemistryQuestionBankCard, normalizeExamKey } from "../lib/examCatalog";
import { questionBankReadScope } from "../lib/questionBankReadScope";
import { linkedTestTargets, linkedTestSyncStatements } from "../lib/linkedTestQuestionSync";

const router = Router();

function normalizeQuestionType(value: unknown): QuestionType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["integer", "nat", "numerical"].includes(normalized)) return "integer";
  if (["multi", "msq", "multiple"].includes(normalized)) return "multi";
  return "mcq";
}

function displayQuestionType(value: unknown, options: unknown): QuestionType {
  const normalized = normalizeQuestionType(value);
  if (normalized !== "mcq") return normalized;
  const parsedOptions = Array.isArray(options)
    ? options
    : safeParseArray<string>(typeof options === "string" ? options : null, []);
  return parsedOptions.some((option) => String(option ?? "").trim().length > 0) ? "mcq" : "integer";
}

function toISOStringSafe(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type Auth = { userId: number; role: string };

function questionBankPage(query: Record<string, unknown>) {
  const requestedLimit = Number(query.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 100;
  const rawCursor = query.cursor;
  const match = typeof rawCursor === "string" ? rawCursor.match(/^(\d+):(\d+)$/) : null;
  if (rawCursor && (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2])))) {
    return null;
  }
  return { enabled: query.limit !== undefined, limit, cursor: match ? { createdAt: Number(match[1]), id: Number(match[2]) } : null };
}
type QuestionType = "mcq" | "multi" | "integer";
type QuestionBankAttemptAnswer = number | number[] | string;
type QuestionBankClassRow = typeof classesTable.$inferSelect & {
  isLocked?: boolean | null;
};
type NormalizedQuestionValue = {
  question: string;
  questionType: QuestionType;
  options: string[];
  optionImages: Array<string | null>;
  correctAnswer: number | null;
  correctAnswerMulti: number[];
  correctAnswerMin: number | null;
  correctAnswerMax: number | null;
  explanation: string | null;
  topicTag: string | null;
  difficulty: string;
  points: number;
  imageData: string | null;
};
type NormalizedQuestionPayloadResult =
  | { value: NormalizedQuestionValue }
  | { error: string };
type ClassAccessError = { error: string; status: 403 | 404 };
type ClassAccessSuccess = {
  cls: typeof classesTable.$inferSelect;
  subjects: Array<typeof subjectsTable.$inferSelect>;
  isEnrolled: boolean;
  isAssignedSubjectTeacher: boolean;
};

function serializeQuestionTransferPayload(
  question: typeof questionBankQuestionsTable.$inferSelect,
) {
        return {
    question: question.question,
    questionType: displayQuestionType(question.questionType, safeParseArray<string>(question.options, [])),
    options: safeParseArray<string>(question.options, []),
    optionImages: safeParseArray<string | null>(question.optionImages, []),
    correctAnswer: question.correctAnswer,
    correctAnswerMulti: safeParseArray<number>(question.correctAnswerMulti, []),
    correctAnswerMin: question.correctAnswerMin,
    correctAnswerMax: question.correctAnswerMax,
    explanation: question.explanation,
    topicTag: question.topicTag ?? null,
    difficulty: question.difficulty ?? "medium",
    points: question.points ?? 1,
    imageData: question.imageData ?? null,
  };
}

function getAuth(req: any, res: any): Auth | null {
  const userId = getSignedUserId(req);
  const role = req.cookies?.userRole;

  if (!userId || !role) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }

  return { userId, role };
}

function isQuestionBankLocked(cls: QuestionBankClassRow) {
  return Boolean(cls.isLocked);
}

function safeParseArray<T>(
  value: string | null | undefined,
  fallback: T[],
): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readClassField<T>(row: Record<string, any>, camel: string, snake: string, fallback: T): T {
  const value = row?.[camel] ?? row?.[snake];
  return value == null ? fallback : (value as T);
}

function normalizeClassRow(row: Record<string, any>): QuestionBankClassRow {
  const assignedTeacherIdsRaw = readClassField<unknown>(row, "assignedTeacherIds", "assigned_teacher_ids", []);
  const scheduledAtRaw = readClassField<unknown>(row, "scheduledAt", "scheduled_at", null);
  const createdAtRaw = readClassField<unknown>(row, "createdAt", "created_at", null);

  return {
    ...row,
    title: readClassField(row, "title", "title", ""),
    description: readClassField(row, "description", "description", null),
    subject: readClassField(row, "subject", "subject", null),
    workflowType: readClassField(row, "workflowType", "workflow_type", "question_bank"),
    adminId: readClassField(row, "adminId", "admin_id", null),
    plannerId: readClassField(row, "plannerId", "planner_id", null),
    assignedTeacherIds: Array.isArray(assignedTeacherIdsRaw)
      ? assignedTeacherIdsRaw
      : safeParseArray<number>(typeof assignedTeacherIdsRaw === "string" ? assignedTeacherIdsRaw : null, []),
    status: readClassField(row, "status", "status", "scheduled"),
    isLocked: Boolean(readClassField(row, "isLocked", "is_locked", false)),
    weeklyTargetQuestions: readClassField(row, "weeklyTargetQuestions", "weekly_target_questions", null),
    weeklyTargetDeadline: readClassField(row, "weeklyTargetDeadline", "weekly_target_deadline", null),
    scheduledAt: scheduledAtRaw ? new Date(scheduledAtRaw as any) : null,
    maxStudents: readClassField(row, "maxStudents", "max_students", null),
    meetingLink: readClassField(row, "meetingLink", "meeting_link", null),
    createdAt: createdAtRaw ? new Date(createdAtRaw as any) : new Date(),
  } as QuestionBankClassRow;
}

function normalizeTitleKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized || null;
}

function normalizeQuestionDuplicateKey(
  question: string,
  questionType: QuestionType,
) {
  const normalizedQuestion = question
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedQuestion) return null;
  return `${questionType}:${normalizedQuestion}`;
}

function buildExistingQuestionDuplicateKey(question: {
  question: string;
  questionType: string | null;
}) {
  const questionType = normalizeQuestionType(question.questionType);
  return normalizeQuestionDuplicateKey(question.question, questionType);
}

function chunkValues<T>(values: T[], size: number): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function getAccessibleQuestionBankClasses(auth: Auth) {
  if (auth.role === "super_admin") {
    const rows = await db
      .select()
      .from(classesTable)
      .where(eq(classesTable.workflowType, "question_bank"));
    return rows.map(normalizeClassRow);
  }

  if (auth.role === "admin") {
    const [allQuestionBankClasses, assignedSubjects, authoredQuestionClasses] =
      await Promise.all([
        db
          .select()
          .from(classesTable)
          .where(eq(classesTable.workflowType, "question_bank")),
        db
          .select({ classId: subjectsTable.classId })
          .from(subjectsTable)
          .where(eq(subjectsTable.teacherId, auth.userId)),
        db
          .selectDistinct({ classId: questionBankQuestionsTable.classId })
          .from(questionBankQuestionsTable)
          .where(eq(questionBankQuestionsTable.createdBy, auth.userId)),
      ]);

    const ownedClasses = allQuestionBankClasses.map(normalizeClassRow).filter((cls) => {
      if (cls.adminId === auth.userId) return true;
      const assignedTeacherIds = cls.assignedTeacherIds;
      return assignedTeacherIds.includes(auth.userId);
    });

    const ownedIds = new Set(ownedClasses.map((item) => item.id));
    const assignedIds = new Set(
      assignedSubjects
        .map((item) => item.classId)
        .filter((id): id is number => id !== null),
    );
    const authoredIds = new Set(
      authoredQuestionClasses
        .map((item) => item.classId)
        .filter((id): id is number => id !== null),
    );
    if (assignedIds.size === 0 && authoredIds.size === 0) return ownedClasses;

    const extraClassIds = [...new Set([...assignedIds, ...authoredIds])].filter(
      (id) => !ownedIds.has(id),
    );
    const extraClasses =
      extraClassIds.length > 0
        ? await db
            .select()
            .from(classesTable)
            .where(
              and(
                inArray(classesTable.id, extraClassIds),
                eq(classesTable.workflowType, "question_bank"),
              ),
            )
        : [];

    return [...ownedClasses, ...extraClasses];
  }

  if (auth.role === "student") {
    // Return all question-bank classes — exam-key filtering is applied downstream
    // in /question-bank/exams to show only the exams matching the student's profile.
      const rows = await db
      .select()
      .from(classesTable)
      .where(eq(classesTable.workflowType, "question_bank"));
    return rows.map(normalizeClassRow);
  }

  return [];
}

async function getStudentExamKeys(userId: number) {
  const [user] = await db
    .select({
      subject: usersTable.subject,
      additionalExams: usersTable.additionalExams,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const keys = new Set<string>();
  const primary = normalizeExamKey(user?.subject);
  if (primary) keys.add(primary);
  for (const exam of user?.additionalExams ?? []) {
    const normalized = normalizeExamKey(exam);
    if (normalized) keys.add(normalized);
  }
  return keys;
}

function getQuestionBankClassExamKey(cls: QuestionBankClassRow) {
  return normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title);
}

async function findExistingQuestionBankCardByExam(
  exam: string,
  excludeClassId?: number,
) {
  const examKey = normalizeExamKey(exam);
  if (!examKey) return null;

  const questionBankClasses = (await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.workflowType, "question_bank"))).map(normalizeClassRow);

  return (
    questionBankClasses.find((cls) => {
      if (excludeClassId && cls.id === excludeClassId) return false;
      return getQuestionBankClassExamKey(cls) === examKey;
    }) ?? null
  );
}

async function canStudentAccessQuestionBankClass(
  userId: number,
  cls: QuestionBankClassRow,
  knownExamKeys?: Set<string>,
) {
  const examKey = getQuestionBankClassExamKey(cls);
  if (!examKey) return false;
  const studentExamKeys = knownExamKeys ?? await getStudentExamKeys(userId);
  return studentExamKeys.has(examKey);
}

function formatLocalDateKey(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function normalizeQuestionBankAttemptAnswer(
  question: typeof questionBankQuestionsTable.$inferSelect,
  value: unknown,
): { value: QuestionBankAttemptAnswer } | { error: string } {
  const questionType = displayQuestionType(question.questionType, question.options);

  if (questionType === "multi") {
    if (!Array.isArray(value) || value.length === 0) {
      return { error: "Select at least one option" };
    }
    const selected = value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0)
      .filter((item, index, list) => list.indexOf(item) === index)
      .sort((a, b) => a - b);
    return selected.length > 0
      ? { value: selected }
      : { error: "Select at least one valid option" };
  }

  if (questionType === "integer") {
    const raw =
      typeof value === "number"
        ? String(value)
        : typeof value === "string"
          ? value.trim()
          : "";
    if (!raw) return { error: "Enter a numeric answer" };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed))
      return { error: "Enter a valid numeric answer" };
    return { value: raw };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: "Select a valid option" };
  }
  return { value: parsed };
}

function isQuestionBankAttemptCorrect(
  question: typeof questionBankQuestionsTable.$inferSelect,
  answer: QuestionBankAttemptAnswer,
) {
  const questionType = displayQuestionType(question.questionType, question.options);

  if (questionType === "multi") {
    return choicesMatch(answer, question.correctAnswerMulti, true) ?? false;
  }

  if (questionType === "integer") {
    const numericAnswer = Number(answer);
    if (
      question.correctAnswerMin != null &&
      question.correctAnswerMax != null
    ) {
      return (
        numericAnswer >= question.correctAnswerMin &&
        numericAnswer <= question.correctAnswerMax
      );
    }
    const exactTarget =
      question.correctAnswerMin ??
      question.correctAnswerMax ??
      question.correctAnswer ??
      parseNumericValue(question.answer);
    return (
      exactTarget !== null &&
      Number.isFinite(numericAnswer) &&
      Math.abs(numericAnswer - Number(exactTarget)) < 1e-9
    );
  }

  return choicesMatch(answer, question.correctAnswer) ?? false;
}

async function buildQuestionBankTreeForClasses(
  auth: Auth,
  classes: QuestionBankClassRow[],
) {
  const classIds = classes.map((item) => item.id);
  if (classIds.length === 0) {
    return { subjects: [], savedBucket: [] as any[] };
  }

  const subjects = await db
    .select()
    .from(subjectsTable)
    .where(inArray(subjectsTable.classId, classIds))
    .orderBy(subjectsTable.order, subjectsTable.createdAt);

  const subjectIds = subjects.map((subject) => subject.id);
  const chapters =
    subjectIds.length > 0
      ? await db
          .select()
          .from(chaptersTable)
          .where(inArray(chaptersTable.subjectId, subjectIds))
          .orderBy(chaptersTable.order, chaptersTable.createdAt)
      : [];

  const chapterIds = chapters.map((chapter) => chapter.id);
  const questions =
    chapterIds.length > 0
      ? await db
          .select()
          .from(questionBankQuestionsTable)
          .where(inArray(questionBankQuestionsTable.chapterId, chapterIds))
          .orderBy(
            questionBankQuestionsTable.order,
            questionBankQuestionsTable.createdAt,
          )
      : [];

  const questionIds = questions.map((question) => question.id);

  // Compute subject teacher IDs early (don't need questionIds) so we can
  // kick off the users fetch together with the other parallel queries.
  const classMap = new Map(classes.map((cls) => [cls.id, cls]));
  const subjectTeacherIds = [
    ...new Set(
      subjects
        .map((subject) => {
          const cls =
            subject.classId != null ? classMap.get(subject.classId) : undefined;
          return subject.teacherId ?? cls?.adminId ?? null;
        })
        .filter((value): value is number => !!value),
    ),
  ];

  // Run reports, saved, and progress queries in parallel — they all only
  // depend on questionIds which is already available.
  const [reports, savedRows, progressRows] = await Promise.all([
    questionIds.length > 0
      ? db
          .select()
          .from(questionBankReportsTable)
          .where(inArray(questionBankReportsTable.questionId, questionIds))
          .orderBy(desc(questionBankReportsTable.createdAt))
      : Promise.resolve([] as (typeof questionBankReportsTable.$inferSelect)[]),

    auth.role === "student" && questionIds.length > 0
      ? db
          .select()
          .from(questionBankSavedQuestionsTable)
          .where(
            and(
              inArray(questionBankSavedQuestionsTable.questionId, questionIds),
              eq(questionBankSavedQuestionsTable.studentId, auth.userId),
            ),
          )
      : Promise.resolve([] as (typeof questionBankSavedQuestionsTable.$inferSelect)[]),

    auth.role === "student" && questionIds.length > 0
      ? db
          .select()
          .from(questionBankQuestionProgressTable)
          .where(
            and(
              inArray(
                questionBankQuestionProgressTable.questionId,
                questionIds,
              ),
              eq(questionBankQuestionProgressTable.studentId, auth.userId),
            ),
          )
      : Promise.resolve([] as (typeof questionBankQuestionProgressTable.$inferSelect)[]),

  ]);

  const reporterIds = [...new Set(reports.map((report) => report.reportedBy))];
  const userIds = [...new Set([...subjectTeacherIds, ...reporterIds])];
  const users =
    userIds.length > 0
      ? await db
          .select({
            id: usersTable.id,
            fullName: usersTable.fullName,
            username: usersTable.username,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : [];
  const userMap = new Map(users.map((user) => [user.id, user]));

  const reportsByQuestion = new Map<number, any[]>();
  for (const report of reports) {
    const existing = reportsByQuestion.get(report.questionId) ?? [];
    existing.push(report);
    reportsByQuestion.set(report.questionId, existing);
  }

  const savedQuestionIds = new Set(savedRows.map((row) => row.questionId));
  const progressByQuestionId = new Map(
    progressRows.map((row) => [row.questionId, row]),
  );

  const serializedQuestions = questions.map((question) => {
    const questionReports = reportsByQuestion.get(question.id) ?? [];
    const progress = progressByQuestionId.get(question.id);
    const optionImages = safeParseArray<string | null>(question.optionImages, []);
    // Strip base64 imageData and base64 optionImages from the bulk tree to
    // keep the response small. Clients fetch them lazily via
    // GET /question-bank/questions/:id/image when actually displaying a question.
    const hasImage = Boolean(question.imageData);
    const hasOptionImages = optionImages.some(Boolean);
    return {
      ...question,
      imageData: null,          // stripped — fetch lazily
      optionImages: [],         // stripped — fetch lazily
      hasImage,
      hasOptionImages,
      options: safeParseArray<string>(question.options, []),
      correctAnswerMulti: safeParseArray<number>(
        question.correctAnswerMulti,
        [],
      ),
      reports: questionReports.map((report) => ({
        id: report.id,
        reportedBy: report.reportedBy,
        reporterName:
          userMap.get(report.reportedBy)?.fullName ??
          userMap.get(report.reportedBy)?.username ??
          "Student",
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      })),
      reportCount: questionReports.length,
      openReportCount: questionReports.filter(
        (report) => report.status === "open",
      ).length,
      isSaved: savedQuestionIds.has(question.id),
      progress: progress
        ? {
            attemptCount: progress.attemptCount,
            correctCount: progress.correctCount,
            incorrectCount: progress.incorrectCount,
            firstAttemptedAt: progress.firstAttemptedAt,
            lastAttemptedAt: progress.lastAttemptedAt,
            solvedAt: progress.solvedAt,
            lastIsCorrect: progress.lastIsCorrect,
          }
        : null,
    };
  });

  const questionsByChapter = new Map<number, typeof serializedQuestions>();
  for (const question of serializedQuestions) {
    const existing = questionsByChapter.get(question.chapterId) ?? [];
    existing.push(question);
    questionsByChapter.set(question.chapterId, existing);
  }

  const chaptersBySubject = new Map<
    number,
    Array<
      typeof chaptersTable.$inferSelect & {
        questions: typeof serializedQuestions;
      }
    >
  >();
  for (const chapter of chapters) {
    const existing = chaptersBySubject.get(chapter.subjectId) ?? [];
    existing.push({
      ...chapter,
      questions: questionsByChapter.get(chapter.id) ?? [],
    });
    chaptersBySubject.set(chapter.subjectId, existing);
  }

  const result = subjects.map((subject) => {
    const cls =
      subject.classId != null ? classMap.get(subject.classId) : undefined;
    const teacherId = subject.teacherId ?? cls?.adminId ?? null;
    const teacher = teacherId ? userMap.get(teacherId) : null;
    return {
      ...subject,
      teacherId,
      teacherName: teacher?.fullName ?? null,
      teacherUsername: teacher?.username ?? null,
      chapters: chaptersBySubject.get(subject.id) ?? [],
    };
  });

  const savedBucket = serializedQuestions.filter(
    (question) => question.isSaved,
  );
  return { subjects: result, savedBucket };
}

async function getQuestionBankCardStats(classIds: number[]) {
  const stats = new Map<
    number,
    { subjectCount: number; chapterCount: number; questionCount: number }
  >();
  if (classIds.length === 0) return stats;

  const subjects = await db
    .select({ id: subjectsTable.id, classId: subjectsTable.classId })
    .from(subjectsTable)
    .where(inArray(subjectsTable.classId, classIds));
  const subjectIds = subjects.map((item) => item.id);

  const chapters =
    subjectIds.length > 0
      ? await db
          .select({ id: chaptersTable.id, subjectId: chaptersTable.subjectId })
          .from(chaptersTable)
          .where(inArray(chaptersTable.subjectId, subjectIds))
      : [];
  const chapterIds = chapters.map((item) => item.id);

  const questions =
    chapterIds.length > 0
      ? await db
          .select({
            id: questionBankQuestionsTable.id,
            chapterId: questionBankQuestionsTable.chapterId,
          })
          .from(questionBankQuestionsTable)
          .where(inArray(questionBankQuestionsTable.chapterId, chapterIds))
      : [];

  for (const classId of classIds) {
    stats.set(classId, { subjectCount: 0, chapterCount: 0, questionCount: 0 });
  }

  const subjectToClass = new Map(
    subjects.map((item) => [item.id, item.classId]),
  );
  const chapterToSubject = new Map(
    chapters.map((item) => [item.id, item.subjectId]),
  );

  for (const subject of subjects) {
    const entry =
      subject.classId != null ? stats.get(subject.classId) : undefined;
    if (entry) entry.subjectCount += 1;
  }

  for (const chapter of chapters) {
    const classId = subjectToClass.get(chapter.subjectId);
    const entry = classId ? stats.get(classId) : null;
    if (entry) entry.chapterCount += 1;
  }

  for (const question of questions) {
    const subjectId = chapterToSubject.get(question.chapterId);
    const classId = subjectId ? subjectToClass.get(subjectId) : null;
    const entry = classId ? stats.get(classId) : null;
    if (entry) entry.questionCount += 1;
  }

  return stats;
}

function classifyQuestionBankDeadline(
  deadline: Date | string | null | undefined,
) {
  if (!deadline) return null;
  const value =
    typeof deadline === "string" ? deadline : deadline.toISOString();
  const ms = new Date(value).getTime() - Date.now();
  const minutesLeft = Math.floor(ms / 60000);
  if (ms <= 0)
    return { urgency: "overdue" as const, minutesLeft, deadline: value };
  if (minutesLeft <= 60)
    return { urgency: "critical" as const, minutesLeft, deadline: value };
  return { urgency: "warning" as const, minutesLeft, deadline: value };
}

async function mapTeacherSummaries(classRows: QuestionBankClassRow[]) {
  const teacherIds = [
    ...new Set(
      classRows
        .flatMap((cls) => cls.assignedTeacherIds ?? [])
        .filter((value): value is number => Number.isInteger(value)),
    ),
  ];

  const teachers =
    teacherIds.length > 0
      ? await db
          .select({
            id: usersTable.id,
            fullName: usersTable.fullName,
            username: usersTable.username,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, teacherIds))
      : [];

  const teacherMap = new Map(teachers.map((item) => [item.id, item]));
  return { teacherIds, teacherMap };
}

function parseQuestionBankDeadlineInput(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    const fallback = new Date(`${trimmed}:00`);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
  }

  return null;
}

router.get("/question-bank/cards", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["super_admin", "admin"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const classes = await getAccessibleQuestionBankClasses(auth);
  const stats = await getQuestionBankCardStats(classes.map((item) => item.id));
  const { teacherMap } = await mapTeacherSummaries(classes);

  const cards = classes
    .map((cls) => {
      const counts = stats.get(cls.id) ?? {
        subjectCount: 0,
        chapterCount: 0,
        questionCount: 0,
      };
      const assignedTeacherIds = cls.assignedTeacherIds ?? [];
      const assignedTeachers = assignedTeacherIds
        .map((teacherId) => teacherMap.get(teacherId))
        .filter((teacher): teacher is NonNullable<typeof teacher> => !!teacher)
        .map((teacher) => ({
          id: teacher.id,
          fullName: teacher.fullName ?? null,
          username: teacher.username ?? null,
        }));
      const target = cls.weeklyTargetQuestions ?? 0;
      return {
        id: cls.id,
        title: cls.title,
        description: cls.description,
        exam: cls.subject,
        status: cls.status,
        adminId: cls.adminId,
        adminName: assignedTeachers[0]?.fullName ?? null,
        adminUsername: assignedTeachers[0]?.username ?? null,
        assignedTeacherIds,
        assignedTeachers,
        weeklyTargetQuestions: cls.weeklyTargetQuestions,
        weeklyTargetDeadline: cls.weeklyTargetDeadline ?? null,
        isLocked: isQuestionBankLocked(cls),
        subjectCount: counts.subjectCount,
        chapterCount: counts.chapterCount,
        questionCount: counts.questionCount,
        remainingQuestions:
          target > 0 ? Math.max(target - counts.questionCount, 0) : 0,
        createdAt: toISOStringSafe(cls.createdAt),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  res.json(cards);
});

router.post("/question-bank/cards", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const exam = typeof req.body?.exam === "string" ? req.body.exam.trim() : "";
  const title = exam;
  const description =
    typeof req.body?.description === "string"
      ? req.body.description.trim()
      : "";
  const teacherIds = Array.isArray(req.body?.teacherIds)
    ? req.body.teacherIds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value > 0)
    : [];
  const rawWeeklyTargetQuestions = req.body?.weeklyTargetQuestions;
  const hasWeeklyTargetQuestions = !(
    rawWeeklyTargetQuestions === undefined ||
    rawWeeklyTargetQuestions === null ||
    String(rawWeeklyTargetQuestions).trim() === ""
  );
  const parsedWeeklyTargetQuestions = hasWeeklyTargetQuestions
    ? Number(rawWeeklyTargetQuestions)
    : undefined;
  const weeklyTargetDeadline =
    typeof req.body?.weeklyTargetDeadline === "string"
      ? req.body.weeklyTargetDeadline.trim()
      : "";

  if (!exam) return res.status(400).json({ error: "Exam name is required" });
  if (teacherIds.length === 0)
    return res
      .status(400)
      .json({ error: "At least one assigned teacher is required" });
  if (
    hasWeeklyTargetQuestions &&
    (!Number.isInteger(parsedWeeklyTargetQuestions) ||
      (parsedWeeklyTargetQuestions ?? 0) < 1)
  ) {
    return res
      .status(400)
      .json({ error: "Weekly target must be a positive whole number" });
  }
  const parsedDeadline = weeklyTargetDeadline
    ? parseQuestionBankDeadlineInput(weeklyTargetDeadline)
    : null;
  if (weeklyTargetDeadline && !parsedDeadline) {
    return res.status(400).json({ error: "Deadline is invalid" });
  }
  const weeklyTargetQuestions = parsedWeeklyTargetQuestions ?? null;

  const duplicateCard = await findExistingQuestionBankCardByExam(exam);
  if (duplicateCard) {
    return res
      .status(409)
      .json({ error: "Question bank for this exam already exists" });
  }

  const teachers = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      fullName: usersTable.fullName,
      username: usersTable.username,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, teacherIds));
  if (
    teachers.length !== teacherIds.length ||
    teachers.some((teacher) => teacher.role !== "admin")
  ) {
    return res
      .status(400)
      .json({ error: "One or more selected teachers are invalid" });
  }
  const primaryTeacher = teachers[0]!;

  const [card] = await db
    .insert(classesTable)
    .values({
      title,
      description: description || null,
      subject: exam,
      workflowType: "question_bank",
      adminId: primaryTeacher.id,
      assignedTeacherIds: teacherIds,
      plannerId: auth.userId,
      status: "scheduled",
      weeklyTargetQuestions,
      weeklyTargetDeadline: toISOStringSafe(parsedDeadline),
      scheduledAt: null,
      maxStudents: null,
      meetingLink: null,
    })
    .returning();

  res.status(201).json({
    id: card.id,
    title: card.title,
    description: card.description,
    exam: card.subject,
    status: card.status,
    adminId: primaryTeacher.id,
    adminName: primaryTeacher.fullName ?? null,
    adminUsername: primaryTeacher.username ?? null,
    assignedTeacherIds: teacherIds,
    assignedTeachers: teachers.map((teacher) => ({
      id: teacher.id,
      fullName: teacher.fullName ?? null,
      username: teacher.username ?? null,
    })),
    weeklyTargetQuestions: card.weeklyTargetQuestions,
    weeklyTargetDeadline: card.weeklyTargetDeadline ?? null,
    isLocked: isQuestionBankLocked(card),
    subjectCount: 0,
    chapterCount: 0,
    questionCount: 0,
    remainingQuestions: weeklyTargetQuestions ?? 0,
    createdAt: toISOStringSafe(card.createdAt),
  });
});

router.patch("/question-bank/cards/:id", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const cardId = Number(req.params.id);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return res.status(400).json({ error: "Invalid card id" });
  }

  const exam = typeof req.body?.exam === "string" ? req.body.exam.trim() : "";
  const title = exam;
  const description =
    typeof req.body?.description === "string"
      ? req.body.description.trim()
      : "";
  const teacherIds = Array.isArray(req.body?.teacherIds)
    ? req.body.teacherIds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value > 0)
    : [];
  const rawWeeklyTargetQuestions = req.body?.weeklyTargetQuestions;
  const hasWeeklyTargetQuestions = !(
    rawWeeklyTargetQuestions === undefined ||
    rawWeeklyTargetQuestions === null ||
    String(rawWeeklyTargetQuestions).trim() === ""
  );
  const parsedWeeklyTargetQuestions = hasWeeklyTargetQuestions
    ? Number(rawWeeklyTargetQuestions)
    : undefined;
  const weeklyTargetDeadline =
    typeof req.body?.weeklyTargetDeadline === "string"
      ? req.body.weeklyTargetDeadline.trim()
      : "";

  if (!exam) return res.status(400).json({ error: "Exam name is required" });
  if (teacherIds.length === 0)
    return res
      .status(400)
      .json({ error: "At least one assigned teacher is required" });
  if (
    hasWeeklyTargetQuestions &&
    (!Number.isInteger(parsedWeeklyTargetQuestions) ||
      (parsedWeeklyTargetQuestions ?? 0) < 1)
  ) {
    return res
      .status(400)
      .json({ error: "Weekly target must be a positive whole number" });
  }
  const parsedDeadline = weeklyTargetDeadline
    ? parseQuestionBankDeadlineInput(weeklyTargetDeadline)
    : null;
  if (weeklyTargetDeadline && !parsedDeadline) {
    return res.status(400).json({ error: "Deadline is invalid" });
  }
  const weeklyTargetQuestions = parsedWeeklyTargetQuestions ?? null;

  const [existingCard] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, cardId));
  if (!existingCard || existingCard.workflowType !== "question_bank") {
    return res.status(404).json({ error: "Question bank card not found" });
  }
  if (!ensureQuestionBankUnlocked(existingCard, res)) return;

  const duplicateCard = await findExistingQuestionBankCardByExam(exam, cardId);
  if (duplicateCard) {
    return res
      .status(409)
      .json({ error: "Question bank for this exam already exists" });
  }

  const teachers = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      fullName: usersTable.fullName,
      username: usersTable.username,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, teacherIds));
  if (
    teachers.length !== teacherIds.length ||
    teachers.some((teacher) => teacher.role !== "admin")
  ) {
    return res
      .status(400)
      .json({ error: "One or more selected teachers are invalid" });
  }
  const primaryTeacher = teachers[0]!;

  const [card] = await db
    .update(classesTable)
    .set({
      title,
      description: description || null,
      subject: exam,
      adminId: primaryTeacher.id,
      assignedTeacherIds: teacherIds,
      weeklyTargetQuestions,
      weeklyTargetDeadline: toISOStringSafe(parsedDeadline),
    })
    .where(eq(classesTable.id, cardId))
    .returning();

  res.json({
    id: card.id,
    title: card.title,
    description: card.description,
    exam: card.subject,
    status: card.status,
    adminId: primaryTeacher.id,
    adminName: primaryTeacher.fullName ?? null,
    adminUsername: primaryTeacher.username ?? null,
    assignedTeacherIds: teacherIds,
    assignedTeachers: teachers.map((teacher) => ({
      id: teacher.id,
      fullName: teacher.fullName ?? null,
      username: teacher.username ?? null,
    })),
    weeklyTargetQuestions: card.weeklyTargetQuestions,
    weeklyTargetDeadline: card.weeklyTargetDeadline ?? null,
    isLocked: isQuestionBankLocked(card),
  });
});

router.patch("/question-bank/cards/:id/lock", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const cardId = Number(req.params.id);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return res.status(400).json({ error: "Invalid card id" });
  }

  const [card] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, cardId));
  if (!card || card.workflowType !== "question_bank") {
    return res.status(404).json({ error: "Question bank card not found" });
  }

  const lockValue = Boolean(req.body?.isLocked);
  const updatedResult = await db.execute(sql<{ id: number; isLocked: boolean }>`
    update classes
    set is_locked = ${lockValue}, updated_at = now()
    where id = ${cardId}
    returning id, is_locked as "isLocked"
  `);
  const updated = updatedResult.rows[0];

  if (!updated) {
    return res.status(404).json({ error: "Question bank card not found" });
  }

  res.json({ id: updated.id, isLocked: updated.isLocked });
});

router.delete("/question-bank/cards/:id", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const cardId = Number(req.params.id);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return res.status(400).json({ error: "Invalid card id" });
  }

  const [existingCard] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, cardId));
  if (!existingCard || existingCard.workflowType !== "question_bank") {
    return res.status(404).json({ error: "Question bank card not found" });
  }
  if (!ensureQuestionBankUnlocked(existingCard, res)) return;

  await db.delete(classesTable).where(eq(classesTable.id, cardId));
  res.json({ success: true });
});

router.get("/question-bank/alerts", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const classes = await getAccessibleQuestionBankClasses(auth);
  const stats = await getQuestionBankCardStats(classes.map((item) => item.id));
  const alerts = classes
    .map((cls) => {
      const target = cls.weeklyTargetQuestions ?? 0;
      const counts = stats.get(cls.id) ?? {
        subjectCount: 0,
        chapterCount: 0,
        questionCount: 0,
      };
      if (!target || !cls.weeklyTargetDeadline) return null;
      if (counts.questionCount >= target) return null;
      const deadlineInfo = classifyQuestionBankDeadline(
        cls.weeklyTargetDeadline,
      );
      if (!deadlineInfo) return null;

      return {
        id: cls.id,
        title: cls.title,
        exam: cls.subject,
        deadline: deadlineInfo.deadline,
        urgency: deadlineInfo.urgency,
        minutesLeft: deadlineInfo.minutesLeft,
        weeklyTargetQuestions: target,
        currentQuestions: counts.questionCount,
        remainingQuestions: Math.max(target - counts.questionCount, 0),
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => {
      const order = { overdue: 0, critical: 1, warning: 2 };
      const diff = order[a.urgency] - order[b.urgency];
      if (diff !== 0) return diff;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

  res.json(alerts);
});

router.get("/question-bank/exams", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin", "student"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (auth.role === "admin" || auth.role === "super_admin") {
    await ensureJamChemistryQuestionBankCard();
  }

  const classes = await getAccessibleQuestionBankClasses(auth);
  const studentExamKeys =
    auth.role === "student" ? await getStudentExamKeys(auth.userId) : null;
  const selectedExamKey = auth.role === "student" ? normalizeExamKey(req.query.exam) : null;

  const grouped = new Map<
    string,
    { key: string; label: string; classes: QuestionBankClassRow[] }
  >();
  for (const cls of classes) {
    const examKey =
      normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title);
    if (!examKey) continue;
    if (studentExamKeys && !studentExamKeys.has(examKey)) continue;
    if (selectedExamKey && examKey !== selectedExamKey) continue;
    const existing = grouped.get(examKey);
    if (existing) {
      existing.classes.push(cls);
    } else {
      grouped.set(examKey, {
        key: examKey,
        label: cls.subject ?? cls.title,
        classes: [cls],
      });
    }
  }

  const allClassIds = [
    ...new Set(
      [...grouped.values()].flatMap((group) =>
        group.classes.map((item) => item.id),
      ),
    ),
  ];
  const progressRows =
    auth.role === "student" && allClassIds.length > 0
      ? await db
          .select()
          .from(questionBankQuestionProgressTable)
          .where(
            and(
              eq(questionBankQuestionProgressTable.studentId, auth.userId),
              inArray(questionBankQuestionProgressTable.classId, allClassIds),
            ),
          )
      : [];
  const progressCountByClassId = new Map<number, number>();
  for (const row of progressRows) {
    progressCountByClassId.set(
      row.classId,
      (progressCountByClassId.get(row.classId) ?? 0) + 1,
    );
  }

  const summaries = await Promise.all(
    [...grouped.values()].map(async (group) => {
      const classIds = group.classes.map((item) => item.id);
      const subjects =
        classIds.length > 0
          ? await db
              .select({ id: subjectsTable.id })
              .from(subjectsTable)
              .where(inArray(subjectsTable.classId, classIds))
          : [];
      const subjectIds = subjects.map((item) => item.id);
      const chapters =
        subjectIds.length > 0
          ? await db
              .select({
                id: chaptersTable.id,
                targetQuestions: chaptersTable.targetQuestions,
              })
              .from(chaptersTable)
              .where(inArray(chaptersTable.subjectId, subjectIds))
          : [];
      const chapterIds = chapters.map((item) => item.id);
      const questions =
        chapterIds.length > 0
          ? await db
              .select({
                id: questionBankQuestionsTable.id,
                chapterId: questionBankQuestionsTable.chapterId,
              })
              .from(questionBankQuestionsTable)
              .where(inArray(questionBankQuestionsTable.chapterId, chapterIds))
          : [];

      const questionCountByChapter = new Map<number, number>();
      for (const question of questions) {
        questionCountByChapter.set(
          question.chapterId,
          (questionCountByChapter.get(question.chapterId) ?? 0) + 1,
        );
      }
      const targetQuestionCount = chapters.reduce((sum, chapter) => {
        const uploaded = questionCountByChapter.get(chapter.id) ?? 0;
        return sum + Math.max(chapter.targetQuestions ?? 0, uploaded);
      }, 0);
      const questionCount = questions.length;
      const attemptedQuestionCount = classIds.reduce(
        (sum, classId) => sum + (progressCountByClassId.get(classId) ?? 0),
        0,
      );

      return {
        key: group.key,
        label: group.label,
        subjectCount: subjects.length,
        chapterCount: chapters.length,
        questionCount,
        targetQuestionCount,
        pendingQuestionCount: Math.max(targetQuestionCount - questionCount, 0),
        attemptedQuestionCount,
      };
    }),
  );

  summaries.sort((a, b) => a.label.localeCompare(b.label));
  res.json(summaries);
});

router.get("/question-bank/progress/summary", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student")
    return res
      .status(403)
      .json({ error: "Only students can view question bank progress" });
  const [student] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, auth.userId));
  if (!ensureStudentFeatureUnlocked(student, "question-bank", res)) return;
  const selectedExamKey = normalizeExamKey(req.query.exam);

  const classes = await getAccessibleQuestionBankClasses(auth);
  const studentExamKeys = await getStudentExamKeys(auth.userId);
  const visibleClassIds = classes
    .filter((cls) => {
      const examKey = getQuestionBankClassExamKey(cls);
      return examKey ? studentExamKeys.has(examKey) && (!selectedExamKey || examKey === selectedExamKey) : false;
    })
    .map((cls) => cls.id);

  const progressRows =
    visibleClassIds.length > 0
      ? await db
          .select()
          .from(questionBankQuestionProgressTable)
          .where(
            and(
              eq(questionBankQuestionProgressTable.studentId, auth.userId),
              inArray(
                questionBankQuestionProgressTable.classId,
                visibleClassIds,
              ),
            ),
          )
      : [];

  // A progress row is created on the first attempt, including an incorrect
  // answer. Keep attempted and actually solved questions separate so the
  // student dashboard does not overstate solved questions.
  const totalAttemptedQuestions = progressRows.length;
  const totalSolvedQuestions = progressRows.filter(
    (row) => Boolean(row.solvedAt || row.lastIsCorrect),
  ).length;
  const totalAttempts = progressRows.reduce(
    (sum, row) => sum + Math.max(row.attemptCount ?? 0, 0),
    0,
  );
  const correctAttempts = progressRows.reduce(
    (sum, row) => sum + Math.max(row.correctCount ?? 0, 0),
    0,
  );
  const latestCorrectQuestions = progressRows.filter(
    (row) => row.lastIsCorrect,
  ).length;
  const dailyAttemptedMap = new Map<string, number>();

  for (const row of progressRows) {
    const key = formatLocalDateKey(row.firstAttemptedAt);
    if (!key) continue;
    dailyAttemptedMap.set(key, (dailyAttemptedMap.get(key) ?? 0) + 1);
  }

  const dailyAttemptedCounts = [...dailyAttemptedMap.entries()]
    .map(([date, questions]) => ({ date, questions }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    totalSolvedQuestions,
    totalAttemptedQuestions,
    totalAttempts,
    correctAttempts,
    latestCorrectQuestions,
    accuracy:
      totalAttempts > 0
        ? Number(((correctAttempts / totalAttempts) * 100).toFixed(1))
        : 0,
    // Kept as an alias for older clients. Dashboard activity uses the
    // explicitly named attempted counts because every answered question is
    // valid practice, even when the first answer is incorrect.
    dailySolvedCounts: dailyAttemptedCounts,
    dailyAttemptedCounts,
  });
});

router.get("/question-bank/saved-questions", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") {
    return res.status(403).json({ error: "Only students can view saved questions" });
  }

  const [student] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, auth.userId));
  if (!ensureStudentFeatureUnlocked(student, "question-bank", res)) return;

  const page = questionBankPage(req.query);
  if (!page) return res.status(400).json({ error: "Invalid saved-question cursor" });
  const studentExamKeys = new Set([student?.subject, ...(student?.additionalExams ?? [])].map(normalizeExamKey).filter(Boolean));
  const classes: Array<{ id: number; title: string; subject: string | null }> = await db
    .select({ id: classesTable.id, title: classesTable.title, subject: classesTable.subject })
    .from(classesTable);
  const allowedClassIds = classes.filter((cls) => studentExamKeys.has(normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title))).map((cls) => cls.id);
  const countOnly = req.query.countOnly === "1";
  if (allowedClassIds.length === 0) return res.json(countOnly ? { count: 0 } : { questions: [], nextCursor: null });

  const scope = and(
    eq(questionBankSavedQuestionsTable.studentId, auth.userId),
    sql`${subjectsTable.classId} IN (SELECT value FROM json_each(${JSON.stringify(allowedClassIds)}))`,
  );
  const contextJoins = (query: any) => query
    .innerJoin(questionBankQuestionsTable, eq(questionBankQuestionsTable.id, questionBankSavedQuestionsTable.questionId))
    .innerJoin(chaptersTable, eq(chaptersTable.id, questionBankQuestionsTable.chapterId))
    .innerJoin(subjectsTable, eq(subjectsTable.id, chaptersTable.subjectId))
    .innerJoin(classesTable, eq(classesTable.id, subjectsTable.classId));
  if (countOnly) {
    const [count] = await contextJoins(db.select({ count: sql<number>`count(*)` }).from(questionBankSavedQuestionsTable)).where(scope);
    return res.json({ count: Number(count?.count ?? 0) });
  }

  const { imageData, optionImages, ...questionColumns } = getTableColumns(questionBankQuestionsTable);
  const savedQuery = contextJoins(db.select({
    savedId: questionBankSavedQuestionsTable.id,
    savedAt: questionBankSavedQuestionsTable.createdAt,
    question: questionColumns,
    progress: questionBankQuestionProgressTable,
    hasImage: sql<number>`coalesce(length(${imageData}), 0) > 0`,
    hasOptionImages: sql<number>`exists (select 1 from json_each(case when json_valid(${optionImages}) then ${optionImages} else '[]' end) where value is not null and value != '' and value != 0)`,
    exam: classesTable.subject,
    classTitle: classesTable.title,
    subjectTitle: subjectsTable.title,
    chapterTitle: chaptersTable.title,
  }).from(questionBankSavedQuestionsTable))
    .leftJoin(questionBankQuestionProgressTable, and(eq(questionBankQuestionProgressTable.questionId, questionBankQuestionsTable.id), eq(questionBankQuestionProgressTable.studentId, auth.userId)))
    .where(and(scope, page.enabled && page.cursor
      ? sql`(${questionBankSavedQuestionsTable.createdAt}, ${questionBankSavedQuestionsTable.id}) < (${page.cursor.createdAt}, ${page.cursor.id})`
      : undefined))
    .orderBy(desc(questionBankSavedQuestionsTable.createdAt), desc(questionBankSavedQuestionsTable.id));
  type SavedRow = {
    savedId: number; savedAt: Date; question: Omit<typeof questionBankQuestionsTable.$inferSelect, "imageData" | "optionImages">;
    progress: typeof questionBankQuestionProgressTable.$inferSelect | null;
    hasImage: number; hasOptionImages: number; exam: string | null; classTitle: string; subjectTitle: string; chapterTitle: string;
  };
  const rows: SavedRow[] = await (page.enabled ? savedQuery.limit(page.limit + 1) : savedQuery);
  const hasMore = page.enabled && rows.length > page.limit;
  const pageRows = page.enabled ? rows.slice(0, page.limit) : rows;
  const savedQuestions = pageRows.map(({ question, progress, ...context }) => ({
      ...question,
      imageData: null,
      optionImages: [],
      hasImage: Boolean(context.hasImage),
      hasOptionImages: Boolean(context.hasOptionImages),
      options: safeParseArray<string>(question.options, []),
      correctAnswerMulti: safeParseArray<number>(question.correctAnswerMulti, []),
      isSaved: true,
      progress: progress
        ? {
            attemptCount: progress.attemptCount,
            correctCount: progress.correctCount,
            incorrectCount: progress.incorrectCount,
            firstAttemptedAt: progress.firstAttemptedAt,
            lastAttemptedAt: progress.lastAttemptedAt,
            solvedAt: progress.solvedAt,
            lastIsCorrect: progress.lastIsCorrect,
          }
        : null,
      examKey: normalizeExamKey(context.exam) ?? normalizeExamKey(context.classTitle),
      examLabel: context.exam ?? context.classTitle,
      subjectTitle: context.subjectTitle,
      chapterTitle: context.chapterTitle,
    }));
  const last = pageRows.at(-1);
  res.json({ questions: savedQuestions, nextCursor: hasMore && last ? `${last.savedAt.getTime()}:${last.savedId}` : null });
});

router.get("/question-bank/exams/:examKey", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin", "student"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const examKey = normalizeExamKey(req.params.examKey);
  if (!examKey) return res.status(400).json({ error: "Invalid exam key" });

  if (auth.role === "student") {
    const studentExamKeys = await getStudentExamKeys(auth.userId);
    if (!studentExamKeys.has(examKey))
      return res.status(403).json({ error: "Forbidden" });
  }

  const classes = await getAccessibleQuestionBankClasses(auth);
  const matchingClasses = classes.filter((cls) => {
    const clsExamKey =
      normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title);
    return clsExamKey === examKey;
  });

  if (matchingClasses.length === 0) {
    return res.status(404).json({ error: "Exam question bank not found" });
  }

  const tree = await buildQuestionBankTreeForClasses(auth, matchingClasses);

  res.json({
    exam: {
      key: examKey,
      label: matchingClasses[0]?.subject ?? matchingClasses[0]?.title ?? "Exam",
    },
    subjects: tree.subjects,
    savedBucket: tree.savedBucket,
  });
});

// Lazy image endpoint — returns imageData + optionImages for a single question.
// Called by the frontend only when a specific question is being displayed,
// keeping the bulk exam tree response small and fast.
router.get("/question-bank/questions/:id/image", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const questionId = parseInt(req.params.id, 10);
  if (!questionId || Number.isNaN(questionId))
    return res.status(400).json({ error: "Invalid question id" });

  const rows = await db
    .select({
      imageData: questionBankQuestionsTable.imageData,
      optionImages: questionBankQuestionsTable.optionImages,
      chapterId: questionBankQuestionsTable.chapterId,
    })
    .from(questionBankQuestionsTable)
    .where(eq(questionBankQuestionsTable.id, questionId))
    .limit(1);

  if (!rows.length) return res.status(404).json({ error: "Question not found" });

  const row = rows[0]!;
  res.json({
    imageData: row.imageData ?? null,
    optionImages: safeParseArray<string | null>(row.optionImages, []),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /question-bank/exams/:examKey/structure
// Returns subjects + chapters with question counts (no question content).
// Fast "skeleton" load; the client then fetches questions per-chapter lazily.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/question-bank/exams/:examKey/structure", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin", "student"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const examKey = normalizeExamKey(req.params.examKey);
  if (!examKey) return res.status(400).json({ error: "Invalid exam key" });

  if (auth.role === "student") {
    const studentExamKeys = await getStudentExamKeys(auth.userId);
    if (!studentExamKeys.has(examKey))
      return res.status(403).json({ error: "Forbidden" });
  }

  const classes = await getAccessibleQuestionBankClasses(auth);
  const matchingClasses = classes.filter((cls) => {
    const clsExamKey =
      normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title);
    return clsExamKey === examKey;
  });

  if (matchingClasses.length === 0) {
    return res.status(404).json({ error: "Exam question bank not found" });
  }

  const classIds = matchingClasses.map((cls) => cls.id);

  const subjects = await db
    .select()
    .from(subjectsTable)
    .where(inArray(subjectsTable.classId, classIds))
    .orderBy(subjectsTable.order, subjectsTable.createdAt);

  const subjectIds = subjects.map((s) => s.id);
  const chapters =
    subjectIds.length > 0
      ? await db
          .select()
          .from(chaptersTable)
          .where(inArray(chaptersTable.subjectId, subjectIds))
          .orderBy(chaptersTable.order, chaptersTable.createdAt)
      : [];

  const chapterIds = chapters.map((c) => c.id);

  // Count questions per chapter (just ids — no content fetched)
  const questionCountRows =
    chapterIds.length > 0
      ? await db
          .select({
            chapterId: questionBankQuestionsTable.chapterId,
            count: sql<number>`cast(count(*) as int)`,
          })
          .from(questionBankQuestionsTable)
          .where(inArray(questionBankQuestionsTable.chapterId, chapterIds))
          .groupBy(questionBankQuestionsTable.chapterId)
      : [];

  const questionCountByChapter = new Map<number, number>(
    questionCountRows.map((r) => [r.chapterId, r.count]),
  );

  // For students, also get attempted count per chapter from progress table
  const attemptedCountByChapter = new Map<number, number>();
  if (auth.role === "student" && chapterIds.length > 0) {
    const progressRows = await db
      .select({
        questionId: questionBankQuestionProgressTable.questionId,
      })
      .from(questionBankQuestionProgressTable)
      .where(
        and(
          eq(questionBankQuestionProgressTable.studentId, auth.userId),
          inArray(questionBankQuestionProgressTable.classId, classIds),
        ),
      );
    // Map questionId → chapterId using questions lookup
    const questionChapterRows =
      progressRows.length > 0
        ? await db
            .select({
              id: questionBankQuestionsTable.id,
              chapterId: questionBankQuestionsTable.chapterId,
            })
            .from(questionBankQuestionsTable)
            .where(
              inArray(
                questionBankQuestionsTable.id,
                progressRows.map((r) => r.questionId),
              ),
            )
        : [];
    const chapterByQuestionId = new Map(
      questionChapterRows.map((q) => [q.id, q.chapterId]),
    );
    for (const row of progressRows) {
      const cid = chapterByQuestionId.get(row.questionId);
      if (cid != null) {
        attemptedCountByChapter.set(cid, (attemptedCountByChapter.get(cid) ?? 0) + 1);
      }
    }
  }

  const examKeyForTimers = normalizeExamKey(matchingClasses[0]?.subject) ?? normalizeExamKey(matchingClasses[0]?.title) ?? "";
  const timeSpentByChapter = new Map<number, number>();
  if (auth.role === "student" && examKeyForTimers && chapterIds.length > 0) {
    const timerRows = await executeD1Sql(`SELECT question_id AS questionId, time_spent_seconds AS timeSpentSeconds
      FROM student_question_timers WHERE student_id = ? AND source_type = 'question-bank' AND exam_key = ? AND time_spent_seconds > 0`, [auth.userId, examKeyForTimers]);
    const timerSecondsByQuestion = new Map(timerRows.rows.map((row) => [Number(row.questionId ?? row.question_id), Number(row.timeSpentSeconds ?? row.time_spent_seconds ?? 0)]));
    const timedQuestionIds = [...timerSecondsByQuestion.keys()].filter((id) => Number.isInteger(id) && id > 0);
    for (const ids of chunkValues(timedQuestionIds, 500)) {
      const questionRows = await db.select({ id: questionBankQuestionsTable.id, chapterId: questionBankQuestionsTable.chapterId })
        .from(questionBankQuestionsTable).where(inArray(questionBankQuestionsTable.id, ids));
      for (const question of questionRows) {
        timeSpentByChapter.set(question.chapterId, (timeSpentByChapter.get(question.chapterId) ?? 0) + (timerSecondsByQuestion.get(question.id) ?? 0));
      }
    }
  }

  const classMap = new Map(matchingClasses.map((cls) => [cls.id, cls]));

  const chaptersBySubject = new Map<number, any[]>();
  for (const chapter of chapters) {
    const existing = chaptersBySubject.get(chapter.subjectId) ?? [];
    existing.push({
      id: chapter.id,
      title: chapter.title,
      description: chapter.description ?? null,
      order: chapter.order,
      isLocked: Boolean(chapter.isLocked),
      targetQuestions: chapter.targetQuestions ?? null,
      questionCount: questionCountByChapter.get(chapter.id) ?? 0,
      attemptedCount: attemptedCountByChapter.get(chapter.id) ?? 0,
      totalTimeSpentSeconds: timeSpentByChapter.get(chapter.id) ?? 0,
    });
    chaptersBySubject.set(chapter.subjectId, existing);
  }

  const result = subjects.map((subject) => {
    const cls = subject.classId != null ? classMap.get(subject.classId) : undefined;
    const isLockedCls = cls ? isQuestionBankLocked(cls) : false;
    return {
      id: subject.id,
      title: subject.title,
      description: subject.description ?? null,
      order: subject.order,
      isLocked: Boolean(subject.isLocked) || isLockedCls,
      chapters: chaptersBySubject.get(subject.id) ?? [],
    };
  });

  res.json({
    exam: {
      key: examKey,
      label: matchingClasses[0]?.subject ?? matchingClasses[0]?.title ?? "Exam",
    },
    subjects: result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /question-bank/chapters/:chapterId/questions
// Lazy-loads the full question list for a single chapter.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/question-bank/chapters/:chapterId/questions", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin", "student"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const chapterId = parseInt(req.params.chapterId, 10);
  if (Number.isNaN(chapterId))
    return res.status(400).json({ error: "Invalid chapter id" });

  // Verify the chapter exists and user can access it
  const chapterRows = await db
    .select()
    .from(chaptersTable)
    .where(eq(chaptersTable.id, chapterId))
    .limit(1);
  if (!chapterRows.length) return res.status(404).json({ error: "Chapter not found" });
  const chapter = chapterRows[0]!;

  const subjectRows = await db
    .select()
    .from(subjectsTable)
    .where(eq(subjectsTable.id, chapter.subjectId))
    .limit(1);
  if (!subjectRows.length) return res.status(404).json({ error: "Subject not found" });
  const subject = subjectRows[0]!;

  if (subject.classId == null) return res.status(404).json({ error: "Class not found" });

  const classRows = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, subject.classId))
    .limit(1);
  if (!classRows.length) return res.status(404).json({ error: "Class not found" });
  const cls = classRows[0]!;

  const accessibleClasses = await getAccessibleQuestionBankClasses(auth);
  const hasClassAccess = accessibleClasses.some((item) => item.id === cls.id);
  if (!hasClassAccess) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // For students: check exam-level access
  if (auth.role === "student") {
    const examKey = normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title);
    if (examKey) {
      const studentExamKeys = await getStudentExamKeys(auth.userId);
      if (!studentExamKeys.has(examKey))
        return res.status(403).json({ error: "Forbidden" });
    }
  }

  let readScope: ReturnType<typeof questionBankReadScope>;
  try { readScope = questionBankReadScope(new URL(req.originalUrl, "http://localhost").searchParams); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  const includeImages = !readScope.indexOnly && (req.query.includeImages === "1" || req.query.includeImages === "true");
  const savedOnly = auth.role === "student" && String(req.query.saved ?? "") === "1";

  const questionQuery = db
    .select({
      ...getTableColumns(questionBankQuestionsTable),
      ...(!includeImages ? { imageData: sql<string | null>`NULL`, optionImages: sql<string | null>`NULL` } : {}),
      ...(readScope.indexOnly ? {
        question: sql<string>`''`, options: sql<string>`'[]'`, explanation: sql<string | null>`NULL`,
        answer: sql<string | null>`NULL`, correctAnswer: sql<number | null>`NULL`,
        correctAnswerMulti: sql<string | null>`NULL`, correctAnswerMin: sql<number | null>`NULL`, correctAnswerMax: sql<number | null>`NULL`, topicTag: sql<string | null>`NULL`,
      } : {}),
      hasImage: readScope.indexOnly ? sql<number>`0` : sql<number>`COALESCE(length(${questionBankQuestionsTable.imageData}),0)>0`,
      hasOptionImages: readScope.indexOnly ? sql<number>`0` : sql<number>`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${questionBankQuestionsTable.optionImages}) THEN ${questionBankQuestionsTable.optionImages} ELSE '[]' END) WHERE value IS NOT NULL AND value != '' AND value != 0)`,
    })
    .from(readScope.ids ? sql`${questionBankQuestionsTable} NOT INDEXED` : questionBankQuestionsTable)
    .where(and(
      eq(questionBankQuestionsTable.chapterId, chapterId),
      readScope.ids ? inArray(questionBankQuestionsTable.id, readScope.ids) : undefined,
      savedOnly
        ? exists(
            db
              .select({ id: questionBankSavedQuestionsTable.id })
              .from(questionBankSavedQuestionsTable)
              .where(and(
                eq(questionBankSavedQuestionsTable.questionId, questionBankQuestionsTable.id),
                eq(questionBankSavedQuestionsTable.studentId, auth.userId),
              )),
          )
        : undefined,
    ))
    .orderBy(questionBankQuestionsTable.order, questionBankQuestionsTable.createdAt, questionBankQuestionsTable.id);

  const questions = await (auth.role === "student" && !readScope.indexOnly ? questionQuery.limit(20) : questionQuery);
  const questionIds = questions.map((q) => q.id);

  const [reports, savedRows, progressRows, timerRows] = await Promise.all([
    auth.role !== "student" && !readScope.indexOnly && questionIds.length > 0
      ? db
          .select()
          .from(questionBankReportsTable)
          .where(inArray(questionBankReportsTable.questionId, questionIds))
          .orderBy(desc(questionBankReportsTable.createdAt))
      : Promise.resolve([] as (typeof questionBankReportsTable.$inferSelect)[]),

    auth.role === "student" && questionIds.length > 0
      ? db
          .select()
          .from(questionBankSavedQuestionsTable)
          .where(
            and(
              sql`${questionBankSavedQuestionsTable.questionId} IN (SELECT value FROM json_each(${JSON.stringify(questionIds)}))`,
              eq(questionBankSavedQuestionsTable.studentId, auth.userId),
            ),
          )
      : Promise.resolve([] as (typeof questionBankSavedQuestionsTable.$inferSelect)[]),

    auth.role === "student" && questionIds.length > 0
      ? db
          .select()
          .from(questionBankQuestionProgressTable)
          .where(
            and(
              sql`${questionBankQuestionProgressTable.questionId} IN (SELECT value FROM json_each(${JSON.stringify(questionIds)}))`,
              eq(questionBankQuestionProgressTable.studentId, auth.userId),
            ),
          )
      : Promise.resolve([] as (typeof questionBankQuestionProgressTable.$inferSelect)[]),

    auth.role === "student" && questionIds.length > 0
      ? executeD1Sql(`SELECT question_id AS questionId, time_spent_seconds AS timeSpentSeconds FROM student_question_timers
          WHERE student_id = ? AND source_type = 'question-bank' AND exam_key = ? AND question_id IN (SELECT value FROM json_each(?))`,
        [auth.userId, normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title) ?? "", JSON.stringify(questionIds)])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);

  const reporterIds = [...new Set(reports.map((report) => report.reportedBy))];
  const reporters =
    reporterIds.length > 0
      ? await db
          .select({
            id: usersTable.id,
            fullName: usersTable.fullName,
            username: usersTable.username,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, reporterIds))
      : [];
  const reporterMap = new Map(reporters.map((user) => [user.id, user]));
  const reportsByQuestion = new Map<number, typeof reports>();
  for (const report of reports) {
    const questionReports = reportsByQuestion.get(report.questionId) ?? [];
    questionReports.push(report);
    reportsByQuestion.set(report.questionId, questionReports);
  }

  const savedSet = new Set(savedRows.map((r) => r.questionId));
  const progressByQuestion = new Map(progressRows.map((r) => [r.questionId, r]));
  const timerByQuestion = new Map(timerRows.rows.map((row) => [Number(row.questionId ?? row.question_id), Number(row.timeSpentSeconds ?? row.time_spent_seconds ?? 0)]));

  const result = questions.map((q) => {
    const progress = progressByQuestion.get(q.id);
    return {
      id: q.id,
      chapterId: q.chapterId,
      question: q.question,
      questionType: displayQuestionType(q.questionType, safeParseArray<string>(q.options, [])),
      options: safeParseArray<string>(q.options, []),
      ...(includeImages
        ? {
            imageData: q.imageData ?? null,
            optionImages: safeParseArray<string | null>(q.optionImages, []),
          }
        : {}),
      hasImage: Boolean(q.hasImage),
      hasOptionImages: Boolean(q.hasOptionImages),
      correctAnswer: q.correctAnswer,
      answer: q.answer ?? null,
      correctAnswerMulti: safeParseArray<number>(q.correctAnswerMulti, []),
      correctAnswerMin: q.correctAnswerMin ?? null,
      correctAnswerMax: q.correctAnswerMax ?? null,
      explanation: q.explanation ?? null,
      topicTag: q.topicTag ?? null,
      difficulty: q.difficulty ?? "medium",
      points: q.points ?? 1,
      order: q.order,
      reports: (reportsByQuestion.get(q.id) ?? []).map((report) => ({
        id: report.id,
        reportedBy: report.reportedBy,
        reporterName:
          reporterMap.get(report.reportedBy)?.fullName ??
          reporterMap.get(report.reportedBy)?.username ??
          "Student",
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      })),
      reportCount: (reportsByQuestion.get(q.id) ?? []).length,
      openReportCount: (reportsByQuestion.get(q.id) ?? []).filter(
        (report) => report.status === "open",
      ).length,
      isSaved: savedSet.has(q.id),
      timeSpentSeconds: timerByQuestion.get(q.id) ?? 0,
      progress: progress
        ? {
            attemptCount: progress.attemptCount ?? 0,
            correctCount: progress.correctCount ?? 0,
            incorrectCount: progress.incorrectCount ?? 0,
            firstAttemptedAt: progress.firstAttemptedAt?.toISOString() ?? "",
            lastAttemptedAt: progress.lastAttemptedAt?.toISOString() ?? "",
            solvedAt: progress.solvedAt?.toISOString() ?? null,
            lastIsCorrect: Boolean(progress.lastIsCorrect),
          }
        : null,
    };
  });

  res.json({ questions: readScope.indexOnly ? result.map(question => ({
    id: question.id, difficulty: question.difficulty, progress: question.progress,
    isSaved: question.isSaved, timeSpentSeconds: question.timeSpentSeconds,
  })) : result });
});

router.post("/question-bank/questions/:id/time", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student") return res.status(403).json({ error: "Only students can save question-bank question time" });
  const questionId = Number(req.params.id);
  const examKey = normalizeExamKey(req.body?.exam);
  const seconds = Number(req.body?.timeSpentSeconds);
  if (!examKey || !Number.isInteger(questionId) || questionId <= 0 || !["gate", "jam-chemistry"].includes(examKey)) {
    return res.status(400).json({ error: "Invalid GATE/JAM question-bank question" });
  }
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 31_536_000) {
    return res.status(400).json({ error: "Question time must be between 0 and one year" });
  }
  const studentExamKeys = await getStudentExamKeys(auth.userId);
  if (!studentExamKeys.has(examKey)) return res.status(403).json({ error: "Forbidden" });
  try {
    const [priorAttempt] = await db.select({ attemptCount: questionBankQuestionProgressTable.attemptCount })
      .from(questionBankQuestionProgressTable)
      .where(and(
        eq(questionBankQuestionProgressTable.studentId, auth.userId),
        eq(questionBankQuestionProgressTable.questionId, questionId),
      ));
    if ((priorAttempt?.attemptCount ?? 0) > 0) {
      const firstTime = await executeD1Sql(`SELECT time_spent_seconds AS timeSpentSeconds FROM student_question_timers
        WHERE student_id = ? AND source_type = 'question-bank' AND exam_key = ? AND question_id = ?`,
      [auth.userId, examKey, questionId]);
      return res.json({ timeSpentSeconds: Number(firstTime.rows[0]?.timeSpentSeconds ?? 0) });
    }
    const saved = await executeD1Sql(`INSERT INTO student_question_timers (student_id, source_type, exam_key, question_id, time_spent_seconds, updated_at)
      VALUES (?, 'question-bank', ?, ?, ?, ?) ON CONFLICT(student_id, source_type, exam_key, question_id) DO UPDATE SET
      time_spent_seconds = MAX(student_question_timers.time_spent_seconds, excluded.time_spent_seconds),
      updated_at = excluded.updated_at RETURNING time_spent_seconds AS timeSpentSeconds`,
    [auth.userId, examKey, questionId, seconds, Date.now()]);
    return res.json({ timeSpentSeconds: Number(saved.rows[0]?.timeSpentSeconds ?? saved.rows[0]?.time_spent_seconds ?? seconds) });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Could not save question timer" });
  }
});

router.get("/question-bank/exams/:examKey/export", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const examKey = normalizeExamKey(req.params.examKey);
  if (!examKey) return res.status(400).json({ error: "Invalid exam key" });

  const classes = await getAccessibleQuestionBankClasses(auth);
  const matchingClasses = classes.filter((cls) => {
    const clsExamKey =
      normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title);
    return clsExamKey === examKey;
  });

  if (matchingClasses.length === 0) {
    return res.status(404).json({ error: "Exam question bank not found" });
  }

  const tree = await buildQuestionBankTreeForClasses(auth, matchingClasses);
  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    exam: {
      key: examKey,
      label: matchingClasses[0]?.subject ?? matchingClasses[0]?.title ?? "Exam",
    },
    subjects: tree.subjects.map((subject) => ({
      title: subject.title,
      chapters: subject.chapters.map((chapter) => ({
        title: chapter.title,
        description: chapter.description ?? null,
        targetQuestions: chapter.targetQuestions ?? 0,
        questions: chapter.questions,
      })),
    })),
  });
});

router.post("/question-bank/exams/:examKey/import", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "admin" && auth.role !== "super_admin") {
    return res
      .status(403)
      .json({
        error: "Only assigned teachers can import into a question bank exam",
      });
  }

  const examKey = normalizeExamKey(req.params.examKey);
  if (!examKey) return res.status(400).json({ error: "Invalid exam key" });

  const classes = await getAccessibleQuestionBankClasses(auth);
  const matchingClasses = classes.filter((cls) => {
    const clsExamKey =
      normalizeExamKey(cls.subject) ?? normalizeExamKey(cls.title);
    return clsExamKey === examKey;
  });
  if (matchingClasses.length === 0) {
    return res.status(404).json({ error: "Exam question bank not found" });
  }
  if (matchingClasses.some((cls) => isQuestionBankLocked(cls))) {
    return res
      .status(409)
      .json({
        error: "This question bank is locked. Unlock it to make changes.",
      });
  }

  const rawSubjects = Array.isArray(req.body?.subjects)
    ? req.body.subjects
    : [];
  if (rawSubjects.length === 0) {
    return res
      .status(400)
      .json({ error: "No subjects were found in the import bundle" });
  }

  const classIds = matchingClasses.map((cls) => cls.id);
  const subjects =
    classIds.length > 0
      ? await db
          .select()
          .from(subjectsTable)
          .where(inArray(subjectsTable.classId, classIds))
      : [];
  const subjectIds = subjects.map((subject) => subject.id);
  const chapters =
    subjectIds.length > 0
      ? await db
          .select()
          .from(chaptersTable)
          .where(inArray(chaptersTable.subjectId, subjectIds))
      : [];

  const subjectsByKey = new Map(
    subjects.map(
      (subject) => [normalizeTitleKey(subject.title), subject] as const,
    ),
  );
  const chaptersBySubjectId = new Map<number, typeof chapters>();
  for (const chapter of chapters) {
    const existing = chaptersBySubjectId.get(chapter.subjectId) ?? [];
    existing.push(chapter);
    chaptersBySubjectId.set(chapter.subjectId, existing);
  }

  let importedCount = 0;
  let skippedSubjectCount = 0;
  let skippedChapterCount = 0;
  let skippedDuplicateCount = 0;
  let invalidQuestionCount = 0;
  const warnings: string[] = [];

  for (const rawSubject of rawSubjects) {
    const subjectTitle =
      typeof rawSubject?.title === "string" ? rawSubject.title.trim() : "";
    const subjectKey = normalizeTitleKey(subjectTitle);
    const targetSubject = subjectKey
      ? subjectsByKey.get(subjectKey)
      : undefined;
    if (!targetSubject) {
      skippedSubjectCount += 1;
      if (subjectTitle) warnings.push(`Subject not found: ${subjectTitle}`);
      continue;
    }
    const targetClass = matchingClasses.find(
      (cls) => cls.id === targetSubject.classId,
    );
    if (
      !targetClass ||
      !canManageQuestionBank(auth, targetSubject, targetClass)
    ) {
      skippedSubjectCount += 1;
      if (subjectTitle) warnings.push(`No access to subject: ${subjectTitle}`);
      continue;
    }

    const rawChapters = Array.isArray(rawSubject?.chapters)
      ? rawSubject.chapters
      : [];
    const targetChapters = chaptersBySubjectId.get(targetSubject.id) ?? [];
    const chapterMap = new Map(
      targetChapters.map(
        (chapter) => [normalizeTitleKey(chapter.title), chapter] as const,
      ),
    );

    for (const rawChapter of rawChapters) {
      const chapterTitle =
        typeof rawChapter?.title === "string" ? rawChapter.title.trim() : "";
      const chapterKey = normalizeTitleKey(chapterTitle);
      const targetChapter = chapterKey ? chapterMap.get(chapterKey) : undefined;
      if (!targetChapter) {
        skippedChapterCount += 1;
        if (subjectTitle && chapterTitle)
          warnings.push(`Chapter not found: ${subjectTitle} / ${chapterTitle}`);
        continue;
      }

      const context = {
        chapter: targetChapter,
        subject: targetSubject,
        cls: targetClass,
      };
      const existingQuestions = await db
        .select({
          id: questionBankQuestionsTable.id,
          question: questionBankQuestionsTable.question,
          questionType: questionBankQuestionsTable.questionType,
        })
        .from(questionBankQuestionsTable)
        .where(eq(questionBankQuestionsTable.chapterId, targetChapter.id));
      const duplicateKeys = new Set(
        existingQuestions
          .map(buildExistingQuestionDuplicateKey)
          .filter((value): value is string => !!value),
      );

      const rawQuestions = Array.isArray(rawChapter?.questions)
        ? rawChapter.questions
        : [];
      const parsedQuestions = rawQuestions.map((item: unknown) =>
        normalizeQuestionPayload(item),
      );
      const validQuestions = parsedQuestions.filter(
        (
          item: NormalizedQuestionPayloadResult,
        ): item is { value: NormalizedQuestionValue } => "value" in item,
      );
      const invalidQuestions = parsedQuestions.filter(
        (item: NormalizedQuestionPayloadResult): item is { error: string } =>
          "error" in item,
      );
      if (invalidQuestions.length > 0 && subjectTitle && chapterTitle) {
        warnings.push(
          `Skipped ${invalidQuestions.length} invalid question(s) in ${subjectTitle} / ${chapterTitle}`,
        );
      }
      invalidQuestionCount += invalidQuestions.length;
      if (validQuestions.length === 0) continue;

      const values: Array<ReturnType<typeof buildQuestionInsertValues>> = [];
      let nextOrder = existingQuestions.length;
      for (const item of validQuestions) {
        const duplicateKey = normalizeQuestionDuplicateKey(
          item.value.question,
          item.value.questionType,
        );
        if (duplicateKey && duplicateKeys.has(duplicateKey)) {
          skippedDuplicateCount += 1;
          continue;
        }
        if (duplicateKey) duplicateKeys.add(duplicateKey);
        values.push(
          buildQuestionInsertValues(
            item.value,
            context,
            nextOrder,
            auth.userId,
          ),
        );
        nextOrder += 1;
      }
      if (values.length === 0) continue;

      const created = await db
        .insert(questionBankQuestionsTable)
        .values(values)
        .returning({ id: questionBankQuestionsTable.id });
      importedCount += created.length;
    }
  }

  res.status(201).json({
    importedCount,
    skippedSubjectCount,
    skippedChapterCount,
    skippedDuplicateCount,
    invalidQuestionCount,
    warnings,
  });
});

router.get("/question-bank/subjects/:subjectId/export", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const subjectId = parseInt(req.params.subjectId, 10);
  if (Number.isNaN(subjectId))
    return res.status(400).json({ error: "Invalid subject id" });

  const context = await getSubjectContext(subjectId);
  if (!context) return res.status(404).json({ error: "Subject not found" });
  if (!canManageQuestionBank(auth, context.subject, context.cls)) {
    return res
      .status(403)
      .json({
        error: "Only the assigned subject teacher can export this subject",
      });
  }

  const chapters = await db
    .select()
    .from(chaptersTable)
    .where(eq(chaptersTable.subjectId, subjectId))
    .orderBy(chaptersTable.order, chaptersTable.createdAt);

  const chapterIds = chapters.map((chapter) => chapter.id);
  const questions =
    chapterIds.length > 0
      ? await db
          .select()
          .from(questionBankQuestionsTable)
          .where(inArray(questionBankQuestionsTable.chapterId, chapterIds))
          .orderBy(
            questionBankQuestionsTable.order,
            questionBankQuestionsTable.createdAt,
          )
      : [];

  const questionsByChapter = new Map<
    number,
    Array<ReturnType<typeof serializeQuestionTransferPayload>>
  >();
  for (const question of questions) {
    const existing = questionsByChapter.get(question.chapterId) ?? [];
    existing.push(serializeQuestionTransferPayload(question));
    questionsByChapter.set(question.chapterId, existing);
  }

  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    subject: {
      id: context.subject.id,
      title: context.subject.title,
      description: context.subject.description ?? null,
    },
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      description: chapter.description ?? null,
      targetQuestions: chapter.targetQuestions ?? 0,
      questions: questionsByChapter.get(chapter.id) ?? [],
    })),
  });
});

router.post("/question-bank/subjects/:subjectId/import", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const subjectId = parseInt(req.params.subjectId, 10);
  if (Number.isNaN(subjectId))
    return res.status(400).json({ error: "Invalid subject id" });

  const context = await getSubjectContext(subjectId);
  if (!context) return res.status(404).json({ error: "Subject not found" });
  if (!canManageQuestionBank(auth, context.subject, context.cls)) {
    return res
      .status(403)
      .json({
        error: "Only the assigned subject teacher can import into this subject",
      });
  }
  if (!ensureQuestionBankUnlocked(context.cls, res)) return;

  const rawChapters = Array.isArray(req.body?.chapters)
    ? req.body.chapters
    : [];
  if (rawChapters.length === 0) {
    return res
      .status(400)
      .json({ error: "No chapters were found in the import bundle" });
  }

  const chapters = await db
    .select()
    .from(chaptersTable)
    .where(eq(chaptersTable.subjectId, subjectId))
    .orderBy(chaptersTable.order, chaptersTable.createdAt);

  const chapterMap = new Map(
    chapters.map(
      (chapter) => [normalizeTitleKey(chapter.title), chapter] as const,
    ),
  );
  let importedCount = 0;
  let skippedChapterCount = 0;
  let skippedDuplicateCount = 0;
  let invalidQuestionCount = 0;
  const warnings: string[] = [];

  for (const rawChapter of rawChapters) {
    const chapterTitle =
      typeof rawChapter?.title === "string" ? rawChapter.title.trim() : "";
    const chapterKey = normalizeTitleKey(chapterTitle);
    const targetChapter = chapterKey ? chapterMap.get(chapterKey) : undefined;
    if (!targetChapter) {
      skippedChapterCount += 1;
      if (chapterTitle) warnings.push(`Chapter not found: ${chapterTitle}`);
      continue;
    }

    const existingQuestions = await db
      .select({
        id: questionBankQuestionsTable.id,
        question: questionBankQuestionsTable.question,
        questionType: questionBankQuestionsTable.questionType,
      })
      .from(questionBankQuestionsTable)
      .where(eq(questionBankQuestionsTable.chapterId, targetChapter.id));

    const duplicateKeys = new Set(
      existingQuestions
        .map(buildExistingQuestionDuplicateKey)
        .filter((value): value is string => !!value),
    );
    const rawQuestions = Array.isArray(rawChapter?.questions)
      ? rawChapter.questions
      : [];
    const parsedQuestions = rawQuestions.map((item: unknown) =>
      normalizeQuestionPayload(item),
    );
    const validQuestions = parsedQuestions.filter(
      (
        item: NormalizedQuestionPayloadResult,
      ): item is { value: NormalizedQuestionValue } => "value" in item,
    );
    const invalidQuestions = parsedQuestions.filter(
      (item: NormalizedQuestionPayloadResult): item is { error: string } =>
        "error" in item,
    );

    if (invalidQuestions.length > 0 && chapterTitle) {
      warnings.push(
        `Skipped ${invalidQuestions.length} invalid question(s) in ${chapterTitle}`,
      );
    }
    invalidQuestionCount += invalidQuestions.length;
    if (validQuestions.length === 0) continue;

    const values: Array<ReturnType<typeof buildQuestionInsertValues>> = [];
    let nextOrder = existingQuestions.length;
    for (const item of validQuestions) {
      const duplicateKey = normalizeQuestionDuplicateKey(
        item.value.question,
        item.value.questionType,
      );
      if (duplicateKey && duplicateKeys.has(duplicateKey)) {
        skippedDuplicateCount += 1;
        continue;
      }
      if (duplicateKey) duplicateKeys.add(duplicateKey);
      values.push(
        buildQuestionInsertValues(
          item.value,
          {
            chapter: targetChapter,
            subject: context.subject,
            cls: context.cls,
          },
          nextOrder,
          auth.userId,
        ),
      );
      nextOrder += 1;
    }

    if (values.length === 0) continue;
    const created = await db
      .insert(questionBankQuestionsTable)
      .values(values)
      .returning({ id: questionBankQuestionsTable.id });
    importedCount += created.length;
  }

  res.status(201).json({
    importedCount,
    skippedChapterCount,
    skippedDuplicateCount,
    invalidQuestionCount,
    warnings,
  });
});

router.get("/question-bank/chapters/:chapterId/export", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const chapterId = parseInt(req.params.chapterId, 10);
  if (Number.isNaN(chapterId))
    return res.status(400).json({ error: "Invalid chapter id" });

  const context = await getChapterContext(chapterId);
  if (!context) return res.status(404).json({ error: "Chapter not found" });
  if (!canManageQuestionBank(auth, context.subject, context.cls)) {
    return res
      .status(403)
      .json({
        error: "Only the assigned subject teacher can export this chapter",
      });
  }

  const questions = await db
    .select()
    .from(questionBankQuestionsTable)
    .where(eq(questionBankQuestionsTable.chapterId, chapterId))
    .orderBy(
      questionBankQuestionsTable.order,
      questionBankQuestionsTable.createdAt,
    );

  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    exam: context.cls.subject,
    subject: {
      id: context.subject.id,
      title: context.subject.title,
    },
    chapter: {
      id: context.chapter.id,
      title: context.chapter.title,
      description: context.chapter.description ?? null,
      targetQuestions: context.chapter.targetQuestions ?? 0,
    },
    questions: questions.map((question) =>
      serializeQuestionTransferPayload(question),
    ),
  });
});

router.post("/question-bank/chapters/:chapterId/import", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const chapterId = parseInt(req.params.chapterId, 10);
  if (Number.isNaN(chapterId))
    return res.status(400).json({ error: "Invalid chapter id" });

  const context = await getChapterContext(chapterId);
  if (!context) return res.status(404).json({ error: "Chapter not found" });
  if (!canManageQuestionBank(auth, context.subject, context.cls)) {
    return res
      .status(403)
      .json({
        error: "Only the assigned subject teacher can import questions here",
      });
  }
  if (!ensureQuestionBankUnlocked(context.cls, res)) return;

  const rawQuestions = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.questions)
      ? req.body.questions
      : [];

  if (rawQuestions.length === 0) {
    return res.status(400).json({ error: "At least one question is required" });
  }

  const parsedQuestions = rawQuestions.map((item: unknown) =>
    normalizeQuestionPayload(item),
  );
  const firstError = parsedQuestions.find(
    (item: NormalizedQuestionPayloadResult): item is { error: string } =>
      "error" in item,
  );
  if (firstError && "error" in firstError) {
    return res.status(400).json({ error: firstError.error });
  }

  const existingCount = await db
    .select({
      id: questionBankQuestionsTable.id,
      question: questionBankQuestionsTable.question,
      questionType: questionBankQuestionsTable.questionType,
    })
    .from(questionBankQuestionsTable)
    .where(eq(questionBankQuestionsTable.chapterId, chapterId));

  const duplicateKeys = new Set(
    existingCount
      .map(buildExistingQuestionDuplicateKey)
      .filter((value): value is string => !!value),
  );
  const values: Array<ReturnType<typeof buildQuestionInsertValues>> = [];
  let duplicateCount = 0;
  let nextOrder = existingCount.length;

  for (const item of parsedQuestions as Array<{
    value: NormalizedQuestionValue;
  }>) {
    const parsed = item.value;
    const duplicateKey = normalizeQuestionDuplicateKey(
      parsed.question,
      parsed.questionType,
    );
    if (duplicateKey && duplicateKeys.has(duplicateKey)) {
      duplicateCount += 1;
      continue;
    }
    if (duplicateKey) duplicateKeys.add(duplicateKey);
    values.push(
      buildQuestionInsertValues(parsed, context, nextOrder, auth.userId),
    );
    nextOrder += 1;
  }

  const created =
    values.length > 0
      ? await db.insert(questionBankQuestionsTable).values(values).returning()
      : [];
  res.status(201).json({
    createdCount: created.length,
    duplicateCount,
    questions: created,
  });
});

async function getChapterContext(chapterId: number) {
  const [chapter] = await db
    .select()
    .from(chaptersTable)
    .where(eq(chaptersTable.id, chapterId));
  if (!chapter) return null;

  const [subject] = await db
    .select()
    .from(subjectsTable)
    .where(eq(subjectsTable.id, chapter.subjectId));
  if (!subject) return null;

  if (!subject.classId) return null;
  const [cls] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, subject.classId));
  if (!cls) return null;

  return { chapter, subject, cls };
}

async function getSubjectContext(subjectId: number) {
  const [subject] = await db
    .select()
    .from(subjectsTable)
    .where(eq(subjectsTable.id, subjectId));
  if (!subject) return null;

  if (!subject.classId) return null;
  const [cls] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, subject.classId));
  if (!cls) return null;

  return { subject, cls };
}

async function getQuestionContext(questionId: number) {
  const [question] = await db
    .select()
    .from(questionBankQuestionsTable)
    .where(eq(questionBankQuestionsTable.id, questionId));
  if (!question) return null;
  const context = await getChapterContext(question.chapterId);
  if (!context) return null;
  return { question, ...context };
}

function canViewClassQuestionBank(
  auth: Auth,
  cls: QuestionBankClassRow,
  isEnrolled: boolean,
) {
  if (auth.role === "super_admin") return true;
  if (auth.role === "admin") {
    return (
      cls.adminId === auth.userId ||
      (cls.assignedTeacherIds ?? []).includes(auth.userId)
    );
  }
  if (auth.role === "student") return isEnrolled;
  return false;
}

function canManageQuestionBank(
  auth: Auth,
  subject: typeof subjectsTable.$inferSelect,
  cls: QuestionBankClassRow,
) {
  if (auth.role === "super_admin") return true;
  if (auth.role !== "admin") return false;
  const effectiveTeacherId = subject.teacherId ?? null;
  return (
    effectiveTeacherId === auth.userId ||
    (subject.teacherId == null &&
      (cls.assignedTeacherIds ?? []).includes(auth.userId))
  );
}

function canManageQuestionBankStructure(auth: Auth, cls: QuestionBankClassRow) {
  if (auth.role === "super_admin") return true;
  void cls;
  return false;
}

function ensureQuestionBankUnlocked(cls: QuestionBankClassRow, res: any) {
  if (!isQuestionBankLocked(cls)) return true;
  res
    .status(409)
    .json({
      error: "This question bank is locked. Unlock it to make changes.",
    });
  return false;
}

type StructureSyncSubjectInput = {
  title: string;
  chapters: string[];
};

function normalizeStructureSyncSubjects(
  input: unknown,
): StructureSyncSubjectInput[] {
  if (!Array.isArray(input)) return [];

  const merged = new Map<string, StructureSyncSubjectInput>();

  for (const entry of input) {
    const record =
      typeof entry === "object" && entry
        ? (entry as Record<string, unknown>)
        : null;
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    const titleKey = normalizeTitleKey(title);
    if (!titleKey) continue;

    const chapterValues = Array.isArray(record?.chapters)
      ? record.chapters
          .map((chapter) => (typeof chapter === "string" ? chapter.trim() : ""))
          .filter((chapter): chapter is string => Boolean(chapter))
      : [];

    const existing = merged.get(titleKey);
    if (!existing) {
      merged.set(titleKey, {
        title,
        chapters: [...new Set(chapterValues.map((chapter) => chapter.trim()))],
      });
      continue;
    }

    const seenChapters = new Set(
      existing.chapters.map((chapter) => normalizeTitleKey(chapter)),
    );
    for (const chapter of chapterValues) {
      const chapterKey = normalizeTitleKey(chapter);
      if (!chapterKey || seenChapters.has(chapterKey)) continue;
      seenChapters.add(chapterKey);
      existing.chapters.push(chapter);
    }
  }

  return [...merged.values()];
}

async function getClassAccess(
  auth: Auth,
  classId: number,
): Promise<ClassAccessError | ClassAccessSuccess> {
  const [cls] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, classId));
  if (!cls) return { error: "Class not found", status: 404 as const };

  const subjects = await db
    .select()
    .from(subjectsTable)
    .where(eq(subjectsTable.classId, classId))
    .orderBy(subjectsTable.order, subjectsTable.createdAt);

  const isEnrolled = auth.role === "student";

  const isAssignedSubjectTeacher =
    auth.role === "admin" &&
    subjects.some((subject) => subject.teacherId === auth.userId);

  if (
    !canViewClassQuestionBank(auth, cls, isEnrolled) &&
    !isAssignedSubjectTeacher
  ) {
    return { error: "Forbidden", status: 403 as const };
  }

  return { cls, subjects, isEnrolled, isAssignedSubjectTeacher };
}

function normalizeQuestionPayload(body: any): NormalizedQuestionPayloadResult {
  const questionType = normalizeQuestionType(body.questionType);
  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  const explanation =
    typeof body.explanation === "string" && body.explanation.trim()
      ? body.explanation.trim()
      : null;
  const topicTag =
    typeof body.topicTag === "string" && body.topicTag.trim()
      ? body.topicTag.trim()
      : typeof body.topic === "string" && body.topic.trim()
        ? body.topic.trim()
        : null;
  const difficulty =
    typeof body.difficulty === "string" && body.difficulty.trim()
      ? body.difficulty.trim()
      : "medium";
  const points = Number.isFinite(Number(body.points))
    ? Math.max(1, parseInt(String(body.points), 10))
    : 1;
  const imageData =
    typeof body.imageData === "string" && body.imageData.trim()
      ? body.imageData.trim()
      : null;

  const rawOptions = Array.isArray(body.options) ? body.options : [];
  const options = rawOptions
    .map((option: unknown) => String(option ?? "").trim())
    .filter(Boolean);
  const rawOptionImages = Array.isArray(body.optionImages)
    ? body.optionImages
    : [];
  const optionImages = rawOptionImages.map((item: unknown) => {
    const value = typeof item === "string" ? item.trim() : "";
    return value || null;
  });

  const correctAnswer =
    body.correctAnswer === null ||
    body.correctAnswer === undefined ||
    body.correctAnswer === ""
      ? null
      : parseNumericValue(body.correctAnswer);
  const correctAnswerMulti = Array.isArray(body.correctAnswerMulti)
    ? body.correctAnswerMulti
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value >= 0)
    : [];
  const correctAnswerMin =
    body.correctAnswerMin === null ||
    body.correctAnswerMin === undefined ||
    body.correctAnswerMin === ""
      ? null
      : parseNumericValue(body.correctAnswerMin);
  const correctAnswerMax =
    body.correctAnswerMax === null ||
    body.correctAnswerMax === undefined ||
    body.correctAnswerMax === ""
      ? null
      : parseNumericValue(body.correctAnswerMax);

  if (!question) return { error: "Question is required" };

  if (questionType === "mcq") {
    if (options.length < 2) return { error: "MCQ needs at least 2 options" };
    if (
      correctAnswer === null ||
      !Number.isInteger(correctAnswer) ||
      correctAnswer < 0 ||
      correctAnswer >= options.length
    ) {
      return { error: "Valid correct answer is required" };
    }
  }

  if (questionType === "multi") {
    if (options.length < 2)
      return { error: "Multi-select needs at least 2 options" };
    if (
      correctAnswerMulti.length === 0 ||
      correctAnswerMulti.some((idx: number) => idx < 0 || idx >= options.length)
    ) {
      return { error: "Select at least one valid correct option" };
    }
  }

  if (questionType === "integer") {
    const hasExact = Number.isFinite(correctAnswer);
    const hasRange =
      Number.isFinite(correctAnswerMin) &&
      Number.isFinite(correctAnswerMax) &&
      (correctAnswerMin as number) <= (correctAnswerMax as number);
    if (!hasExact && !hasRange) {
      return { error: "Integer answer or range is required" };
    }
  }

  return {
    value: {
      question,
      questionType,
      options,
      optionImages,
      correctAnswer: Number.isFinite(correctAnswer) ? correctAnswer : null,
      correctAnswerMulti,
      correctAnswerMin: Number.isFinite(correctAnswerMin)
        ? correctAnswerMin
        : null,
      correctAnswerMax: Number.isFinite(correctAnswerMax)
        ? correctAnswerMax
        : null,
      explanation,
      topicTag,
      difficulty,
      points,
      imageData,
    } satisfies NormalizedQuestionValue,
  };
}

function buildQuestionInsertValues(
  parsed: NormalizedQuestionValue,
  context: NonNullable<Awaited<ReturnType<typeof getChapterContext>>>,
  order: number,
  createdBy: number,
) {
  return {
    classId: context.cls.id,
    subjectId: context.subject.id,
    chapterId: context.chapter.id,
    question: parsed.question,
    questionType: parsed.questionType,
    options: JSON.stringify(parsed.options),
    optionImages: parsed.optionImages.some(Boolean)
      ? JSON.stringify(parsed.optionImages)
      : null,
    correctAnswer: parsed.correctAnswer,
    correctAnswerMulti:
      parsed.correctAnswerMulti.length > 0
        ? JSON.stringify(parsed.correctAnswerMulti)
        : null,
    correctAnswerMin: parsed.correctAnswerMin,
    correctAnswerMax: parsed.correctAnswerMax,
    answer:
      parsed.questionType === "integer"
        ? String(parsed.correctAnswer ?? parsed.correctAnswerMin ?? "")
        : parsed.questionType === "mcq"
          ? (parsed.options[parsed.correctAnswer ?? 0] ?? null)
          : parsed.correctAnswerMulti
              .map((idx) => parsed.options[idx])
              .filter(Boolean)
              .join(", "),
    explanation: parsed.explanation,
    topicTag: parsed.topicTag,
    difficulty: parsed.difficulty,
    points: parsed.points,
    order,
    imageData: parsed.imageData,
    createdBy,
  };
}

router.get("/question-bank/classes/:classId", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const classId = parseInt(req.params.classId, 10);
  if (Number.isNaN(classId))
    return res.status(400).json({ error: "Invalid class id" });

  const access = await getClassAccess(auth, classId);
  if ("error" in access) {
    const { status, error } = access;
    return res.status(status).json({ error });
  }

  const { cls, subjects } = access;
  const subjectIds = subjects.map((subject) => subject.id);
  const chapters =
    subjectIds.length > 0
      ? await db
          .select()
          .from(chaptersTable)
          .where(inArray(chaptersTable.subjectId, subjectIds))
          .orderBy(chaptersTable.order, chaptersTable.createdAt)
      : [];

  const chapterIds = chapters.map((chapter) => chapter.id);
  const questions =
    chapterIds.length > 0
      ? await db
          .select()
          .from(questionBankQuestionsTable)
          .where(inArray(questionBankQuestionsTable.chapterId, chapterIds))
          .orderBy(
            questionBankQuestionsTable.order,
            questionBankQuestionsTable.createdAt,
          )
      : [];

  const questionIds = questions.map((question) => question.id);
  const studentView = auth.role === "student";
  const reports =
    questionIds.length > 0
      ? studentView
        ? await db
            .select({
              questionId: questionBankReportsTable.questionId,
              status: questionBankReportsTable.status,
            })
            .from(questionBankReportsTable)
            .where(inArray(questionBankReportsTable.questionId, questionIds))
        : await db
            .select()
            .from(questionBankReportsTable)
            .where(inArray(questionBankReportsTable.questionId, questionIds))
            .orderBy(desc(questionBankReportsTable.createdAt))
      : [];

  const savedRows =
    auth.role === "student" && questionIds.length > 0
      ? await db
          .select()
          .from(questionBankSavedQuestionsTable)
          .where(
            and(
              inArray(questionBankSavedQuestionsTable.questionId, questionIds),
              eq(questionBankSavedQuestionsTable.studentId, auth.userId),
            ),
          )
      : [];

  const subjectTeacherIds = [
    ...new Set(
      subjects
        .map((subject) => subject.teacherId ?? cls.adminId)
        .filter((value): value is number => !!value),
    ),
  ];
  const reporterIds = studentView
    ? []
    : [...new Set(reports.map((report: any) => report.reportedBy))];
  const userIds = [...new Set([...subjectTeacherIds, ...reporterIds])];
  const users =
    userIds.length > 0
      ? await db
          .select({
            id: usersTable.id,
            fullName: usersTable.fullName,
            username: usersTable.username,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : [];
  const userMap = new Map(users.map((user) => [user.id, user]));

  const reportsByQuestion = new Map<number, any[]>();
  for (const report of reports) {
    const existing = reportsByQuestion.get(report.questionId) ?? [];
    existing.push(report);
    reportsByQuestion.set(report.questionId, existing);
  }

  const savedQuestionIds = new Set(savedRows.map((row) => row.questionId));

  const serializedQuestions = questions.map((question) => {
    const questionReports = reportsByQuestion.get(question.id) ?? [];
    return {
      ...question,
      options: safeParseArray<string>(question.options, []),
      optionImages: safeParseArray<string | null>(question.optionImages, []),
      correctAnswerMulti: safeParseArray<number>(
        question.correctAnswerMulti,
        [],
      ),
      reports: studentView
        ? []
        : questionReports.map((report) => ({
            id: report.id,
            reportedBy: report.reportedBy,
            reporterName:
              userMap.get(report.reportedBy)?.fullName ??
              userMap.get(report.reportedBy)?.username ??
              "Student",
            reason: report.reason,
            status: report.status,
            createdAt: report.createdAt,
          })),
      reportCount: questionReports.length,
      openReportCount: questionReports.filter(
        (report) => report.status === "open",
      ).length,
      isSaved: savedQuestionIds.has(question.id),
    };
  });

  const questionsByChapter = new Map<number, typeof serializedQuestions>();
  for (const question of serializedQuestions) {
    const existing = questionsByChapter.get(question.chapterId) ?? [];
    existing.push(question);
    questionsByChapter.set(question.chapterId, existing);
  }

  const chaptersBySubject = new Map<
    number,
    Array<
      typeof chaptersTable.$inferSelect & {
        questions: typeof serializedQuestions;
      }
    >
  >();
  for (const chapter of chapters) {
    const existing = chaptersBySubject.get(chapter.subjectId) ?? [];
    existing.push({
      ...chapter,
      questions: questionsByChapter.get(chapter.id) ?? [],
    });
    chaptersBySubject.set(chapter.subjectId, existing);
  }

  const result = subjects.map((subject) => {
    const teacherId = subject.teacherId ?? cls.adminId;
    const teacher = teacherId ? userMap.get(teacherId) : null;
    return {
      ...subject,
      teacherId,
      teacherName: teacher?.fullName ?? null,
      teacherUsername: teacher?.username ?? null,
      chapters: chaptersBySubject.get(subject.id) ?? [],
    };
  });

  const savedBucket = serializedQuestions.filter(
    (question) => question.isSaved,
  );

  res.json({
    class: {
      id: cls.id,
      title: cls.title,
      subject: cls.subject,
      isLocked: isQuestionBankLocked(cls),
    },
    subjects: result,
    savedBucket,
  });
});

router.post(
  "/chapters/:chapterId/question-bank-questions",
  async (req, res) => {
    const auth = getAuth(req, res);
    if (!auth) return;

    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId))
      return res.status(400).json({ error: "Invalid chapter id" });

    const context = await getChapterContext(chapterId);
    if (!context) return res.status(404).json({ error: "Chapter not found" });
    if (!canManageQuestionBank(auth, context.subject, context.cls)) {
      return res
        .status(403)
        .json({ error: "Only the assigned subject teacher can add questions" });
    }
    if (!ensureQuestionBankUnlocked(context.cls, res)) return;

    const parsed = normalizeQuestionPayload(req.body);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const existingCount = await db
      .select({
        id: questionBankQuestionsTable.id,
        question: questionBankQuestionsTable.question,
        questionType: questionBankQuestionsTable.questionType,
      })
      .from(questionBankQuestionsTable)
      .where(eq(questionBankQuestionsTable.chapterId, chapterId));

    const duplicateKey = normalizeQuestionDuplicateKey(
      parsed.value.question,
      parsed.value.questionType,
    );
    const existingKeys = new Set(
      existingCount
        .map(buildExistingQuestionDuplicateKey)
        .filter((value): value is string => !!value),
    );
    if (duplicateKey && existingKeys.has(duplicateKey)) {
      return res
        .status(409)
        .json({
          error: "This question already exists in the selected chapter",
        });
    }

    const [created] = await db
      .insert(questionBankQuestionsTable)
      .values(
        buildQuestionInsertValues(
          parsed.value,
          context,
          existingCount.length,
          auth.userId,
        ),
      )
      .returning();

    res.status(201).json(created);
  },
);

router.post(
  "/chapters/:chapterId/question-bank-questions/bulk",
  async (req, res) => {
    const auth = getAuth(req, res);
    if (!auth) return;

    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId))
      return res.status(400).json({ error: "Invalid chapter id" });

    const context = await getChapterContext(chapterId);
    if (!context) return res.status(404).json({ error: "Chapter not found" });
    if (!canManageQuestionBank(auth, context.subject, context.cls)) {
      return res
        .status(403)
        .json({ error: "Only the assigned subject teacher can add questions" });
    }
    if (!ensureQuestionBankUnlocked(context.cls, res)) return;

    const rawQuestions = Array.isArray(req.body?.questions)
      ? req.body.questions
      : [];
    if (rawQuestions.length === 0)
      return res
        .status(400)
        .json({ error: "At least one question is required" });

    const parsedQuestions = rawQuestions.map((item: unknown) =>
      normalizeQuestionPayload(item),
    );
    const firstError = parsedQuestions.find(
      (item: NormalizedQuestionPayloadResult): item is { error: string } =>
        "error" in item,
    );
    if (firstError && "error" in firstError) {
      return res.status(400).json({ error: firstError.error });
    }

    const existingCount = await db
      .select({
        id: questionBankQuestionsTable.id,
        question: questionBankQuestionsTable.question,
        questionType: questionBankQuestionsTable.questionType,
      })
      .from(questionBankQuestionsTable)
      .where(eq(questionBankQuestionsTable.chapterId, chapterId));

    const duplicateKeys = new Set(
      existingCount
        .map(buildExistingQuestionDuplicateKey)
        .filter((value): value is string => !!value),
    );
    const values: Array<ReturnType<typeof buildQuestionInsertValues>> = [];
    let duplicateCount = 0;
    let nextOrder = existingCount.length;

    for (const item of parsedQuestions as Array<{
      value: NormalizedQuestionValue;
    }>) {
      const parsed = item.value;
      const duplicateKey = normalizeQuestionDuplicateKey(
        parsed.question,
        parsed.questionType,
      );
      if (duplicateKey && duplicateKeys.has(duplicateKey)) {
        duplicateCount += 1;
        continue;
      }
      if (duplicateKey) duplicateKeys.add(duplicateKey);
      values.push(
        buildQuestionInsertValues(parsed, context, nextOrder, auth.userId),
      );
      nextOrder += 1;
    }

    const created =
      values.length > 0
        ? await db.insert(questionBankQuestionsTable).values(values).returning()
        : [];
    res.status(201).json({
      createdCount: created.length,
      duplicateCount,
      questions: created,
    });
  },
);

router.post("/question-bank/classes/:classId/subjects", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const classId = parseInt(req.params.classId, 10);
  if (Number.isNaN(classId))
    return res.status(400).json({ error: "Invalid class id" });

  const [cls] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, classId));
  if (!cls) return res.status(404).json({ error: "Class not found" });
  if (!canManageQuestionBankStructure(auth, cls)) {
    return res
      .status(403)
      .json({ error: "Only super admin can modify this question bank" });
  }
  if (!ensureQuestionBankUnlocked(cls, res)) return;

  const { title, description } = req.body ?? {};
  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "Subject title is required" });
  }

  const existingCount = await db
    .select({ id: subjectsTable.id })
    .from(subjectsTable)
    .where(eq(subjectsTable.classId, classId));

  const [subject] = await db
    .insert(subjectsTable)
    .values({
      classId,
      title: title.trim(),
      description:
        typeof description === "string" && description.trim()
          ? description.trim()
          : null,
      teacherId: cls.adminId,
      order: existingCount.length,
    })
    .returning();

  const [teacher] = await db
    .select({ fullName: usersTable.fullName, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, subject.teacherId!));

  res.status(201).json({
    ...subject,
    teacherName: teacher?.fullName ?? null,
    teacherUsername: teacher?.username ?? null,
    chapters: [],
  });
});

router.post(
  "/question-bank/classes/:classId/structure-sync",
  async (req, res) => {
    const auth = getAuth(req, res);
    if (!auth) return;

    const classId = parseInt(req.params.classId, 10);
    if (Number.isNaN(classId))
      return res.status(400).json({ error: "Invalid class id" });

    const [cls] = await db
      .select()
      .from(classesTable)
      .where(eq(classesTable.id, classId));
    if (!cls) return res.status(404).json({ error: "Class not found" });
    if (!canManageQuestionBankStructure(auth, cls)) {
      return res
        .status(403)
        .json({ error: "Only super admin can modify this question bank" });
    }
    if (!ensureQuestionBankUnlocked(cls, res)) return;

    const parsedSubjects = normalizeStructureSyncSubjects(req.body?.subjects);
    if (parsedSubjects.length === 0) {
      return res
        .status(400)
        .json({ error: "Paste at least one subject with chapters." });
    }

    const result = await db.transaction(async (tx) => {
      const existingSubjects = await tx
        .select({
          id: subjectsTable.id,
          title: subjectsTable.title,
          order: subjectsTable.order,
        })
        .from(subjectsTable)
        .where(eq(subjectsTable.classId, classId));

      const existingSubjectEntries = existingSubjects
        .map((subject) => {
          const key = normalizeTitleKey(subject.title);
          return key ? ([key, subject] as const) : null;
        })
        .filter(
          (
            entry,
          ): entry is readonly [string, (typeof existingSubjects)[number]] =>
            entry !== null,
        );
      const existingSubjectMap = new Map(existingSubjectEntries);

      const newSubjectValues = parsedSubjects
        .filter(
          (subject) =>
            !existingSubjectMap.has(normalizeTitleKey(subject.title)!),
        )
        .map((subject, index) => ({
          classId,
          title: subject.title,
          description: null,
          teacherId: cls.adminId,
          order: existingSubjects.length + index,
        }));

      if (newSubjectValues.length > 0) {
        await tx.insert(subjectsTable).values(newSubjectValues);
      }

      const allSubjects =
        newSubjectValues.length > 0
          ? await tx
              .select({
                id: subjectsTable.id,
                title: subjectsTable.title,
                order: subjectsTable.order,
              })
              .from(subjectsTable)
              .where(eq(subjectsTable.classId, classId))
          : existingSubjects;

      const subjectEntries = allSubjects
        .map((subject) => {
          const key = normalizeTitleKey(subject.title);
          return key ? ([key, subject] as const) : null;
        })
        .filter(
          (entry): entry is readonly [string, (typeof allSubjects)[number]] =>
            entry !== null,
        );
      const subjectMap = new Map(subjectEntries);

      const allSubjectIds = [...subjectMap.values()].map(
        (subject) => subject.id,
      );
      const existingChapters =
        allSubjectIds.length > 0
          ? await tx
              .select({
                subjectId: chaptersTable.subjectId,
                title: chaptersTable.title,
                order: chaptersTable.order,
              })
              .from(chaptersTable)
              .where(inArray(chaptersTable.subjectId, allSubjectIds))
          : [];

      const chapterKeysBySubject = new Map<number, Set<string>>();
      const nextOrderBySubject = new Map<number, number>();

      for (const chapter of existingChapters) {
        const chapterKey = normalizeTitleKey(chapter.title);
        if (!chapterKeysBySubject.has(chapter.subjectId)) {
          chapterKeysBySubject.set(chapter.subjectId, new Set());
        }
        if (chapterKey) {
          chapterKeysBySubject.get(chapter.subjectId)!.add(chapterKey);
        }
        nextOrderBySubject.set(
          chapter.subjectId,
          (nextOrderBySubject.get(chapter.subjectId) ?? 0) + 1,
        );
      }

      for (const subject of allSubjects) {
        if (nextOrderBySubject.has(subject.id)) continue;
        nextOrderBySubject.set(subject.id, 0);
        chapterKeysBySubject.set(subject.id, new Set());
      }

      const chapterValues: Array<typeof chaptersTable.$inferInsert> = [];
      for (const parsedSubject of parsedSubjects) {
        const subjectKey = normalizeTitleKey(parsedSubject.title);
        if (!subjectKey) continue;
        const subject = subjectMap.get(subjectKey);
        if (!subject) continue;

        const chapterKeys =
          chapterKeysBySubject.get(subject.id) ?? new Set<string>();
        let nextOrder = nextOrderBySubject.get(subject.id) ?? 0;

        for (const chapterTitle of parsedSubject.chapters) {
          const chapterKey = normalizeTitleKey(chapterTitle);
          if (!chapterKey || chapterKeys.has(chapterKey)) continue;

          chapterKeys.add(chapterKey);
          chapterValues.push({
            subjectId: subject.id,
            title: chapterTitle,
            description: null,
            targetQuestions: 0,
            order: nextOrder,
          });
          nextOrder += 1;
        }

        chapterKeysBySubject.set(subject.id, chapterKeys);
        nextOrderBySubject.set(subject.id, nextOrder);
      }

      if (chapterValues.length > 0) {
        for (const chunk of chunkValues(chapterValues, 200)) {
          await tx.insert(chaptersTable).values(chunk);
        }
      }

      const firstSubjectKey = normalizeTitleKey(parsedSubjects[0]?.title ?? "");
      const firstSubjectId = firstSubjectKey
        ? (subjectMap.get(firstSubjectKey)?.id ?? null)
        : null;

      return {
        createdSubjects: newSubjectValues.length,
        createdChapters: chapterValues.length,
        firstSubjectId,
      };
    });

    res.status(201).json(result);
  },
);

router.post("/question-bank/subjects/:subjectId/chapters", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const subjectId = parseInt(req.params.subjectId, 10);
  if (Number.isNaN(subjectId))
    return res.status(400).json({ error: "Invalid subject id" });

  const context = await getSubjectContext(subjectId);
  if (!context) return res.status(404).json({ error: "Subject not found" });
  const { cls } = context;
  if (!canManageQuestionBankStructure(auth, cls)) {
    return res
      .status(403)
      .json({ error: "Only super admin can modify this question bank" });
  }
  if (!ensureQuestionBankUnlocked(cls, res)) return;

  const { title, description } = req.body ?? {};
  const targetQuestions = Number(req.body?.targetQuestions ?? 0);
  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "Chapter title is required" });
  }
  if (!Number.isFinite(targetQuestions) || targetQuestions < 0) {
    return res
      .status(400)
      .json({ error: "Target questions must be zero or more" });
  }

  const existingCount = await db
    .select({ id: chaptersTable.id })
    .from(chaptersTable)
    .where(eq(chaptersTable.subjectId, subjectId));

  const [chapter] = await db
    .insert(chaptersTable)
    .values({
      subjectId,
      title: title.trim(),
      description:
        typeof description === "string" && description.trim()
          ? description.trim()
          : null,
      targetQuestions: Math.max(0, Math.round(targetQuestions)),
      order: existingCount.length,
    })
    .returning();

  res.status(201).json({ ...chapter, questions: [] });
});

router.patch("/question-bank/subjects/:subjectId", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const subjectId = parseInt(req.params.subjectId, 10);
  if (Number.isNaN(subjectId))
    return res.status(400).json({ error: "Invalid subject id" });

  const context = await getSubjectContext(subjectId);
  if (!context) return res.status(404).json({ error: "Subject not found" });
  const { cls } = context;
  if (!canManageQuestionBankStructure(auth, cls)) {
    return res
      .status(403)
      .json({ error: "Only super admin can modify this question bank" });
  }
  if (!ensureQuestionBankUnlocked(cls, res)) return;

  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description =
    typeof req.body?.description === "string"
      ? req.body.description.trim()
      : "";
  if (!title) {
    return res.status(400).json({ error: "Subject title is required" });
  }

  const [updatedSubject] = await db
    .update(subjectsTable)
    .set({
      title,
      description: description || null,
    })
    .where(eq(subjectsTable.id, subjectId))
    .returning();

  const [teacher] = updatedSubject.teacherId
    ? await db
        .select({
          fullName: usersTable.fullName,
          username: usersTable.username,
        })
        .from(usersTable)
        .where(eq(usersTable.id, updatedSubject.teacherId))
    : [];

  res.json({
    ...updatedSubject,
    teacherName: teacher?.fullName ?? null,
    teacherUsername: teacher?.username ?? null,
  });
});

router.delete("/question-bank/subjects/:subjectId", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const subjectId = parseInt(req.params.subjectId, 10);
  if (Number.isNaN(subjectId))
    return res.status(400).json({ error: "Invalid subject id" });

  const context = await getSubjectContext(subjectId);
  if (!context) return res.status(404).json({ error: "Subject not found" });
  if (!canManageQuestionBankStructure(auth, context.cls)) {
    return res
      .status(403)
      .json({ error: "Only super admin can modify this question bank" });
  }

  await db.delete(subjectsTable).where(eq(subjectsTable.id, subjectId));
  res.json({ success: true });
});

router.patch("/question-bank/chapters/:chapterId", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const chapterId = parseInt(req.params.chapterId, 10);
  if (Number.isNaN(chapterId))
    return res.status(400).json({ error: "Invalid chapter id" });

  const context = await getChapterContext(chapterId);
  if (!context) return res.status(404).json({ error: "Chapter not found" });
  if (!canManageQuestionBankStructure(auth, context.cls)) {
    return res
      .status(403)
      .json({ error: "Only super admin can update chapter details" });
  }
  if (!ensureQuestionBankUnlocked(context.cls, res)) return;

  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description =
    typeof req.body?.description === "string"
      ? req.body.description.trim()
      : "";
  const rawTargetQuestions = Number(
    req.body?.targetQuestions ?? context.chapter.targetQuestions ?? 0,
  );

  if (!title) {
    return res.status(400).json({ error: "Chapter title is required" });
  }
  if (!Number.isFinite(rawTargetQuestions) || rawTargetQuestions < 0) {
    return res
      .status(400)
      .json({ error: "Target questions must be zero or more" });
  }

  const [updatedChapter] = await db
    .update(chaptersTable)
    .set({
      title,
      description: description || null,
      targetQuestions: Math.max(0, Math.round(rawTargetQuestions)),
    })
    .where(eq(chaptersTable.id, chapterId))
    .returning();

  res.json(updatedChapter);
});

router.delete("/question-bank/chapters/:chapterId", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const chapterId = parseInt(req.params.chapterId, 10);
  if (Number.isNaN(chapterId))
    return res.status(400).json({ error: "Invalid chapter id" });

  const context = await getChapterContext(chapterId);
  if (!context) return res.status(404).json({ error: "Chapter not found" });
  if (!canManageQuestionBankStructure(auth, context.cls)) {
    return res
      .status(403)
      .json({ error: "Only super admin can modify this question bank" });
  }
  if (!ensureQuestionBankUnlocked(context.cls, res)) return;

  await db.delete(chaptersTable).where(eq(chaptersTable.id, chapterId));
  res.json({ success: true });
});

router.patch("/question-bank-questions/:id", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const questionId = parseInt(req.params.id, 10);
  if (Number.isNaN(questionId))
    return res.status(400).json({ error: "Invalid question id" });

  const context = await getQuestionContext(questionId);
  if (!context) return res.status(404).json({ error: "Question not found" });
  if (!canManageQuestionBank(auth, context.subject, context.cls)) {
    return res
      .status(403)
      .json({
        error: "Only the assigned subject teacher can update questions",
      });
  }
  if (!ensureQuestionBankUnlocked(context.cls, res)) return;

  const parsed = normalizeQuestionPayload(req.body);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });

  const [updatedRows, linkedTestQuestionIds] = await Promise.all([
    db
      .update(questionBankQuestionsTable)
      .set({
        question: parsed.value.question,
        questionType: parsed.value.questionType,
        options: JSON.stringify(parsed.value.options),
        optionImages: parsed.value.optionImages.some(Boolean)
          ? JSON.stringify(parsed.value.optionImages)
          : null,
        correctAnswer: parsed.value.correctAnswer,
        correctAnswerMulti:
          parsed.value.correctAnswerMulti.length > 0
            ? JSON.stringify(parsed.value.correctAnswerMulti)
            : null,
        correctAnswerMin: parsed.value.correctAnswerMin,
        correctAnswerMax: parsed.value.correctAnswerMax,
        answer:
          parsed.value.questionType === "integer"
            ? String(
                parsed.value.correctAnswer ?? parsed.value.correctAnswerMin ?? "",
              )
            : parsed.value.questionType === "mcq"
              ? (parsed.value.options[parsed.value.correctAnswer ?? 0] ?? null)
              : parsed.value.correctAnswerMulti
                  .map((idx: number) => parsed.value.options[idx])
                  .filter(Boolean)
                  .join(", "),
        explanation: parsed.value.explanation,
        topicTag: parsed.value.topicTag,
        difficulty: parsed.value.difficulty,
        points: parsed.value.points,
        imageData: parsed.value.imageData,
        updatedAt: new Date(),
      })
      .where(eq(questionBankQuestionsTable.id, questionId))
      .returning(),

    db
      .select({ testId: testQuestionBankLinksTable.testId, testQuestionId: testQuestionBankLinksTable.testQuestionId })
      .from(testQuestionBankLinksTable)
      .where(eq(testQuestionBankLinksTable.questionBankQuestionId, questionId)),
  ]);

  const updated = updatedRows[0];
  if (!updated) return res.status(404).json({ error: "Question not found" });

  const storedQuestion = Object.fromEntries(Object.entries(updated).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]));
  const targets = linkedTestTargets(storedQuestion, linkedTestQuestionIds.map(link => ({ test_id: link.testId, test_question_id: link.testQuestionId })));
  try {
    for (const statement of linkedTestSyncStatements(storedQuestion, Object.keys(req.body), targets)) {
      await executeD1Sql(statement.sql, statement.params);
    }
  } catch (error) {
    console.error("[question-patch] linked test sync error:", error);
    return res.status(503).json({ error: "QBank changes were saved, but linked test updates failed. Save this question again to retry. Reports remain open." });
  }

  const previousProgress = await db
    .select()
    .from(questionBankQuestionProgressTable)
    .where(eq(questionBankQuestionProgressTable.questionId, questionId));
  for (const progress of previousProgress) {
    if (!progress.lastAnswer) continue;
    let submittedAnswer: unknown = progress.lastAnswer;
    try {
      submittedAnswer = JSON.parse(progress.lastAnswer);
    } catch {
      // Older text answers may have been stored without JSON encoding.
    }
    const regraded = isQuestionBankAttemptCorrect(updated, submittedAnswer as QuestionBankAttemptAnswer);
    if (regraded === progress.lastIsCorrect) continue;
    const delta = regraded ? 1 : -1;
    await db
      .update(questionBankQuestionProgressTable)
      .set({
        lastIsCorrect: regraded,
        correctCount: Math.max(0, progress.correctCount + delta),
        incorrectCount: Math.max(0, progress.incorrectCount - delta),
        solvedAt: regraded ? progress.solvedAt ?? progress.lastAttemptedAt ?? new Date() : progress.correctCount + delta <= 0 ? null : progress.solvedAt,
      })
      .where(and(eq(questionBankQuestionProgressTable.id, progress.id), eq(questionBankQuestionProgressTable.lastAnswer, progress.lastAnswer), eq(questionBankQuestionProgressTable.lastIsCorrect, progress.lastIsCorrect), eq(questionBankQuestionProgressTable.lastAttemptedAt, progress.lastAttemptedAt)));
  }

  const resolvedReports = await db
    .update(questionBankReportsTable)
    .set({ status: "resolved", updatedAt: new Date() })
    .where(and(eq(questionBankReportsTable.questionId, questionId), eq(questionBankReportsTable.status, "open")))
    .returning();

  // Notify students only after both QBank and the linked tests have been updated.
  if (resolvedReports.length > 0) {
    void (async () => {
      try {
        const reporterIds = [...new Set(resolvedReports.map((r) => r.reportedBy))];
        const reporters = await db
          .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, reporterIds));

        const questionLabel = `Q${questionId}`;
        const contextTitle = `${context.subject.title} – ${context.chapter.title}`;
        const questionUrl = buildPublicAppUrl(`/question-bank/question/${questionId}`);

        await Promise.all(
          reporters.map(async (reporter) => {
            const studentName = reporter.fullName || reporter.username || "Student";
            await pushNotification({
              userId: reporter.id,
              type: "system",
              title: "A reported question has been updated",
              message: `${questionLabel} in ${contextTitle} was updated by the teacher.`,
              link: questionUrl,
            });
            if (reporter.email) {
              await sendStudentQuestionUpdatedEmail({
                studentName,
                email: reporter.email,
                questionLabel,
                contextTitle,
                actionUrl: questionUrl,
              });
            }
          }),
        );
      } catch (err) {
        console.error("[question-patch] resolved-report notification error:", err);
      }
    })();
  }

  res.json(updated);
});

router.patch("/question-bank-questions/:id/move", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const questionId = parseInt(req.params.id, 10);
  const targetChapterId = Number(req.body?.chapterId);
  if (Number.isNaN(questionId) || !Number.isInteger(questionId)) {
    return res.status(400).json({ error: "Invalid question id" });
  }
  if (!Number.isInteger(targetChapterId) || targetChapterId <= 0) {
    return res
      .status(400)
      .json({ error: "A valid target chapter is required" });
  }

  const currentContext = await getQuestionContext(questionId);
  if (!currentContext)
    return res.status(404).json({ error: "Question not found" });
  if (
    !canManageQuestionBank(auth, currentContext.subject, currentContext.cls)
  ) {
    return res
      .status(403)
      .json({ error: "Only the assigned subject teacher can move questions" });
  }
  if (!ensureQuestionBankUnlocked(currentContext.cls, res)) return;

  const targetContext = await getChapterContext(targetChapterId);
  if (!targetContext)
    return res.status(404).json({ error: "Target chapter not found" });
  if (!canManageQuestionBank(auth, targetContext.subject, targetContext.cls)) {
    return res
      .status(403)
      .json({ error: "You do not have access to the target chapter" });
  }
  if (targetContext.subject.id !== currentContext.subject.id) {
    return res
      .status(400)
      .json({ error: "Question can only be moved within the same subject" });
  }
  if (targetContext.chapter.id === currentContext.chapter.id) {
    return res
      .status(400)
      .json({ error: "Question is already in this chapter" });
  }

  const targetExisting = await db
    .select({
      id: questionBankQuestionsTable.id,
      question: questionBankQuestionsTable.question,
      questionType: questionBankQuestionsTable.questionType,
    })
    .from(questionBankQuestionsTable)
    .where(eq(questionBankQuestionsTable.chapterId, targetChapterId));
  const duplicateKeys = new Set(
    targetExisting
      .map(buildExistingQuestionDuplicateKey)
      .filter((value): value is string => !!value),
  );
  const duplicateKey = normalizeQuestionDuplicateKey(
    currentContext.question.question,
    currentContext.question.questionType === "multi" ||
      currentContext.question.questionType === "integer"
      ? currentContext.question.questionType
      : "mcq",
  );

  if (duplicateKey && duplicateKeys.has(duplicateKey)) {
    return res
      .status(409)
      .json({
        error: "A matching question already exists in the target chapter",
      });
  }

  const [updated] = await db
    .update(questionBankQuestionsTable)
    .set({
      classId: targetContext.cls.id,
      subjectId: targetContext.subject.id,
      chapterId: targetContext.chapter.id,
      order: targetExisting.length,
      updatedAt: new Date(),
    })
    .where(eq(questionBankQuestionsTable.id, questionId))
    .returning();

  res.json(updated);
});

router.delete("/question-bank-questions/:id", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const questionId = parseInt(req.params.id, 10);
  if (Number.isNaN(questionId))
    return res.status(400).json({ error: "Invalid question id" });

  const context = await getQuestionContext(questionId);
  if (!context) return res.status(404).json({ error: "Question not found" });
  if (!canManageQuestionBank(auth, context.subject, context.cls)) {
    return res
      .status(403)
      .json({
        error: "Only the assigned subject teacher can delete questions",
      });
  }
  if (!ensureQuestionBankUnlocked(context.cls, res)) return;

  await db
    .delete(questionBankQuestionsTable)
    .where(eq(questionBankQuestionsTable.id, questionId));
  res.sendStatus(204);
});

router.post("/question-bank-questions/:id/attempt", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student")
    return res
      .status(403)
      .json({ error: "Only students can attempt question bank questions" });
  const [student] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, auth.userId));
  if (!ensureStudentFeatureUnlocked(student, "question-bank", res)) return;

  const questionId = parseInt(req.params.id, 10);
  if (Number.isNaN(questionId))
    return res.status(400).json({ error: "Invalid question id" });

  const context = await getQuestionContext(questionId);
  if (!context) return res.status(404).json({ error: "Question not found" });

  const allowed = await canStudentAccessQuestionBankClass(
    auth.userId,
    context.cls,
  );
  if (!allowed)
    return res
      .status(403)
      .json({
        error: "This question bank is not available for your exam profile",
      });

  const normalizedAnswer = normalizeQuestionBankAttemptAnswer(
    context.question,
    req.body?.answer,
  );
  if ("error" in normalizedAnswer)
    return res.status(400).json({ error: normalizedAnswer.error });

  const now = new Date();
  const isCorrect = isQuestionBankAttemptCorrect(
    context.question,
    normalizedAnswer.value,
  );
  const serializedAnswer = JSON.stringify(normalizedAnswer.value);

  const [existing] = await db
    .select()
    .from(questionBankQuestionProgressTable)
    .where(
      and(
        eq(questionBankQuestionProgressTable.questionId, questionId),
        eq(questionBankQuestionProgressTable.studentId, auth.userId),
      ),
    );

  const [progress] = existing
    ? await db
        .update(questionBankQuestionProgressTable)
        .set({
          attemptCount: existing.attemptCount + 1,
          correctCount: existing.correctCount + (isCorrect ? 1 : 0),
          incorrectCount: existing.incorrectCount + (isCorrect ? 0 : 1),
          lastAnswer: serializedAnswer,
          lastIsCorrect: isCorrect,
          lastAttemptedAt: now,
          solvedAt: existing.solvedAt ?? (isCorrect ? now : null),
        })
        .where(eq(questionBankQuestionProgressTable.id, existing.id))
        .returning()
    : await db
        .insert(questionBankQuestionProgressTable)
        .values({
          questionId,
          studentId: auth.userId,
          classId: context.cls.id,
          subjectId: context.subject.id,
          chapterId: context.chapter.id,
          attemptCount: 1,
          correctCount: isCorrect ? 1 : 0,
          incorrectCount: isCorrect ? 0 : 1,
          lastAnswer: serializedAnswer,
          lastIsCorrect: isCorrect,
          firstAttemptedAt: now,
          lastAttemptedAt: now,
          solvedAt: isCorrect ? now : null,
        })
        .returning();

  res.json({
    isCorrect,
    progress: {
      attemptCount: progress.attemptCount,
      correctCount: progress.correctCount,
      incorrectCount: progress.incorrectCount,
      firstAttemptedAt: progress.firstAttemptedAt,
      lastAttemptedAt: progress.lastAttemptedAt,
      solvedAt: progress.solvedAt,
      lastIsCorrect: progress.lastIsCorrect,
    },
  });
});

router.all("/question-bank-questions/:id/report", async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) return res.sendStatus(405);
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student")
    return res
      .status(403)
      .json({ error: "Only students can report questions" });
  const [student] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, auth.userId));
  if (!ensureStudentFeatureUnlocked(student, "question-bank", res)) return;

  const questionId = parseInt(req.params.id, 10);
  if (Number.isNaN(questionId))
    return res.status(400).json({ error: "Invalid question id" });

  const context = await getQuestionContext(questionId);
  if (!context) return res.status(404).json({ error: "Question not found" });

  const allowed = await canStudentAccessQuestionBankClass(
    auth.userId,
    context.cls,
  );
  if (!allowed)
    return res
      .status(403)
      .json({
        error: "This question bank is not available for your exam profile",
      });

  const teacherId = context.subject.teacherId ?? context.cls.adminId;
  if (!teacherId)
    return res
      .status(400)
      .json({ error: "No teacher assigned for this subject" });

  const existingOpen = await db
    .select({ id: questionBankReportsTable.id })
    .from(questionBankReportsTable)
    .where(
      and(
        eq(questionBankReportsTable.questionId, questionId),
        eq(questionBankReportsTable.reportedBy, auth.userId),
        eq(questionBankReportsTable.status, "open"),
      ),
    ).limit(1);
  if (req.method === "GET") return res.json({ pending: existingOpen.length > 0 });
  if (existingOpen.length > 0)
    return res
      .status(409)
      .json({ error: pendingReportMessage, pending: true });

  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim()
      : "Student reported an issue in this question";

  const now = new Date();
  const inserted = await executeD1Sql(questionBankReportInsert, [questionId, context.cls.id, context.subject.id, context.chapter.id, auth.userId, teacherId, reason, now, now, questionId, auth.userId]);
  if (!inserted.rows.length) return res.status(409).json({ error: pendingReportMessage, pending: true });
  const [report] = await db.select().from(questionBankReportsTable).where(eq(questionBankReportsTable.id, Number(inserted.rows[0].id))).limit(1);

  // Fire-and-forget: notify teacher and acknowledge student
  void (async () => {
    try {
      const [teacher] = await db
        .select({ fullName: usersTable.fullName, username: usersTable.username, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, teacherId));

      const studentName = student.fullName || student.username || "Student";
      const teacherName = teacher?.fullName || teacher?.username || "Teacher";
      const questionLabel = `Q${questionId}`;
      const contextTitle = `${context.subject.title} – ${context.chapter.title}`;
      const questionUrl = buildPublicAppUrl(
        `/question-bank/question/${questionId}`,
      );
      const examKey =
        normalizeExamKey(context.cls.subject) ??
        normalizeExamKey(context.cls.title);
      const reportsUrl = examKey
        ? buildPublicAppUrl(
            `/admin/question-bank/exam/${encodeURIComponent(examKey)}/subject/${context.subject.id}/chapter/${context.chapter.id}?questionId=${questionId}`,
          )
        : buildPublicAppUrl(`/admin/question-bank`);

      // Notify teacher in-app
      await pushNotification({
        userId: teacherId,
        type: "system",
        title: "Question reported by a student",
        message: `${studentName} reported ${questionLabel} in ${contextTitle}: "${reason}"`,
        link: reportsUrl,
      });

      // Email teacher
      if (teacher?.email) {
        await sendTeacherQuestionReportAlertEmail({
          teacherName,
          email: teacher.email,
          studentName,
          questionLabel,
          contextTitle,
          reason,
          actionUrl: reportsUrl,
        });
      }

      // Acknowledge student by email
      if (student.email) {
        await sendStudentQuestionReportAcknowledgementEmail({
          studentName,
          email: student.email,
          questionLabel,
          contextTitle,
          reason,
          actionUrl: questionUrl,
        });
      }
    } catch (err) {
      console.error("[report] post-create notification error:", err);
    }
  })();

  res.status(201).json(report);
});

router.post("/question-bank-questions/:id/save", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "student")
    return res.status(403).json({ error: "Only students can save questions" });

  const questionId = parseInt(req.params.id, 10);
  if (Number.isNaN(questionId))
    return res.status(400).json({ error: "Invalid question id" });

  const [[student], context] = await Promise.all([
    db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, auth.userId)),
    getQuestionContext(questionId),
  ]);
  if (!ensureStudentFeatureUnlocked(student, "question-bank", res)) return;
  if (!context) return res.status(404).json({ error: "Question not found" });

  const knownExamKeys = new Set(
    [student?.subject, ...(student?.additionalExams ?? [])]
      .map(normalizeExamKey)
      .filter((key): key is string => Boolean(key)),
  );
  const allowed = await canStudentAccessQuestionBankClass(
    auth.userId,
    context.cls,
    knownExamKeys,
  );
  if (!allowed)
    return res
      .status(403)
      .json({
        error: "This question bank is not available for your exam profile",
      });

  const [existing] = await db
    .select()
    .from(questionBankSavedQuestionsTable)
    .where(
      and(
        eq(questionBankSavedQuestionsTable.questionId, questionId),
        eq(questionBankSavedQuestionsTable.studentId, auth.userId),
      ),
    );

  if (existing) {
    await db
      .delete(questionBankSavedQuestionsTable)
      .where(eq(questionBankSavedQuestionsTable.id, existing.id));
    return res.json({ saved: false });
  }

  await db
    .insert(questionBankSavedQuestionsTable)
    .values({ questionId, studentId: auth.userId });
  res.json({ saved: true });
});

router.get("/question-bank/reports", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin"].includes(auth.role))
    return res.status(403).json({ error: "Forbidden" });

  const page = questionBankPage(req.query);
  if (!page) return res.status(400).json({ error: "Invalid report cursor" });
  const reportQuery = db.select().from(questionBankReportsTable).where(and(
    eq(questionBankReportsTable.status, "open"),
    auth.role === "super_admin" ? undefined : eq(questionBankReportsTable.teacherId, auth.userId),
    page.enabled && page.cursor ? sql`(${questionBankReportsTable.createdAt}, ${questionBankReportsTable.id}) < (${page.cursor.createdAt}, ${page.cursor.id})` : undefined,
  )).orderBy(desc(questionBankReportsTable.createdAt), desc(questionBankReportsTable.id));
  const reportRows: Array<typeof questionBankReportsTable.$inferSelect> = await (page.enabled ? reportQuery.limit(page.limit + 1) : reportQuery);
  const hasMore = page.enabled && reportRows.length > page.limit;
  const reports = page.enabled ? reportRows.slice(0, page.limit) : reportRows;

  const questionIds = reports.map((report) => report.questionId);
  const reporterIds = reports.map((report) => report.reportedBy);
  const [questions, reporters] = await Promise.all([
    questionIds.length > 0
      ? db
          .select({ id: questionBankQuestionsTable.id, question: questionBankQuestionsTable.question })
          .from(questionBankQuestionsTable)
          .where(sql`${questionBankQuestionsTable.id} IN (SELECT value FROM json_each(${JSON.stringify(questionIds)}))`)
      : Promise.resolve<Array<{ id: number; question: string }>>(
          [],
        ),
    reporterIds.length > 0
      ? db
          .select({
            id: usersTable.id,
            fullName: usersTable.fullName,
            username: usersTable.username,
          })
          .from(usersTable)
          .where(sql`${usersTable.id} IN (SELECT value FROM json_each(${JSON.stringify(reporterIds)}))`)
      : Promise.resolve<
          Array<{ id: number; fullName: string; username: string }>
        >([]),
  ]);

  const questionMap = new Map<
    number,
    { id: number; question: string }
  >(
    questions.map(
      (question: { id: number; question: string }): [number, { id: number; question: string }] => [
        question.id,
        question,
      ],
    ),
  );
  const reporterMap = new Map<
    number,
    { id: number; fullName: string; username: string }
  >(
    reporters.map(
      (
        reporter: { id: number; fullName: string; username: string },
      ): [number, { id: number; fullName: string; username: string }] => [
        reporter.id,
        reporter,
      ],
    ),
  );

  const items = reports.map((report) => ({
      ...report,
      questionText: questionMap.get(report.questionId)?.question ?? "",
      reporterName:
        reporterMap.get(report.reportedBy)?.fullName ??
        reporterMap.get(report.reportedBy)?.username ??
        "Student",
    }));
  const last = reports.at(-1);
  res.json(page.enabled ? { reports: items, nextCursor: hasMore && last ? `${last.createdAt.getTime()}:${last.id}` : null } : items);
});

// Teacher rejects an open report → notify + email student
router.patch("/question-bank/reports/:id/reject", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["admin", "super_admin"].includes(auth.role))
    return res.status(403).json({ error: "Forbidden" });

  const reportId = parseInt(req.params.id, 10);
  if (Number.isNaN(reportId))
    return res.status(400).json({ error: "Invalid report id" });

  const [report] = await db
    .select()
    .from(questionBankReportsTable)
    .where(eq(questionBankReportsTable.id, reportId))
    .limit(1);

  if (!report) return res.status(404).json({ error: "Report not found" });
  if (report.status !== "open")
    return res.status(409).json({ error: "Report is already closed" });

  // Only the assigned teacher or super_admin can reject
  if (auth.role !== "super_admin" && report.teacherId !== auth.userId)
    return res.status(403).json({ error: "You are not assigned to this report" });

  const [updated] = await db
    .update(questionBankReportsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(questionBankReportsTable.id, reportId))
    .returning();

  // Fire-and-forget: notify + email the student
  void (async () => {
    try {
      const [context, student] = await Promise.all([
        getQuestionContext(report.questionId),
        db
          .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, report.reportedBy))
          .limit(1)
          .then((rows) => rows[0]),
      ]);

      if (!context || !student) return;

      const studentName = student.fullName || student.username || "Student";
      const questionLabel = `Q${report.questionId}`;
      const contextTitle = `${context.subject.title} – ${context.chapter.title}`;
      const questionUrl = buildPublicAppUrl(`/question-bank/question/${report.questionId}`);

      await pushNotification({
        userId: student.id,
        type: "system",
        title: "Your question report was reviewed",
        message: `Your report for ${questionLabel} in ${contextTitle} was reviewed and rejected by the teacher.`,
        link: questionUrl,
      });

      if (student.email) {
        await sendStudentQuestionReportRejectedEmail({
          studentName,
          email: student.email,
          questionLabel,
          contextTitle,
          actionUrl: questionUrl,
        });
      }
    } catch (err) {
      console.error("[report-reject] notification error:", err);
    }
  })();

  res.json(updated);
});

export { router as questionBankRouter };
