import { Router } from "express";
import { pendingReportMessage, testReportInsert } from "../lib/pending-question-report";
import { getSignedUserId, getSignedUserIdOrThrow } from "../lib/authUtils";
import {
  db,
  executeD1Sql,
  testsTable,
  testQuestionsTable,
  testQuestionBankLinksTable,
  testQuestionReportsTable,
  testSectionsTable,
  testSubmissionsTable,
  examTemplatesTable,
  usersTable,
  classesTable,
  chaptersTable,
  subjectsTable,
  questionBankQuestionsTable,
} from "@workspace/db";
import {
  hasBrevoAccounts,
  queueStudentQuestionReportAcknowledgementEmail,
  queueStudentQuestionReportRejectedEmail,
  queueStudentQuestionUpdatedEmail,
  queueStudentTestResultEmail,
  queueTeacherQuestionReportAlertEmail,
} from "../lib/brevo";
import { logger } from "../lib/logger";
import { pushNotificationToMany } from "../lib/pushNotification";
import { ensureStudentFeatureUnlocked } from "../lib/studentFeatureAccess";
import {
  extractNumericAnswerFromSolution,
  extractNumericRange,
  parseNumericValue,
} from "../lib/numericAnswers";
import { eq, and, inArray, isNull, or, asc, desc, sql } from "drizzle-orm";

const router = Router();

function toISOStringSafe(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function requireAuth(req: any, res: any, next: any) {
  if (!getSignedUserIdOrThrow(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function getUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

function hasDistinctIntegerRange(minValue: unknown, maxValue: unknown) {
  return minValue !== null &&
    minValue !== undefined &&
    maxValue !== null &&
    maxValue !== undefined &&
    Number(minValue) !== Number(maxValue);
}

function normalizeSerializedIntegerAnswer(question: any) {
  const correctAnswerMin =
    question.correctAnswerMin === null || question.correctAnswerMin === undefined
      ? null
      : Number(question.correctAnswerMin);
  const correctAnswerMax =
    question.correctAnswerMax === null || question.correctAnswerMax === undefined
      ? null
      : Number(question.correctAnswerMax);

  if (hasDistinctIntegerRange(correctAnswerMin, correctAnswerMax)) {
    return {
      correctAnswer: null,
      correctAnswerMin,
      correctAnswerMax,
    };
  }

  const exactAnswer =
    correctAnswerMin ??
    correctAnswerMax ??
    (question.correctAnswer === null || question.correctAnswer === undefined
      ? null
      : Number(question.correctAnswer));

  return {
    correctAnswer: exactAnswer,
    correctAnswerMin: null,
    correctAnswerMax: null,
  };
}

function gradeQuestion(q: any, answer: any): boolean {
  const meta = safeParseJson<Record<string, unknown> | null>(q.meta, null);
  if (meta?.needsCorrectAnswer === true || meta?.needsCorrectAnswer === "true") return false;
  const qType = q.questionType ?? "mcq";
  if (qType === "multi") {
    const correct: number[] = q.correctAnswerMulti ? JSON.parse(q.correctAnswerMulti) : [];
    const selected: number[] = Array.isArray(answer) ? [...answer].sort((a, b) => a - b) : [];
    return JSON.stringify(selected) === JSON.stringify([...correct].sort((a, b) => a - b));
  }
  if (qType === "integer") {
    if (answer === undefined || answer === null) return false;
    const num = Number(answer);
    if (hasDistinctIntegerRange(q.correctAnswerMin, q.correctAnswerMax)) {
      return num >= Number(q.correctAnswerMin) && num <= Number(q.correctAnswerMax);
    }
    const exactTarget = q.correctAnswerMin ?? q.correctAnswerMax ?? q.correctAnswer;
    return Math.abs(num - Number(exactTarget)) < 1e-9;
  }
  // mcq
  return answer !== undefined && answer !== null && Number(answer) === q.correctAnswer;
}

function hasAnsweredQuestion(q: any, answer: any): boolean {
  const qType = q.questionType ?? "mcq";
  if (qType === "multi") return Array.isArray(answer) && answer.length > 0;
  return answer !== undefined && answer !== null && answer !== "";
}

function normalizeExamKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const compact = raw.replace(/[^a-z0-9]+/g, " ").trim();
  if (compact.includes("jam chemistry") || compact.includes("iit jam chemistry")) return "jam-chemistry";
  if (compact.includes("iit jam")) return "iit-jam";
  if (compact.includes("jee main")) return "jee";
  if (compact === "jee") return "jee";
  if (compact.includes("gate")) return "gate";
  if (compact.includes("cuet")) return "cuet";
  if (compact.includes("neet")) return "neet";
  if (compact.includes("cat")) return "cat";
  return compact.replace(/\s+/g, "-");
}

function getStudentExamKeys(user: { subject?: string | null; additionalExams?: unknown[] | null }) {
  const examKeys = new Set<string>();
  const primaryExamKey = normalizeExamKey(user.subject);
  if (primaryExamKey) examKeys.add(primaryExamKey);
  for (const exam of user.additionalExams ?? []) {
    const key = normalizeExamKey(exam);
    if (key) examKeys.add(key);
  }
  return examKeys;
}

async function getStudentEnrolledClassIds(_userId: number) {
  return new Set<number>();
}

function canStudentAccessTest(
  test: { classId?: number | null; examType?: unknown },
  access: { enrolledClassIds: Set<number>; examKeys: Set<string> },
) {
  const examKey = normalizeExamKey(test.examType);
  return examKey ? access.examKeys.has(examKey) : false;
}

function getPortalUrl() {
  return typeof process.env.PUBLIC_APP_URL === "string" && process.env.PUBLIC_APP_URL.trim()
    ? process.env.PUBLIC_APP_URL.trim()
    : "http://localhost:5173";
}

function buildPortalUrl(path: string) {
  try {
    return new URL(path, getPortalUrl()).toString();
  } catch {
    return getPortalUrl();
  }
}

function getDisplayName(user: { fullName?: string | null; username?: string | null } | null | undefined, fallback: string) {
  if (typeof user?.fullName === "string" && user.fullName.trim()) return user.fullName.trim();
  if (typeof user?.username === "string" && user.username.trim()) return user.username.trim();
  return fallback;
}

type StudentRecipient = {
  id: number;
  email: string | null;
  fullName: string | null;
  username: string | null;
  subject: string | null;
  additionalExams: string[] | null;
};

async function getEligibleStudentRecipientsForTest(test: { classId?: number | null; examType?: unknown }) {
  const students = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      username: usersTable.username,
      subject: usersTable.subject,
      additionalExams: usersTable.additionalExams,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "student"));

  return students.filter((student) =>
    canStudentAccessTest(test, {
      enrolledClassIds: new Set<number>(),
      examKeys: getStudentExamKeys(student),
    }),
  ) as StudentRecipient[];
}

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeArrayValue<T = unknown>(value: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(value)) return value as T[];
  return safeParseJson(value, fallback);
}

function normalizeObjectValue<T extends Record<string, unknown> | null>(value: unknown, fallback: T): T {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  return safeParseJson(value, fallback);
}

function normalizeSectionLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTitleKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized || null;
}

function firstTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

type SubmissionResultEmailSubjectBreakdown = {
  label: string;
  totalQuestions: number;
  attemptedQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  unattemptedQuestions: number;
  accuracyPct: number;
};

function buildSubmissionResultEmailSummary(params: {
  testTitle: string;
  questions: Array<typeof testQuestionsTable.$inferSelect>;
  sections: Array<typeof testSectionsTable.$inferSelect>;
  answers: Record<string, unknown> | null | undefined;
  questionTimings: Record<string, number> | null | undefined;
}) {
  const sectionsById = new Map(params.sections.map((section) => [section.id, section] as const));
  const answers = params.answers ?? {};
  const timings = params.questionTimings ?? {};
  const subjectStats = new Map<string, Omit<SubmissionResultEmailSubjectBreakdown, "accuracyPct">>();

  let totalQuestions = 0;
  let attemptedQuestions = 0;
  let correctQuestions = 0;
  let incorrectQuestions = 0;
  let unattemptedQuestions = 0;

  for (const question of params.questions) {
    totalQuestions += 1;
    const answer = answers[String(question.id)];
    const attempted = hasAnsweredQuestion(question, answer);
    const correct = attempted ? gradeQuestion(question, answer) : false;
    const section = question.sectionId ? sectionsById.get(question.sectionId) ?? null : null;
    const subjectLabel = firstTrimmedString(
      question.subjectLabel,
      section?.subjectLabel,
      section?.title,
      params.testTitle,
    ) ?? "General";

    const current = subjectStats.get(subjectLabel) ?? {
      label: subjectLabel,
      totalQuestions: 0,
      attemptedQuestions: 0,
      correctQuestions: 0,
      incorrectQuestions: 0,
      unattemptedQuestions: 0,
    };

    current.totalQuestions += 1;

    if (attempted) {
      attemptedQuestions += 1;
      current.attemptedQuestions += 1;

      if (correct) {
        correctQuestions += 1;
        current.correctQuestions += 1;
      } else {
        incorrectQuestions += 1;
        current.incorrectQuestions += 1;
      }
    } else {
      unattemptedQuestions += 1;
      current.unattemptedQuestions += 1;
    }

    subjectStats.set(subjectLabel, current);
  }

  let timeSpentSeconds = 0;
  for (const value of Object.values(timings)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      timeSpentSeconds += numeric;
    }
  }

  const subjectBreakdown = Array.from(subjectStats.values())
    .map((entry) => ({
      ...entry,
      accuracyPct: entry.totalQuestions > 0
        ? Number(((entry.correctQuestions / entry.totalQuestions) * 100).toFixed(2))
        : 0,
    }))
    .sort((left, right) => right.totalQuestions - left.totalQuestions || left.label.localeCompare(right.label));

  return {
    totalQuestions,
    attemptedQuestions,
    correctQuestions,
    incorrectQuestions,
    unattemptedQuestions,
    timeSpentSeconds: Math.round(timeSpentSeconds),
    subjectBreakdown,
  };
}

function normalizeImportedQuestionCodeKey(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const compact = String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (!compact) return null;
  return compact.replace(/\d+/g, (digits) => {
    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? String(parsed) : digits;
  });
}

function extractImportedQuestionCodeNumber(value: unknown): number | null {
  const normalized = normalizeImportedQuestionCodeKey(value);
  if (!normalized) return null;
  const match = normalized.match(/(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldPreserveImportedSections(value: unknown) {
  const config = normalizeObjectValue<Record<string, unknown> | null>(value, null);
  return Boolean(config?.importedFromHtml || config?.preserveImportedSections);
}

function isImportedMarksTag(value: string) {
  return /[+-]?\d+(?:\.\d+)?\s*\/\s*[+-]?\d+(?:\.\d+)?/.test(value);
}

function isImportedDifficultyTag(value: string) {
  const normalized = value.trim().toLowerCase();
  return [
    "easy",
    "moderate",
    "medium",
    "tough",
    "hard",
    "expert",
    "advanced",
  ].some((token) => normalized.includes(token));
}

function normalizeTestDifficultyValue(value: unknown): "easy" | "moderate" | "tough" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "easy") return "easy";
  if (normalized === "moderate" || normalized === "medium") return "moderate";
  if (normalized === "tough" || normalized === "hard" || normalized === "advanced" || normalized === "expert") return "tough";
  return null;
}

function normalizeImportedQuestionType(value: unknown): "mcq" | "multi" | "integer" {
  if (typeof value !== "string") return "mcq";
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return "mcq";
  if (normalized === "msq" || normalized.includes("multi") || normalized.includes("multiple")) return "multi";
  if (normalized === "nat" || normalized.includes("integer") || normalized.includes("numeric") || normalized.includes("numerical")) return "integer";
  return "mcq";
}

function parseImportedNumericValue(value: unknown): number | null {
  return parseNumericValue(value);
}

function parseImportedOptionIndex(value: unknown, optionCount: number): number | null {
  if (optionCount <= 0) return null;
  const numeric = parseImportedNumericValue(value);
  if (numeric !== null && Number.isInteger(numeric)) {
    if (numeric >= 0 && numeric < optionCount) return numeric;
    if (numeric >= 1 && numeric <= optionCount) return numeric - 1;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  if (/^[A-Z]$/.test(trimmed)) {
    const index = trimmed.charCodeAt(0) - 65;
    return index >= 0 && index < optionCount ? index : null;
  }
  return null;
}

function normalizeImportedAnswerIndices(value: unknown, optionCount: number): number[] {
  if (optionCount <= 0 || value === undefined || value === null) return [];
  const rawParts = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (/^[A-Za-z]+$/.test(value.trim())
          ? value.trim().split("")
          : value.split(/[\s,;|/]+/).filter(Boolean))
      : [value];
  const seen = new Set<number>();
  rawParts.forEach((part) => {
    const index = parseImportedOptionIndex(part, optionCount);
    if (index !== null) seen.add(index);
  });
  return Array.from(seen).sort((left, right) => left - right);
}

function extractImportedNumericRange(value: unknown): { min: number | null; max: number | null } {
  return extractNumericRange(value);
}

const IGNORED_IMPORTED_TAXONOMY_KEYS = new Set([
  "aerospace engineering",
  "agricultural engineering",
  "biotechnology engineering",
  "bt",
  "chemical engineering",
  "ch",
  "civil engineering",
  "ce",
  "computer science and engineering",
  "computer science engineering",
  "cse",
  "cs",
  "electrical engineering",
  "ee",
  "ec",
  "ece",
  "electronics and communication engineering",
  "electronics engineering",
  "engineering sciences",
  "es",
  "it",
  "instrumentation engineering",
  "ie",
  "mechanical engineering",
  "me",
  "metallurgical engineering",
  "mt",
  "production engineering",
  "pe",
]);

function sanitizeImportedTaxonomyValue(value: unknown, sectionLabel?: string | null) {
  const sanitized = sanitizeExplicitTaxonomyValue(value);
  const normalized = normalizeTitleKey(sanitized);
  const normalizedSection = normalizeTitleKey(sectionLabel);
  if (!normalized) return null;
  if (IGNORED_IMPORTED_TAXONOMY_KEYS.has(normalized)) return null;
  if (normalizedSection && normalized === normalizedSection) return null;
  return sanitized;
}

function sanitizeExplicitTaxonomyValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const normalized = normalizeTitleKey(trimmed);
  if (!normalized) return null;
  if (isImportedMarksTag(trimmed)) return null;
  if (isImportedDifficultyTag(trimmed)) return null;
  return trimmed;
}

function inferImportedTaxonomy(meta: Record<string, unknown> | null, sectionLabel?: string | null) {
  const importedTags = Array.isArray(meta?.importedTags)
    ? meta.importedTags
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  const candidates = importedTags
    .map((tag) => sanitizeImportedTaxonomyValue(tag, sectionLabel))
    .filter((value): value is string => Boolean(value));

  return {
    subjectName: candidates[0] ?? null,
    chapterName: candidates[1] ?? null,
  };
}

function normalizeResolvedTaxonomy({
  subjectName,
  chapterName,
  topicTag,
}: {
  subjectName: string | null;
  chapterName: string | null;
  topicTag?: string | null;
}) {
  return {
    subjectName,
    chapterName: chapterName ?? topicTag ?? null,
  };
}

function resolveStoredQuestionTaxonomy(meta: Record<string, unknown> | null, sectionLabel?: string | null) {
  const inferredTaxonomy = inferImportedTaxonomy(meta, sectionLabel);
  const readValue = (value: unknown) => sanitizeExplicitTaxonomyValue(value);

  return normalizeResolvedTaxonomy({
    subjectName: readValue(meta?.subjectName) ?? readValue(meta?.subject) ?? inferredTaxonomy.subjectName,
    chapterName: readValue(meta?.chapterName) ?? readValue(meta?.chapter) ?? inferredTaxonomy.chapterName,
    topicTag: readValue(meta?.topicTag) ?? readValue(meta?.topicName) ?? readValue(meta?.topic),
  });
}

function normalizeQuestionBankDifficulty(value: unknown): "easy" | "medium" | "hard" {
  if (typeof value !== "string") return "medium";
  const normalized = value.trim().toLowerCase();
  if (normalized === "easy") return "easy";
  if (normalized === "tough" || normalized === "hard") return "hard";
  return "medium";
}

function normalizeQuestionDuplicateKey(question: string, questionType: "mcq" | "multi" | "integer") {
  const normalizedQuestion = question.trim().toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalizedQuestion) return null;
  return `${questionType}:${normalizedQuestion}`;
}

type QuestionBankPublishSyncSummary = {
  linkedCount: number;
  createdQuestionBankClassCount: number;
  createdSubjectCount: number;
  createdChapterCount: number;
  skippedNoSubjectCount: number;
  skippedNoQuestionBankClassCount: number;
  skippedInvalidQuestionCount: number;
  skippedDuplicateCount: number;
  duplicateQuestions: Array<{
    questionId: number;
    questionNo: string;
  }>;
  reviewQuestions: Array<{
    questionId: number;
    questionNo: string;
    reason: string;
    subjectName: string | null;
    chapterName: string | null;
  }>;
  warnings: string[];
};

type QuestionBankUnpublishCleanupSummary = {
  detachedCount: number;
  removedQuestionCount: number;
  removedChapterCount: number;
  removedSubjectCount: number;
  reviewBucketCleared: boolean;
  warnings: string[];
};

type ResolvedQuestionBankContext = {
  targetClass: typeof classesTable.$inferSelect | null;
  createdQuestionBankClassCount: number;
};

type QuestionBankSectionLookup = Map<number, typeof testSectionsTable.$inferSelect>;
type QuestionBankSubjectsByKey = Map<string, typeof subjectsTable.$inferSelect>;
type QuestionBankChaptersBySubjectId = Map<number, Array<typeof chaptersTable.$inferSelect>>;

type ResolvedQuestionBankTaxonomy = {
  subjectLabel: string;
  subjectKey: string;
  chapterTitle: string;
  chapterKey: string;
};

type QuestionBankTaxonomyCatalog = {
  targetClass: typeof classesTable.$inferSelect;
  subjects: Array<typeof subjectsTable.$inferSelect>;
  subjectsByKey: QuestionBankSubjectsByKey;
  chaptersBySubjectId: QuestionBankChaptersBySubjectId;
};

type QuestionBankTitleMatch<T> = {
  item: T;
  exact: boolean;
  reason: "exact" | "compact" | "fuzzy" | "single" | "fallback";
  score: number;
};

function buildQuestionBankSectionLookup(sections: Array<typeof testSectionsTable.$inferSelect>): QuestionBankSectionLookup {
  return new Map(sections.map((section) => [section.id, section] as const));
}

function buildQuestionBankSubjectsByKey(subjects: Array<typeof subjectsTable.$inferSelect>): QuestionBankSubjectsByKey {
  return new Map(
    subjects
      .map((subject) => {
        const key = normalizeTitleKey(subject.title);
        return key ? [key, subject] as const : null;
      })
      .filter((item): item is readonly [string, typeof subjectsTable.$inferSelect] => Boolean(item)),
  );
}

function buildQuestionBankChaptersBySubjectId(chapters: Array<typeof chaptersTable.$inferSelect>): QuestionBankChaptersBySubjectId {
  const chaptersBySubjectId = new Map<number, Array<typeof chaptersTable.$inferSelect>>();
  chapters.forEach((chapter) => {
    const current = chaptersBySubjectId.get(chapter.subjectId) ?? [];
    current.push(chapter);
    chaptersBySubjectId.set(chapter.subjectId, current);
  });
  return chaptersBySubjectId;
}

function compactTitleKey(value: string | null | undefined) {
  return value?.replace(/\s+/g, "") || "";
}

function titleKeyTokens(value: string | null | undefined) {
  return (value ?? "").split(/\s+/).filter(Boolean);
}

function titleKeyAcronym(value: string | null | undefined) {
  return titleKeyTokens(value).map((token) => token[0]).join("");
}

function titleMatchScore(leftKey: string | null | undefined, rightKey: string | null | undefined) {
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 1;
  const leftCompact = compactTitleKey(leftKey);
  const rightCompact = compactTitleKey(rightKey);
  if (leftCompact && leftCompact === rightCompact) return 0.98;
  if (leftCompact && (leftCompact === titleKeyAcronym(rightKey) || rightCompact === titleKeyAcronym(leftKey))) return 0.92;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return 0.86;

  const leftTokens = new Set(titleKeyTokens(leftKey));
  const rightTokens = new Set(titleKeyTokens(rightKey));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function findBestQuestionBankTitleMatch<T>(
  requestedKey: string | null | undefined,
  items: T[],
  getTitle: (item: T) => string,
  allowFallback: boolean,
): QuestionBankTitleMatch<T> | null {
  const normalizedRequestedKey = requestedKey ?? "";
  if (normalizedRequestedKey) {
    let best: { item: T; score: number; reason: QuestionBankTitleMatch<T>["reason"] } | null = null;
    for (const item of items) {
      const candidateKey = normalizeTitleKey(getTitle(item));
      const score = titleMatchScore(normalizedRequestedKey, candidateKey);
      if (score <= 0) continue;
      const reason: QuestionBankTitleMatch<T>["reason"] =
        score >= 1 ? "exact" : score >= 0.98 ? "compact" : "fuzzy";
      if (!best || score > best.score) best = { item, score, reason };
    }
    if (best && best.score >= 0.72) {
      return { item: best.item, exact: best.reason === "exact", reason: best.reason, score: best.score };
    }
  }

  if (allowFallback && items.length === 1) {
    return { item: items[0]!, exact: false, reason: "single", score: 0.55 };
  }
  if (allowFallback && items.length > 0) {
    return { item: items[0]!, exact: false, reason: "fallback", score: 0.1 };
  }
  return null;
}

function findQuestionBankSubjectForTaxonomy(
  subjectKey: string | null | undefined,
  subjectsByKey: QuestionBankSubjectsByKey,
  subjects: Array<typeof subjectsTable.$inferSelect>,
  allowFallback: boolean,
) {
  const exactSubject = subjectKey ? subjectsByKey.get(subjectKey) ?? null : null;
  if (exactSubject) return { item: exactSubject, exact: true, reason: "exact" as const, score: 1 };
  return findBestQuestionBankTitleMatch(subjectKey, subjects, (subject) => subject.title, allowFallback);
}

function findBestQuestionBankChapterPair(
  chapterKey: string | null | undefined,
  catalog: Pick<QuestionBankTaxonomyCatalog, "subjects" | "chaptersBySubjectId">,
) {
  if (!chapterKey) return null;
  let best: {
    subject: typeof subjectsTable.$inferSelect;
    chapterMatch: QuestionBankTitleMatch<typeof chaptersTable.$inferSelect>;
  } | null = null;
  for (const subject of catalog.subjects) {
    const chapters = catalog.chaptersBySubjectId.get(subject.id) ?? [];
    const chapterMatch = findBestQuestionBankTitleMatch(chapterKey, chapters, (chapter) => chapter.title, false);
    if (!chapterMatch) continue;
    if (!best || chapterMatch.score > best.chapterMatch.score) {
      best = { subject, chapterMatch };
    }
  }
  return best;
}

function resolveQuestionBankTaxonomyForTestQuestion(
  question: typeof testQuestionsTable.$inferSelect,
  sectionById: QuestionBankSectionLookup,
): ResolvedQuestionBankTaxonomy | null {
  const section = question.sectionId ? sectionById.get(question.sectionId) ?? null : null;
  const meta = safeParseJson<Record<string, unknown> | null>(question.meta, null);
  const sectionLabel = firstTrimmedString(question.subjectLabel, section?.subjectLabel, section?.title);
  const resolvedTaxonomy = resolveStoredQuestionTaxonomy(meta, sectionLabel);
  const subjectLabel = firstTrimmedString(
    resolvedTaxonomy.subjectName,
    typeof question.subjectLabel === "string" ? question.subjectLabel : null,
    typeof section?.subjectLabel === "string" ? section.subjectLabel : null,
  );
  const subjectKey = normalizeTitleKey(subjectLabel ?? "");
  if (!subjectLabel || !subjectKey) return null;

  const chapterTitle = firstTrimmedString(
    resolvedTaxonomy.chapterName,
    meta?.chapterTitle,
    meta?.topicTag,
    meta?.topic,
  ) ?? "Imported from Tests";
  const chapterKey = normalizeTitleKey(chapterTitle) ?? "imported from tests";

  return {
    subjectLabel,
    subjectKey,
    chapterTitle,
    chapterKey,
  };
}

function findQuestionBankChapterForTaxonomy(
  targetSubjectId: number,
  chapterKey: string,
  chaptersBySubjectId: QuestionBankChaptersBySubjectId,
  allowFallback = false,
) {
  const chapters = chaptersBySubjectId.get(targetSubjectId) ?? [];
  const match = findBestQuestionBankTitleMatch(chapterKey, chapters, (chapter) => chapter.title, allowFallback);
  return match?.item ?? null;
}

async function ensureTeacherAssignedToQuestionBankClass(
  targetClass: typeof classesTable.$inferSelect,
  teacherId: number,
) {
  const assignedTeacherIds = Array.isArray(targetClass.assignedTeacherIds)
    ? targetClass.assignedTeacherIds.filter((value): value is number => Number.isInteger(value))
    : [];

  if (assignedTeacherIds.includes(teacherId)) {
    return targetClass;
  }

  const nextAssignedTeacherIds = [...new Set([...assignedTeacherIds, teacherId])];
  const [updatedClass] = await db
    .update(classesTable)
    .set({ assignedTeacherIds: nextAssignedTeacherIds })
    .where(eq(classesTable.id, targetClass.id))
    .returning();

  return updatedClass ?? { ...targetClass, assignedTeacherIds: nextAssignedTeacherIds };
}

async function resolveQuestionBankClassForExam(
  teacherId: number,
  examType: unknown,
  options: { createIfMissing?: boolean } = {},
): Promise<ResolvedQuestionBankContext> {
  const shouldCreateMissing = options.createIfMissing !== false;
  const examKey = normalizeExamKey(examType);
  if (!examKey) {
    return {
      targetClass: null,
      createdQuestionBankClassCount: 0,
    };
  }

  const candidateClasses = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.workflowType, "question_bank"))
    .orderBy(asc(classesTable.createdAt));

  const assignedClass =
    candidateClasses.find((cls) => normalizeExamKey(cls.subject) === examKey && (cls.assignedTeacherIds ?? []).includes(teacherId)) ??
    candidateClasses.find((cls) => normalizeExamKey(cls.title) === examKey && (cls.assignedTeacherIds ?? []).includes(teacherId)) ??
    null;
  const ownedClass =
    candidateClasses.find((cls) => normalizeExamKey(cls.subject) === examKey && cls.adminId === teacherId) ??
    candidateClasses.find((cls) => normalizeExamKey(cls.title) === examKey && cls.adminId === teacherId) ??
    null;
  const examMatchedClass =
    candidateClasses.find((cls) => normalizeExamKey(cls.subject) === examKey) ??
    candidateClasses.find((cls) => normalizeExamKey(cls.title) === examKey) ??
    null;

  let targetClass = assignedClass ?? ownedClass ?? examMatchedClass ?? null;

  if (!targetClass) {
    if (!shouldCreateMissing) {
      return {
        targetClass: null,
        createdQuestionBankClassCount: 0,
      };
    }
    const examLabel =
      typeof examType === "string" && examType.trim()
        ? examType.trim().replace(/\s+/g, " ").toUpperCase()
        : examKey.toUpperCase();
    const [createdClass] = await db.insert(classesTable).values({
      title: examLabel,
      description: "Auto-created from published tests",
      subject: examLabel,
      workflowType: "question_bank",
      adminId: teacherId,
      assignedTeacherIds: [teacherId],
      plannerId: null,
      status: "scheduled",
      weeklyTargetQuestions: null,
      weeklyTargetDeadline: null,
      scheduledAt: null,
      maxStudents: null,
      meetingLink: null,
    }).returning();
    targetClass = createdClass;
    return {
      targetClass,
      createdQuestionBankClassCount: 1,
    };
  }

  targetClass = await ensureTeacherAssignedToQuestionBankClass(targetClass, teacherId);

  return {
    targetClass,
    createdQuestionBankClassCount: 0,
  };
}

async function loadQuestionBankTaxonomyCatalogForExam(
  teacherId: number,
  examType: unknown,
): Promise<QuestionBankTaxonomyCatalog | null> {
  const { targetClass } = await resolveQuestionBankClassForExam(teacherId, examType, { createIfMissing: false });
  if (!targetClass) return null;

  const subjects = await db
    .select()
    .from(subjectsTable)
    .where(eq(subjectsTable.classId, targetClass.id))
    .orderBy(asc(subjectsTable.order), asc(subjectsTable.createdAt));
  const chapters = subjects.length > 0
    ? await db.select().from(chaptersTable).where(inArray(chaptersTable.subjectId, subjects.map((subject) => subject.id))).orderBy(asc(chaptersTable.order), asc(chaptersTable.id))
    : [];

  return {
    targetClass,
    subjects,
    subjectsByKey: buildQuestionBankSubjectsByKey(subjects),
    chaptersBySubjectId: buildQuestionBankChaptersBySubjectId(chapters),
  };
}

function resolveCanonicalQuestionBankTaxonomy(
  catalog: QuestionBankTaxonomyCatalog | null,
  subjectName: string | null,
  chapterName: string | null,
) {
  if (!catalog || catalog.subjects.length === 0) {
    return {
      subjectName,
      chapterName,
      needsReview: false,
      reviewReason: null as string | null,
      importedSubjectName: null as string | null,
      importedChapterName: null as string | null,
      suggestedSubjectName: null as string | null,
      suggestedChapterName: null as string | null,
    };
  }

  const requestedSubjectKey = normalizeTitleKey(subjectName ?? "");
  const requestedChapterKey = normalizeTitleKey(chapterName ?? "");
  const directSubjectMatch = findQuestionBankSubjectForTaxonomy(requestedSubjectKey, catalog.subjectsByKey, catalog.subjects, false);
  const crossSubjectChapterMatch = findBestQuestionBankChapterPair(requestedChapterKey, catalog);

  let subjectMatch = directSubjectMatch;
  let targetSubject = subjectMatch?.item ?? null;
  let chapterMatch: QuestionBankTitleMatch<typeof chaptersTable.$inferSelect> | null = null;

  if (targetSubject) {
    const targetChapters = catalog.chaptersBySubjectId.get(targetSubject.id) ?? [];
    chapterMatch = findBestQuestionBankTitleMatch(requestedChapterKey, targetChapters, (chapter) => chapter.title, false);
  }

  if (
    crossSubjectChapterMatch &&
    (
      !targetSubject ||
      !chapterMatch ||
      crossSubjectChapterMatch.chapterMatch.exact ||
      crossSubjectChapterMatch.chapterMatch.score > chapterMatch.score + 0.08
    )
  ) {
    targetSubject = crossSubjectChapterMatch.subject;
    subjectMatch = {
      item: crossSubjectChapterMatch.subject,
      exact: normalizeTitleKey(crossSubjectChapterMatch.subject.title) === requestedSubjectKey,
      reason: normalizeTitleKey(crossSubjectChapterMatch.subject.title) === requestedSubjectKey ? "exact" : "fuzzy",
      score: directSubjectMatch?.item.id === crossSubjectChapterMatch.subject.id ? directSubjectMatch.score : 0.72,
    };
    chapterMatch = crossSubjectChapterMatch.chapterMatch;
  }

  if (!targetSubject) {
    subjectMatch = findQuestionBankSubjectForTaxonomy(requestedSubjectKey, catalog.subjectsByKey, catalog.subjects, Boolean(subjectName));
    targetSubject = subjectMatch?.item ?? null;
  }

  if (targetSubject && !chapterMatch) {
    const targetChapters = catalog.chaptersBySubjectId.get(targetSubject.id) ?? [];
    chapterMatch = findBestQuestionBankTitleMatch(requestedChapterKey, targetChapters, (chapter) => chapter.title, Boolean(chapterName));
  }

  const subjectAutoAccepted = Boolean(subjectMatch && (subjectMatch.reason === "exact" || subjectMatch.reason === "compact"));
  const chapterAutoAccepted = Boolean(chapterMatch && (chapterMatch.reason === "exact" || chapterMatch.reason === "compact"));
  const canonicalSubjectName = subjectAutoAccepted ? (targetSubject?.title ?? subjectName) : subjectName;
  const canonicalChapterName = chapterAutoAccepted ? (chapterMatch?.item.title ?? chapterName) : chapterName;
  const subjectChanged = Boolean(subjectAutoAccepted && subjectName && canonicalSubjectName && normalizeTitleKey(subjectName) !== normalizeTitleKey(canonicalSubjectName));
  const chapterChanged = Boolean(chapterAutoAccepted && chapterName && canonicalChapterName && normalizeTitleKey(chapterName) !== normalizeTitleKey(canonicalChapterName));
  const needsSubjectReview = Boolean(subjectName && (!targetSubject || !subjectAutoAccepted));
  const needsChapterReview = Boolean(chapterName && (!chapterMatch || !chapterAutoAccepted));
  const needsReview = Boolean(
    subjectChanged ||
    chapterChanged ||
    needsSubjectReview ||
    needsChapterReview,
  );
  const reviewMessages: string[] = [];
  if (needsSubjectReview) {
    reviewMessages.push("Subject does not exactly match the super-admin question bank.");
  }
  if (needsChapterReview) {
    reviewMessages.push("Chapter does not exactly match the super-admin question bank.");
  }

  return {
    subjectName: canonicalSubjectName,
    chapterName: canonicalChapterName,
    needsReview,
    reviewReason: needsReview
      ? reviewMessages.join(" ")
      : null,
    importedSubjectName: needsReview ? subjectName : null,
    importedChapterName: needsReview ? chapterName : null,
    suggestedSubjectName: needsSubjectReview ? targetSubject?.title ?? null : null,
    suggestedChapterName: needsChapterReview ? chapterMatch?.item.title ?? null : null,
  };
}

function buildPublishQuestionCode(question: typeof testQuestionsTable.$inferSelect) {
  const explicitCode = typeof question.questionCode === "string" ? question.questionCode.trim() : "";
  if (explicitCode) return explicitCode;
  return `Q${String((question.order ?? 0) + 1).padStart(2, "0")}`;
}

async function syncPublishedTestQuestionsToQuestionBank(testId: number, teacherId: number, examType: unknown): Promise<QuestionBankPublishSyncSummary> {
  const summary: QuestionBankPublishSyncSummary = {
    linkedCount: 0,
    createdQuestionBankClassCount: 0,
    createdSubjectCount: 0,
    createdChapterCount: 0,
    skippedNoSubjectCount: 0,
    skippedNoQuestionBankClassCount: 0,
    skippedInvalidQuestionCount: 0,
    skippedDuplicateCount: 0,
    duplicateQuestions: [],
    reviewQuestions: [],
    warnings: [],
  };

  const { targetClass, createdQuestionBankClassCount } = await resolveQuestionBankClassForExam(teacherId, examType, { createIfMissing: false });
  summary.createdQuestionBankClassCount = createdQuestionBankClassCount;
  if (!targetClass) {
    summary.skippedNoQuestionBankClassCount += 1;
    summary.warnings.push("No super-admin question bank structure was found for this exam.");
    return summary;
  }

  const [subjects, testQuestions, sections, existingLinks] = await Promise.all([
    db.select().from(subjectsTable).where(eq(subjectsTable.classId, targetClass.id)).orderBy(asc(subjectsTable.order), asc(subjectsTable.createdAt)),
    db.select().from(testQuestionsTable).where(eq(testQuestionsTable.testId, testId)).orderBy(asc(testQuestionsTable.order), asc(testQuestionsTable.id)),
    db.select().from(testSectionsTable).where(eq(testSectionsTable.testId, testId)).orderBy(asc(testSectionsTable.order), asc(testSectionsTable.id)),
    db.select().from(testQuestionBankLinksTable).where(eq(testQuestionBankLinksTable.testId, testId)),
  ]);

  if (testQuestions.length === 0) {
    return summary;
  }

  const existingLinksByTestQuestionId = new Map<number, typeof testQuestionBankLinksTable.$inferSelect>();
  for (const link of existingLinks) {
    existingLinksByTestQuestionId.set(link.testQuestionId, link);
  }

  const sectionById = buildQuestionBankSectionLookup(sections);
  const subjectsByKey = buildQuestionBankSubjectsByKey(subjects);
  const chapters = subjects.length > 0
    ? await db.select().from(chaptersTable).where(inArray(chaptersTable.subjectId, subjects.map((subject) => subject.id))).orderBy(asc(chaptersTable.order), asc(chaptersTable.id))
    : [];
  const chaptersBySubjectId = buildQuestionBankChaptersBySubjectId(chapters);
  const duplicateKeysByChapterId = new Map<number, Map<string, number>>();

  for (const question of testQuestions) {
    if (existingLinksByTestQuestionId.has(question.id)) {
      continue;
    }

    const resolvedTaxonomy = resolveQuestionBankTaxonomyForTestQuestion(question, sectionById);
    const questionNo = buildPublishQuestionCode(question);
    if (!resolvedTaxonomy) {
      summary.skippedNoSubjectCount += 1;
      summary.reviewQuestions.push({
        questionId: question.id,
        questionNo,
        reason: "Subject or chapter is missing.",
        subjectName: null,
        chapterName: null,
      });
      continue;
    }

    const targetSubject = subjectsByKey.get(resolvedTaxonomy.subjectKey) ?? null;
    if (!targetSubject) {
      summary.skippedNoSubjectCount += 1;
      summary.reviewQuestions.push({
        questionId: question.id,
        questionNo,
        reason: "Subject does not match the super-admin question bank.",
        subjectName: resolvedTaxonomy.subjectLabel,
        chapterName: resolvedTaxonomy.chapterTitle,
      });
      summary.warnings.push(`Skipped ${questionNo} because its subject does not match the super-admin question bank.`);
      continue;
    }

    const targetChapter = findQuestionBankChapterForTaxonomy(targetSubject.id, resolvedTaxonomy.chapterKey, chaptersBySubjectId, false);
    if (!targetChapter) {
      summary.skippedNoSubjectCount += 1;
      summary.reviewQuestions.push({
        questionId: question.id,
        questionNo,
        reason: "Chapter does not match the super-admin question bank.",
        subjectName: targetSubject.title,
        chapterName: resolvedTaxonomy.chapterTitle,
      });
      summary.warnings.push(`Skipped ${questionNo} because its chapter does not match the super-admin question bank.`);
      continue;
    }

    let duplicateMap = duplicateKeysByChapterId.get(targetChapter.id);
    if (!duplicateMap) {
      const existingQuestions = await db
        .select({
          id: questionBankQuestionsTable.id,
          question: questionBankQuestionsTable.question,
          questionType: questionBankQuestionsTable.questionType,
        })
        .from(questionBankQuestionsTable)
        .where(eq(questionBankQuestionsTable.chapterId, targetChapter.id));
      duplicateMap = new Map<string, number>();
      existingQuestions.forEach((item) => {
        const existingQuestionType = item.questionType === "multi" || item.questionType === "integer" ? item.questionType : "mcq";
        const existingKey = normalizeQuestionDuplicateKey(item.question, existingQuestionType);
        if (existingKey && !duplicateMap?.has(existingKey)) {
          duplicateMap?.set(existingKey, item.id);
        }
      });
      duplicateKeysByChapterId.set(targetChapter.id, duplicateMap);
    }

    const questionType = question.questionType === "multi" || question.questionType === "integer" ? question.questionType : "mcq";
    const normalizedQuestionText = question.question.trim() || question.questionCode?.trim() || `Imported test question ${question.id}`;
    const duplicateKey = normalizeQuestionDuplicateKey(normalizedQuestionText, questionType);
    const existingQuestionBankQuestionId = duplicateKey ? duplicateMap.get(duplicateKey) ?? null : null;
    if (existingQuestionBankQuestionId) {
      await db.insert(testQuestionBankLinksTable).values({
        testId,
        testQuestionId: question.id,
        questionBankQuestionId: existingQuestionBankQuestionId,
      });
      summary.skippedDuplicateCount += 1;
      summary.duplicateQuestions.push({
        questionId: question.id,
        questionNo: firstTrimmedString(
          question.questionCode,
          `Q${String((Number(question.order) || 0) + 1).padStart(2, "0")}`,
        ) ?? `Q${question.id}`,
      });
      continue;
    }

    const options = questionType === "integer" ? [] : normalizeArrayValue<string>(question.options, []);
    const optionImages = questionType === "integer" ? [] : normalizeArrayValue<string | null>(question.optionImages, []);
    const correctAnswerMulti = questionType === "multi" ? normalizeArrayValue<number>(question.correctAnswerMulti, []) : [];
    const correctAnswer = question.correctAnswer === null || question.correctAnswer === undefined ? null : Number(question.correctAnswer);
    const correctAnswerMin = question.correctAnswerMin === null || question.correctAnswerMin === undefined ? null : Number(question.correctAnswerMin);
    const correctAnswerMax = question.correctAnswerMax === null || question.correctAnswerMax === undefined ? null : Number(question.correctAnswerMax);
    const hasExactIntegerAnswer = Number.isFinite(correctAnswer);
    const hasIntegerRangeAnswer =
      Number.isFinite(correctAnswerMin) &&
      Number.isFinite(correctAnswerMax) &&
      Number(correctAnswerMin) <= Number(correctAnswerMax);

    const isValidQuestion =
      (questionType === "mcq" && options.length >= 2 && hasExactIntegerAnswer && Number(correctAnswer) >= 0 && Number(correctAnswer) < options.length) ||
      (questionType === "multi" && options.length >= 2 && correctAnswerMulti.length > 0 && correctAnswerMulti.every((value) => Number.isInteger(value) && value >= 0 && value < options.length)) ||
      (questionType === "integer" && (hasExactIntegerAnswer || hasIntegerRangeAnswer));

    if (!isValidQuestion) {
      summary.skippedInvalidQuestionCount += 1;
      continue;
    }

    const answer =
      questionType === "integer"
        ? String(correctAnswer ?? correctAnswerMin ?? "")
        : questionType === "mcq"
          ? options[correctAnswer ?? 0] ?? null
          : correctAnswerMulti.map((index) => options[index]).filter(Boolean).join(", ");
    const questionMeta = safeParseJson<Record<string, unknown> | null>(question.meta, null);

    const [createdQuestion] = await db.insert(questionBankQuestionsTable).values({
      classId: targetClass.id,
      subjectId: targetSubject.id,
      chapterId: targetChapter.id,
      question: normalizedQuestionText,
      questionType,
      options: JSON.stringify(options),
      optionImages: optionImages.some(Boolean) ? JSON.stringify(optionImages) : null,
      correctAnswer: Number.isFinite(correctAnswer) ? correctAnswer : null,
      correctAnswerMulti: correctAnswerMulti.length > 0 ? JSON.stringify(correctAnswerMulti) : null,
      correctAnswerMin: Number.isFinite(correctAnswerMin) ? correctAnswerMin : null,
      correctAnswerMax: Number.isFinite(correctAnswerMax) ? correctAnswerMax : null,
      answer,
      explanation: question.solutionText?.trim() || question.aiSolutionText?.trim() || null,
      topicTag: typeof questionMeta?.topicTag === "string" && questionMeta.topicTag.trim() ? questionMeta.topicTag.trim() : null,
      difficulty: normalizeQuestionBankDifficulty(questionMeta?.difficulty),
      points: Math.max(1, Number(question.points) || 1),
      order: duplicateMap.size,
      imageData: question.imageData ?? null,
      sourceTestId: testId,
      sourceTestQuestionId: question.id,
      createdBy: teacherId,
    }).returning({ id: questionBankQuestionsTable.id });

    await db.insert(testQuestionBankLinksTable).values({
      testId,
      testQuestionId: question.id,
      questionBankQuestionId: createdQuestion.id,
    });

    if (duplicateKey) duplicateMap.set(duplicateKey, createdQuestion.id);
    summary.linkedCount += 1;
  }

  return summary;
}

async function cleanupUnpublishedTestQuestionsFromQuestionBank(
  testId: number,
  teacherId: number,
  examType: unknown,
): Promise<QuestionBankUnpublishCleanupSummary> {
  const summary: QuestionBankUnpublishCleanupSummary = {
    detachedCount: 0,
    removedQuestionCount: 0,
    removedChapterCount: 0,
    removedSubjectCount: 0,
    reviewBucketCleared: true,
    warnings: [],
  };
  const candidateChapterIds = new Set<number>();
  const candidateSubjectIds = new Set<number>();

  const directLinks = await db
    .select()
    .from(testQuestionBankLinksTable)
    .where(eq(testQuestionBankLinksTable.testId, testId));

  if (directLinks.length > 0) {
    const linkedQuestionBankIds = [...new Set(directLinks.map((link) => link.questionBankQuestionId))];
    await db.delete(testQuestionBankLinksTable).where(eq(testQuestionBankLinksTable.testId, testId));
    summary.detachedCount = directLinks.length;

    if (linkedQuestionBankIds.length > 0) {
      const [remainingLinks, linkedQuestions] = await Promise.all([
        db
          .select({ questionBankQuestionId: testQuestionBankLinksTable.questionBankQuestionId })
          .from(testQuestionBankLinksTable)
          .where(inArray(testQuestionBankLinksTable.questionBankQuestionId, linkedQuestionBankIds)),
        db
          .select({
            id: questionBankQuestionsTable.id,
            subjectId: questionBankQuestionsTable.subjectId,
            chapterId: questionBankQuestionsTable.chapterId,
            sourceTestId: questionBankQuestionsTable.sourceTestId,
            sourceTestQuestionId: questionBankQuestionsTable.sourceTestQuestionId,
          })
          .from(questionBankQuestionsTable)
          .where(inArray(questionBankQuestionsTable.id, linkedQuestionBankIds)),
      ]);

      const stillLinkedIds = new Set(remainingLinks.map((link) => link.questionBankQuestionId));
      linkedQuestions.forEach((question) => {
        candidateSubjectIds.add(question.subjectId);
        candidateChapterIds.add(question.chapterId);
      });
      const removableQuestionIds = linkedQuestions
        .filter((question) => !stillLinkedIds.has(question.id) && (question.sourceTestId !== null || question.sourceTestQuestionId !== null))
        .map((question) => question.id);

      if (removableQuestionIds.length > 0) {
        await db.delete(questionBankQuestionsTable).where(inArray(questionBankQuestionsTable.id, removableQuestionIds));
        summary.removedQuestionCount += removableQuestionIds.length;
      }
    }
  }

  const { targetClass } = await resolveQuestionBankClassForExam(teacherId, examType);
  if (targetClass) {
    const [subjects, testQuestions, sections] = await Promise.all([
      db.select().from(subjectsTable).where(eq(subjectsTable.classId, targetClass.id)).orderBy(asc(subjectsTable.order), asc(subjectsTable.createdAt)),
      db.select().from(testQuestionsTable).where(eq(testQuestionsTable.testId, testId)).orderBy(asc(testQuestionsTable.order), asc(testQuestionsTable.id)),
      db.select().from(testSectionsTable).where(eq(testSectionsTable.testId, testId)).orderBy(asc(testSectionsTable.order), asc(testSectionsTable.id)),
    ]);

    if (testQuestions.length > 0 && subjects.length > 0) {
      const sectionById = buildQuestionBankSectionLookup(sections);
      const subjectsByKey = buildQuestionBankSubjectsByKey(subjects);
      const chapters = await db
        .select()
        .from(chaptersTable)
        .where(inArray(chaptersTable.subjectId, subjects.map((subject) => subject.id)))
        .orderBy(asc(chaptersTable.order), asc(chaptersTable.id));
      const chaptersBySubjectId = buildQuestionBankChaptersBySubjectId(chapters);

      for (const question of testQuestions) {
        const resolvedTaxonomy = resolveQuestionBankTaxonomyForTestQuestion(question, sectionById);
        if (!resolvedTaxonomy) continue;

        const targetSubject = subjectsByKey.get(resolvedTaxonomy.subjectKey) ?? null;
        if (!targetSubject) continue;
        candidateSubjectIds.add(targetSubject.id);

        const targetChapter = findQuestionBankChapterForTaxonomy(targetSubject.id, resolvedTaxonomy.chapterKey, chaptersBySubjectId);
        if (targetChapter) candidateChapterIds.add(targetChapter.id);
      }

      if (candidateChapterIds.size > 0) {
        const existingQuestionBankQuestions = await db
          .select({
            id: questionBankQuestionsTable.id,
            subjectId: questionBankQuestionsTable.subjectId,
            chapterId: questionBankQuestionsTable.chapterId,
            question: questionBankQuestionsTable.question,
            questionType: questionBankQuestionsTable.questionType,
            createdBy: questionBankQuestionsTable.createdBy,
            sourceTestId: questionBankQuestionsTable.sourceTestId,
            sourceTestQuestionId: questionBankQuestionsTable.sourceTestQuestionId,
          })
          .from(questionBankQuestionsTable)
          .where(inArray(questionBankQuestionsTable.chapterId, [...candidateChapterIds]));

        const linksByQuestionBankId = new Set(
          existingQuestionBankQuestions.length > 0
            ? (
                await db
                  .select({ questionBankQuestionId: testQuestionBankLinksTable.questionBankQuestionId })
                  .from(testQuestionBankLinksTable)
                  .where(inArray(testQuestionBankLinksTable.questionBankQuestionId, existingQuestionBankQuestions.map((question) => question.id)))
              ).map((item) => item.questionBankQuestionId)
            : [],
        );

        const questionBankByChapterAndKey = new Map<string, typeof existingQuestionBankQuestions[number]>();
        existingQuestionBankQuestions.forEach((question) => {
          const storedQuestionType = question.questionType === "multi" || question.questionType === "integer" ? question.questionType : "mcq";
          const key = normalizeQuestionDuplicateKey(question.question, storedQuestionType);
          if (!key) return;
          const compositeKey = `${question.chapterId}:${key}`;
          if (!questionBankByChapterAndKey.has(compositeKey)) {
            questionBankByChapterAndKey.set(compositeKey, question);
          }
        });

        const removableLegacyIds = new Set<number>();
        for (const question of testQuestions) {
          const resolvedTaxonomy = resolveQuestionBankTaxonomyForTestQuestion(question, sectionById);
          if (!resolvedTaxonomy) continue;

          const targetSubject = subjectsByKey.get(resolvedTaxonomy.subjectKey) ?? null;
          if (!targetSubject) continue;

          const targetChapter = findQuestionBankChapterForTaxonomy(targetSubject.id, resolvedTaxonomy.chapterKey, chaptersBySubjectId);
          if (!targetChapter) continue;

          const questionType = question.questionType === "multi" || question.questionType === "integer" ? question.questionType : "mcq";
          const normalizedQuestionText = question.question.trim() || question.questionCode?.trim() || `Imported test question ${question.id}`;
          const duplicateKey = normalizeQuestionDuplicateKey(normalizedQuestionText, questionType);
          if (!duplicateKey) continue;

          const matchedQuestion = questionBankByChapterAndKey.get(`${targetChapter.id}:${duplicateKey}`) ?? null;
          if (!matchedQuestion) continue;
          if (matchedQuestion.createdBy !== teacherId) continue;
          if (linksByQuestionBankId.has(matchedQuestion.id)) continue;

          removableLegacyIds.add(matchedQuestion.id);
          candidateSubjectIds.add(matchedQuestion.subjectId);
          candidateChapterIds.add(matchedQuestion.chapterId);
        }

        if (removableLegacyIds.size > 0) {
          await db.delete(questionBankQuestionsTable).where(inArray(questionBankQuestionsTable.id, [...removableLegacyIds]));
          summary.removedQuestionCount += removableLegacyIds.size;
          summary.warnings.push("Legacy synced questions were cleaned using question-text matching.");
        }
      }
    }
  } else if (candidateChapterIds.size === 0 && candidateSubjectIds.size === 0) {
    summary.warnings.push("No matching question bank class was found for cleanup.");
  }

  if (candidateChapterIds.size > 0) {
    const remainingQuestionRows = await db
      .select({ chapterId: questionBankQuestionsTable.chapterId })
      .from(questionBankQuestionsTable)
      .where(inArray(questionBankQuestionsTable.chapterId, [...candidateChapterIds]));
    const occupiedChapterIds = new Set(remainingQuestionRows.map((row) => row.chapterId));
    const emptyChapterIds = [...candidateChapterIds].filter((chapterId) => !occupiedChapterIds.has(chapterId));

    if (emptyChapterIds.length > 0) {
      const emptyChapters = await db
        .select({ id: chaptersTable.id, subjectId: chaptersTable.subjectId })
        .from(chaptersTable)
        .where(inArray(chaptersTable.id, emptyChapterIds));

      if (emptyChapters.length > 0) {
        emptyChapters.forEach((chapter) => candidateSubjectIds.add(chapter.subjectId));
        await db.delete(chaptersTable).where(inArray(chaptersTable.id, emptyChapters.map((chapter) => chapter.id)));
        summary.removedChapterCount += emptyChapters.length;
      }
    }
  }

  if (candidateSubjectIds.size > 0) {
    const remainingChapterRows = await db
      .select({ subjectId: chaptersTable.subjectId })
      .from(chaptersTable)
      .where(inArray(chaptersTable.subjectId, [...candidateSubjectIds]));
    const occupiedSubjectIds = new Set(remainingChapterRows.map((row) => row.subjectId));
    const emptySubjectIds = [...candidateSubjectIds].filter((subjectId) => !occupiedSubjectIds.has(subjectId));

    if (emptySubjectIds.length > 0) {
      await db.delete(subjectsTable).where(inArray(subjectsTable.id, emptySubjectIds));
      summary.removedSubjectCount += emptySubjectIds.length;
    }
  }

  return summary;
}

function serializeTestQuestion(question: any, options?: { showCorrect?: boolean; includeSolutions?: boolean }) {
  const showCorrect = Boolean(options?.showCorrect);
  const includeSolutions = Boolean(options?.includeSolutions);
  const base = {
    id: question.id,
    sectionId: question.sectionId ?? null,
    questionCode: question.questionCode ?? null,
    sourceType: question.sourceType ?? "manual",
    subjectLabel: question.subjectLabel ?? null,
    question: question.question,
    questionType: question.questionType ?? "mcq",
    options: safeParseJson(question.options, []),
    optionImages: safeParseJson(question.optionImages, null),
    points: question.points,
    negativeMarks: question.negativeMarks ?? 0,
    order: question.order,
    meta: safeParseJson(question.meta, null),
    imageData: question.imageData ?? null,
  } as Record<string, unknown>;

  if (showCorrect) {
    const normalizedIntegerAnswer =
      (question.questionType ?? "mcq") === "integer"
        ? normalizeSerializedIntegerAnswer(question)
        : null;
    base.correctAnswer = normalizedIntegerAnswer?.correctAnswer ?? question.correctAnswer;
    base.correctAnswerMulti = safeParseJson(question.correctAnswerMulti, null);
    base.correctAnswerMin = normalizedIntegerAnswer?.correctAnswerMin ?? null;
    base.correctAnswerMax = normalizedIntegerAnswer?.correctAnswerMax ?? null;
  }

  if (includeSolutions) {
    base.solutionText = question.solutionText ?? null;
    base.solutionImageData = question.solutionImageData ?? null;
  }

  return base;
}

function getReporterDisplayName(user: { fullName?: string | null; username?: string | null } | null | undefined) {
  if (!user) return "Student";
  if (typeof user.fullName === "string" && user.fullName.trim()) return user.fullName.trim();
  if (typeof user.username === "string" && user.username.trim()) return user.username.trim();
  return "Student";
}

function serializeTestQuestionReport(
  report: any,
  reporter?: { fullName?: string | null; username?: string | null } | null,
) {
  return {
    id: report.id,
    testId: report.testId,
    questionId: report.questionId,
    reportedBy: report.reportedBy,
    teacherId: report.teacherId,
    reason: report.reason,
    status: report.status ?? "open",
    teacherNote: report.teacherNote ?? null,
    createdAt: report.createdAt ?? null,
    updatedAt: report.updatedAt ?? null,
    reporterName: getReporterDisplayName(reporter),
  };
}

function buildQuestionReportsByQuestionId(
  reports: any[],
  reporterMap: Map<number, { fullName?: string | null; username?: string | null }> = new Map(),
) {
  const questionReportsByQuestionId = new Map<number, Array<Record<string, unknown>>>();
  for (const report of reports) {
    const serialized = serializeTestQuestionReport(report, reporterMap.get(report.reportedBy));
    const bucket = questionReportsByQuestionId.get(report.questionId) ?? [];
    bucket.push(serialized);
    questionReportsByQuestionId.set(report.questionId, bucket);
  }
  return questionReportsByQuestionId;
}

function formatSubmissionAnswerLabel(question: any, answer: any): string {
  const qType = question.questionType ?? "mcq";
  if (answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0)) {
    return "—";
  }
  if (qType === "multi") {
    return Array.isArray(answer)
      ? answer.map((value) => String.fromCharCode(65 + Number(value))).join(", ")
      : "—";
  }
  if (qType === "integer") {
    return String(answer);
  }
  return String.fromCharCode(65 + Number(answer));
}

function formatQuestionCorrectLabel(question: any): string {
  const qType = question.questionType ?? "mcq";
  if (qType === "multi") {
    return normalizeArrayValue<number>(question.correctAnswerMulti, [])
      .map((value) => String.fromCharCode(65 + Number(value)))
      .join(", ");
  }
  if (qType === "integer") {
    const normalizedIntegerAnswer = normalizeSerializedIntegerAnswer(question);
    if (
      normalizedIntegerAnswer.correctAnswerMin !== null &&
      normalizedIntegerAnswer.correctAnswerMax !== null
    ) {
      return `${normalizedIntegerAnswer.correctAnswerMin} — ${normalizedIntegerAnswer.correctAnswerMax}`;
    }
    return String(normalizedIntegerAnswer.correctAnswer ?? "—");
  }
  return String.fromCharCode(65 + Number(question.correctAnswer ?? 0));
}

function computeOptionSelectionStats(question: any, submissions: Array<{ answers?: unknown }>) {
  const optionCounts = normalizeArrayValue(question.options, []).map(() => 0);
  let attemptedCount = 0;
  const questionType = question.questionType ?? "mcq";

  submissions.forEach((submission) => {
    const parsedAnswers = safeParseJson<Record<string, unknown>>(submission.answers, {});
    const answer = parsedAnswers[String(question.id)] ?? parsedAnswers[question.id as unknown as keyof typeof parsedAnswers];
    if (!hasAnsweredQuestion(question, answer)) return;

    attemptedCount += 1;

    if (questionType === "mcq") {
      const index = Number(answer);
      if (optionCounts[index] !== undefined) optionCounts[index] += 1;
      return;
    }

    if (questionType === "multi" && Array.isArray(answer)) {
      answer.forEach((value) => {
        const index = Number(value);
        if (optionCounts[index] !== undefined) optionCounts[index] += 1;
      });
    }
  });

  return {
    optionCounts,
    optionSelectionPercentages: optionCounts.map((count) =>
      attemptedCount > 0 ? Number(((count / attemptedCount) * 100).toFixed(2)) : 0,
    ),
  };
}

async function syncTestSectionsFromTemplate(testId: number, examType: unknown, rawSections: any[]) {
  const parsedSections = rawSections.map((section) => ({
    ...section,
    meta: safeParseJson(section.meta, null),
  }));

  const examKey = normalizeExamKey(examType);
  if (!examKey) return parsedSections;

  const [template] = await db.select().from(examTemplatesTable).where(eq(examTemplatesTable.key, examKey)).limit(1);
  if (!template) return parsedSections;

  const templateSections = normalizeArrayValue<Record<string, unknown>>(template.sections, []);
  if (templateSections.length === 0) return parsedSections;

  const existingByLabel = new Map<string, any>();
  parsedSections.forEach((section) => {
    const label = normalizeSectionLabel(section.subjectLabel ?? section.title);
    if (label && !existingByLabel.has(label)) existingByLabel.set(label, section);
  });

  const usedIds = new Set<number>();
  const resolvedSections: any[] = [];

  for (let index = 0; index < templateSections.length; index += 1) {
    const templateSection = templateSections[index];
    const templateLabel = normalizeSectionLabel(templateSection.subjectLabel ?? templateSection.title);

    let existingSection =
      (templateLabel && existingByLabel.get(templateLabel)) ||
      parsedSections.find((section) => !usedIds.has(section.id) && section.order === index) ||
      parsedSections.find((section) => !usedIds.has(section.id)) ||
      null;

    const desiredValues = {
      title:
        typeof templateSection.title === "string" && templateSection.title.trim()
          ? templateSection.title.trim()
          : `Section ${index + 1}`,
      description:
        typeof templateSection.description === "string" && templateSection.description.trim()
          ? templateSection.description.trim()
          : existingSection?.description ?? null,
      subjectLabel:
        typeof templateSection.subjectLabel === "string" && templateSection.subjectLabel.trim()
          ? templateSection.subjectLabel.trim()
          : existingSection?.subjectLabel ?? null,
      questionCount:
        templateSection.questionCount === undefined || templateSection.questionCount === null || String(templateSection.questionCount).trim() === ""
          ? null
          : Number(templateSection.questionCount),
      marksPerQuestion:
        templateSection.marksPerQuestion === undefined || templateSection.marksPerQuestion === null || String(templateSection.marksPerQuestion).trim() === ""
          ? null
          : Number(templateSection.marksPerQuestion),
      negativeMarks:
        templateSection.negativeMarks === undefined || templateSection.negativeMarks === null || String(templateSection.negativeMarks).trim() === ""
          ? null
          : Number(templateSection.negativeMarks),
      meta: templateSection.meta ?? existingSection?.meta ?? null,
      order: index,
    };

    if (!existingSection) {
      const [createdSection] = await db.insert(testSectionsTable).values({
        testId,
        title: desiredValues.title,
        description: desiredValues.description,
        subjectLabel: desiredValues.subjectLabel,
        questionCount: desiredValues.questionCount,
        marksPerQuestion: desiredValues.marksPerQuestion,
        negativeMarks: desiredValues.negativeMarks,
        meta: desiredValues.meta ? JSON.stringify(desiredValues.meta) : null,
        order: desiredValues.order,
      }).returning();
      existingSection = {
        ...createdSection,
        meta: safeParseJson(createdSection.meta, null),
      };
      usedIds.add(existingSection.id);
    } else {
      usedIds.add(existingSection.id);
      const currentMeta = existingSection.meta ?? null;
      const desiredMetaString = desiredValues.meta ? JSON.stringify(desiredValues.meta) : null;
      const currentMetaString = currentMeta ? JSON.stringify(currentMeta) : null;
      const needsUpdate =
        existingSection.title !== desiredValues.title ||
        (existingSection.description ?? null) !== desiredValues.description ||
        (existingSection.subjectLabel ?? null) !== desiredValues.subjectLabel ||
        (existingSection.questionCount ?? null) !== desiredValues.questionCount ||
        (existingSection.marksPerQuestion ?? null) !== desiredValues.marksPerQuestion ||
        (existingSection.negativeMarks ?? null) !== desiredValues.negativeMarks ||
        existingSection.order !== desiredValues.order ||
        currentMetaString !== desiredMetaString;

      if (needsUpdate) {
        const [updatedSection] = await db.update(testSectionsTable).set({
          title: desiredValues.title,
          description: desiredValues.description,
          subjectLabel: desiredValues.subjectLabel,
          questionCount: desiredValues.questionCount,
          marksPerQuestion: desiredValues.marksPerQuestion,
          negativeMarks: desiredValues.negativeMarks,
          meta: desiredMetaString,
          order: desiredValues.order,
        }).where(eq(testSectionsTable.id, existingSection.id)).returning();
        existingSection = {
          ...updatedSection,
          meta: safeParseJson(updatedSection.meta, null),
        };
      }
    }

    resolvedSections.push(existingSection);
  }

  const unusedSections = parsedSections
    .filter((section) => !resolvedSections.some((resolved) => resolved.id === section.id))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return [...resolvedSections, ...unusedSections];
}

async function ensureBuilderSectionsForTest(params: {
  testId: number;
  test: {
    subjectName?: string | null;
    chapterName?: string | null;
  };
  rawSections: any[];
  questions: Array<typeof testQuestionsTable.$inferSelect>;
}) {
  const parsedSections = params.rawSections.map((section) => ({
    ...section,
    meta: safeParseJson(section.meta, null),
  }));

  const validSectionIds = new Set(parsedSections.map((section) => section.id));
  const orphanQuestions = params.questions.filter((question) => question.sectionId == null || !validSectionIds.has(question.sectionId));

  if (parsedSections.length > 0 && orphanQuestions.length === 0) {
    return {
      sections: parsedSections,
      questions: params.questions,
    };
  }

  if (parsedSections.length === 0) {
    const groupedQuestions = new Map<string, Array<typeof testQuestionsTable.$inferSelect>>();

    for (const question of params.questions) {
      const meta = safeParseJson<Record<string, unknown> | null>(question.meta, null);
      const label =
        firstTrimmedString(
          question.subjectLabel,
          meta?.subjectName,
          params.test.subjectName,
          params.test.chapterName,
        ) ?? "Section 1";
      const key = normalizeSectionLabel(label) || "section 1";
      const current = groupedQuestions.get(key) ?? [];
      current.push(question);
      groupedQuestions.set(key, current);
    }

    if (groupedQuestions.size === 0) {
      groupedQuestions.set(
        normalizeSectionLabel(params.test.subjectName ?? params.test.chapterName ?? "Section 1") || "section 1",
        [],
      );
    }

    const createdSections: Array<(typeof parsedSections)[number]> = [];
    let order = 0;
    for (const [key, sectionQuestions] of groupedQuestions.entries()) {
      const firstQuestion = sectionQuestions[0] ?? null;
      const firstQuestionMeta = firstQuestion ? safeParseJson<Record<string, unknown> | null>(firstQuestion.meta, null) : null;
      const title =
        firstTrimmedString(
          firstQuestion?.subjectLabel,
          firstQuestionMeta?.subjectName,
          params.test.subjectName,
          params.test.chapterName,
          key,
          `Section ${order + 1}`,
        ) ?? `Section ${order + 1}`;
      const [createdSection] = await db.insert(testSectionsTable).values({
        testId: params.testId,
        title,
        description: null,
        subjectLabel: title,
        questionCount: sectionQuestions.length,
        marksPerQuestion: null,
        negativeMarks: null,
        meta: null,
        order,
      }).returning();
      createdSections.push({
        ...createdSection,
        meta: safeParseJson(createdSection.meta, null),
      });
      order += 1;
    }

    const createdByLabel = new Map(
      createdSections.map((section) => [normalizeSectionLabel(section.subjectLabel ?? section.title), section] as const),
    );

    const patchedQuestions = await Promise.all(
      params.questions.map(async (question) => {
        const meta = safeParseJson<Record<string, unknown> | null>(question.meta, null);
        const label =
          firstTrimmedString(
            question.subjectLabel,
            meta?.subjectName,
            params.test.subjectName,
            params.test.chapterName,
            createdSections[0]?.title,
          ) ?? createdSections[0]?.title ?? "Section 1";
        const targetSection = createdByLabel.get(normalizeSectionLabel(label)) ?? createdSections[0];
        if (!targetSection) return question;
        if (question.sectionId === targetSection.id) return { ...question, sectionId: targetSection.id };
        await db
          .update(testQuestionsTable)
          .set({ sectionId: targetSection.id })
          .where(eq(testQuestionsTable.id, question.id));
        return { ...question, sectionId: targetSection.id };
      }),
    );

    return {
      sections: createdSections,
      questions: patchedQuestions,
    };
  }

  const sectionsByLabel = new Map(
    parsedSections.map((section) => [normalizeSectionLabel(section.subjectLabel ?? section.title), section] as const),
  );
  const fallbackSection = parsedSections[0] ?? null;

  const patchedQuestions = await Promise.all(
    params.questions.map(async (question) => {
      if (question.sectionId != null && validSectionIds.has(question.sectionId)) return question;
      const meta = safeParseJson<Record<string, unknown> | null>(question.meta, null);
      const label =
        firstTrimmedString(
          question.subjectLabel,
          meta?.subjectName,
          params.test.subjectName,
          params.test.chapterName,
        ) ?? "";
      const targetSection = sectionsByLabel.get(normalizeSectionLabel(label)) ?? fallbackSection;
      if (!targetSection) return question;
      await db
        .update(testQuestionsTable)
        .set({ sectionId: targetSection.id })
        .where(eq(testQuestionsTable.id, question.id));
      return { ...question, sectionId: targetSection.id };
    }),
  );

  return {
    sections: parsedSections,
    questions: patchedQuestions,
  };
}

// GET /api/tests — list tests
router.get("/tests", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (user.role === "super_admin") {
      const tests = await db.select({
        id: testsTable.id,
        classId: testsTable.classId,
        title: testsTable.title,
        chapterId: testsTable.chapterId,
        examConfig: testsTable.examConfig,
        durationMinutes: testsTable.durationMinutes,
        passingScore: testsTable.passingScore,
        isPublished: testsTable.isPublished,
        questionCount: sql<number>`count(${testQuestionsTable.id})`,
        submissionCount: sql<number>`(select count(*) from test_submissions where test_id = ${testsTable.id})`,
        scheduledAt: testsTable.scheduledAt, createdAt: testsTable.createdAt,
        className: classesTable.title, chapterName: chaptersTable.title, subjectName: subjectsTable.title,
      }).from(testsTable)
        .leftJoin(classesTable, eq(testsTable.classId, classesTable.id))
        .leftJoin(chaptersTable, eq(testsTable.chapterId, chaptersTable.id))
        .leftJoin(subjectsTable, eq(chaptersTable.subjectId, subjectsTable.id))
        .leftJoin(testQuestionsTable, eq(testQuestionsTable.testId, testsTable.id))
        .groupBy(
          testsTable.id,
          testsTable.classId,
          testsTable.title,
          testsTable.chapterId,
          testsTable.examConfig,
          testsTable.durationMinutes,
          testsTable.passingScore,
          testsTable.isPublished,
          testsTable.displayOrder,
          testsTable.scheduledAt,
          testsTable.createdAt,
          classesTable.title,
          chaptersTable.title,
          subjectsTable.title,
        )
        .orderBy(asc(testsTable.displayOrder), asc(testsTable.createdAt));
      return res.json(tests.map((test) => ({ ...test, examConfig: normalizeObjectValue(test.examConfig, null) })));
    }

    if (user.role === "admin") {
      const tests = await db.select({
        id: testsTable.id, classId: testsTable.classId, title: testsTable.title,
        description: testsTable.description,
        chapterId: testsTable.chapterId,
        examType: testsTable.examType,
        examConfig: testsTable.examConfig,
        durationMinutes: testsTable.durationMinutes,
        defaultPositiveMarks: testsTable.defaultPositiveMarks,
        defaultNegativeMarks: testsTable.defaultNegativeMarks,
        passingScore: testsTable.passingScore,
        isPublished: testsTable.isPublished,
        questionCount: sql<number>`count(${testQuestionsTable.id})`,
        scheduledAt: testsTable.scheduledAt, createdAt: testsTable.createdAt,
        className: classesTable.title, chapterName: chaptersTable.title, subjectName: subjectsTable.title,
      }).from(testsTable)
        .leftJoin(classesTable, eq(testsTable.classId, classesTable.id))
        .leftJoin(chaptersTable, eq(testsTable.chapterId, chaptersTable.id))
        .leftJoin(subjectsTable, eq(chaptersTable.subjectId, subjectsTable.id))
        .leftJoin(testQuestionsTable, eq(testQuestionsTable.testId, testsTable.id))
        .where(eq(testsTable.createdBy, userId))
        .groupBy(
          testsTable.id,
          testsTable.classId,
          testsTable.title,
          testsTable.description,
          testsTable.chapterId,
          testsTable.examType,
          testsTable.examConfig,
          testsTable.durationMinutes,
          testsTable.defaultPositiveMarks,
          testsTable.defaultNegativeMarks,
          testsTable.passingScore,
          testsTable.isPublished,
          testsTable.displayOrder,
          testsTable.scheduledAt,
          testsTable.createdAt,
          classesTable.title,
          chaptersTable.title,
          subjectsTable.title,
        )
        .orderBy(asc(testsTable.displayOrder), asc(testsTable.createdAt));
      return res.json(tests.map((test) => ({ ...test, examConfig: normalizeObjectValue(test.examConfig, null) })));
    }

    // Student
    const [enrolledClassIds, submissions] = await Promise.all([
      getStudentEnrolledClassIds(userId),
      db.select({ testId: testSubmissionsTable.testId })
        .from(testSubmissionsTable)
        .where(eq(testSubmissionsTable.studentId, userId)),
    ]);
    const access = {
      enrolledClassIds,
      examKeys: getStudentExamKeys(user),
    };
    const selectedExamKey = normalizeExamKey(req.query.exam);
    const submittedTestIds = new Set(submissions.map((s) => s.testId));
    // Count attempts per test from already-fetched data — avoids a full-table scan
    const totalAttemptsMap = new Map<number, number>();
    for (const s of submissions) {
      totalAttemptsMap.set(s.testId, (totalAttemptsMap.get(s.testId) ?? 0) + 1);
    }

    const tests = await db.select({
      id: testsTable.id,
      classId: testsTable.classId,
      title: testsTable.title,
      description: testsTable.description,
      examType: testsTable.examType,
      examHeader: testsTable.examHeader,
      examSubheader: testsTable.examSubheader,
      durationMinutes: testsTable.durationMinutes,
      passingScore: testsTable.passingScore,
      scheduledAt: testsTable.scheduledAt,
      displayOrder: testsTable.displayOrder,
      examConfig: testsTable.examConfig,
      className: classesTable.title, chapterName: chaptersTable.title, subjectName: subjectsTable.title,
    }).from(testsTable)
      .leftJoin(classesTable, eq(testsTable.classId, classesTable.id))
      .leftJoin(chaptersTable, eq(testsTable.chapterId, chaptersTable.id))
      .leftJoin(subjectsTable, eq(chaptersTable.subjectId, subjectsTable.id))
      .where(eq(testsTable.isPublished, true))
      .orderBy(asc(testsTable.displayOrder), asc(testsTable.scheduledAt));

    const visibleTests = tests.filter((test) => {
      const cfg = normalizeObjectValue<Record<string, unknown> | null>(test.examConfig, null);
      // Hide from student if admin explicitly disabled Student Dashboard toggle
      if (cfg?.showOnStudentDashboard === false && !submittedTestIds.has(test.id)) return false;
      if (selectedExamKey && normalizeExamKey(test.examType) !== selectedExamKey) return false;
      return submittedTestIds.has(test.id) || canStudentAccessTest(test, access);
    });

    return res.json(visibleTests.map(({ examConfig: _ec, displayOrder: _do, ...t }) => ({
      ...t,
      // Strip internal import metadata from student-facing description
      description: (typeof t.description === "string" && /^imported from saved html\s*:/i.test(t.description.trim()))
        ? null
        : t.description,
      alreadySubmitted: submittedTestIds.has(t.id),
      totalAttempts: totalAttemptsMap.get(t.id) ?? 0,
    })));
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// PATCH /api/tests/bulk-exam-config — bulk update examConfig fields for many tests at once.
// Much faster than N individual PATCH /tests/:id calls because it:
//   1. Authenticates once
//   2. Fetches all tests in a single query
//   3. Skips syncTestSectionsFromTemplate (sections don't change on examConfig-only edits)
//   4. Updates all rows concurrently via Promise.all
//   5. Runs any required question-bank syncs in parallel across all affected tests
router.patch("/tests/bulk-exam-config", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { ids, examConfigPatch } = req.body as { ids: unknown; examConfigPatch: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && id > 0)) {
      return res.status(400).json({ error: "All ids must be positive integers" });
    }
    if (!examConfigPatch || typeof examConfigPatch !== "object" || Array.isArray(examConfigPatch)) {
      return res.status(400).json({ error: "examConfigPatch must be an object" });
    }
    const patch = examConfigPatch as Record<string, unknown>;

    // Fetch all target tests in one round-trip
    const existingTests = await db.select().from(testsTable).where(inArray(testsTable.id, ids as number[]));
    if (existingTests.length === 0) return res.status(404).json({ error: "No tests found" });

    // Merge patch into each test's existing examConfig and update all concurrently
    await Promise.all(
      existingTests.map((test) => {
        const existingCfg = normalizeObjectValue<Record<string, unknown>>(test.examConfig, {}) ?? {};
        const newCfg = { ...existingCfg, ...patch };
        return db.update(testsTable).set({ examConfig: JSON.stringify(newCfg) }).where(eq(testsTable.id, test.id));
      }),
    );

    // If syncWithQuestionBank is being enabled, run question-bank sync in parallel
    // for all tests that are already published (skipped for the disable case).
    if (patch.syncWithQuestionBank === true) {
      const publishedTests = existingTests.filter((t) => {
        const beforeSyncEnabled = normalizeObjectValue<Record<string, unknown>>(t.examConfig, {})?.syncWithQuestionBank === true;
        return t.isPublished && !beforeSyncEnabled;
      });
      if (publishedTests.length > 0) {
        // Fire-and-forget: don't block the response on sync — it can be slow for many tests
        void Promise.all(
          publishedTests.map((t) =>
            syncPublishedTestQuestionsToQuestionBank(t.id, userId, t.examType).catch((err) => {
              logger.error({ err, testId: t.id }, "bulk-exam-config: question bank sync failed");
            }),
          ),
        );
      }
    }

    return res.json({ updated: existingTests.length });
  } catch (error) {
    logger.error({ error }, "PATCH /api/tests/bulk-exam-config failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/tests/reorder — admin reorders tests by displayOrder
router.patch("/tests/reorder", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (user.role !== "admin" && user.role !== "super_admin") return res.status(403).json({ error: "Forbidden" });

    const { orderedIds } = req.body as { orderedIds: number[] };
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: "orderedIds must be a non-empty array" });
    }

    // Validate all IDs are integers to prevent SQL injection in the bulk update
    if (!orderedIds.every((id) => Number.isInteger(id) && id > 0)) {
      return res.status(400).json({ error: "Invalid orderedIds: all values must be positive integers" });
    }

    // Single bulk UPDATE using VALUES list — O(1) round-trips instead of O(N),
    // scales cleanly to hundreds of tests.
    const valuesList = orderedIds.map((id, i) => `(${id}, ${i})`).join(", ");
    await db.execute(
      sql.raw(`UPDATE tests SET display_order = v.ord FROM (VALUES ${valuesList}) AS v(id, ord) WHERE tests.id = v.id`)
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Reorder tests failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tests/review-bucket — all non-correct student test questions grouped later in UI
router.get("/tests/review-bucket", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (user.role !== "student") return res.status(403).json({ error: "Forbidden" });
    if (!ensureStudentFeatureUnlocked(user, "tests", res)) return;
    const dismissedQuestionIds = new Set(
      (user.reviewBucketDismissedQuestionIds ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
    );

    const submissions = await db.select()
      .from(testSubmissionsTable)
      .where(eq(testSubmissionsTable.studentId, userId))
      .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id));

    const latestByTest = new Map<number, typeof submissions[number]>();
    for (const submission of submissions) {
      if (!latestByTest.has(submission.testId)) latestByTest.set(submission.testId, submission);
    }

    const testIds = [...latestByTest.keys()];
    if (testIds.length === 0) return res.json([]);

    const allSubmissions = await db
      .select({
        testId: testSubmissionsTable.testId,
        answers: testSubmissionsTable.answers,
        questionTimings: testSubmissionsTable.questionTimings,
      })
      .from(testSubmissionsTable)
      .where(inArray(testSubmissionsTable.testId, testIds));

    const tests = await db.select({
      id: testsTable.id,
      title: testsTable.title,
      chapterName: chaptersTable.title,
      subjectName: subjectsTable.title,
    }).from(testsTable)
      .leftJoin(chaptersTable, eq(testsTable.chapterId, chaptersTable.id))
      .leftJoin(subjectsTable, eq(chaptersTable.subjectId, subjectsTable.id))
      .where(and(inArray(testsTable.id, testIds), eq(testsTable.isPublished, true)));

    const visibleTestIds = tests.map((test) => test.id);
    if (visibleTestIds.length === 0) return res.json([]);

    const sections = await db.select().from(testSectionsTable)
      .where(inArray(testSectionsTable.testId, visibleTestIds))
      .orderBy(asc(testSectionsTable.order));

    const questions = await db.select().from(testQuestionsTable)
      .where(inArray(testQuestionsTable.testId, visibleTestIds))
      .orderBy(asc(testQuestionsTable.order));
    const questionIds = questions.map((question) => question.id);
    const reports = questionIds.length > 0
      ? await db
          .select()
          .from(testQuestionReportsTable)
          .where(and(
            inArray(testQuestionReportsTable.questionId, questionIds),
            eq(testQuestionReportsTable.reportedBy, userId),
          ))
          .orderBy(desc(testQuestionReportsTable.createdAt), desc(testQuestionReportsTable.id))
      : [];
    const latestReportByQuestionId = new Map<number, typeof reports[number]>();
    for (const report of reports) {
      if (!latestReportByQuestionId.has(report.questionId)) {
        latestReportByQuestionId.set(report.questionId, report);
      }
    }

    const testMetaById = new Map(tests.map((test) => [test.id, test]));
    const sectionById = new Map(sections.map((section) => [section.id, section]));
    const allSubmissionsByTest = new Map<number, typeof allSubmissions>();
    allSubmissions.forEach((submission) => {
      const bucket = allSubmissionsByTest.get(submission.testId) ?? [];
      bucket.push(submission);
      allSubmissionsByTest.set(submission.testId, bucket);
    });

    const entries = questions.flatMap((question) => {
      const submission = latestByTest.get(question.testId);
      if (!submission) return [];
      if (dismissedQuestionIds.has(question.id)) return [];
      const latestReport = latestReportByQuestionId.get(question.id);
      const answers = safeParseJson<Record<string, unknown>>(submission.answers, {});
      const timings = safeParseJson<Record<string, number>>(submission.questionTimings, {});
      const answer = answers[String(question.id)];
      const answered = hasAnsweredQuestion(question, answer);
      const correct = answered && gradeQuestion(question, answer);
      if (correct) return [];

      const testMeta = testMetaById.get(question.testId);
      const section = question.sectionId ? sectionById.get(question.sectionId) : null;
      const meta = safeParseJson<Record<string, unknown> | null>(question.meta, null);
      const chapterName = typeof meta?.chapterName === "string" && meta.chapterName.trim()
        ? meta.chapterName.trim()
        : testMeta?.chapterName ?? "General";
      const topicTag = typeof meta?.topicTag === "string" && meta.topicTag.trim()
        ? meta.topicTag.trim()
        : null;
      const questionTimings = allSubmissionsByTest.get(question.testId) ?? [];
      let attemptedCount = 0;
      let correctCount = 0;
      let wrongCount = 0;
      let skippedCount = 0;
      const recordedTimes: number[] = [];
      const optionCounts = normalizeArrayValue(question.options, []).map(() => 0);

      questionTimings.forEach((item) => {
        const parsedAnswers = safeParseJson<Record<string, unknown>>(item.answers, {});
        const parsedAnswer = parsedAnswers[String(question.id)] ?? parsedAnswers[question.id as unknown as keyof typeof parsedAnswers];
        const didAnswer = hasAnsweredQuestion(question, parsedAnswer);
        if (didAnswer) {
          attemptedCount += 1;
          if (gradeQuestion(question, parsedAnswer)) correctCount += 1;
          else wrongCount += 1;

          if ((question.questionType ?? "mcq") === "mcq") {
            const index = Number(parsedAnswer);
            if (optionCounts[index] !== undefined) optionCounts[index] += 1;
          }

          if ((question.questionType ?? "mcq") === "multi" && Array.isArray(parsedAnswer)) {
            parsedAnswer.forEach((value) => {
              const index = Number(value);
              if (optionCounts[index] !== undefined) optionCounts[index] += 1;
            });
          }
        } else {
          skippedCount += 1;
        }

        const parsedTimings = safeParseJson<Record<string, number>>(item.questionTimings, {});
        const recorded = Number(parsedTimings[String(question.id)] ?? parsedTimings[question.id as unknown as keyof typeof parsedTimings] ?? 0);
        if (Number.isFinite(recorded) && recorded > 0) recordedTimes.push(recorded);
      });

      const totalSubmissions = questionTimings.length;
      const attemptedBase = attemptedCount > 0 ? attemptedCount : 1;
      const averageTimeSeconds =
        recordedTimes.length > 0
          ? Math.round(recordedTimes.reduce((sum, value) => sum + value, 0) / recordedTimes.length)
          : 0;
      const analytics = {
        myTimeSeconds: Number(timings[String(question.id)] ?? timings[question.id as unknown as keyof typeof timings] ?? 0) || 0,
        allottedTimeSeconds: Number(meta?.estimatedTimeSeconds ?? 0) || 0,
        averageTimeSeconds,
        gotRightPercent: attemptedCount > 0 ? Number(((correctCount / attemptedBase) * 100).toFixed(2)) : 0,
        gotWrongPercent: attemptedCount > 0 ? Number(((wrongCount / attemptedBase) * 100).toFixed(2)) : 0,
        skippedPercent: totalSubmissions > 0 ? Number(((skippedCount / totalSubmissions) * 100).toFixed(2)) : 0,
      };
      const optionSelectionPercentages = optionCounts.map((count) =>
        attemptedCount > 0 ? Number(((count / attemptedCount) * 100).toFixed(2)) : 0,
      );
      const subjectLabel =
        (typeof question.subjectLabel === "string" && question.subjectLabel.trim() ? question.subjectLabel.trim() : null) ??
        (typeof section?.subjectLabel === "string" && section.subjectLabel.trim() ? section.subjectLabel.trim() : null) ??
        (typeof section?.title === "string" && section.title.trim() ? section.title.trim() : null) ??
        testMeta?.subjectName ??
        "General";

      return [{
        testId: question.testId,
        questionId: question.id,
        questionIndex: Number(question.order ?? 0),
        status: answered ? "incorrect" : "unattempted",
        subjectLabel,
        chapterName,
        topicTag,
        sectionLabel: section?.title ?? subjectLabel,
        yourAnswerLabel: answered ? formatSubmissionAnswerLabel(question, answer) : "Not attempted",
        correctAnswerLabel: formatQuestionCorrectLabel(question),
        report: latestReport ? serializeTestQuestionReport(latestReport) : null,
        analytics,
        question: {
          ...serializeTestQuestion(question, { showCorrect: true, includeSolutions: true }),
          optionSelectionCounts: optionCounts,
          optionSelectionPercentages,
        },
      }];
    });

    return res.json(entries);
  } catch (error) {
    console.error("GET /api/tests/review-bucket failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tests/review-bucket/:questionId/remove", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const questionId = parseInt(req.params.questionId, 10);
    if (!Number.isFinite(questionId)) return res.status(400).json({ error: "Invalid question id" });

    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (user.role !== "student") return res.status(403).json({ error: "Forbidden" });
    if (!ensureStudentFeatureUnlocked(user, "tests", res)) return;

    const nextDismissedIds = Array.from(
      new Set(
        [...(user.reviewBucketDismissedQuestionIds ?? []), questionId]
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value)),
      ),
    );
    await db
      .update(usersTable)
      .set({
        reviewBucketDismissedQuestionIds: nextDismissedIds,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    return res.json({ ok: true });
  } catch (error) {
    console.error("POST /api/tests/review-bucket/:questionId/remove failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tests/questions/:questionId/report", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const questionId = parseInt(req.params.questionId, 10);
    if (!Number.isFinite(questionId)) return res.status(400).json({ error: "Invalid question id" });

    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (user.role !== "student") return res.status(403).json({ error: "Only students can report questions" });
    if (!ensureStudentFeatureUnlocked(user, "tests", res)) return;

    const [questionRow] = await db
      .select({
        questionId: testQuestionsTable.id,
        questionCode: testQuestionsTable.questionCode,
        testId: testsTable.id,
        testTitle: testsTable.title,
        teacherId: testsTable.createdBy,
      })
      .from(testQuestionsTable)
      .innerJoin(testsTable, eq(testQuestionsTable.testId, testsTable.id))
      .where(eq(testQuestionsTable.id, questionId))
      .limit(1);
    if (!questionRow) return res.status(404).json({ error: "Question not found" });

    const [submission] = await db
      .select({ id: testSubmissionsTable.id })
      .from(testSubmissionsTable)
      .where(and(
        eq(testSubmissionsTable.testId, questionRow.testId),
        eq(testSubmissionsTable.studentId, userId),
      ))
      .limit(1);
    if (!submission) {
      return res.status(403).json({ error: "You can report only after submitting this test" });
    }

    if (!questionRow.teacherId) {
      return res.status(400).json({ error: "No teacher is assigned for this test yet" });
    }
    const teacherId = questionRow.teacherId;

    const [existingOpenReport] = await db
      .select({ id: testQuestionReportsTable.id })
      .from(testQuestionReportsTable)
      .where(and(
        eq(testQuestionReportsTable.questionId, questionId),
        eq(testQuestionReportsTable.reportedBy, userId),
        eq(testQuestionReportsTable.status, "open"),
      ))
      .limit(1);
    if (existingOpenReport) {
      return res.status(409).json({ error: "You already have an open report for this question" });
    }

    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "Student reported an issue with this question";
    const now = new Date();
    const inserted = await executeD1Sql(testReportInsert, [questionRow.testId, questionId, userId, teacherId, reason, now, now, questionId, userId]);
    if (!inserted.rows.length) return res.status(409).json({ error: pendingReportMessage, pending: true });
    const [report] = await db.select().from(testQuestionReportsTable).where(eq(testQuestionReportsTable.id, Number(inserted.rows[0].id))).limit(1);

    const reporterLabel =
      (typeof user.fullName === "string" && user.fullName.trim() ? user.fullName.trim() : null) ??
      (typeof user.username === "string" && user.username.trim() ? user.username.trim() : null) ??
      "A student";
    const questionLabel = questionRow.questionCode?.trim() || `Question ${questionId}`;
    await pushNotificationToMany([teacherId], {
      type: "test",
      title: "Question reported",
      message: `${reporterLabel} reported ${questionLabel} in ${questionRow.testTitle}.`,
      link: `/admin/tests/${questionRow.testId}/builder?questionId=${questionId}`,
    });

    void (async () => {
      if (!(await hasBrevoAccounts())) return;

      const [teacher] = await db
        .select({
          email: usersTable.email,
          fullName: usersTable.fullName,
          username: usersTable.username,
        })
        .from(usersTable)
        .where(eq(usersTable.id, teacherId))
        .limit(1);

      const studentName = getDisplayName(user, "Student");
      const studentActionUrl = buildPortalUrl(`/student/tests/${questionRow.testId}/solutions`);
      const teacherActionUrl = buildPortalUrl(`/admin/tests/${questionRow.testId}/builder?questionId=${questionId}`);

      if (typeof user.email === "string" && user.email.trim()) {
        queueStudentQuestionReportAcknowledgementEmail({
          studentName,
          email: user.email.trim(),
          questionLabel,
          contextTitle: questionRow.testTitle,
          reason,
          actionUrl: studentActionUrl,
        });
      }

      if (typeof teacher?.email === "string" && teacher.email.trim()) {
        queueTeacherQuestionReportAlertEmail({
          teacherName: getDisplayName(teacher, "Teacher"),
          email: teacher.email.trim(),
          studentName,
          questionLabel,
          contextTitle: questionRow.testTitle,
          reason,
          actionUrl: teacherActionUrl,
        });
      }
    })().catch((error) => {
      logger.warn({ error, questionId, testId: questionRow.testId }, "Failed to queue question report emails");
    });

    return res.status(201).json(serializeTestQuestionReport(report, user));
  } catch (error) {
    console.error("POST /api/tests/questions/:questionId/report failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/tests/question-reports/:reportId", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const reportId = parseInt(req.params.reportId, 10);
    if (!Number.isFinite(reportId)) return res.status(400).json({ error: "Invalid report id" });

    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (user.role !== "admin" && user.role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const [report] = await db
      .select({
        id: testQuestionReportsTable.id,
        testId: testQuestionReportsTable.testId,
        questionId: testQuestionReportsTable.questionId,
        reportedBy: testQuestionReportsTable.reportedBy,
        teacherId: testQuestionReportsTable.teacherId,
        reason: testQuestionReportsTable.reason,
        status: testQuestionReportsTable.status,
        teacherNote: testQuestionReportsTable.teacherNote,
        createdAt: testQuestionReportsTable.createdAt,
        updatedAt: testQuestionReportsTable.updatedAt,
        testTitle: testsTable.title,
        questionCode: testQuestionsTable.questionCode,
      })
      .from(testQuestionReportsTable)
      .innerJoin(testsTable, eq(testQuestionReportsTable.testId, testsTable.id))
      .innerJoin(testQuestionsTable, eq(testQuestionReportsTable.questionId, testQuestionsTable.id))
      .where(eq(testQuestionReportsTable.id, reportId))
      .limit(1);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (user.role !== "super_admin" && report.teacherId !== userId) {
      return res.status(403).json({ error: "Only the assigned teacher can manage this report" });
    }

    const nextStatus = req.body?.status === "resolved" ? "resolved" : req.body?.status === "rejected" ? "rejected" : null;
    if (!nextStatus) return res.status(400).json({ error: "A valid status is required" });
    const teacherNote =
      typeof req.body?.teacherNote === "string" && req.body.teacherNote.trim()
        ? req.body.teacherNote.trim()
        : null;

    const [updatedReport] = await db
      .update(testQuestionReportsTable)
      .set({
        status: nextStatus,
        teacherNote,
        updatedAt: new Date(),
      })
      .where(eq(testQuestionReportsTable.id, reportId))
      .returning();
    if (!updatedReport) return res.status(404).json({ error: "Report not found" });

    const title = nextStatus === "rejected" ? "Question report rejected" : "Question report resolved";
    const message = nextStatus === "rejected"
      ? `Your report for a question in ${report.testTitle} was reviewed and rejected.`
      : `Your reported question in ${report.testTitle} has been resolved.`;
    await pushNotificationToMany([report.reportedBy], {
      type: "test",
      title,
      message: teacherNote ? `${message} ${teacherNote}` : message,
      link: `/student/tests/${report.testId}/solutions`,
    });

    if (nextStatus === "rejected") {
      void (async () => {
        if (!(await hasBrevoAccounts())) return;
        const [reporter] = await db
          .select({
            email: usersTable.email,
            fullName: usersTable.fullName,
            username: usersTable.username,
          })
          .from(usersTable)
          .where(eq(usersTable.id, report.reportedBy))
          .limit(1);

        if (typeof reporter?.email !== "string" || !reporter.email.trim()) return;

        queueStudentQuestionReportRejectedEmail({
          studentName: getDisplayName(reporter, "Student"),
          email: reporter.email.trim(),
          questionLabel: report.questionCode?.trim() || `Question ${report.questionId}`,
          contextTitle: report.testTitle,
          actionUrl: buildPortalUrl(`/student/tests/${report.testId}/solutions`),
        });
      })().catch((error) => {
        logger.warn({ error, reportId, testId: report.testId }, "Failed to queue question report rejected email");
      });
    }

    return res.json(serializeTestQuestionReport(updatedReport));
  } catch (error) {
    console.error("PATCH /api/tests/question-reports/:reportId failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tests/:id — test detail with questions
router.get("/tests/:id", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const [test] = await db.select({
      id: testsTable.id,
      classId: testsTable.classId,
      chapterId: testsTable.chapterId,
      title: testsTable.title,
      description: testsTable.description,
      examType: testsTable.examType,
      examHeader: testsTable.examHeader,
      examSubheader: testsTable.examSubheader,
      instructions: testsTable.instructions,
      examConfig: testsTable.examConfig,
      durationMinutes: testsTable.durationMinutes,
      passingScore: testsTable.passingScore,
      defaultPositiveMarks: testsTable.defaultPositiveMarks,
      defaultNegativeMarks: testsTable.defaultNegativeMarks,
      isPublished: testsTable.isPublished,
      scheduledAt: testsTable.scheduledAt,
      createdBy: testsTable.createdBy,
      createdAt: testsTable.createdAt,
      className: classesTable.title,
      chapterName: chaptersTable.title,
      subjectName: subjectsTable.title,
    }).from(testsTable)
      .leftJoin(classesTable, eq(testsTable.classId, classesTable.id))
      .leftJoin(chaptersTable, eq(testsTable.chapterId, chaptersTable.id))
      .leftJoin(subjectsTable, eq(chaptersTable.subjectId, subjectsTable.id))
      .where(eq(testsTable.id, testId));
    if (!test) return res.status(404).json({ error: "Test not found" });

    const questions = await db.select().from(testQuestionsTable)
      .where(eq(testQuestionsTable.testId, testId)).orderBy(testQuestionsTable.order);
    const rawSections = await db.select().from(testSectionsTable)
      .where(eq(testSectionsTable.testId, testId)).orderBy(testSectionsTable.order);
    const syncedOrExistingSections = shouldPreserveImportedSections(test.examConfig) || rawSections.length > 0
      ? rawSections.map((section) => ({ ...section, meta: safeParseJson(section.meta, null) }))
      : await syncTestSectionsFromTemplate(test.id, test.examType, rawSections);
    const builderReady = await ensureBuilderSectionsForTest({
      testId: test.id,
      test,
      rawSections: syncedOrExistingSections,
      questions,
    });
    const sections = builderReady.sections;
    const resolvedQuestions = builderReady.questions;

    const isAdmin = user.role === "admin" || user.role === "super_admin";
    let submission: typeof testSubmissionsTable.$inferSelect | null = null;
    if (user.role === "student") {
      if (!ensureStudentFeatureUnlocked(user, "tests", res)) return;
      const [sub] = await db.select().from(testSubmissionsTable)
        .where(and(eq(testSubmissionsTable.testId, testId), eq(testSubmissionsTable.studentId, userId)))
        .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id))
        .limit(1);
      submission = sub ?? null;

      const access = {
        enrolledClassIds: await getStudentEnrolledClassIds(userId),
        examKeys: getStudentExamKeys(user),
      };
      const canAccess = submission !== null || (Boolean(test.isPublished) && canStudentAccessTest(test, access));
      if (!canAccess) return res.status(403).json({ error: "Forbidden" });
    }

    const richSubmission = submission ? {
      ...submission,
      questionTimings: safeParseJson(submission.questionTimings, null),
      flaggedQuestions: safeParseJson(submission.flaggedQuestions, null),
      visitedQuestionIds: safeParseJson(submission.visitedQuestionIds, null),
      reviewQuestionIds: safeParseJson(submission.reviewQuestionIds, null),
      interactionLog: safeParseJson(submission.interactionLog, null),
    } : null;

    const showCorrect = isAdmin || submission !== null;
    const reports = isAdmin
      ? await db
          .select()
          .from(testQuestionReportsTable)
          .where(eq(testQuestionReportsTable.testId, testId))
          .orderBy(desc(testQuestionReportsTable.createdAt), desc(testQuestionReportsTable.id))
      : [];
    const reporterIds = [...new Set(reports.map((report) => report.reportedBy).filter((value) => Number.isFinite(value)))];
    const reporters = reporterIds.length > 0
      ? await db
          .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username })
          .from(usersTable)
          .where(inArray(usersTable.id, reporterIds))
      : [];
    const reporterMap = new Map(
      reporters.map((reporter) => [reporter.id, reporter] as const),
    );
    const questionReportsByQuestionId = buildQuestionReportsByQuestionId(reports, reporterMap);
    const safeQuestions = resolvedQuestions.map((q) => {
      const serialized = serializeTestQuestion(q, { showCorrect, includeSolutions: showCorrect }) as Record<string, unknown>;
      if (isAdmin) {
        const questionReports = questionReportsByQuestionId.get(q.id) ?? [];
        serialized.reports = questionReports;
        serialized.openReportCount = questionReports.filter((report) => report.status === "open").length;
        serialized.totalReportCount = questionReports.length;
      }
      return serialized;
    });

    return res.json({ ...test, examConfig: normalizeObjectValue(test.examConfig, null), sections, questions: safeQuestions, submission: richSubmission });
  } catch (error) {
    console.error("GET /api/tests/:id failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tests/:id/export — export a full test bundle with sections + questions
router.get("/tests/:id/export", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || (user.role !== "admin" && user.role !== "super_admin")) return res.status(403).json({ error: "Forbidden" });

    const [test] = await db.select().from(testsTable).where(eq(testsTable.id, testId));
    if (!test) return res.status(404).json({ error: "Test not found" });

    const rawSections = await db.select().from(testSectionsTable)
      .where(eq(testSectionsTable.testId, testId))
      .orderBy(asc(testSectionsTable.order));
    const sections = shouldPreserveImportedSections(test.examConfig)
      ? rawSections.map((section) => ({ ...section, meta: safeParseJson(section.meta, null) }))
      : await syncTestSectionsFromTemplate(test.id, test.examType, rawSections);
    const questions = await db.select().from(testQuestionsTable)
      .where(eq(testQuestionsTable.testId, testId))
      .orderBy(asc(testQuestionsTable.order));
    const sectionById = new Map(sections.map((section) => [section.id, section]));

    const bundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      source: {
        testId: test.id,
        title: test.title,
        examType: test.examType,
      },
      test: {
        title: test.title,
        description: test.description ?? null,
        examType: test.examType,
        examHeader: test.examHeader ?? null,
        examSubheader: test.examSubheader ?? null,
        instructions: test.instructions ?? null,
        examConfig: normalizeObjectValue(test.examConfig, null),
        durationMinutes: test.durationMinutes,
        passingScore: test.passingScore ?? null,
        defaultPositiveMarks: test.defaultPositiveMarks,
        defaultNegativeMarks: test.defaultNegativeMarks,
        scheduledAt: test.scheduledAt ? new Date(test.scheduledAt).toISOString() : null,
        sections: sections.map((section, index) => ({
          exportRef: `section-${section.id}`,
          title: section.title,
          description: section.description ?? null,
          subjectLabel: section.subjectLabel ?? null,
          questionCount: section.questionCount ?? null,
          marksPerQuestion: section.marksPerQuestion ?? null,
          negativeMarks: section.negativeMarks ?? null,
          meta: normalizeObjectValue(section.meta, null),
          order: section.order ?? index,
        })),
        questions: questions.map((question, index) => {
          const meta = normalizeObjectValue<Record<string, unknown> | null>(question.meta, null);
          const section = question.sectionId ? sectionById.get(question.sectionId) ?? null : null;
          const sectionLabel = firstTrimmedString(
            question.subjectLabel,
            section?.subjectLabel,
            section?.title,
          );
          const resolvedTaxonomy = resolveStoredQuestionTaxonomy(meta, sectionLabel);
          const subjectName = resolvedTaxonomy.subjectName;
          const chapterName = resolvedTaxonomy.chapterName;
          const topicTag = firstTrimmedString(meta?.topicTag, meta?.topic, meta?.topicName);
          const difficulty = normalizeTestDifficultyValue(firstTrimmedString(meta?.difficulty));
          const idealTimeSeconds =
            parseImportedNumericValue(meta?.estimatedTimeSeconds) ??
            parseImportedNumericValue(meta?.idealTimeSeconds);
          const normalizedIntegerAnswer =
            (question.questionType ?? "mcq") === "integer"
              ? normalizeSerializedIntegerAnswer(question)
              : null;
          return {
            question: question.question,
            questionType: question.questionType ?? "mcq",
            sectionRef: question.sectionId ? `section-${question.sectionId}` : null,
            section: sectionLabel,
            sectionLabel,
            questionCode: question.questionCode ?? null,
            sourceType: question.sourceType ?? "manual",
            subjectLabel: sectionLabel,
            subject: subjectName,
            subjectName,
            chapter: chapterName,
            chapterName,
            difficulty,
            difficultyLevel: difficulty,
            idealTimeSeconds,
            estimatedTimeSeconds: idealTimeSeconds,
            topic: topicTag,
            topicTag,
            options: normalizeArrayValue<string>(question.options, []),
            optionImages: normalizeArrayValue<string | null>(question.optionImages, []),
            correctAnswer: normalizedIntegerAnswer?.correctAnswer ?? question.correctAnswer,
            correctAnswerMulti: normalizeArrayValue<number>(question.correctAnswerMulti, []),
            correctAnswerMin: normalizedIntegerAnswer?.correctAnswerMin ?? null,
            correctAnswerMax: normalizedIntegerAnswer?.correctAnswerMax ?? null,
            points: question.points,
            negativeMarks: question.negativeMarks ?? 0,
            meta,
            solutionText: question.solutionText ?? null,
            solutionImageData: question.solutionImageData ?? null,
            order: question.order ?? index,
            imageData: question.imageData ?? null,
          };
        }),
      },
    };

    return res.json(bundle);
  } catch (error) {
    console.error("GET /api/tests/:id/export failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tests — create test
router.post("/tests", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const { title, description, examType, examHeader, examSubheader, instructions, examConfig, durationMinutes, passingScore, defaultPositiveMarks, defaultNegativeMarks, scheduledAt, sections } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });

    const resolvedExamType = examType ? String(examType) : "custom";
    const [template] = resolvedExamType && resolvedExamType !== "custom"
      ? await db.select().from(examTemplatesTable).where(eq(examTemplatesTable.key, resolvedExamType))
      : [null];

    const resolvedDuration = durationMinutes ? Number(durationMinutes) : template?.durationMinutes ?? 30;
    const resolvedInstructions = typeof instructions === "string"
      ? (instructions.trim() || null)
      : template?.instructions?.trim() || null;

    // Place the new test at the end of the current admin's list
    const [maxRow] = await db
      .select({ maxOrder: sql<number>`coalesce(max(${testsTable.displayOrder}), -1)` })
      .from(testsTable)
      .where(eq(testsTable.createdBy, userId));
    const nextDisplayOrder = (maxRow?.maxOrder ?? -1) + 1;

    const [test] = await db.insert(testsTable).values({
      classId: null,
      chapterId: null,
      title: String(title), description: description ? String(description) : null,
      examType: resolvedExamType,
      examHeader: examHeader ? String(examHeader) : template?.examHeader ?? null,
      examSubheader: examSubheader ? String(examSubheader) : template?.examSubheader ?? null,
      instructions: resolvedInstructions,
      examConfig: examConfig ? JSON.stringify(examConfig) : null,
      durationMinutes: resolvedDuration,
      passingScore: passingScore === undefined || passingScore === null || String(passingScore).trim() === ""
        ? template?.passingScore ?? null
        : Number(passingScore),
      defaultPositiveMarks: defaultPositiveMarks !== undefined ? Number(defaultPositiveMarks) : template?.defaultPositiveMarks ?? 1,
      defaultNegativeMarks: defaultNegativeMarks !== undefined ? Number(defaultNegativeMarks) : template?.defaultNegativeMarks ?? 0,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      createdBy: userId,
      displayOrder: nextDisplayOrder,
    }).returning();
    if (Array.isArray(sections) && sections.length > 0) {
      await db.insert(testSectionsTable).values(
        sections.map((section: any, index: number) => ({
          testId: test.id,
          title: String(section.title),
          description: section.description ? String(section.description) : null,
          subjectLabel: section.subjectLabel ? String(section.subjectLabel) : null,
          questionCount: section.questionCount !== undefined ? Number(section.questionCount) : null,
          marksPerQuestion: section.marksPerQuestion !== undefined ? Number(section.marksPerQuestion) : null,
          negativeMarks: section.negativeMarks !== undefined ? Number(section.negativeMarks) : null,
          meta: section.meta ? JSON.stringify(section.meta) : null,
          order: index,
        })),
      );
    }
    return res.status(201).json(test);
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// POST /api/tests/import — recreate a full test from an exported bundle
router.post("/tests/import", requireAuth, async (req, res) => {
  (req.socket as any)?.setTimeout?.(600_000);
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const payload = req.body?.test ? req.body : { test: req.body };
    const test = payload?.test;
    if (!test || typeof test !== "object") return res.status(400).json({ error: "Invalid import payload" });
    const importDefaults = normalizeObjectValue<Record<string, unknown> | null>(payload?.importDefaults, null);

    const title = typeof test.title === "string" ? test.title.trim() : "";
    if (!title) return res.status(400).json({ error: "Imported test title missing" });

    const importedSections = Array.isArray(test.sections) ? test.sections : [];
    const questions = Array.isArray(test.questions) ? test.questions : [];
    const importedExamConfig = normalizeObjectValue<Record<string, unknown> | null>(test.examConfig, null);
    const normalizedExamType = normalizeExamKey(test.examType) ?? (typeof test.examType === "string" && test.examType.trim() ? test.examType.trim() : "custom");
    const [matchedTemplate] = normalizedExamType && normalizedExamType !== "custom"
      ? await db.select().from(examTemplatesTable).where(eq(examTemplatesTable.key, normalizedExamType)).limit(1)
      : [null];

    const preserveImportedSections = importedSections.length > 0;
    const storedExamConfig = preserveImportedSections
      ? { ...(importedExamConfig ?? {}), preserveImportedSections: true }
      : importedExamConfig;
    const templateSections = matchedTemplate
      ? normalizeArrayValue<Record<string, unknown>>(matchedTemplate.sections, [])
      : [];
    const resolvedSections = importedSections.length > 0
      ? importedSections
      : templateSections.length > 0
        ? templateSections
        : importedSections;
    const importDefaultSubjectName = sanitizeExplicitTaxonomyValue(importDefaults?.subjectName);
    const importDefaultChapterName = sanitizeExplicitTaxonomyValue(importDefaults?.chapterName);
    const importDefaultDifficulty = normalizeTestDifficultyValue(importDefaults?.difficulty);
    const importDefaultIdealTimeSeconds = parseImportedNumericValue(importDefaults?.idealTimeSeconds);
    let pendingReviewCount = 0;

    const normalizeSectionLabel = (value: unknown) =>
      typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";

    const importedSectionsByRef = new Map<string, any>();
    const importedSectionsByLabel = new Map<string, any>();
    importedSections.forEach((section: any, index: number) => {
      const ref = String(section.exportRef ?? `section-${index}`);
      importedSectionsByRef.set(ref, section);
      const label = normalizeSectionLabel(section.subjectLabel ?? section.title);
      if (label && !importedSectionsByLabel.has(label)) importedSectionsByLabel.set(label, section);
    });

    // If the filename carried a numeric prefix (e.g. "002_…" → 2) the frontend
    // embeds it as test.displayOrder so the imported test lands in the right
    // position. Otherwise fall back to appending at the end of the list.
    const filenameDisplayOrder =
      typeof test.displayOrder === "number" && Number.isFinite(test.displayOrder)
        ? (test.displayOrder as number)
        : null;
    let importDisplayOrder: number;
    if (filenameDisplayOrder !== null) {
      importDisplayOrder = filenameDisplayOrder;
    } else {
      const [importMaxRow] = await db
        .select({ maxOrder: sql<number>`coalesce(max(${testsTable.displayOrder}), -1)` })
        .from(testsTable)
        .where(eq(testsTable.createdBy, userId));
      importDisplayOrder = (importMaxRow?.maxOrder ?? -1) + 1;
    }

    const [createdTest] = await db.insert(testsTable).values({
      classId: null,
      chapterId: null,
      title,
      description: typeof test.description === "string" && test.description.trim() ? test.description.trim() : null,
      examType: normalizedExamType,
      examHeader: typeof test.examHeader === "string" && test.examHeader.trim() ? test.examHeader.trim() : matchedTemplate?.examHeader ?? null,
      examSubheader: typeof test.examSubheader === "string" && test.examSubheader.trim() ? test.examSubheader.trim() : matchedTemplate?.examSubheader ?? null,
      instructions: typeof test.instructions === "string" && test.instructions.trim() ? test.instructions.trim() : null,
      examConfig: storedExamConfig ? JSON.stringify(storedExamConfig) : null,
      durationMinutes: Number(test.durationMinutes) || matchedTemplate?.durationMinutes || 30,
      passingScore: test.passingScore === undefined || test.passingScore === null || String(test.passingScore).trim() === "" ? null : Number(test.passingScore),
      defaultPositiveMarks: test.defaultPositiveMarks !== undefined ? Number(test.defaultPositiveMarks) : matchedTemplate?.defaultPositiveMarks ?? 1,
      defaultNegativeMarks: test.defaultNegativeMarks !== undefined ? Number(test.defaultNegativeMarks) : matchedTemplate?.defaultNegativeMarks ?? 0,
      scheduledAt: typeof test.scheduledAt === "string" && test.scheduledAt.trim() ? new Date(test.scheduledAt) : null,
      createdBy: userId,
      isPublished: false,
      displayOrder: importDisplayOrder,
    }).returning();

    const sectionIdMap = new Map<string, number>();
    const createdSections: Array<{ id: number; label: string; displayLabel: string | null; index: number }> = [];
    for (let index = 0; index < resolvedSections.length; index += 1) {
      const section = resolvedSections[index] as any;
      const templateLabel = normalizeSectionLabel(section.subjectLabel ?? section.title);
      const importedMatch = templateSections.length > 0
        ? importedSectionsByLabel.get(templateLabel) ?? importedSections[index] ?? null
        : importedSections[index] ?? null;

      const [createdSection] = await db.insert(testSectionsTable).values({
        testId: createdTest.id,
        title: typeof section.title === "string" && section.title.trim() ? section.title.trim() : `Section ${index + 1}`,
        description: typeof section.description === "string" && section.description.trim()
          ? section.description.trim()
          : (typeof importedMatch?.description === "string" && importedMatch.description.trim() ? importedMatch.description.trim() : null),
        subjectLabel: typeof section.subjectLabel === "string" && section.subjectLabel.trim()
          ? section.subjectLabel.trim()
          : (typeof importedMatch?.subjectLabel === "string" && importedMatch.subjectLabel.trim() ? importedMatch.subjectLabel.trim() : null),
        questionCount: section.questionCount === undefined || section.questionCount === null || String(section.questionCount).trim() === ""
          ? (importedMatch?.questionCount === undefined || importedMatch?.questionCount === null || String(importedMatch.questionCount).trim() === "" ? null : Number(importedMatch.questionCount))
          : Number(section.questionCount),
        marksPerQuestion: section.marksPerQuestion === undefined || section.marksPerQuestion === null || String(section.marksPerQuestion).trim() === ""
          ? (importedMatch?.marksPerQuestion === undefined || importedMatch?.marksPerQuestion === null || String(importedMatch.marksPerQuestion).trim() === "" ? null : Number(importedMatch.marksPerQuestion))
          : Number(section.marksPerQuestion),
        negativeMarks: section.negativeMarks === undefined || section.negativeMarks === null || String(section.negativeMarks).trim() === ""
          ? (importedMatch?.negativeMarks === undefined || importedMatch?.negativeMarks === null || String(importedMatch.negativeMarks).trim() === "" ? null : Number(importedMatch.negativeMarks))
          : Number(section.negativeMarks),
        meta: section.meta ? JSON.stringify(section.meta) : (importedMatch?.meta ? JSON.stringify(importedMatch.meta) : null),
        order: section.order !== undefined ? Number(section.order) : index,
      }).returning();
      createdSections.push({
        id: createdSection.id,
        label: normalizeSectionLabel(createdSection.subjectLabel ?? createdSection.title),
        displayLabel: firstTrimmedString(createdSection.subjectLabel, createdSection.title),
        index,
      });
      if (importedMatch) {
        sectionIdMap.set(String(importedMatch.exportRef ?? `section-${index}`), createdSection.id);
      }
      sectionIdMap.set(String(section.exportRef ?? `section-${index}`), createdSection.id);
    }

    for (let index = 0; index < importedSections.length; index += 1) {
      const importedSection = importedSections[index] as any;
      const ref = String(importedSection.exportRef ?? `section-${index}`);
      if (sectionIdMap.has(ref)) continue;
      const importedLabel = normalizeSectionLabel(importedSection.subjectLabel ?? importedSection.title);
      const matchedCreatedSection =
        createdSections.find((section) => section.label && section.label === importedLabel) ??
        createdSections[index] ??
        createdSections[0];
      if (matchedCreatedSection) sectionIdMap.set(ref, matchedCreatedSection.id);
    }

    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      const questionSectionLabel = firstTrimmedString(
        question.section,
        question.sectionLabel,
        question.subjectLabel,
        importedSectionsByRef.get(String(question.sectionRef ?? ""))?.subjectLabel,
        importedSectionsByRef.get(String(question.sectionRef ?? ""))?.title,
      );
      const matchedSection =
        question.sectionRef
          ? createdSections.find((section) => section.id === (sectionIdMap.get(String(question.sectionRef)) ?? -1)) ?? null
          : questionSectionLabel
            ? createdSections.find((section) => section.label === normalizeSectionLabel(questionSectionLabel)) ?? null
            : null;
      const sectionId = matchedSection?.id ?? (question.sectionRef ? sectionIdMap.get(String(question.sectionRef)) ?? null : null);
      const importedMeta = normalizeObjectValue<Record<string, unknown> | null>(question.meta, null);
      const requestedQuestionType = normalizeImportedQuestionType(
        firstTrimmedString(
          question.questionType,
          question.type,
          importedMeta?.questionType,
          importedMeta?.type,
        ),
      );
      const options = normalizeArrayValue<string>(question.options, []);
      const optionImages = normalizeArrayValue<string | null>(question.optionImages, []);
      const resolvedImportedTaxonomy = resolveStoredQuestionTaxonomy(importedMeta, questionSectionLabel ?? matchedSection?.displayLabel ?? null);
      const correctAnswerMulti = normalizeImportedAnswerIndices(
        question.correctAnswerMulti ??
        question.correctAnswers ??
        question.answers ??
        (requestedQuestionType === "multi" ? (question.correctAnswer ?? question.answer) : null) ??
        importedMeta?.correctAnswerMulti ??
        importedMeta?.correctAnswers ??
        importedMeta?.answers ??
        (requestedQuestionType === "multi" ? (importedMeta?.correctAnswer ?? importedMeta?.answer) : null),
        options.length,
      );
      const correctAnswerRangeFromQuestion = extractImportedNumericRange(question.correctAnswerRange);
      const fallbackQuestionRange = extractImportedNumericRange(question.answerRange);
      const correctAnswerRange = {
        min: correctAnswerRangeFromQuestion.min ?? fallbackQuestionRange.min,
        max: correctAnswerRangeFromQuestion.max ?? fallbackQuestionRange.max,
      };
      const metaCorrectAnswerRange = extractImportedNumericRange(importedMeta?.correctAnswerRange);
      const metaFallbackRange = extractImportedNumericRange(importedMeta?.answerRange);
      const metaAnswerRange = {
        min: metaCorrectAnswerRange.min ?? metaFallbackRange.min,
        max: metaCorrectAnswerRange.max ?? metaFallbackRange.max,
      };
      const solutionText = firstTrimmedString(
        question.solutionText,
        importedMeta?.solutionText,
        question.aiSolutionText,
        importedMeta?.aiSolutionText,
      );
      const solutionAnswer = extractNumericAnswerFromSolution(solutionText);
      const solutionRange = {
        min: solutionAnswer.min,
        max: solutionAnswer.max,
      };
      const correctAnswerIndex = parseImportedOptionIndex(
        question.correctAnswer ??
        question.answer ??
        importedMeta?.correctAnswer ??
        importedMeta?.answer,
        options.length,
      );
      const exactIntegerAnswer =
        parseImportedNumericValue(question.correctAnswer) ??
        parseImportedNumericValue(question.answer) ??
        parseImportedNumericValue(importedMeta?.correctAnswer) ??
        parseImportedNumericValue(importedMeta?.answer);
      const explicitCorrectAnswerMin =
        parseImportedNumericValue(question.correctAnswerMin) ??
        parseImportedNumericValue(question.answerMin) ??
        parseImportedNumericValue(question.rangeMin) ??
        parseImportedNumericValue(importedMeta?.correctAnswerMin) ??
        parseImportedNumericValue(importedMeta?.answerMin) ??
        parseImportedNumericValue(importedMeta?.rangeMin);
      const explicitCorrectAnswerMax =
        parseImportedNumericValue(question.correctAnswerMax) ??
        parseImportedNumericValue(question.answerMax) ??
        parseImportedNumericValue(question.rangeMax) ??
        parseImportedNumericValue(importedMeta?.correctAnswerMax) ??
        parseImportedNumericValue(importedMeta?.answerMax) ??
        parseImportedNumericValue(importedMeta?.rangeMax);
      let correctAnswerMin = explicitCorrectAnswerMin ?? correctAnswerRange.min ?? metaAnswerRange.min;
      let correctAnswerMax = explicitCorrectAnswerMax ?? correctAnswerRange.max ?? metaAnswerRange.max;
      let exactAnswer = exactIntegerAnswer;
      const canInferIntegerRangeFromText = requestedQuestionType === "integer" || options.length === 0;
      if (
        canInferIntegerRangeFromText &&
        solutionRange.min !== null &&
        solutionRange.max !== null &&
        solutionRange.min <= solutionRange.max
      ) {
        // Teacher solution is authoritative. Do not preserve a half-imported
        // `min=1, max=null` when the first line says `1.3 (1.0 - 1.5)`.
        correctAnswerMin = solutionRange.min;
        correctAnswerMax = solutionRange.max;
        exactAnswer = null;
      } else if (
        canInferIntegerRangeFromText &&
        exactAnswer === null &&
        solutionAnswer.exact !== null
      ) {
        // Numeric/NAT answers can be decimal values such as 0.125 or 1.3.
        exactAnswer = solutionAnswer.exact;
      }
      const questionType =
        requestedQuestionType === "multi" || correctAnswerMulti.length > 1
          ? "multi"
          : requestedQuestionType === "integer" || (options.length === 0 && correctAnswerMin !== null && correctAnswerMax !== null)
            ? "integer"
            : "mcq";
      const subjectLabel = firstTrimmedString(
        question.subjectLabel,
        importedMeta?.subjectLabel,
        question.section,
        question.sectionLabel,
        matchedSection?.displayLabel,
      );
      const topicTag = firstTrimmedString(
        question.topicTag,
        importedMeta?.topicTag,
        question.topicName,
        importedMeta?.topicName,
        question.topic,
        importedMeta?.topic,
      );
      const rawSubjectName = firstTrimmedString(
        question.subject,
        question.subjectName,
        resolvedImportedTaxonomy.subjectName,
      );
      const rawChapterName = firstTrimmedString(
        question.chapter,
        question.chapterName,
        question.chapterTitle,
        importedMeta?.chapterTitle,
        resolvedImportedTaxonomy.chapterName,
      );
      const sanitizedSubjectName = sanitizeExplicitTaxonomyValue(rawSubjectName);
      const sanitizedChapterName = sanitizeExplicitTaxonomyValue(rawChapterName);
      const normalizedTaxonomy = normalizeResolvedTaxonomy({
        subjectName: sanitizedSubjectName,
        chapterName: sanitizedChapterName,
        topicTag,
      });
      const subjectName = normalizedTaxonomy.subjectName ?? importDefaultSubjectName;
      const chapterName = normalizedTaxonomy.chapterName ?? importDefaultChapterName;
      const difficulty =
        normalizeTestDifficultyValue(
        firstTrimmedString(
          question.difficulty,
          question.difficultyLevel,
          importedMeta?.difficulty,
        ),
        ) ?? importDefaultDifficulty;
      const estimatedTimeSecondsRaw =
        question.idealTimeSeconds ??
        question.estimatedTimeSeconds ??
        question.idealTime ??
        importedMeta?.estimatedTimeSeconds ??
        importedMeta?.idealTimeSeconds ??
        importedMeta?.idealTime ??
        null;
      const estimatedTimeSeconds =
        estimatedTimeSecondsRaw === undefined || estimatedTimeSecondsRaw === null || String(estimatedTimeSecondsRaw).trim() === ""
          ? importDefaultIdealTimeSeconds
          : Number(estimatedTimeSecondsRaw);
      const hasCorrectAnswer =
        questionType === "multi"
          ? correctAnswerMulti.length > 0
          : questionType === "integer"
            ? exactAnswer !== null || (correctAnswerMin !== null && correctAnswerMax !== null)
            : correctAnswerIndex !== null;
      const needsSubjectName = !subjectName;
      const needsChapterName = !chapterName;
      const needsDifficulty = !difficulty;
      const needsIdealTimeSeconds = estimatedTimeSeconds === null || !Number.isFinite(estimatedTimeSeconds);
      const needsCorrectAnswer = !hasCorrectAnswer;
      const needsQuestionSetup = needsSubjectName || needsChapterName || needsDifficulty || needsIdealTimeSeconds || needsCorrectAnswer;
      if (needsQuestionSetup) pendingReviewCount += 1;
      const {
        needsSubjectName: _needsSubjectName,
        needsChapterName: _needsChapterName,
        needsDifficulty: _needsDifficulty,
        needsIdealTimeSeconds: _needsIdealTimeSeconds,
        needsCorrectAnswer: _needsCorrectAnswer,
        needsQuestionSetup: _needsQuestionSetup,
        ...baseImportedMeta
      } = importedMeta ?? {};
      const normalizedMeta = {
        ...baseImportedMeta,
        ...(difficulty ? { difficulty } : {}),
        ...(estimatedTimeSeconds !== null && Number.isFinite(estimatedTimeSeconds) ? { estimatedTimeSeconds } : {}),
        ...(subjectName ? { subjectName } : {}),
        ...(chapterName ? { chapterName } : {}),
        ...(topicTag ? { topicTag } : {}),
        ...(needsSubjectName ? { needsSubjectName: true } : {}),
        ...(needsChapterName ? { needsChapterName: true } : {}),
        ...(needsDifficulty ? { needsDifficulty: true } : {}),
        ...(needsIdealTimeSeconds ? { needsIdealTimeSeconds: true } : {}),
        ...(needsCorrectAnswer ? { needsCorrectAnswer: true } : {}),
        ...(needsQuestionSetup ? { needsQuestionSetup: true } : {}),
      };
      const persistedMeta = Object.keys(normalizedMeta).length > 0 ? normalizedMeta : null;

      await db.insert(testQuestionsTable).values({
        testId: createdTest.id,
        sectionId,
        question: typeof question.question === "string" ? question.question : "",
        questionType,
        questionCode: typeof question.questionCode === "string" && question.questionCode.trim() ? question.questionCode.trim() : null,
        sourceType: typeof question.sourceType === "string" && question.sourceType.trim() ? question.sourceType.trim() : "manual",
        subjectLabel,
        options: JSON.stringify(options),
        optionImages: optionImages.length > 0 ? JSON.stringify(optionImages) : null,
        correctAnswer:
          questionType === "integer"
            ? (correctAnswerMin !== null && correctAnswerMax !== null ? 0 : Number(exactAnswer ?? 0))
            : questionType === "multi"
              ? 0
              : Number(correctAnswerIndex ?? 0),
        correctAnswerMulti: questionType === "multi" ? JSON.stringify(correctAnswerMulti) : null,
        correctAnswerMin: questionType === "integer" && correctAnswerMin !== null ? Number(correctAnswerMin) : null,
        correctAnswerMax: questionType === "integer" && correctAnswerMax !== null ? Number(correctAnswerMax) : null,
        points: question.points !== undefined && question.points !== null ? Number(question.points) : 1,
        negativeMarks: question.negativeMarks !== undefined && question.negativeMarks !== null ? Number(question.negativeMarks) : 0,
        meta: persistedMeta ? JSON.stringify(persistedMeta) : null,
        solutionText: typeof question.solutionText === "string" && question.solutionText.trim() ? question.solutionText.trim() : null,
        solutionImageData: typeof question.solutionImageData === "string" && question.solutionImageData.trim() ? question.solutionImageData : null,
        order: question.order !== undefined ? Number(question.order) : index,
        imageData: typeof question.imageData === "string" && question.imageData ? question.imageData : null,
      });
    }

    const persistedSections = await db.select().from(testSectionsTable)
      .where(eq(testSectionsTable.testId, createdTest.id))
      .orderBy(asc(testSectionsTable.order));
    const syncedSections = shouldPreserveImportedSections(createdTest.examConfig)
      ? persistedSections.map((section) => ({ ...section, meta: safeParseJson(section.meta, null) }))
      : await syncTestSectionsFromTemplate(createdTest.id, createdTest.examType, persistedSections);

    return res.status(201).json({
      id: createdTest.id,
      title: createdTest.title,
      sectionCount: syncedSections.length,
      questionCount: questions.length,
      pendingReviewCount,
      isPublished: createdTest.isPublished,
    });
  } catch (error) {
    console.error("POST /api/tests/import failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tests/:id/import-question-metadata — bulk apply per-question metadata to an existing test
router.post("/tests/:id/import-question-metadata", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const body = req.body;
    const rawItems = Array.isArray(body)
      ? body
      : body && typeof body === "object"
        ? Array.isArray((body as any).questions)
          ? (body as any).questions
          : Array.isArray((body as any).items)
            ? (body as any).items
            : Array.isArray((body as any).rows)
              ? (body as any).rows
              : Array.isArray((body as any).data)
                ? (body as any).data
                : Array.isArray((body as any).test?.questions)
                  ? (body as any).test.questions
                  : Array.isArray((body as any).test?.items)
                    ? (body as any).test.items
                    : []
        : [];
    if (rawItems.length === 0) {
      return res.status(400).json({ error: "No question metadata found in import payload" });
    }

    const [[test], testQuestions] = await Promise.all([
      db.select().from(testsTable).where(eq(testsTable.id, testId)),
      db
        .select()
        .from(testQuestionsTable)
        .where(eq(testQuestionsTable.testId, testId))
        .orderBy(asc(testQuestionsTable.order)),
    ]);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }
    if (testQuestions.length === 0) {
      return res.status(404).json({ error: "Test questions not found" });
    }
    const questionBankCatalog = await loadQuestionBankTaxonomyCatalogForExam(userId, test.examType);

    const questionByCode = new Map<string, typeof testQuestions[number]>();
    const questionByCodeNumber = new Map<number, typeof testQuestions[number]>();
    testQuestions.forEach((question) => {
      const normalizedQuestionCode = normalizeImportedQuestionCodeKey(question.questionCode);
      if (normalizedQuestionCode) {
        questionByCode.set(normalizedQuestionCode, question);
      }
      const questionCodeNumber = extractImportedQuestionCodeNumber(question.questionCode);
      if (questionCodeNumber !== null && !questionByCodeNumber.has(questionCodeNumber)) {
        questionByCodeNumber.set(questionCodeNumber, question);
      }
    });

    let matchedCount = 0;
    let updatedCount = 0;
    let unresolvedCount = 0;
    const skippedRows: string[] = [];

    for (let index = 0; index < rawItems.length; index += 1) {
      const item = rawItems[index] as Record<string, unknown>;
      const rawQuestionCode = item.questionCode ?? item.code ?? item.question_code ?? null;
      const normalizedQuestionCode = normalizeImportedQuestionCodeKey(rawQuestionCode);
      const questionCodeNumber = extractImportedQuestionCodeNumber(rawQuestionCode);
      const questionNumber =
        parseImportedNumericValue(item.questionNumber) ??
        parseImportedNumericValue(item.questionNo) ??
        parseImportedNumericValue(item.order) ??
        parseImportedNumericValue(item.index);
      const matchedQuestion =
        (normalizedQuestionCode ? questionByCode.get(normalizedQuestionCode) ?? null : null) ??
        (questionCodeNumber !== null ? questionByCodeNumber.get(questionCodeNumber) ?? null : null) ??
        (questionNumber !== null && questionNumber >= 1 && questionNumber <= testQuestions.length
          ? testQuestions[Math.round(questionNumber) - 1]
          : null);
      if (!matchedQuestion) {
        skippedRows.push(
          normalizedQuestionCode ||
          (questionNumber !== null ? `Q${Math.round(questionNumber)}` : `Row ${index + 1}`),
        );
        continue;
      }
      matchedCount += 1;

      const currentMeta = safeParseJson<Record<string, unknown> | null>(matchedQuestion.meta, null);
      const questionType = matchedQuestion.questionType ?? "mcq";
      const optionCount = safeParseJson<string[]>(matchedQuestion.options, []).length;
      const explicitSubjectName = sanitizeExplicitTaxonomyValue(
        firstTrimmedString(item.subject, item.subjectName, item.subject_name),
      );
      const explicitChapterName = sanitizeExplicitTaxonomyValue(
        firstTrimmedString(item.chapter, item.chapterName, item.chapter_name),
      );
      const explicitTopicTag = sanitizeExplicitTaxonomyValue(
        firstTrimmedString(item.topic, item.topicTag, item.topicName, item.topic_name),
      );
      const explicitDifficulty = normalizeTestDifficultyValue(
        firstTrimmedString(item.difficulty, item.difficultyLevel, item.difficulty_level),
      );
      const explicitIdealTimeSeconds =
        parseImportedNumericValue(item.idealTimeSeconds) ??
        parseImportedNumericValue(item.estimatedTimeSeconds) ??
        parseImportedNumericValue(item.idealTime);

      const nextSubjectName =
        explicitSubjectName ??
        sanitizeExplicitTaxonomyValue(firstTrimmedString(currentMeta?.subjectName, currentMeta?.subject));
      const nextChapterName =
        explicitChapterName ??
        sanitizeExplicitTaxonomyValue(firstTrimmedString(currentMeta?.chapterName, currentMeta?.chapter));
      const nextTopicTag =
        explicitTopicTag ??
        sanitizeExplicitTaxonomyValue(firstTrimmedString(currentMeta?.topicTag, currentMeta?.topicName, currentMeta?.topic));
      const nextDifficulty =
        explicitDifficulty ??
        normalizeTestDifficultyValue(firstTrimmedString(currentMeta?.difficulty));
      const nextIdealTimeSeconds =
        explicitIdealTimeSeconds ??
        parseImportedNumericValue(currentMeta?.estimatedTimeSeconds);
      const canonicalTaxonomy = resolveCanonicalQuestionBankTaxonomy(
        questionBankCatalog,
        nextSubjectName,
        nextChapterName,
      );
      const resolvedSubjectName = canonicalTaxonomy.subjectName;
      const resolvedChapterName = canonicalTaxonomy.chapterName;

      const providedCorrectAnswerIndex = parseImportedOptionIndex(
        item.correctAnswer ?? item.answer,
        optionCount,
      );
      const providedCorrectAnswerMulti = normalizeImportedAnswerIndices(
        item.correctAnswerMulti ?? item.correctAnswers ?? item.answers,
        optionCount,
      );
      const providedExactIntegerAnswer =
        parseImportedNumericValue(item.correctAnswer) ??
        parseImportedNumericValue(item.answer);
      const providedCorrectAnswerMin =
        parseImportedNumericValue(item.correctAnswerMin) ??
        parseImportedNumericValue(item.answerMin) ??
        parseImportedNumericValue(item.rangeMin);
      const providedCorrectAnswerMax =
        parseImportedNumericValue(item.correctAnswerMax) ??
        parseImportedNumericValue(item.answerMax) ??
        parseImportedNumericValue(item.rangeMax);
      const providedRange = extractImportedNumericRange(item.correctAnswerRange ?? item.answerRange);
      const providedSolutionAnswer = extractNumericAnswerFromSolution(
        firstTrimmedString(
          item.solutionText,
          item.solution,
          item.explanation,
          matchedQuestion.solutionText,
          matchedQuestion.aiSolutionText,
        ),
      );
      const solutionRange =
        providedSolutionAnswer.min !== null && providedSolutionAnswer.max !== null
          ? {
              min: Math.min(providedSolutionAnswer.min, providedSolutionAnswer.max),
              max: Math.max(providedSolutionAnswer.min, providedSolutionAnswer.max),
            }
          : { min: null, max: null };
      const resolvedProvidedExactAnswer =
        providedExactIntegerAnswer ?? providedSolutionAnswer.exact;

      const currentHasCorrectAnswer =
        currentMeta?.needsCorrectAnswer === true || currentMeta?.needsCorrectAnswer === "true"
          ? false
          : questionType === "multi"
            ? safeParseJson<number[]>(matchedQuestion.correctAnswerMulti, []).length > 0
            : questionType === "integer"
              ? hasDistinctIntegerRange(matchedQuestion.correctAnswerMin, matchedQuestion.correctAnswerMax) || matchedQuestion.correctAnswer !== null
              : Number(matchedQuestion.correctAnswer) >= 0;

      const nextHasCorrectAnswer =
        questionType === "multi"
          ? providedCorrectAnswerMulti.length > 0 || currentHasCorrectAnswer
          : questionType === "integer"
            ? (
              resolvedProvidedExactAnswer !== null ||
              (providedCorrectAnswerMin !== null && providedCorrectAnswerMax !== null) ||
              (providedRange.min !== null && providedRange.max !== null) ||
              (solutionRange.min !== null && solutionRange.max !== null) ||
              currentHasCorrectAnswer
            )
            : providedCorrectAnswerIndex !== null || currentHasCorrectAnswer;

      const nextMeta = {
        ...(currentMeta ?? {}),
        ...(resolvedSubjectName ? { subjectName: resolvedSubjectName } : {}),
        ...(resolvedChapterName ? { chapterName: resolvedChapterName } : {}),
        importedSubjectName: canonicalTaxonomy.importedSubjectName,
        importedChapterName: canonicalTaxonomy.importedChapterName,
        suggestedSubjectName: canonicalTaxonomy.suggestedSubjectName,
        suggestedChapterName: canonicalTaxonomy.suggestedChapterName,
        needsTaxonomyReview: canonicalTaxonomy.needsReview,
        taxonomyReviewReason: canonicalTaxonomy.reviewReason,
        ...(nextTopicTag ? { topicTag: nextTopicTag } : {}),
        ...(nextDifficulty ? { difficulty: nextDifficulty } : {}),
        ...(nextIdealTimeSeconds !== null && Number.isFinite(nextIdealTimeSeconds) ? { estimatedTimeSeconds: nextIdealTimeSeconds } : {}),
        needsSubjectName: !resolvedSubjectName,
        needsChapterName: !resolvedChapterName,
        needsDifficulty: !nextDifficulty,
        needsIdealTimeSeconds: !(nextIdealTimeSeconds !== null && Number.isFinite(nextIdealTimeSeconds)),
        needsCorrectAnswer: !nextHasCorrectAnswer,
        needsQuestionSetup: (
          !resolvedSubjectName ||
          !resolvedChapterName ||
          canonicalTaxonomy.needsReview ||
          !nextDifficulty ||
          !(nextIdealTimeSeconds !== null && Number.isFinite(nextIdealTimeSeconds)) ||
          !nextHasCorrectAnswer
        ),
      };

      const updates: Record<string, unknown> = {
        meta: JSON.stringify(nextMeta),
      };

      if (questionType === "mcq" && providedCorrectAnswerIndex !== null) {
        updates.correctAnswer = providedCorrectAnswerIndex;
      } else if (questionType === "multi" && providedCorrectAnswerMulti.length > 0) {
        updates.correctAnswerMulti = JSON.stringify(providedCorrectAnswerMulti);
      } else if (questionType === "integer") {
        const rangeMin = solutionRange.min ?? providedCorrectAnswerMin ?? providedRange.min;
        const rangeMax = solutionRange.max ?? providedCorrectAnswerMax ?? providedRange.max;
        if (rangeMin !== null && rangeMax !== null) {
          updates.correctAnswer = 0;
          updates.correctAnswerMin = Math.min(rangeMin, rangeMax);
          updates.correctAnswerMax = Math.max(rangeMin, rangeMax);
        } else if (resolvedProvidedExactAnswer !== null) {
          updates.correctAnswer = resolvedProvidedExactAnswer;
          updates.correctAnswerMin = null;
          updates.correctAnswerMax = null;
        }
      }

      await db
        .update(testQuestionsTable)
        .set(updates)
        .where(and(eq(testQuestionsTable.id, matchedQuestion.id), eq(testQuestionsTable.testId, testId)));

      updatedCount += 1;
      if (nextMeta.needsQuestionSetup) unresolvedCount += 1;
    }

    return res.json({
      matchedCount,
      updatedCount,
      unresolvedCount,
      skippedCount: skippedRows.length,
      skippedRows,
    });
  } catch (error) {
    console.error("POST /api/tests/:id/import-question-metadata failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/tests/:id — update test
router.patch("/tests/:id", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const [beforeTest] = await db.select().from(testsTable).where(eq(testsTable.id, testId));
    if (!beforeTest) return res.status(404).json({ error: "Test not found" });

    const { isPublished, title, description, examType, examHeader, examSubheader, instructions, examConfig, durationMinutes, passingScore, defaultPositiveMarks, defaultNegativeMarks, scheduledAt } = req.body;
    const updates: any = {};
    if (isPublished !== undefined) updates.isPublished = Boolean(isPublished);
    if (title) updates.title = String(title);
    if (description !== undefined) updates.description = description ? String(description) : null;
    let selectedTemplate: any = null;
    const normalizedPatchExamKey = examType !== undefined ? normalizeExamKey(examType) : null;
    if (normalizedPatchExamKey) {
      const [matchedTemplate] = await db.select().from(examTemplatesTable).where(eq(examTemplatesTable.key, normalizedPatchExamKey)).limit(1);
      selectedTemplate = matchedTemplate ?? null;
    }
    if (examType !== undefined) updates.examType = normalizedPatchExamKey ?? (examType ? String(examType) : "custom");
    if (examHeader !== undefined) updates.examHeader = examHeader ? String(examHeader) : null;
    if (examSubheader !== undefined) updates.examSubheader = examSubheader ? String(examSubheader) : null;
    if (instructions !== undefined) updates.instructions = instructions ? String(instructions) : null;
    if (examConfig !== undefined) updates.examConfig = examConfig ? JSON.stringify(examConfig) : null;
    if (durationMinutes) updates.durationMinutes = Number(durationMinutes);
    if (passingScore !== undefined) {
      updates.passingScore = passingScore === null || String(passingScore).trim() === "" ? null : Number(passingScore);
    }
    if (defaultPositiveMarks !== undefined) updates.defaultPositiveMarks = Number(defaultPositiveMarks);
    if (defaultNegativeMarks !== undefined) updates.defaultNegativeMarks = Number(defaultNegativeMarks);
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    const preserveSections = shouldPreserveImportedSections(beforeTest?.examConfig);
    const publishExamType = updates.examType ?? beforeTest.examType;

    if (selectedTemplate && !preserveSections) {
      updates.examType = selectedTemplate.key;
      updates.examHeader = selectedTemplate.examHeader ?? null;
      updates.examSubheader = selectedTemplate.examSubheader ?? null;
      if (instructions === undefined) {
        updates.instructions = typeof selectedTemplate.customInstructions === "string" && selectedTemplate.customInstructions.trim()
          ? selectedTemplate.customInstructions.trim()
          : null;
      }
      if (durationMinutes === undefined) updates.durationMinutes = selectedTemplate.durationMinutes;
      if (passingScore === undefined) updates.passingScore = selectedTemplate.passingScore ?? null;
      if (defaultPositiveMarks === undefined) updates.defaultPositiveMarks = selectedTemplate.defaultPositiveMarks ?? 1;
      if (defaultNegativeMarks === undefined) updates.defaultNegativeMarks = selectedTemplate.defaultNegativeMarks ?? 0;
    }

    const [test] = await db.update(testsTable).set(updates).where(eq(testsTable.id, testId)).returning();
    const rawSections = await db.select().from(testSectionsTable)
      .where(eq(testSectionsTable.testId, testId))
      .orderBy(asc(testSectionsTable.order));
    const syncedSections = shouldPreserveImportedSections(test.examConfig)
      ? rawSections.map((section) => ({ ...section, meta: safeParseJson(section.meta, null) }))
      : await syncTestSectionsFromTemplate(testId, test.examType, rawSections);

    const beforeSyncEnabled = normalizeObjectValue<Record<string, unknown> | null>(beforeTest?.examConfig, null)?.syncWithQuestionBank === true;
    const newExamConfigObj = examConfig && typeof examConfig === "object" ? examConfig as Record<string, unknown> : null;
    const newSyncEnabled = newExamConfigObj?.syncWithQuestionBank === true;
    const syncToggledOn = !beforeSyncEnabled && newSyncEnabled && updates.isPublished === undefined;
    const syncToggledOff = beforeSyncEnabled && !newSyncEnabled && updates.isPublished === undefined;

    const questionBankSync =
      updates.isPublished === true || (syncToggledOn && test.isPublished)
        ? await syncPublishedTestQuestionsToQuestionBank(testId, userId, test.examType)
        : null;
    const questionBankCleanup =
      (updates.isPublished === false && beforeTest?.isPublished)
        ? await cleanupUnpublishedTestQuestionsFromQuestionBank(testId, userId, beforeTest.examType)
        : null;

    let publishNotificationStudentIds: number[] = [];

    // Prepare student notifications when a test is first published.
    if (updates.isPublished === true && !beforeTest?.isPublished) {
      const students = await db.select({
        id: usersTable.id,
        subject: usersTable.subject,
        additionalExams: usersTable.additionalExams,
      }).from(usersTable).where(eq(usersTable.role, "student"));
      publishNotificationStudentIds = students
        .filter((student) =>
          canStudentAccessTest(test, {
            enrolledClassIds: new Set<number>(),
            examKeys: getStudentExamKeys(student),
          }),
        )
        .map((student) => student.id);
    }

    const payload = {
      ...test,
      examConfig: normalizeObjectValue(test.examConfig, null),
      sections: syncedSections,
      questionBankSync,
      questionBankCleanup,
    };

    res.json(payload);

    if (publishNotificationStudentIds.length > 0) {
      void pushNotificationToMany(publishNotificationStudentIds, {
        type: "test",
        title: `New Test: ${test.title}`,
        message: test.durationMinutes
          ? `Duration: ${test.durationMinutes} min${test.durationMinutes !== 1 ? "s" : ""}. Head to My Tests to start.`
          : "A new test is now available in My Tests.",
        link: "/student/tests",
      }).catch((error) => {
        logger.error({ error, testId, studentCount: publishNotificationStudentIds.length }, "Failed to dispatch publish notifications");
      });
    }

    return;
  } catch (error) {
    console.error("PATCH /api/tests/:id failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/tests/:id
router.delete("/tests/:id", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const [existingTest] = await db.select().from(testsTable).where(eq(testsTable.id, testId));
    if (!existingTest) return res.status(404).json({ error: "Test not found" });

    await cleanupUnpublishedTestQuestionsFromQuestionBank(
      testId,
      existingTest.createdBy ?? userId,
      existingTest.examType,
    );
    await db.delete(testsTable).where(eq(testsTable.id, testId));
    return res.status(204).send();
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// POST /api/tests/:id/questions — add question (supports mcq, multi, integer)
router.post("/tests/:id/questions", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const {
      question,
      questionType = "mcq",
      sectionId,
      questionCode,
      sourceType,
      subjectLabel,
      options = [],
      optionImages,
      correctAnswer,
      correctAnswerMulti,
      correctAnswerMin,
      correctAnswerMax,
      points,
      negativeMarks,
      imageData,
      meta,
      solutionText,
      solutionImageData,
    } = req.body;
    if (!question && !imageData) return res.status(400).json({ error: "question text or image required" });

    const existing = await db.select({ id: testQuestionsTable.id })
      .from(testQuestionsTable).where(eq(testQuestionsTable.testId, testId));

    const normalizedMeta = normalizeObjectValue<Record<string, unknown> | null>(meta, null);
    const parsedCorrectAnswer = correctAnswer === undefined || correctAnswer === null || String(correctAnswer).trim?.() === ""
      ? null
      : Number(correctAnswer);
    const hasMcqCorrectAnswer = parsedCorrectAnswer !== null && Number.isFinite(parsedCorrectAnswer) && parsedCorrectAnswer >= 0;
    const normalizedCorrectAnswerMulti = Array.isArray(correctAnswerMulti) ? correctAnswerMulti.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0) : [];
    const hasMultiCorrectAnswer = normalizedCorrectAnswerMulti.length > 0;
    const parsedCorrectAnswerMin =
      correctAnswerMin === undefined || correctAnswerMin === null || String(correctAnswerMin).trim?.() === ""
        ? null
        : Number(correctAnswerMin);
    const parsedCorrectAnswerMax =
      correctAnswerMax === undefined || correctAnswerMax === null || String(correctAnswerMax).trim?.() === ""
        ? null
        : Number(correctAnswerMax);
    const isRange =
      questionType === "integer" &&
      parsedCorrectAnswerMin !== null &&
      parsedCorrectAnswerMax !== null &&
      Number.isFinite(parsedCorrectAnswerMin) &&
      Number.isFinite(parsedCorrectAnswerMax);
    const hasIntegerCorrectAnswer = isRange || (parsedCorrectAnswer !== null && Number.isFinite(parsedCorrectAnswer));
    const needsCorrectAnswer =
      questionType === "multi"
        ? !hasMultiCorrectAnswer
        : questionType === "integer"
          ? !hasIntegerCorrectAnswer
          : !hasMcqCorrectAnswer;
    const persistedMeta = {
      ...(normalizedMeta ?? {}),
      needsCorrectAnswer,
      needsQuestionSetup: needsCorrectAnswer || Boolean(normalizedMeta?.needsQuestionSetup),
    };

    const [q] = await db.insert(testQuestionsTable).values({
      testId,
      sectionId: sectionId ? Number(sectionId) : null,
      questionCode: questionCode ? String(questionCode) : null,
      sourceType: sourceType ? String(sourceType) : "manual",
      subjectLabel: subjectLabel ? String(subjectLabel) : null,
      question: question ? String(question) : "",
      questionType: String(questionType),
      options: JSON.stringify(options),
      optionImages: optionImages ? JSON.stringify(optionImages) : null,
      correctAnswer:
        questionType === "multi"
          ? 0
          : isRange
            ? 0
            : questionType === "mcq"
              ? (hasMcqCorrectAnswer ? Number(parsedCorrectAnswer) : -1)
              : (hasIntegerCorrectAnswer ? Number(parsedCorrectAnswer) : 0),
      correctAnswerMulti: questionType === "multi" ? JSON.stringify(normalizedCorrectAnswerMulti) : null,
      correctAnswerMin: isRange ? Number(parsedCorrectAnswerMin) : null,
      correctAnswerMax: isRange ? Number(parsedCorrectAnswerMax) : null,
      points: points ? Number(points) : 1,
      negativeMarks: negativeMarks !== undefined ? Number(negativeMarks) : 0,
      meta: Object.keys(persistedMeta).length > 0 ? JSON.stringify(persistedMeta) : null,
      solutionText: typeof solutionText === "string" && solutionText.trim() ? solutionText.trim() : null,
      solutionImageData: typeof solutionImageData === "string" && solutionImageData.trim() ? solutionImageData : null,
      order: existing.length,
      imageData: imageData ? String(imageData) : null,
    }).returning();

    return res.status(201).json(serializeTestQuestion(q, { showCorrect: true, includeSolutions: true }));
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// PATCH /api/tests/:id/questions/:qid — update question
router.patch("/tests/:id/questions/:qid", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const questionId = parseInt(req.params.qid, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const {
      question,
      questionType = "mcq",
      sectionId,
      questionCode,
      sourceType,
      subjectLabel,
      options = [],
      optionImages,
      correctAnswer,
      correctAnswerMulti,
      correctAnswerMin,
      correctAnswerMax,
      points,
      negativeMarks,
      imageData,
      meta,
      solutionText,
      solutionImageData,
    } = req.body;
    if (!question && !imageData) return res.status(400).json({ error: "question text or image required" });
    const normalizedMeta = normalizeObjectValue<Record<string, unknown> | null>(meta, null);
    const parsedCorrectAnswer = correctAnswer === undefined || correctAnswer === null || String(correctAnswer).trim?.() === ""
      ? null
      : Number(correctAnswer);
    const hasMcqCorrectAnswer = parsedCorrectAnswer !== null && Number.isFinite(parsedCorrectAnswer) && parsedCorrectAnswer >= 0;
    const normalizedCorrectAnswerMulti = Array.isArray(correctAnswerMulti) ? correctAnswerMulti.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0) : [];
    const hasMultiCorrectAnswer = normalizedCorrectAnswerMulti.length > 0;
    const parsedCorrectAnswerMin =
      correctAnswerMin === undefined || correctAnswerMin === null || String(correctAnswerMin).trim?.() === ""
        ? null
        : Number(correctAnswerMin);
    const parsedCorrectAnswerMax =
      correctAnswerMax === undefined || correctAnswerMax === null || String(correctAnswerMax).trim?.() === ""
        ? null
        : Number(correctAnswerMax);
    const isRange =
      questionType === "integer" &&
      parsedCorrectAnswerMin !== null &&
      parsedCorrectAnswerMax !== null &&
      Number.isFinite(parsedCorrectAnswerMin) &&
      Number.isFinite(parsedCorrectAnswerMax);
    const hasIntegerCorrectAnswer = isRange || (parsedCorrectAnswer !== null && Number.isFinite(parsedCorrectAnswer));
    const needsCorrectAnswer =
      questionType === "multi"
        ? !hasMultiCorrectAnswer
        : questionType === "integer"
          ? !hasIntegerCorrectAnswer
          : !hasMcqCorrectAnswer;
    const persistedMeta = {
      ...(normalizedMeta ?? {}),
      needsCorrectAnswer,
      needsQuestionSetup: needsCorrectAnswer || Boolean(normalizedMeta?.needsQuestionSetup),
    };

    const [q] = await db.update(testQuestionsTable).set({
      testId,
      sectionId: sectionId ? Number(sectionId) : null,
      questionCode: questionCode ? String(questionCode) : null,
      sourceType: sourceType ? String(sourceType) : "manual",
      subjectLabel: subjectLabel ? String(subjectLabel) : null,
      question: question ? String(question) : "",
      questionType: String(questionType),
      options: JSON.stringify(options),
      optionImages: optionImages ? JSON.stringify(optionImages) : null,
      correctAnswer:
        questionType === "multi"
          ? 0
          : isRange
            ? 0
            : questionType === "mcq"
              ? (hasMcqCorrectAnswer ? Number(parsedCorrectAnswer) : -1)
              : (hasIntegerCorrectAnswer ? Number(parsedCorrectAnswer) : 0),
      correctAnswerMulti: questionType === "multi" ? JSON.stringify(normalizedCorrectAnswerMulti) : null,
      correctAnswerMin: isRange ? Number(parsedCorrectAnswerMin) : null,
      correctAnswerMax: isRange ? Number(parsedCorrectAnswerMax) : null,
      points: points ? Number(points) : 1,
      negativeMarks: negativeMarks !== undefined ? Number(negativeMarks) : 0,
      meta: Object.keys(persistedMeta).length > 0 ? JSON.stringify(persistedMeta) : null,
      solutionText: typeof solutionText === "string" && solutionText.trim() ? solutionText.trim() : null,
      solutionImageData: typeof solutionImageData === "string" && solutionImageData.trim() ? solutionImageData : null,
      imageData: imageData ? String(imageData) : null,
    }).where(and(eq(testQuestionsTable.id, questionId), eq(testQuestionsTable.testId, testId))).returning();

    if (!q) return res.status(404).json({ error: "Question not found" });
    const openReports = await db
      .select()
      .from(testQuestionReportsTable)
      .where(and(
        eq(testQuestionReportsTable.questionId, questionId),
        eq(testQuestionReportsTable.status, "open"),
      ));

    if (openReports.length > 0) {
      await db
        .update(testQuestionReportsTable)
        .set({
          status: "resolved",
          updatedAt: new Date(),
        })
        .where(and(
          eq(testQuestionReportsTable.questionId, questionId),
          eq(testQuestionReportsTable.status, "open"),
        ));

      const [testMeta] = await db
        .select({
          title: testsTable.title,
          classId: testsTable.classId,
          examType: testsTable.examType,
        })
        .from(testsTable)
        .where(eq(testsTable.id, testId))
        .limit(1);
      const reporterIds = [...new Set(openReports.map((report) => report.reportedBy))];
      if (reporterIds.length > 0) {
        const questionLabel = q.questionCode?.trim() || `Question ${questionId}`;
        await pushNotificationToMany(reporterIds, {
          type: "test",
          title: "Reported question fixed",
          message: `${questionLabel} in ${testMeta?.title ?? "your test"} has been updated by the teacher.`,
          link: `/student/tests/${testId}/solutions`,
        });

        void (async () => {
          if (!(await hasBrevoAccounts()) || !testMeta) return;
          const recipients = await getEligibleStudentRecipientsForTest({
            classId: testMeta.classId,
            examType: testMeta.examType,
          });

          const sentStudentIds = new Set<number>();
          for (const recipient of recipients) {
            if (sentStudentIds.has(recipient.id)) continue;
            if (typeof recipient.email !== "string" || !recipient.email.trim()) continue;
            sentStudentIds.add(recipient.id);
            queueStudentQuestionUpdatedEmail({
              studentName: getDisplayName(recipient, "Student"),
              email: recipient.email.trim(),
              questionLabel,
              contextTitle: testMeta.title,
              actionUrl: buildPortalUrl("/student/tests"),
            });
          }
        })().catch((error) => {
          logger.warn({ error, questionId, testId }, "Failed to queue updated question emails");
        });
      }
    }

    return res.json({
      ...serializeTestQuestion(q, { showCorrect: true, includeSolutions: true }),
      resolvedReportsCount: openReports.length,
    });
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// GET /api/tests/:id/sections
router.get("/tests/:id/sections", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || (user.role !== "admin" && user.role !== "super_admin")) return res.status(403).json({ error: "Forbidden" });

    const sections = await db.select().from(testSectionsTable)
      .where(eq(testSectionsTable.testId, testId))
      .orderBy(asc(testSectionsTable.order));
    return res.json(sections);
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// POST /api/tests/:id/sections
router.post("/tests/:id/sections", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const { title, description, subjectLabel, questionCount, marksPerQuestion, negativeMarks, meta } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });

    const existing = await db.select({ id: testSectionsTable.id }).from(testSectionsTable).where(eq(testSectionsTable.testId, testId));
    const [section] = await db.insert(testSectionsTable).values({
      testId,
      title: String(title),
      description: description ? String(description) : null,
      subjectLabel: subjectLabel ? String(subjectLabel) : null,
      questionCount: questionCount !== undefined ? Number(questionCount) : null,
      marksPerQuestion: marksPerQuestion !== undefined ? Number(marksPerQuestion) : null,
      negativeMarks: negativeMarks !== undefined ? Number(negativeMarks) : null,
      meta: meta ? JSON.stringify(meta) : null,
      order: existing.length,
    }).returning();
    return res.status(201).json(section);
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// PATCH /api/tests/:id/sections/:sectionId
router.patch("/tests/:id/sections/:sectionId", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const sectionId = parseInt(req.params.sectionId, 10);
    const [existingSection] = await db
      .select()
      .from(testSectionsTable)
      .where(and(eq(testSectionsTable.id, sectionId), eq(testSectionsTable.testId, testId)));
    if (!existingSection) return res.status(404).json({ error: "Section not found" });
    const { title, description, subjectLabel, questionCount, marksPerQuestion, negativeMarks, meta, order } = req.body;
    if (questionCount !== undefined && questionCount !== null) {
      const linkedQuestions = await db
        .select({ id: testQuestionsTable.id })
        .from(testQuestionsTable)
        .where(and(eq(testQuestionsTable.testId, testId), eq(testQuestionsTable.sectionId, sectionId)));
      if (Number(questionCount) < linkedQuestions.length) {
        return res.status(400).json({ error: `Section already has ${linkedQuestions.length} saved questions` });
      }
    }
    const updates: any = {};
    if (title !== undefined) updates.title = String(title);
    if (description !== undefined) updates.description = description ? String(description) : null;
    if (subjectLabel !== undefined) updates.subjectLabel = subjectLabel ? String(subjectLabel) : null;
    if (questionCount !== undefined) updates.questionCount = questionCount !== null ? Number(questionCount) : null;
    if (marksPerQuestion !== undefined) updates.marksPerQuestion = marksPerQuestion !== null ? Number(marksPerQuestion) : null;
    if (negativeMarks !== undefined) updates.negativeMarks = negativeMarks !== null ? Number(negativeMarks) : null;
    if (meta !== undefined) updates.meta = meta ? JSON.stringify(meta) : null;
    if (order !== undefined) updates.order = Number(order);
    const [section] = await db
      .update(testSectionsTable)
      .set(updates)
      .where(and(eq(testSectionsTable.id, sectionId), eq(testSectionsTable.testId, testId)))
      .returning();
    if (!section) return res.status(404).json({ error: "Section not found" });
    return res.json(section);
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /api/tests/:id/sections/:sectionId
router.delete("/tests/:id/sections/:sectionId", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const sectionId = parseInt(req.params.sectionId, 10);
    const [existingSection] = await db
      .select()
      .from(testSectionsTable)
      .where(and(eq(testSectionsTable.id, sectionId), eq(testSectionsTable.testId, testId)));
    if (!existingSection) return res.status(404).json({ error: "Section not found" });
    const linkedQuestions = await db
      .select({ id: testQuestionsTable.id })
      .from(testQuestionsTable)
      .where(and(eq(testQuestionsTable.testId, testId), eq(testQuestionsTable.sectionId, sectionId)));
    if (linkedQuestions.length > 0) {
      return res.status(400).json({ error: "Remove saved questions before deleting this section" });
    }
    await db.delete(testSectionsTable).where(and(eq(testSectionsTable.id, sectionId), eq(testSectionsTable.testId, testId)));
    return res.status(204).send();
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// DELETE /api/tests/:id/questions/:qid
router.delete("/tests/:id/questions/:qid", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    await db.delete(testQuestionsTable).where(eq(testQuestionsTable.id, parseInt(req.params.qid, 10)));
    return res.status(204).send();
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// POST /api/tests/:id/submit — student submits answers
router.post("/tests/:id/submit", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "student") return res.status(403).json({ error: "Students only" });
    if (!ensureStudentFeatureUnlocked(user, "tests", res)) return;

    const [test] = await db.select({
      id: testsTable.id,
      title: testsTable.title,
      classId: testsTable.classId,
      examType: testsTable.examType,
      isPublished: testsTable.isPublished,
      passingScore: testsTable.passingScore,
    }).from(testsTable).where(eq(testsTable.id, testId));
    if (!test) return res.status(404).json({ error: "Test not found" });

    const access = {
      enrolledClassIds: await getStudentEnrolledClassIds(userId),
      examKeys: getStudentExamKeys(user),
    };
    if (!test.isPublished || !canStudentAccessTest(test, access)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const {
      answers,
      questionTimings,
      flaggedQuestions,
      visitedQuestionIds,
      reviewQuestionIds,
      interactionLog,
    } = req.body;
    const [questions, sections] = await Promise.all([
      db.select().from(testQuestionsTable).where(eq(testQuestionsTable.testId, testId)),
      db
        .select()
        .from(testSectionsTable)
        .where(eq(testSectionsTable.testId, testId))
        .orderBy(asc(testSectionsTable.order), asc(testSectionsTable.id)),
    ]);

    let score = 0, totalPoints = 0;
    for (const q of questions) {
      totalPoints += q.points;
      const answer = answers?.[q.id];
      if (gradeQuestion(q, answer)) {
        score += q.points;
      } else if (hasAnsweredQuestion(q, answer)) {
        score -= Number(q.negativeMarks ?? 0);
      }
    }

    const normalizedScore = Number(score.toFixed(2));
    const percentage = totalPoints > 0 ? Number(((normalizedScore / totalPoints) * 100).toFixed(2)) : 0;
    const passed = test.passingScore == null ? true : percentage >= test.passingScore;
    const resultEmailSummary = buildSubmissionResultEmailSummary({
      testTitle: test.title,
      questions,
      sections,
      answers: safeParseJson<Record<string, unknown> | null>(answers ?? {}, {}),
      questionTimings: safeParseJson<Record<string, number> | null>(questionTimings ?? {}, {}),
    });

    const [submission] = await db.insert(testSubmissionsTable).values({
      testId, studentId: userId,
      answers: JSON.stringify(answers ?? {}),
      questionTimings: questionTimings ? JSON.stringify(questionTimings) : null,
      flaggedQuestions: flaggedQuestions ? JSON.stringify(flaggedQuestions) : null,
      visitedQuestionIds: visitedQuestionIds ? JSON.stringify(visitedQuestionIds) : null,
      reviewQuestionIds: reviewQuestionIds ? JSON.stringify(reviewQuestionIds) : null,
      interactionLog: interactionLog ? JSON.stringify(interactionLog) : null,
      score: normalizedScore, totalPoints, percentage, passed,
    }).returning();

    if (user.email?.trim()) {
      try {
        if (await hasBrevoAccounts()) {
          queueStudentTestResultEmail({
            studentName: user.fullName?.trim() || user.username || "Student",
            email: user.email.trim(),
            testId,
            testTitle: test.title,
            score: normalizedScore,
            totalPoints,
            percentage,
            passed,
            passingScore: test.passingScore,
            submittedAt: submission.submittedAt ?? new Date(),
            totalQuestions: resultEmailSummary.totalQuestions,
            attemptedQuestions: resultEmailSummary.attemptedQuestions,
            correctQuestions: resultEmailSummary.correctQuestions,
            incorrectQuestions: resultEmailSummary.incorrectQuestions,
            unattemptedQuestions: resultEmailSummary.unattemptedQuestions,
            timeSpentSeconds: resultEmailSummary.timeSpentSeconds,
            subjectBreakdown: resultEmailSummary.subjectBreakdown,
          });
        }
      } catch (error) {
        logger.warn(
          { error, testId, studentId: userId, email: user.email },
          "Failed to queue student test result email",
        );
      }
    }

    return res.status(201).json(submission);
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

type InsightDifficulty = "easy" | "moderate" | "tough";
type InsightQuestionType = "mcq" | "multi" | "integer";
type InsightStatus = "strong" | "building" | "recovering" | "slipping" | "fragile";
type SpeedZone = "fast-accurate" | "fast-fragile" | "slow-solid" | "drag-zone";

type InsightPoint = {
  testId: number;
  submittedAt: string | null;
  subject: string;
  subjectKey: string;
  focus: string;
  focusKey: string;
  difficulty: InsightDifficulty;
  questionType: InsightQuestionType;
  attempted: boolean;
  correct: boolean;
  timeSpent: number;
};

type AdvancedInsightsPayload = {
  historyDepth: number;
  masteryMap: Array<{
    label: string;
    currentAccuracy: number;
    baselineAccuracy: number | null;
    trend: number | null;
    attempted: number;
    avgSecondsPerAttempt: number;
    status: InsightStatus;
    signal: string;
  }>;
  forgettingCurve: Array<{
    label: string;
    subject: string;
    previousAccuracy: number;
    currentAccuracy: number;
    drop: number;
    retentionPct: number;
    lastSeenDays: number | null;
  }>;
  speedVsAccuracy: Array<{
    label: string;
    accuracy: number;
    avgSecondsPerAttempt: number;
    baselineAccuracy: number | null;
    baselineSecondsPerAttempt: number | null;
    zone: SpeedZone;
    insight: string;
  }>;
  errorRecurrence: Array<{
    label: string;
    category: "Topic" | "Difficulty" | "Question Type";
    currentWrong: number;
    previousWrong: number;
    testsHit: number;
    severity: "high" | "medium";
    signal: string;
  }>;
  revisionRoadmap: Array<{
    title: string;
    priority: "High" | "Medium";
    focusArea: string;
    reason: string;
    actions: string[];
  }>;
};

function normalizeInsightQuestionType(value: unknown): InsightQuestionType {
  if (value === "multi") return "multi";
  if (value === "integer") return "integer";
  return "mcq";
}

function insightQuestionTypeLabel(value: InsightQuestionType) {
  if (value === "multi") return "Multi Select";
  if (value === "integer") return "Integer";
  return "MCQ";
}

function insightDifficultyLabel(value: InsightDifficulty) {
  if (value === "easy") return "Easy";
  if (value === "tough") return "Tough";
  return "Moderate";
}

function roundMetric(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeInsightPoints(points: InsightPoint[]) {
  const attemptedPoints = points.filter((point) => point.attempted);
  const attempted = attemptedPoints.length;
  const correct = attemptedPoints.filter((point) => point.correct).length;
  const wrong = Math.max(0, attempted - correct);
  const totalTime = attemptedPoints.reduce((sum, point) => sum + point.timeSpent, 0);
  return {
    attempted,
    correct,
    wrong,
    accuracy: attempted > 0 ? roundMetric((correct / attempted) * 100) : 0,
    avgSecondsPerAttempt: attempted > 0 ? roundMetric(totalTime / attempted) : 0,
  };
}

function resolveInsightFocusLabel(subject: string, focus: string) {
  const subjectKey = normalizeTitleKey(subject);
  const focusKey = normalizeTitleKey(focus);
  if (!focusKey || focusKey === subjectKey) return subject;
  return `${subject} · ${focus}`;
}

function buildInsightPoint(params: {
  testId: number;
  submittedAt: Date | string | null | undefined;
  testTitle: string;
  sectionLabel?: string | null;
  subjectName?: string | null;
  chapterName?: string | null;
  topicTag?: string | null;
  meta?: Record<string, unknown> | null;
  questionType?: string | null;
  attempted: boolean;
  correct: boolean;
  timeSpent: number;
}): InsightPoint {
  const subject = firstTrimmedString(
    params.subjectName,
    typeof params.meta?.subjectName === "string" ? params.meta.subjectName : null,
    params.sectionLabel,
    params.testTitle,
  ) ?? params.testTitle;
  const focus = firstTrimmedString(
    params.topicTag,
    typeof params.meta?.topicTag === "string" ? params.meta.topicTag : null,
    typeof params.meta?.topicName === "string" ? params.meta.topicName : null,
    typeof params.meta?.topic === "string" ? params.meta.topic : null,
    params.chapterName,
    typeof params.meta?.chapterName === "string" ? params.meta.chapterName : null,
    subject,
  ) ?? subject;
  const difficulty = normalizeTestDifficultyValue(params.meta?.difficulty) ?? "moderate";

  return {
    testId: params.testId,
    submittedAt: params.submittedAt ? new Date(params.submittedAt).toISOString() : null,
    subject,
    subjectKey: normalizeTitleKey(subject) ?? "unknown-subject",
    focus,
    focusKey: normalizeTitleKey(focus) ?? normalizeTitleKey(subject) ?? "unknown-focus",
    difficulty,
    questionType: normalizeInsightQuestionType(params.questionType),
    attempted: params.attempted,
    correct: params.correct,
    timeSpent: Number(params.timeSpent || 0),
  };
}

function buildHistoryInsightPoints(params: {
  testId: number;
  testTitle: string;
  submittedAt: Date | string | null | undefined;
  questions: Array<typeof testQuestionsTable.$inferSelect>;
  sections: Array<typeof testSectionsTable.$inferSelect>;
  answers: Record<string, unknown>;
  timings: Record<string, number>;
}) {
  const sectionsById = new Map(params.sections.map((section) => [section.id, section] as const));
  return params.questions.map((question) => {
    const meta = safeParseJson<Record<string, unknown> | null>(question.meta, null);
    const section = question.sectionId ? sectionsById.get(question.sectionId) ?? null : null;
    const sectionLabel = firstTrimmedString(question.subjectLabel, section?.subjectLabel, section?.title, params.testTitle);
    const resolvedTaxonomy = resolveStoredQuestionTaxonomy(meta, sectionLabel);
    const topicTag = firstTrimmedString(meta?.topicTag, meta?.topicName, meta?.topic);
    const answer = params.answers[question.id] ?? params.answers[String(question.id)];
    const attempted = hasAnsweredQuestion(question, answer);
    const correct = attempted ? gradeQuestion(question, answer) : false;
    const timeSpent = Number(params.timings[question.id] ?? params.timings[String(question.id)] ?? 0);
    return buildInsightPoint({
      testId: params.testId,
      submittedAt: params.submittedAt,
      testTitle: params.testTitle,
      sectionLabel,
      subjectName: resolvedTaxonomy.subjectName,
      chapterName: resolvedTaxonomy.chapterName,
      topicTag,
      meta,
      questionType: question.questionType,
      attempted,
      correct,
      timeSpent,
    });
  });
}

function buildAdvancedInsightsPayload(params: {
  currentPoints: InsightPoint[];
  historyPoints: InsightPoint[];
  historyDepth: number;
  currentSubmittedAt: Date | string | null | undefined;
}): AdvancedInsightsPayload {
  const currentSubmittedAt = params.currentSubmittedAt ? new Date(params.currentSubmittedAt) : null;
  const currentBySubject = new Map<string, { label: string; points: InsightPoint[] }>();
  const historyBySubject = new Map<string, { label: string; points: InsightPoint[] }>();
  const currentByFocus = new Map<string, { label: string; subject: string; points: InsightPoint[] }>();
  const historyByFocus = new Map<string, { label: string; subject: string; points: InsightPoint[] }>();

  const registerGroup = <T extends { label: string; points: InsightPoint[] }>(
    map: Map<string, T>,
    key: string,
    create: () => T,
    point: InsightPoint,
  ) => {
    const existing = map.get(key) ?? create();
    existing.points.push(point);
    map.set(key, existing);
  };

  for (const point of params.currentPoints) {
    registerGroup(currentBySubject, point.subjectKey, () => ({ label: point.subject, points: [] }), point);
    registerGroup(currentByFocus, point.focusKey, () => ({ label: point.focus, subject: point.subject, points: [] }), point);
  }
  for (const point of params.historyPoints) {
    registerGroup(historyBySubject, point.subjectKey, () => ({ label: point.subject, points: [] }), point);
    registerGroup(historyByFocus, point.focusKey, () => ({ label: point.focus, subject: point.subject, points: [] }), point);
  }

  const masteryMap = Array.from(currentBySubject.entries())
    .map(([subjectKey, group]) => {
      const current = summarizeInsightPoints(group.points);
      const baselineGroup = historyBySubject.get(subjectKey);
      const baseline = baselineGroup ? summarizeInsightPoints(baselineGroup.points) : null;
      const trend = baseline ? roundMetric(current.accuracy - baseline.accuracy) : null;

      let status: InsightStatus = "building";
      if (current.accuracy >= 75 && (trend == null || trend >= -5)) status = "strong";
      else if (trend != null && trend >= 8) status = "recovering";
      else if (trend != null && trend <= -12) status = "slipping";
      else if (current.accuracy < 55) status = "fragile";

      let signal = `${current.attempted} attempted with ${current.avgSecondsPerAttempt}s average pace.`;
      if (baseline && trend != null) {
        signal = trend >= 0
          ? `Up ${Math.abs(trend)} pts vs recent baseline with ${current.avgSecondsPerAttempt}s average pace.`
          : `Down ${Math.abs(trend)} pts vs recent baseline with ${current.avgSecondsPerAttempt}s average pace.`;
      }

      return {
        label: group.label,
        currentAccuracy: current.accuracy,
        baselineAccuracy: baseline?.accuracy ?? null,
        trend,
        attempted: current.attempted,
        avgSecondsPerAttempt: current.avgSecondsPerAttempt,
        status,
        signal,
      };
    })
    .sort((left, right) => {
      const rank: Record<InsightStatus, number> = { slipping: 0, fragile: 1, building: 2, recovering: 3, strong: 4 };
      return rank[left.status] - rank[right.status] || left.currentAccuracy - right.currentAccuracy;
    });

  let forgettingCurve = Array.from(currentByFocus.entries())
    .map(([focusKey, group]) => {
      const current = summarizeInsightPoints(group.points);
      const historyGroup = historyByFocus.get(focusKey);
      if (!historyGroup) return null;
      const baseline = summarizeInsightPoints(historyGroup.points);
      const drop = roundMetric(baseline.accuracy - current.accuracy);
      if (baseline.attempted < 2 || current.attempted < 1 || baseline.accuracy < 60 || drop < 12) return null;
      const latestSeen = historyGroup.points
        .map((point) => point.submittedAt)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
      const lastSeenDays = currentSubmittedAt && latestSeen
        ? Math.max(0, Math.round((currentSubmittedAt.getTime() - new Date(latestSeen).getTime()) / (1000 * 60 * 60 * 24)))
        : null;
      return {
        label: group.label,
        subject: group.subject,
        previousAccuracy: baseline.accuracy,
        currentAccuracy: current.accuracy,
        drop,
        retentionPct: baseline.accuracy > 0 ? roundMetric((current.accuracy / baseline.accuracy) * 100) : 0,
        lastSeenDays,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => right.drop - left.drop)
    .slice(0, 4);

  if (forgettingCurve.length === 0) {
    forgettingCurve = masteryMap
      .filter((item) => item.baselineAccuracy != null && item.trend != null && item.trend <= -12)
      .map((item) => ({
        label: item.label,
        subject: item.label,
        previousAccuracy: item.baselineAccuracy ?? 0,
        currentAccuracy: item.currentAccuracy,
        drop: Math.abs(item.trend ?? 0),
        retentionPct: item.baselineAccuracy ? roundMetric((item.currentAccuracy / item.baselineAccuracy) * 100) : 0,
        lastSeenDays: null,
      }))
      .slice(0, 4);
  }

  const speedVsAccuracy = Array.from(currentBySubject.entries())
    .map(([subjectKey, group]) => {
      const current = summarizeInsightPoints(group.points);
      const baselineGroup = historyBySubject.get(subjectKey);
      const baseline = baselineGroup ? summarizeInsightPoints(baselineGroup.points) : null;
      const paceReference = baseline?.avgSecondsPerAttempt ?? 90;

      let zone: SpeedZone = "slow-solid";
      if (current.accuracy >= 70 && current.avgSecondsPerAttempt <= paceReference * 0.95) zone = "fast-accurate";
      else if (current.accuracy < 70 && current.avgSecondsPerAttempt <= paceReference) zone = "fast-fragile";
      else if (current.accuracy < 70) zone = "drag-zone";

      let insight = `${current.accuracy}% accuracy at ${current.avgSecondsPerAttempt}s per attempt.`;
      if (baseline) {
        const paceDelta = roundMetric(current.avgSecondsPerAttempt - baseline.avgSecondsPerAttempt);
        const accDelta = roundMetric(current.accuracy - baseline.accuracy);
        const paceLabel = paceDelta >= 0 ? `${paceDelta}s slower` : `${Math.abs(paceDelta)}s faster`;
        const accLabel = accDelta >= 0 ? `${accDelta} pts up` : `${Math.abs(accDelta)} pts down`;
        insight = `${paceLabel} with ${accLabel} vs recent baseline.`;
      }

      return {
        label: group.label,
        accuracy: current.accuracy,
        avgSecondsPerAttempt: current.avgSecondsPerAttempt,
        baselineAccuracy: baseline?.accuracy ?? null,
        baselineSecondsPerAttempt: baseline?.avgSecondsPerAttempt ?? null,
        zone,
        insight,
      };
    })
    .sort((left, right) => {
      const rank: Record<SpeedZone, number> = { "drag-zone": 0, "fast-fragile": 1, "slow-solid": 2, "fast-accurate": 3 };
      return rank[left.zone] - rank[right.zone] || left.accuracy - right.accuracy;
    });

  const currentWrongPoints = params.currentPoints.filter((point) => point.attempted && !point.correct);
  const historyWrongPoints = params.historyPoints.filter((point) => point.attempted && !point.correct);
  const recurrenceCandidates = new Map<string, {
    label: string;
    category: "Topic" | "Difficulty" | "Question Type";
    currentWrong: number;
    previousWrong: number;
    testsHit: Set<number>;
  }>();

  const registerRecurrence = (
    key: string,
    category: "Topic" | "Difficulty" | "Question Type",
    label: string,
    point: InsightPoint,
    bucket: "currentWrong" | "previousWrong",
  ) => {
    const existing = recurrenceCandidates.get(key) ?? {
      label,
      category,
      currentWrong: 0,
      previousWrong: 0,
      testsHit: new Set<number>(),
    };
    existing[bucket] += 1;
    existing.testsHit.add(point.testId);
    recurrenceCandidates.set(key, existing);
  };

  for (const point of currentWrongPoints) {
    registerRecurrence(`topic:${point.focusKey}`, "Topic", resolveInsightFocusLabel(point.subject, point.focus), point, "currentWrong");
    registerRecurrence(`difficulty:${point.difficulty}`, "Difficulty", insightDifficultyLabel(point.difficulty), point, "currentWrong");
    registerRecurrence(`type:${point.questionType}`, "Question Type", insightQuestionTypeLabel(point.questionType), point, "currentWrong");
  }
  for (const point of historyWrongPoints) {
    registerRecurrence(`topic:${point.focusKey}`, "Topic", resolveInsightFocusLabel(point.subject, point.focus), point, "previousWrong");
    registerRecurrence(`difficulty:${point.difficulty}`, "Difficulty", insightDifficultyLabel(point.difficulty), point, "previousWrong");
    registerRecurrence(`type:${point.questionType}`, "Question Type", insightQuestionTypeLabel(point.questionType), point, "previousWrong");
  }

  const errorRecurrence = Array.from(recurrenceCandidates.values())
    .filter((item) => (item.currentWrong >= 1 && item.previousWrong >= 1) || (item.currentWrong + item.previousWrong >= 3 && item.testsHit.size >= 2))
    .sort((left, right) => {
      const leftScore = left.currentWrong * 3 + left.previousWrong * 2 + left.testsHit.size + (left.category === "Topic" ? 2 : 0);
      const rightScore = right.currentWrong * 3 + right.previousWrong * 2 + right.testsHit.size + (right.category === "Topic" ? 2 : 0);
      return rightScore - leftScore;
    })
    .slice(0, 4)
    .map((item) => {
      const severity: "high" | "medium" = item.currentWrong + item.previousWrong >= 4 || item.testsHit.size >= 3 ? "high" : "medium";
      return {
        label: item.label,
        category: item.category,
        currentWrong: item.currentWrong,
        previousWrong: item.previousWrong,
        testsHit: item.testsHit.size,
        severity,
        signal: `Wrong ${item.currentWrong + item.previousWrong} times across ${item.testsHit.size} test${item.testsHit.size === 1 ? "" : "s"}.`,
      };
    });

  const revisionRoadmap: AdvancedInsightsPayload["revisionRoadmap"] = [];
  const roadmapKeys = new Set<string>();
  const pushRoadmap = (item: AdvancedInsightsPayload["revisionRoadmap"][number]) => {
    const key = normalizeTitleKey(item.focusArea) ?? normalizeTitleKey(item.title) ?? item.title;
    if (roadmapKeys.has(key)) return;
    roadmapKeys.add(key);
    revisionRoadmap.push(item);
  };

  const weakestMastery = masteryMap[0];
  const biggestDrop = forgettingCurve[0];
  const biggestRecurringError = errorRecurrence[0];
  const paceRisk = speedVsAccuracy.find((item) => item.zone === "drag-zone" || item.zone === "fast-fragile") ?? speedVsAccuracy[0];

  if (biggestDrop) {
    pushRoadmap({
      title: `Recover ${biggestDrop.label}`,
      priority: "High",
      focusArea: biggestDrop.label,
      reason: `${biggestDrop.drop} pt drop vs recent baseline. Retention is now ${biggestDrop.retentionPct}% in this area.`,
      actions: [
        `Redo the last wrong questions from ${biggestDrop.label} without time pressure.`,
        `Create a short formula or concept recap for ${biggestDrop.label}.`,
        `Attempt one timed mini-set from ${biggestDrop.label} before the next mock.`,
      ],
    });
  }

  if (biggestRecurringError) {
    pushRoadmap({
      title: `Break ${biggestRecurringError.label} loop`,
      priority: biggestRecurringError.severity === "high" ? "High" : "Medium",
      focusArea: biggestRecurringError.label,
      reason: `${biggestRecurringError.category} mistakes have repeated across ${biggestRecurringError.testsHit} tests.`,
      actions: [
        `Review why ${biggestRecurringError.currentWrong + biggestRecurringError.previousWrong} mistakes happened in ${biggestRecurringError.label}.`,
        `Solve 8-12 focused questions from this bucket in mixed difficulty.`,
        `Do one post-practice audit and note the exact trigger behind each miss.`,
      ],
    });
  }

  if (paceRisk) {
    pushRoadmap({
      title: paceRisk.zone === "drag-zone" ? `Unblock pace in ${paceRisk.label}` : `Stabilise accuracy in ${paceRisk.label}`,
      priority: paceRisk.zone === "drag-zone" ? "High" : "Medium",
      focusArea: paceRisk.label,
      reason: paceRisk.insight,
      actions: [
        `Run one timed set for ${paceRisk.label} with a hard stop per question.`,
        `Mark which questions deserve quick skip vs full attempt in ${paceRisk.label}.`,
        `Compare pace after the next test and keep only the faster method that stays accurate.`,
      ],
    });
  }

  if (revisionRoadmap.length < 3 && weakestMastery) {
    pushRoadmap({
      title: `Rebuild ${weakestMastery.label}`,
      priority: weakestMastery.status === "fragile" || weakestMastery.status === "slipping" ? "High" : "Medium",
      focusArea: weakestMastery.label,
      reason: weakestMastery.signal,
      actions: [
        `Revisit core concepts and solved examples from ${weakestMastery.label}.`,
        `Solve a short untimed drill first, then repeat it with time pressure.`,
        `Track whether accuracy crosses ${Math.max(70, weakestMastery.currentAccuracy + 10)}% on the next attempt.`,
      ],
    });
  }

  return {
    historyDepth: params.historyDepth,
    masteryMap,
    forgettingCurve,
    speedVsAccuracy,
    errorRecurrence,
    revisionRoadmap: revisionRoadmap.slice(0, 3),
  };
}

// GET /api/tests/:id/my-analysis — student gets their own advanced analysis + anonymous class stats
router.get("/tests/:id/my-analysis", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || user.role !== "student") return res.status(403).json({ error: "Forbidden" });
    if (!ensureStudentFeatureUnlocked(user, "tests", res)) return;

    const [test] = await db.select({
      id: testsTable.id, title: testsTable.title, description: testsTable.description,
      durationMinutes: testsTable.durationMinutes, passingScore: testsTable.passingScore,
      examType: testsTable.examType,
      examHeader: testsTable.examHeader,
      examSubheader: testsTable.examSubheader,
      classId: testsTable.classId, className: classesTable.title,
    }).from(testsTable).leftJoin(classesTable, eq(testsTable.classId, classesTable.id))
      .where(eq(testsTable.id, testId));
    if (!test) return res.status(404).json({ error: "Not found" });

    // Student's own submission
    const [submission] = await db.select({
      id: testSubmissionsTable.id,
      answers: testSubmissionsTable.answers,
      questionTimings: testSubmissionsTable.questionTimings,
      flaggedQuestions: testSubmissionsTable.flaggedQuestions,
      visitedQuestionIds: testSubmissionsTable.visitedQuestionIds,
      reviewQuestionIds: testSubmissionsTable.reviewQuestionIds,
      interactionLog: testSubmissionsTable.interactionLog,
      score: testSubmissionsTable.score,
      totalPoints: testSubmissionsTable.totalPoints,
      percentage: testSubmissionsTable.percentage,
      passed: testSubmissionsTable.passed,
      submittedAt: testSubmissionsTable.submittedAt,
    }).from(testSubmissionsTable)
      .where(and(eq(testSubmissionsTable.testId, testId), eq(testSubmissionsTable.studentId, userId)))
      .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id))
      .limit(1);
    if (!submission) return res.status(403).json({ error: "You have not submitted this test" });

    const questions = await db.select().from(testQuestionsTable)
      .where(eq(testQuestionsTable.testId, testId)).orderBy(testQuestionsTable.order);
    const sections = await db.select().from(testSectionsTable)
      .where(eq(testSectionsTable.testId, testId)).orderBy(testSectionsTable.order);
    const sectionById = new Map(sections.map((section) => [section.id, section] as const));

    const recentSubmissionRows = await db.select({
      id: testSubmissionsTable.id,
      testId: testSubmissionsTable.testId,
      answers: testSubmissionsTable.answers,
      questionTimings: testSubmissionsTable.questionTimings,
      score: testSubmissionsTable.score,
      totalPoints: testSubmissionsTable.totalPoints,
      percentage: testSubmissionsTable.percentage,
      submittedAt: testSubmissionsTable.submittedAt,
      testTitle: testsTable.title,
    }).from(testSubmissionsTable)
      .innerJoin(testsTable, eq(testSubmissionsTable.testId, testsTable.id))
      .where(eq(testSubmissionsTable.studentId, userId))
      .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id));

    const latestRecentByTest = new Map<number, typeof recentSubmissionRows[number]>();
    for (const row of recentSubmissionRows) {
      if (row.testId === testId || latestRecentByTest.has(row.testId)) continue;
      latestRecentByTest.set(row.testId, row);
      if (latestRecentByTest.size >= 5) break;
    }
    const historyRows = Array.from(latestRecentByTest.values());
    const historyTestIds = historyRows.map((row) => row.testId);
    const historyQuestions = historyTestIds.length > 0
      ? await db.select().from(testQuestionsTable)
        .where(inArray(testQuestionsTable.testId, historyTestIds))
        .orderBy(asc(testQuestionsTable.testId), asc(testQuestionsTable.order))
      : [];
    const historySections = historyTestIds.length > 0
      ? await db.select().from(testSectionsTable)
        .where(inArray(testSectionsTable.testId, historyTestIds))
        .orderBy(asc(testSectionsTable.testId), asc(testSectionsTable.order))
      : [];
    const historyQuestionsByTest = new Map<number, typeof historyQuestions>();
    const historySectionsByTest = new Map<number, typeof historySections>();
    for (const row of historyRows) {
      historyQuestionsByTest.set(row.testId, []);
      historySectionsByTest.set(row.testId, []);
    }
    for (const question of historyQuestions) {
      historyQuestionsByTest.get(question.testId)?.push(question);
    }
    for (const section of historySections) {
      historySectionsByTest.get(section.testId)?.push(section);
    }

    // All class submissions for aggregate stats
    const allSubRows = await db.select({
      id: testSubmissionsTable.id, percentage: testSubmissionsTable.percentage,
      passed: testSubmissionsTable.passed, answers: testSubmissionsTable.answers,
      questionTimings: testSubmissionsTable.questionTimings,
      studentId: testSubmissionsTable.studentId,
      submittedAt: testSubmissionsTable.submittedAt,
    }).from(testSubmissionsTable)
      .where(eq(testSubmissionsTable.testId, testId))
      .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id));

    const latestByStudent = new Map<number, typeof allSubRows[number]>();
    for (const row of allSubRows) {
      if (!latestByStudent.has(row.studentId)) latestByStudent.set(row.studentId, row);
    }
    const allSubs = Array.from(latestByStudent.values());

    const totalSubs = allSubs.length;
    const classAvg = totalSubs > 0 ? Math.round(allSubs.reduce((a, s) => a + s.percentage, 0) / totalSubs) : 0;
    const classPassRate = totalSubs > 0 ? Math.round(allSubs.filter(s => s.passed).length / totalSubs * 100) : 0;

    // Student rank & percentile
    const sortedPct = [...allSubs].sort((a, b) => b.percentage - a.percentage);
    const rank = sortedPct.findIndex(s => s.studentId === userId) + 1;
    const percentile = totalSubs > 1 ? Math.round(((totalSubs - rank) / (totalSubs - 1)) * 100) : 100;

    // Student's parsed data
    const myAnswers: Record<string, any> = JSON.parse(submission.answers ?? "{}");
    const myTimings: Record<string, number> = submission.questionTimings ? JSON.parse(submission.questionTimings) : {};
    const myFlagged: number[] = submission.flaggedQuestions ? JSON.parse(submission.flaggedQuestions) : [];
    const myVisited: number[] = submission.visitedQuestionIds ? JSON.parse(submission.visitedQuestionIds) : [];
    const myReview: number[] = submission.reviewQuestionIds ? JSON.parse(submission.reviewQuestionIds) : [];
    const myInteractionLog = submission.interactionLog ? JSON.parse(submission.interactionLog) : [];

    // Per-question analysis
    const perQuestion = questions.map((q, idx) => {
      const meta = q.meta ? JSON.parse(q.meta) : null;
      const section = q.sectionId ? sectionById.get(q.sectionId) ?? null : null;
      const sectionLabel = firstTrimmedString(
        q.subjectLabel,
        section?.subjectLabel,
        section?.title,
      );
      const resolvedTaxonomy = resolveStoredQuestionTaxonomy(meta, sectionLabel);
      const topicTag = firstTrimmedString(meta?.topicTag, meta?.topicName, meta?.topic);
      const answer = myAnswers[q.id] ?? myAnswers[String(q.id)];
      const isSkipped = answer === undefined || answer === null || (Array.isArray(answer) && answer.length === 0) || answer === "";
      const isCorrect = !isSkipped ? gradeQuestion(q, answer) : false;
      const myTime = myTimings[q.id] ?? myTimings[String(q.id)] ?? 0;
      const isFlagged = myFlagged.includes(q.id) || myFlagged.includes(Number(q.id));

      // Class-level stats for this question
      let classCorrectCount = 0;
      let classAttemptedCount = 0;
      const classTimings: number[] = [];
      allSubs.forEach(s => {
        const parsedAns = JSON.parse(s.answers ?? "{}");
        const ans = parsedAns[q.id] ?? parsedAns[String(q.id)];
        if (hasAnsweredQuestion(q, ans)) classAttemptedCount++;
        if (gradeQuestion(q, ans)) classCorrectCount++;
        const timings: Record<string, number> = s.questionTimings ? JSON.parse(s.questionTimings) : {};
        const t = timings[q.id] ?? timings[String(q.id)] ?? 0;
        classTimings.push(Number(t) || 0);
      });
      const classWrongCount = Math.max(0, classAttemptedCount - classCorrectCount);
      const classSkippedCount = Math.max(0, totalSubs - classAttemptedCount);
      const classSuccessRate = totalSubs > 0 ? Math.round(classCorrectCount / totalSubs * 100) : 0;
      const classAvgTime = classTimings.length > 0 ? Math.round(classTimings.reduce((a, b) => a + b, 0) / classTimings.length) : 0;

      return {
        id: q.id, order: idx + 1,
        question: q.question, questionType: q.questionType ?? "mcq",
        options: q.options ? JSON.parse(q.options) : [],
        optionImages: q.optionImages ? JSON.parse(q.optionImages) : null,
        imageData: q.imageData ?? null,
        sectionId: q.sectionId ?? null,
        subjectLabel: sectionLabel ?? null,
        subjectName: resolvedTaxonomy.subjectName,
        chapterName: resolvedTaxonomy.chapterName,
        topicTag,
        meta,
        points: q.points,
        negativeMarks: q.negativeMarks ?? 0,
        correctAnswer: q.correctAnswer,
        correctAnswerMulti: q.correctAnswerMulti ? JSON.parse(q.correctAnswerMulti) : null,
        correctAnswerMin: q.correctAnswerMin ?? null,
        correctAnswerMax: q.correctAnswerMax ?? null,
        myAnswer: isSkipped ? null : answer,
        isCorrect,
        isSkipped,
        isFlagged,
        myTime,
        classSuccessRate,
        classAvgTime,
        classCorrectCount,
        classAttemptedCount,
        classWrongCount,
        classSkippedCount,
        // Time comparison: faster/slower than class
        timeVsClass: classAvgTime > 0 ? Math.round((myTime - classAvgTime) / classAvgTime * 100) : 0,
      };
    });

    const totalTime = Object.values(myTimings).reduce((a, b) => a + (Number(b) || 0), 0);
    const correctCount = perQuestion.filter(q => q.isCorrect).length;
    const skippedCount = perQuestion.filter(q => q.isSkipped).length;
    const wrongCount = perQuestion.length - correctCount - skippedCount;

    // Insights
    const weakQuestions = perQuestion.filter(q => !q.isCorrect && !q.isSkipped && q.classSuccessRate >= 60);
    const hardQuestions = perQuestion.filter(q => !q.isCorrect && q.classSuccessRate < 40);
    const timeHogs = perQuestion.filter(q => q.myTime > 0).sort((a, b) => b.myTime - a.myTime).slice(0, 3);
    const fasterThanClass = perQuestion.filter(q => q.timeVsClass < -20 && q.myTime > 0).length;
    const slowerThanClass = perQuestion.filter(q => q.timeVsClass > 50 && q.myTime > 0).length;

    const currentInsightPoints = perQuestion.map((question) => buildInsightPoint({
      testId,
      submittedAt: submission.submittedAt,
      testTitle: test.title,
      sectionLabel: question.subjectLabel,
      subjectName: question.subjectName,
      chapterName: question.chapterName,
      topicTag: question.topicTag,
      meta: question.meta,
      questionType: question.questionType,
      attempted: !question.isSkipped,
      correct: question.isCorrect,
      timeSpent: question.myTime,
    }));

    const historicalInsightPoints = historyRows.flatMap((row) => buildHistoryInsightPoints({
      testId: row.testId,
      testTitle: row.testTitle,
      submittedAt: row.submittedAt,
      questions: historyQuestionsByTest.get(row.testId) ?? [],
      sections: historySectionsByTest.get(row.testId) ?? [],
      answers: safeParseJson<Record<string, unknown>>(row.answers, {}),
      timings: safeParseJson<Record<string, number>>(row.questionTimings, {}),
    }));

    const advancedInsights = buildAdvancedInsightsPayload({
      currentPoints: currentInsightPoints,
      historyPoints: historicalInsightPoints,
      historyDepth: historyRows.length,
      currentSubmittedAt: submission.submittedAt,
    });

    return res.json({
      test: { ...test, totalQuestions: questions.length },
      submission: {
        id: submission.id, score: submission.score, totalPoints: submission.totalPoints,
        percentage: submission.percentage, passed: submission.passed, submittedAt: submission.submittedAt,
        totalTime, correctCount, wrongCount, skippedCount,
        flaggedCount: myFlagged.length,
        questionTimings: myTimings,
        flaggedQuestions: myFlagged,
        visitedQuestionIds: myVisited,
        reviewQuestionIds: myReview,
        interactionLog: myInteractionLog,
      },
      sections: sections.map((section) => ({
        ...section,
        meta: section.meta ? JSON.parse(section.meta) : null,
      })),
      classStats: { totalSubs, classAvg, classPassRate, rank, percentile },
      perQuestion,
      insights: { weakQuestions, hardQuestions, timeHogs, fasterThanClass, slowerThanClass },
      advancedInsights,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tests/:id/solutions — section-wise solutions after submission
router.get("/tests/:id/solutions", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const sectionId = req.query.sectionId ? parseInt(String(req.query.sectionId), 10) : null;
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const [test] = await db.select({
      id: testsTable.id,
      title: testsTable.title,
      examHeader: testsTable.examHeader,
      examSubheader: testsTable.examSubheader,
    }).from(testsTable).where(eq(testsTable.id, testId));
    if (!test) return res.status(404).json({ error: "Test not found" });

    const isAdmin = user.role === "admin" || user.role === "super_admin";
    if (!isAdmin) {
      if (!ensureStudentFeatureUnlocked(user, "tests", res)) return;
      const [submission] = await db.select({ id: testSubmissionsTable.id })
        .from(testSubmissionsTable)
        .where(and(eq(testSubmissionsTable.testId, testId), eq(testSubmissionsTable.studentId, userId)))
        .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id))
        .limit(1);
      if (!submission) {
        return res.status(403).json({ error: "You have not submitted this test" });
      }
    }

    const sections = await db.select().from(testSectionsTable)
      .where(eq(testSectionsTable.testId, testId))
      .orderBy(asc(testSectionsTable.order));

    const filteredSections = sectionId
      ? sections.filter((section) => section.id === sectionId)
      : sections;

    const questions = await db.select().from(testQuestionsTable)
      .where(eq(testQuestionsTable.testId, testId))
      .orderBy(asc(testQuestionsTable.order));
    const questionIds = questions.map((question) => question.id);
    const studentReports = user.role === "student" && questionIds.length > 0
      ? await db
          .select()
          .from(testQuestionReportsTable)
          .where(and(
            inArray(testQuestionReportsTable.questionId, questionIds),
            eq(testQuestionReportsTable.reportedBy, userId),
          ))
          .orderBy(desc(testQuestionReportsTable.createdAt), desc(testQuestionReportsTable.id))
      : [];
    const latestReportByQuestionId = new Map<number, typeof studentReports[number]>();
    for (const report of studentReports) {
      if (!latestReportByQuestionId.has(report.questionId)) {
        latestReportByQuestionId.set(report.questionId, report);
      }
    }
    const allSubmissions = await db
      .select({ answers: testSubmissionsTable.answers })
      .from(testSubmissionsTable)
      .where(eq(testSubmissionsTable.testId, testId));

    const questionsBySection = new Map<number | null, any[]>();
    for (const question of questions) {
      const key = question.sectionId ?? null;
      const existing = questionsBySection.get(key) ?? [];
      existing.push(question);
      questionsBySection.set(key, existing);
    }

    const serializedSections: Array<{
      id: number;
      title: string;
      subjectLabel: string | null;
      order: number;
      items: Array<Record<string, unknown>>;
    }> = [];

    for (const section of filteredSections) {
      const sectionQuestions = questionsBySection.get(section.id) ?? [];
      const items: Array<Record<string, unknown>> = [];

      for (const question of sectionQuestions) {
        const optionStats = computeOptionSelectionStats(question, allSubmissions);
        items.push({
          ...serializeTestQuestion(question, { showCorrect: true, includeSolutions: true }),
          solutionText: question.solutionText?.trim() || null,
          solutionImageData: question.solutionImageData ?? null,
          solutionSource: question.solutionText?.trim() || question.solutionImageData?.trim() ? "teacher" : "none",
          report: latestReportByQuestionId.get(question.id)
            ? serializeTestQuestionReport(latestReportByQuestionId.get(question.id))
            : null,
          optionSelectionCounts: optionStats.optionCounts,
          optionSelectionPercentages: optionStats.optionSelectionPercentages,
        });
      }

      serializedSections.push({
        id: section.id,
        title: section.title,
        subjectLabel: section.subjectLabel ?? null,
        order: section.order ?? 0,
        items,
      });
    }

    return res.json({
      test,
      sections: serializedSections,
    });
  } catch (error) {
    console.error("GET /api/tests/:id/solutions failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tests/:id/results — admin sees all submissions
router.get("/tests/:id/results", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || (user.role !== "admin" && user.role !== "super_admin")) return res.status(403).json({ error: "Forbidden" });

    const submissions = await db.select({
      id: testSubmissionsTable.id, studentId: testSubmissionsTable.studentId,
      score: testSubmissionsTable.score, totalPoints: testSubmissionsTable.totalPoints,
      percentage: testSubmissionsTable.percentage, passed: testSubmissionsTable.passed,
      submittedAt: testSubmissionsTable.submittedAt, answers: testSubmissionsTable.answers,
      studentName: usersTable.fullName, studentUsername: usersTable.username,
    }).from(testSubmissionsTable)
      .leftJoin(usersTable, eq(testSubmissionsTable.studentId, usersTable.id))
      .where(eq(testSubmissionsTable.testId, testId))
      .orderBy(testSubmissionsTable.submittedAt);

    return res.json(submissions);
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

// GET /api/tests/:id/analytics — detailed analytics with per-question breakdown
router.get("/tests/:id/analytics", requireAuth, async (req, res) => {
  try {
    const testId = parseInt(req.params.id, 10);
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user || (user.role !== "admin" && user.role !== "super_admin")) return res.status(403).json({ error: "Forbidden" });

    const [test] = await db.select().from(testsTable).where(eq(testsTable.id, testId));
    if (!test) return res.status(404).json({ error: "Not found" });

    const questions = await db.select().from(testQuestionsTable)
      .where(eq(testQuestionsTable.testId, testId)).orderBy(testQuestionsTable.order);

    const submissions = await db.select({
      id: testSubmissionsTable.id, score: testSubmissionsTable.score,
      totalPoints: testSubmissionsTable.totalPoints, percentage: testSubmissionsTable.percentage,
      passed: testSubmissionsTable.passed, submittedAt: testSubmissionsTable.submittedAt,
      answers: testSubmissionsTable.answers,
      questionTimings: testSubmissionsTable.questionTimings,
      flaggedQuestions: testSubmissionsTable.flaggedQuestions,
      studentId: testSubmissionsTable.studentId,
      studentName: usersTable.fullName, studentUsername: usersTable.username,
    }).from(testSubmissionsTable)
      .leftJoin(usersTable, eq(testSubmissionsTable.studentId, usersTable.id))
      .where(eq(testSubmissionsTable.testId, testId))
      .orderBy(testSubmissionsTable.submittedAt);

    const total = submissions.length;
    const passCount = submissions.filter((s) => s.passed).length;
    const avgPercentage = total > 0 ? Math.round(submissions.reduce((a, s) => a + s.percentage, 0) / total) : 0;
    const avgScore = total > 0 ? +(submissions.reduce((a, s) => a + s.score, 0) / total).toFixed(1) : 0;
    const maxScore = total > 0 ? Math.max(...submissions.map((s) => s.percentage)) : 0;
    const minScore = total > 0 ? Math.min(...submissions.map((s) => s.percentage)) : 0;

    // Standard deviation of scores
    const stdDev = total > 1
      ? Math.round(Math.sqrt(submissions.reduce((acc, s) => acc + Math.pow(s.percentage - avgPercentage, 2), 0) / total))
      : 0;

    // Score distribution buckets (0-20, 20-40, 40-60, 60-80, 80-100)
    const buckets = [
      { range: "0–20%", min: 0, max: 20, count: 0 },
      { range: "21–40%", min: 21, max: 40, count: 0 },
      { range: "41–60%", min: 41, max: 60, count: 0 },
      { range: "61–80%", min: 61, max: 80, count: 0 },
      { range: "81–100%", min: 81, max: 100, count: 0 },
    ];
    submissions.forEach((s) => {
      const bucket = buckets.find((b) => s.percentage >= b.min && s.percentage <= b.max);
      if (bucket) bucket.count++;
    });

    // Median score
    const sortedPct = [...submissions.map((s) => s.percentage)].sort((a, b) => a - b);
    const median = total > 0
      ? total % 2 === 0
        ? Math.round((sortedPct[total / 2 - 1] + sortedPct[total / 2]) / 2)
        : sortedPct[Math.floor(total / 2)]
      : 0;

    // Per-question analytics with time analysis + discrimination index
    const perQuestion = questions.map((q) => {
      let correctCount = 0;
      let skippedCount = 0;
      const optionCounts: number[] = q.options ? JSON.parse(q.options).map(() => 0) : [];
      const timingsPerSub: number[] = [];
      let flaggedCount = 0;

      // For discrimination index: split into top/bottom 27%
      const n27 = Math.max(1, Math.round(total * 0.27));
      const sortedByScore = [...submissions].sort((a, b) => b.percentage - a.percentage);
      const topGroup = sortedByScore.slice(0, n27);
      const bottomGroup = sortedByScore.slice(-n27);
      let topCorrect = 0;
      let bottomCorrect = 0;

      submissions.forEach((s) => {
        const parsedAnswers = JSON.parse(s.answers ?? "{}");
        const answer = parsedAnswers[q.id];
        const timings = s.questionTimings ? JSON.parse(s.questionTimings) : {};
        const flagged = s.flaggedQuestions ? JSON.parse(s.flaggedQuestions) : [];

        if (answer === undefined || answer === null || answer === "") {
          skippedCount++;
        } else {
          if (gradeQuestion(q, answer)) correctCount++;
        }

        if (flagged.includes(q.id) || flagged.includes(String(q.id))) flaggedCount++;

        const timing = timings[q.id] ?? timings[String(q.id)] ?? 0;
        timingsPerSub.push(Number(timing) || 0);

        // Track option selections for MCQ/multi
        if ((q.questionType ?? "mcq") === "mcq" && answer !== undefined && answer !== null) {
          const idx = Number(answer);
          if (optionCounts[idx] !== undefined) optionCounts[idx]++;
        }
        if ((q.questionType ?? "mcq") === "multi" && Array.isArray(answer)) {
          answer.forEach((idx: number) => {
            if (optionCounts[idx] !== undefined) optionCounts[idx]++;
          });
        }
      });

      // Discrimination index for top/bottom groups
      topGroup.forEach((s) => {
        const parsedAnswers = JSON.parse(s.answers ?? "{}");
        const answer = parsedAnswers[q.id];
        if (gradeQuestion(q, answer)) topCorrect++;
      });
      bottomGroup.forEach((s) => {
        const parsedAnswers = JSON.parse(s.answers ?? "{}");
        const answer = parsedAnswers[q.id];
        if (gradeQuestion(q, answer)) bottomCorrect++;
      });

      const discriminationIndex = n27 > 0
        ? +((topCorrect / n27 - bottomCorrect / n27)).toFixed(2)
        : 0;

      const avgTime = timingsPerSub.length > 0
        ? Math.round(timingsPerSub.reduce((a, b) => a + b, 0) / timingsPerSub.length)
        : 0;
      const maxTime = timingsPerSub.length > 0 ? Math.max(...timingsPerSub) : 0;
      const minTime = timingsPerSub.length > 0 ? Math.min(...timingsPerSub) : 0;

      const successRate = total > 0 ? Math.round((correctCount / total) * 100) : 0;

      // Difficulty classification
      const difficulty = successRate >= 75 ? "easy" : successRate >= 40 ? "medium" : "hard";

      // Quality classification based on discrimination index
      const quality = discriminationIndex >= 0.4 ? "excellent"
        : discriminationIndex >= 0.3 ? "good"
        : discriminationIndex >= 0.2 ? "fair"
        : "poor";

      return {
        id: q.id,
        question: q.question,
        questionType: q.questionType ?? "mcq",
        options: q.options ? JSON.parse(q.options) : [],
        optionImages: q.optionImages ? JSON.parse(q.optionImages) : null,
        correctAnswer: q.correctAnswer,
        correctAnswerMulti: q.correctAnswerMulti ? JSON.parse(q.correctAnswerMulti) : null,
        correctAnswerMin: q.correctAnswerMin ?? null,
        correctAnswerMax: q.correctAnswerMax ?? null,
        points: q.points,
        correctCount,
        wrongCount: total - correctCount - skippedCount,
        skippedCount,
        successRate,
        optionCounts,
        imageData: q.imageData ?? null,
        // Advanced metrics
        difficulty,
        quality,
        discriminationIndex,
        flaggedCount,
        avgTime,
        maxTime,
        minTime,
        timingsPerSub,
      };
    });

    // Per-student breakdown (with timings for heatmap)
    const studentBreakdown = submissions.map((s) => {
      const parsedAnswers = JSON.parse(s.answers ?? "{}");
      const timings = s.questionTimings ? JSON.parse(s.questionTimings) : {};
      const flagged = s.flaggedQuestions ? JSON.parse(s.flaggedQuestions) : [];

      const questionResults = questions.map((q) => {
        const answer = parsedAnswers[q.id];
        const timing = timings[q.id] ?? timings[String(q.id)] ?? 0;
        const isCorrect = answer !== undefined && answer !== null && answer !== ""
          ? gradeQuestion(q, answer) : null;
        return {
          qId: q.id,
          correct: isCorrect,
          time: Number(timing) || 0,
          flagged: flagged.includes(q.id) || flagged.includes(String(q.id)),
        };
      });

      const totalTime = questionResults.reduce((a, r) => a + r.time, 0);

      return {
        id: s.id,
        studentId: s.studentId,
        studentName: s.studentName,
        studentUsername: s.studentUsername,
        score: s.score,
        totalPoints: s.totalPoints,
        percentage: s.percentage,
        passed: s.passed,
        submittedAt: s.submittedAt,
        totalTime,
        questionResults,
      };
    });

    // Over-time trend (if multiple submissions, group by date)
    const submissionsByDate = new Map<string, { total: number; passed: number; avgPct: number; scores: number[] }>();
    submissions.forEach((s) => {
      const dateKey = s.submittedAt ? new Date(s.submittedAt).toISOString().slice(0, 10) : "unknown";
      if (!submissionsByDate.has(dateKey)) submissionsByDate.set(dateKey, { total: 0, passed: 0, avgPct: 0, scores: [] });
      const d = submissionsByDate.get(dateKey)!;
      d.total++;
      if (s.passed) d.passed++;
      d.scores.push(s.percentage);
    });
    const trendData = [...submissionsByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({
      date,
      submissions: d.total,
      passRate: Math.round((d.passed / d.total) * 100),
      avgScore: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
    }));

    return res.json({
      test: { id: test.id, title: test.title, passingScore: test.passingScore, durationMinutes: test.durationMinutes },
      total, passCount, failCount: total - passCount,
      avgPercentage, avgScore, maxScore, minScore, stdDev, median,
      scoreDistribution: buckets,
      perQuestion,
      studentBreakdown,
      trendData,
      // Summary counts
      difficultyBreakdown: {
        easy: perQuestion.filter((q) => q.difficulty === "easy").length,
        medium: perQuestion.filter((q) => q.difficulty === "medium").length,
        hard: perQuestion.filter((q) => q.difficulty === "hard").length,
      },
      hardestQuestions: [...perQuestion].sort((a, b) => a.successRate - b.successRate).slice(0, 3).map((q) => ({ id: q.id, question: q.question, successRate: q.successRate })),
      easiestQuestions: [...perQuestion].sort((a, b) => b.successRate - a.successRate).slice(0, 3).map((q) => ({ id: q.id, question: q.question, successRate: q.successRate })),
      mostTimeConsuming: [...perQuestion].sort((a, b) => b.avgTime - a.avgTime).slice(0, 3).map((q) => ({ id: q.id, question: q.question, avgTime: q.avgTime })),
      mostFlagged: [...perQuestion].sort((a, b) => b.flaggedCount - a.flaggedCount).slice(0, 3).map((q) => ({ id: q.id, question: q.question, flaggedCount: q.flaggedCount })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/calendar
router.get("/calendar", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const user = await getUser(userId);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    let testRows: any[] = [];
    if (user.role === "super_admin") {
      testRows = await db.select({ id: testsTable.id, title: testsTable.title, scheduledAt: testsTable.scheduledAt, createdAt: testsTable.createdAt, classId: testsTable.classId, isPublished: testsTable.isPublished }).from(testsTable);
    } else if (user.role === "admin") {
      testRows = await db.select({ id: testsTable.id, title: testsTable.title, scheduledAt: testsTable.scheduledAt, createdAt: testsTable.createdAt, classId: testsTable.classId, isPublished: testsTable.isPublished }).from(testsTable).where(eq(testsTable.createdBy, userId));
    } else {
      testRows = await db.select({ id: testsTable.id, title: testsTable.title, scheduledAt: testsTable.scheduledAt, createdAt: testsTable.createdAt, classId: testsTable.classId })
        .from(testsTable)
        .where(eq(testsTable.isPublished, true));
    }

    const events = testRows.map((t) => ({
      id: `test-${t.id}`,
      type: "test" as const,
      title: t.title,
      date: toISOStringSafe(t.scheduledAt ?? t.createdAt) ?? new Date().toISOString(),
      linkId: t.id,
      isScheduled: !!t.scheduledAt,
    }));
    return res.json(events);
  } catch { return res.status(500).json({ error: "Internal server error" }); }
});

export { router as testsRouter };
