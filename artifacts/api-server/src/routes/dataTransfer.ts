import { Router, type IRouter } from "express";
import {
  db,
  executeD1Sql,
  usersTable,
  subjectsTable,
  chaptersTable,
  testsTable,
  testSectionsTable,
  testQuestionsTable,
  testSubmissionsTable,
  testQuestionReportsTable,
  testQuestionBankLinksTable,
  userActivityLogs,
  userSessions,
  notificationsTable,
  notificationPreferencesTable,
  directMessagesTable,
  questionBankQuestionsTable,
  questionBankQuestionProgressTable,
  questionBankSavedQuestionsTable,
  questionBankReportsTable,
  platformSettingsTable,
  passwordResetRequestsTable,
  examTemplatesTable,
  emailProviderConfigsTable,
  emailProviderDailyUsageTable,
  emailSendLogsTable,
  paymentHistoryTable,
  aiApiKeysTable,
  classesTable,
  enrollmentsTable,
  metaSessionsTable,
} from "@workspace/db";
import { eq, sql, getTableColumns, and, inArray, or, ilike } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { hashPassword } from "../lib/auth";
import {
  getTestsPaymentHistory,
  getAnalysisPaymentHistory,
  getStudentFeatureUnlockPricing,
  getTestsLockEvents,
} from "../lib/studentFeatureAccess";

const router: IRouter = Router();

function requireSuperAdmin(req: any, res: any): boolean {
  const callerRole = req.cookies?.userRole;
  if (!callerRole) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  if (callerRole !== "super_admin") {
    res.status(403).json({ error: "Forbidden – super_admin only" });
    return false;
  }
  return true;
}

function isMissingRelationError(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string }; message?: string } | null;
  const code = candidate?.cause?.code ?? candidate?.code;
  if (code === "42P01") return true;
  return typeof candidate?.message === "string" && candidate.message.toLowerCase().includes("does not exist");
}

/* ─────────────────────────────────────────
   Shared: build the full platform snapshot
   includePasswords: true = migration export
───────────────────────────────────────── */
async function safeSelect(tableName: string, table: any): Promise<any[]> {
  try {
    return await db.select().from(table);
  } catch (err: any) {
    throw new Error(`Failed to query table "${tableName}": ${err?.message ?? String(err)}`);
  }
}

function extractImportedUsers(value: unknown): any[] {
  const userKeys = new Set([
    "users", "useraccounts", "user_accounts", "accounts", "account",
    "members", "students", "profiles", "userlist", "user_list",
    "records", "rows", "items",
  ]);
  const visited = new Set<object>();

  const isObject = (candidate: unknown): candidate is Record<string, unknown> =>
    !!candidate && typeof candidate === "object" && !Array.isArray(candidate);
  const looksLikeUser = (candidate: unknown): candidate is Record<string, unknown> => {
    if (!isObject(candidate)) return false;
    return [
      "email", "emailaddress", "mail", "username", "username",
      "user_name", "login", "user", "userid", "user_id",
    ].some((key) =>
      Object.keys(candidate).some((actual) => actual.toLowerCase() === key),
    );
  };
  const normalizeKey = (key: string) => key.toLowerCase().replace(/[-\s]/g, "_");

  const visit = (candidate: unknown, depth: number): any[] => {
    if (depth > 6 || candidate === null || candidate === undefined) return [];
    if (Array.isArray(candidate)) {
      return candidate.length > 0 && candidate.some(looksLikeUser) ? candidate : [];
    }
    if (!isObject(candidate) || visited.has(candidate)) return [];
    visited.add(candidate);

    const entries = Object.entries(candidate);
    for (const [key, nested] of entries) {
      const normalizedKey = normalizeKey(key);
      if (userKeys.has(normalizedKey)) {
        if (Array.isArray(nested) && nested.length > 0) return nested;
        if (isObject(nested)) {
          const values = Object.values(nested);
          if (values.length > 0 && values.some(looksLikeUser)) return values;
        }
      }
    }

    if (looksLikeUser(candidate)) return [candidate];

    // Search unknown wrappers as well as known migration envelopes. Candidate
    // arrays are still required to contain account-like records.
    for (const [key, nested] of entries) {
      const found = visit(nested, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  };

  return visit(value, 0);
}

/* ─────────────────────────────────────────
   Student-only export (for backup emails)
   Only exports users with role = 'student'
───────────────────────────────────────── */
export async function buildStudentOnlyExport() {
  const students = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "student"));
  const studentIds = students.map((student) => student.id);

  const [testProgress, questionBankProgress, questionBankSaved] = studentIds.length > 0
    ? await Promise.all([
      db
        .select({
          id: testSubmissionsTable.id,
          testId: testSubmissionsTable.testId,
          studentId: testSubmissionsTable.studentId,
          score: testSubmissionsTable.score,
          totalPoints: testSubmissionsTable.totalPoints,
          percentage: testSubmissionsTable.percentage,
          passed: testSubmissionsTable.passed,
          submittedAt: testSubmissionsTable.submittedAt,
          testTitle: testsTable.title,
        })
        .from(testSubmissionsTable)
        .leftJoin(testsTable, eq(testSubmissionsTable.testId, testsTable.id))
        .where(inArray(testSubmissionsTable.studentId, studentIds)),
      db
        .select({
          id: questionBankQuestionProgressTable.id,
          questionId: questionBankQuestionProgressTable.questionId,
          studentId: questionBankQuestionProgressTable.studentId,
          classId: questionBankQuestionProgressTable.classId,
          subjectId: questionBankQuestionProgressTable.subjectId,
          chapterId: questionBankQuestionProgressTable.chapterId,
          attemptCount: questionBankQuestionProgressTable.attemptCount,
          correctCount: questionBankQuestionProgressTable.correctCount,
          incorrectCount: questionBankQuestionProgressTable.incorrectCount,
          lastIsCorrect: questionBankQuestionProgressTable.lastIsCorrect,
          firstAttemptedAt: questionBankQuestionProgressTable.firstAttemptedAt,
          lastAttemptedAt: questionBankQuestionProgressTable.lastAttemptedAt,
          solvedAt: questionBankQuestionProgressTable.solvedAt,
          subjectName: subjectsTable.title,
          chapterName: chaptersTable.title,
        })
        .from(questionBankQuestionProgressTable)
        .leftJoin(subjectsTable, eq(questionBankQuestionProgressTable.subjectId, subjectsTable.id))
        .leftJoin(chaptersTable, eq(questionBankQuestionProgressTable.chapterId, chaptersTable.id))
        .where(inArray(questionBankQuestionProgressTable.studentId, studentIds))
        .catch((error) => {
          if (isMissingRelationError(error)) return [];
          throw error;
        }),
      db
        .select({
          id: questionBankSavedQuestionsTable.id,
          questionId: questionBankSavedQuestionsTable.questionId,
          studentId: questionBankSavedQuestionsTable.studentId,
          createdAt: questionBankSavedQuestionsTable.createdAt,
        })
        .from(questionBankSavedQuestionsTable)
        .where(inArray(questionBankSavedQuestionsTable.studentId, studentIds)),
    ])
    : [[], [], []];

  return {
    exportedAt: new Date().toISOString(),
    version: "2.1",
    exportType: "student_data",
    students,
    progress: {
      testSubmissions: testProgress,
      questionBankProgress,
      questionBankSaved,
    },
    meta: {
      count: students.length,
      testSubmissions: testProgress.length,
      questionBankProgress: questionBankProgress.length,
      questionBankSaved: questionBankSaved.length,
      passwordsIncluded: true,
    },
  };
}

export async function buildFullExport(includePasswords = false) {
  const [
    users,
    subjects,
    chapters,
    tests,
    testSections,
    testQuestions,
    testSubmissions,
    testQuestionReports,
    testQuestionBankLinks,
    activityLogs,
    sessions,
    notifications,
    notificationPrefs,
    directMessages,
    questionBankQs,
    questionBankProgress,
    questionBankSaved,
    questionBankReports,
    platformSettings,
    passwordResetRequests,
    examTemplates,
    emailProviderConfigs,
    emailProviderDailyUsage,
    emailSendLogs,
    paymentHistory,
    aiApiKeys,
    classes,
    enrollments,
    metaSessions,
  ] = await Promise.all([
    safeSelect("users", usersTable),
    safeSelect("subjects", subjectsTable),
    safeSelect("chapters", chaptersTable),
    safeSelect("tests", testsTable),
    safeSelect("test_sections", testSectionsTable),
    safeSelect("test_questions", testQuestionsTable),
    safeSelect("test_submissions", testSubmissionsTable),
    safeSelect("test_question_reports", testQuestionReportsTable),
    safeSelect("test_question_bank_links", testQuestionBankLinksTable),
    safeSelect("user_activity_logs", userActivityLogs),
    safeSelect("user_sessions", userSessions),
    safeSelect("notifications", notificationsTable),
    safeSelect("notification_preferences", notificationPreferencesTable),
    safeSelect("direct_messages", directMessagesTable),
    safeSelect("question_bank_questions", questionBankQuestionsTable),
    safeSelect("question_bank_question_progress", questionBankQuestionProgressTable),
    safeSelect("question_bank_saved_questions", questionBankSavedQuestionsTable),
    safeSelect("question_bank_reports", questionBankReportsTable),
    safeSelect("platform_settings", platformSettingsTable),
    safeSelect("password_reset_requests", passwordResetRequestsTable),
    safeSelect("exam_templates", examTemplatesTable),
    safeSelect("email_provider_configs", emailProviderConfigsTable),
    safeSelect("email_provider_daily_usage", emailProviderDailyUsageTable),
    safeSelect("email_send_logs", emailSendLogsTable),
    safeSelect("payment_history", paymentHistoryTable),
    safeSelect("ai_api_keys", aiApiKeysTable),
    safeSelect("classes", classesTable),
    safeSelect("enrollments", enrollmentsTable),
    safeSelect("meta_sessions", metaSessionsTable),
  ]);

  const exportedUsers = includePasswords
    ? users
    : users.map(({ passwordHash, ...u }) => { void passwordHash; return u; });

  const tables = {
    users: exportedUsers,
    subjects,
    chapters,
    tests,
    testSections,
    testQuestions,
    testSubmissions,
    testQuestionReports,
    testQuestionBankLinks,
    activityLogs,
    sessions,
    notifications,
    notificationPrefs,
    directMessages,
    questionBankQuestions: questionBankQs,
    questionBankProgress,
    questionBankSaved,
    questionBankReports,
    platformSettings,
    passwordResetRequests,
    examTemplates,
    emailProviderConfigs,
    emailProviderDailyUsage,
    emailSendLogs,
    paymentHistory,
    aiApiKeys,
    classes,
    enrollments,
    metaSessions,
  };

  const meta = {
    counts: {
      users: users.length,
      subjects: subjects.length,
      chapters: chapters.length,
      tests: tests.length,
      testSections: testSections.length,
      testQuestions: testQuestions.length,
      testSubmissions: testSubmissions.length,
      testQuestionReports: testQuestionReports.length,
      questionBankQuestions: questionBankQs.length,
      questionBankProgress: questionBankProgress.length,
      questionBankSaved: questionBankSaved.length,
      activityLogs: activityLogs.length,
      sessions: sessions.length,
      notifications: notifications.length,
      directMessages: directMessages.length,
      emailSendLogs: emailSendLogs.length,
      emailProviderDailyUsage: emailProviderDailyUsage.length,
      paymentHistory: paymentHistory.length,
      aiApiKeys: aiApiKeys.length,
      classes: classes.length,
      enrollments: enrollments.length,
      metaSessions: metaSessions.length,
    },
    passwordsIncluded: includePasswords,
    exportType: includePasswords ? "full_migration" : "standard",
  };

  return {
    exportedAt: new Date().toISOString(),
    version: "2.0",
    tables,
    meta,
  };
}

/* Helper: stream a large JSON string in chunks so the event loop is never blocked */
async function streamJsonResponse(res: any, json: string): Promise<void> {
  const CHUNK = 256 * 1024; // 256 KB per write
  for (let i = 0; i < json.length; i += CHUNK) {
    res.write(json.slice(i, i + CHUNK));
    await new Promise<void>((r) => setImmediate(r));
  }
  res.end();
}

/* ─────────────────────────────────────────
   GET /api/data-transfer/export
   Standard export — passwords excluded
───────────────────────────────────────── */
router.get("/data-transfer/export", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  // Allow up to 10 minutes for huge datasets
  (req.socket as any)?.setTimeout?.(600_000);
  try {
    const payload = await buildFullExport(false);
    const date = new Date().toISOString().slice(0, 10);
    const json = JSON.stringify(payload);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="rankpulse-export-${date}.json"`);
    // Stream in chunks — no Content-Length, browser gets Transfer-Encoding:chunked
    await streamJsonResponse(res, json);
  } catch (err: any) {
    console.error("Export failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Export failed", detail: err?.message });
    }
  }
});

/* ─────────────────────────────────────────
   GET /api/data-transfer/export/full
   FULL migration export — passwords included
───────────────────────────────────────── */
router.get("/data-transfer/export/full", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  // Allow up to 10 minutes for huge datasets
  (req.socket as any)?.setTimeout?.(600_000);
  try {
    const payload = await buildFullExport(true);
    const date = new Date().toISOString().slice(0, 10);
    const json = JSON.stringify(payload);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="rankpulse-FULL-MIGRATION-${date}.json"`);
    // Stream in chunks — no Content-Length, browser gets Transfer-Encoding:chunked
    await streamJsonResponse(res, json);
  } catch (err: any) {
    console.error("Full export failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Export failed", detail: err?.message });
    }
  }
});

/* ─────────────────────────────────────────
   GET /api/data-transfer/export/stats
───────────────────────────────────────── */
router.get("/data-transfer/export/stats", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const countFrom = async (tableName: string): Promise<number> => {
      const result = await executeD1Sql(`SELECT COUNT(*) AS n FROM ${tableName}`, []);
      const row = result.rows[0] as { n?: number | string } | undefined;
      return Number(row?.n ?? 0);
    };

    const [
      users, subjects, chapters,
      tests, testSections, testQuestions, testSubmissions,
      questionBankQuestions,
      questionBankProgress, questionBankSaved, activityLogs,
      sessions, notifications, directMessages,
      emailSendLogs, emailProviderDailyUsage,
      testQuestionReports, passwordResetRequests,
      paymentHistory,
    ] = await Promise.all([
      countFrom("users"),
      countFrom("subjects"),
      countFrom("chapters"),
      countFrom("tests"),
      countFrom("test_sections"),
      countFrom("test_questions"),
      countFrom("test_submissions"),
      countFrom("question_bank_questions"),
      countFrom("question_bank_question_progress"),
      countFrom("question_bank_saved_questions"),
      countFrom("user_activity_logs"),
      countFrom("user_sessions"),
      countFrom("notifications"),
      countFrom("direct_messages"),
      countFrom("email_send_logs"),
      countFrom("email_provider_daily_usage"),
      countFrom("test_question_reports"),
      countFrom("password_reset_requests"),
      countFrom("payment_history"),
    ]);

    res.json({
      counts: {
        users, subjects, chapters,
        tests, testSections, testQuestions, testSubmissions,
        questionBankQuestions,
        questionBankProgress, questionBankSaved, activityLogs,
        sessions, notifications, directMessages,
        emailSendLogs, emailProviderDailyUsage,
        testQuestionReports, passwordResetRequests,
        paymentHistory,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Stats failed", detail: err?.message });
  }
});

/* ─────────────────────────────────────────
   Helper: build a typed upsert set from a
   Drizzle table's actual column definitions.
───────────────────────────────────────── */
function buildTypedUpsertParts(table: any, row: Record<string, any>) {
  const cols = getTableColumns(table) as Record<string, any>;
  const idCol = cols["id"];
  const set: Record<string, any> = {};
  for (const [fieldName, col] of Object.entries(cols)) {
    if (fieldName === "id") continue;
    if (!(fieldName in row)) continue;
    set[fieldName] = sql.raw(`excluded."${col.name}"`);
  }
  return { idCol, set };
}

/* Sanitise an incoming row so it only contains keys the table schema knows about. */
/* Cache getTableColumns() per table object — saves thousands of re-computations on large imports */
const _colCache = new WeakMap<object, Record<string, any>>();
function getCols(table: any): Record<string, any> {
  let cols = _colCache.get(table);
  if (!cols) { cols = getTableColumns(table) as Record<string, any>; _colCache.set(table, cols); }
  return cols;
}

function sanitizeRow(table: any, row: Record<string, any>): Record<string, any> {
  const cols = getCols(table);
  const out: Record<string, any> = {};
  for (const key of Object.keys(cols)) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

function coerceRowForInsert(table: any, row: Record<string, any>): Record<string, any> {
  const cols = getCols(table);
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(row)) {
    if (val === null || val === undefined) {
      out[key] = val;
      continue;
    }
    const col = cols[key];
    const colDataType: string = col?.dataType ?? "";

    if (colDataType === "array") {
      if (Array.isArray(val)) {
        out[key] = val;
      } else if (typeof val === "string") {
        try { out[key] = JSON.parse(val); } catch { out[key] = []; }
      } else {
        out[key] = [];
      }
      continue;
    }

    if (typeof val === "object" && !(val instanceof Date)) {
      out[key] = JSON.stringify(val);
    } else if (typeof val === "string" && colDataType === "date") {
      const d = new Date(val);
      out[key] = isNaN(d.getTime()) ? null : d;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function dedupeRowsById(rows: Record<string, any>[]): { rows: Record<string, any>[]; skipped: number } {
  const seen = new Set<string | number>();
  const deduped: Record<string, any>[] = [];
  let skipped = 0;
  for (const row of rows) {
    const id = row?.id;
    if (id !== undefined && id !== null) {
      const key = typeof id === "number" ? id : String(id);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
    }
    deduped.push(row);
  }
  return { rows: deduped, skipped };
}

function buildRowError(err: any): string {
  const pgErr = err?.cause ?? err;
  const parts: string[] = [];
  if (pgErr?.code) parts.push(`code=${pgErr.code}`);
  if (pgErr?.constraint) parts.push(`constraint=${pgErr.constraint}`);
  if (pgErr?.detail) parts.push(pgErr.detail.slice(0, 200));
  if (parts.length === 0 || !pgErr?.detail) {
    const causeMsg: string | undefined = pgErr?.message ?? err?.cause?.message;
    const rawMsg: string = err?.message ?? "unknown error";
    if (causeMsg && causeMsg !== rawMsg) {
      parts.push(causeMsg.slice(0, 250));
    } else {
      const nlIdx = rawMsg.indexOf("\n");
      const shortMsg = nlIdx > 0 ? rawMsg.slice(nlIdx + 1).trim() : rawMsg;
      parts.push(shortMsg.slice(0, 250));
    }
  }
  return parts.join(" | ");
}

function nullFkColumns(table: any, row: Record<string, any>): Record<string, any> {
  const cols = getTableColumns(table) as Record<string, any>;
  const out = { ...row };
  for (const [key, col] of Object.entries(cols)) {
    if (key === "id") continue;
    if (col.dataType === "number" && !col.notNull && key in out && out[key] !== null) {
      out[key] = null;
    }
  }
  return out;
}

/* ─────────────────────────────────────────
   POST /api/data-transfer/import
   TRUNCATE all tables, then INSERT fresh.
───────────────────────────────────────── */
router.post("/data-transfer/import", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;

  const body = req.body as any;
  if (!body?.tables || !body?.version) {
    res.status(400).json({ error: "Invalid file – missing tables or version" });
    return;
  }

  const results: Record<string, { inserted: number; skipped: number }> = {};
  const BATCH_SIZE = 500;

  const safeInsert = async (name: string, table: any, rows: any[]) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      results[name] = { inserted: 0, skipped: 0 };
      return;
    }
    const clean = rows
      .map((r) => sanitizeRow(table, r))
      .filter((r) => Object.keys(r).length > 0)
      .map((r) => coerceRowForInsert(table, r));
    const deduped = dedupeRowsById(clean);
    if (deduped.rows.length === 0) { results[name] = { inserted: 0, skipped: rows.length + deduped.skipped }; return; }

    let inserted = 0, skipped = 0;
    skipped += deduped.skipped;
    for (let i = 0; i < deduped.rows.length; i += BATCH_SIZE) {
      const chunk = deduped.rows.slice(i, i + BATCH_SIZE);
      try {
        await db.insert(table).values(chunk).onConflictDoNothing();
        inserted += chunk.length;
      } catch (batchErr: any) {
        for (const row of chunk) {
          try {
            await db.insert(table).values(row).onConflictDoNothing();
            inserted++;
          } catch (rowErr: any) {
            if ((rowErr?.cause?.code ?? rowErr?.code) === "23503") {
              try {
                await db.insert(table).values(nullFkColumns(table, row)).onConflictDoNothing();
                inserted++;
                console.warn(`[import] ${name} row id=${row?.id} inserted with nulled FK columns: ${buildRowError(rowErr)}`);
                continue;
              } catch { /* fall through to skip */ }
            }
            console.error(`[import] ${name} row skipped (id=${row?.id}): ${buildRowError(rowErr)}`);
            skipped++;
          }
        }
      }
    }
    results[name] = { inserted, skipped };
  };

  try {
    const t = body.tables;

    const savedSuperAdmins: Record<string, any>[] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "super_admin"));

    // ── Step 1: Clear all tables in FK-safe order for SQLite/D1 ─────────────
    const tablesToClear = [
      "user_sessions",
      "user_activity_logs",
      "email_send_logs",
      "email_provider_daily_usage",
      "email_provider_configs",
      "exam_templates",
      "password_reset_requests",
      "platform_settings",
      "direct_messages",
      "notification_preferences",
      "notifications",
      "question_bank_reports",
      "question_bank_saved_questions",
      "question_bank_question_progress",
      "question_bank_questions",
      "test_question_reports",
      "test_submissions",
      "test_question_bank_links",
      "test_questions",
      "test_sections",
      "tests",
      "payment_history",
      "enrollments",
      "classes",
      "chapters",
      "subjects",
      "users",
      "ai_api_keys",
      "meta_sessions",
    ];
    for (const tableName of tablesToClear) {
      await db.execute(sql.raw(`DELETE FROM "${tableName}"`));
    }

    // ── Step 2: INSERT in dependency order ────────────────────────────────────
    await safeInsert("users", usersTable, (t.users ?? []).map((u: any) => ({
      ...u,
      passwordHash: u.passwordHash ?? "$2b$10$placeholder",
    })));
    await safeInsert("subjects", subjectsTable, t.subjects ?? []);
    await safeInsert("chapters", chaptersTable, t.chapters ?? []);
    // classes must come before question_bank_questions (FK: class_id → classes.id)
    await safeInsert("classes", classesTable, t.classes ?? []);
    await safeInsert("enrollments", enrollmentsTable, t.enrollments ?? []);
    await safeInsert("tests", testsTable, t.tests ?? []);
    await safeInsert("testSections", testSectionsTable, t.testSections ?? []);
    await safeInsert("testQuestions", testQuestionsTable, t.testQuestions ?? []);
    await safeInsert("testSubmissions", testSubmissionsTable, t.testSubmissions ?? []);
    await safeInsert("testQuestionReports", testQuestionReportsTable, t.testQuestionReports ?? []);
    // question_bank_questions must come before test_question_bank_links (FK: question_bank_question_id)
    await safeInsert("questionBankQuestions", questionBankQuestionsTable, t.questionBankQuestions ?? []);
    await safeInsert("testQuestionBankLinks", testQuestionBankLinksTable, t.testQuestionBankLinks ?? []);
    await safeInsert("questionBankProgress", questionBankQuestionProgressTable, t.questionBankProgress ?? []);
    await safeInsert("questionBankSaved", questionBankSavedQuestionsTable, t.questionBankSaved ?? []);
    await safeInsert("questionBankReports", questionBankReportsTable, t.questionBankReports ?? []);
    await safeInsert("paymentHistory", paymentHistoryTable, t.paymentHistory ?? []);
    await safeInsert("notifications", notificationsTable, t.notifications ?? []);
    await safeInsert("notificationPrefs", notificationPreferencesTable, t.notificationPrefs ?? []);
    await safeInsert("directMessages", directMessagesTable, t.directMessages ?? []);
    await safeInsert("platformSettings", platformSettingsTable, t.platformSettings ?? []);
    await safeInsert("passwordResetRequests", passwordResetRequestsTable, t.passwordResetRequests ?? []);
    await safeInsert("examTemplates", examTemplatesTable, t.examTemplates ?? []);
    await safeInsert("emailProviderConfigs", emailProviderConfigsTable, t.emailProviderConfigs ?? []);
    await safeInsert("emailProviderDailyUsage", emailProviderDailyUsageTable, t.emailProviderDailyUsage ?? []);
    await safeInsert("emailSendLogs", emailSendLogsTable, t.emailSendLogs ?? []);
    await safeInsert("activityLogs", userActivityLogs, t.activityLogs ?? []);
    await safeInsert("sessions", userSessions, t.sessions ?? []);
    await safeInsert("aiApiKeys", aiApiKeysTable, t.aiApiKeys ?? []);
    await safeInsert("metaSessions", metaSessionsTable, t.metaSessions ?? []);

    // ── Restore ALL super_admin users so no admin login is ever lost ──────────
    for (const admin of savedSuperAdmins) {
      const { id: adminId, ...adminFields } = admin;
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, adminId));
      if (!existing) {
        await db.insert(usersTable).values(admin as any);
      } else {
        await db.update(usersTable).set(adminFields as any).where(eq(usersTable.id, adminId));
      }
    }

    const totalInserted = Object.values(results).reduce((s, r) => s + r.inserted, 0);
    const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped, 0);

    res.json({ success: true, summary: { totalInserted, totalSkipped }, details: results });
  } catch (err: any) {
    console.error("Import failed:", err);
    res.status(500).json({ error: "Import failed", detail: err?.message });
  }
});

/* ─────────────────────────────────────────
   Chunked-upload session store
   Splits large files (250MB+) into 20MB
   pieces so Replit's proxy never times out
───────────────────────────────────────── */
interface ChunkSession {
  chunks: (string | null)[];
  total: number;
  createdAt: number;
}
const importSessions = new Map<string, ChunkSession>();

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of importSessions) {
    if (s.createdAt < cutoff) importSessions.delete(id);
  }
}, 30 * 60 * 1000);

/* POST /api/data-transfer/import/chunk
   Upload one 20 MB slice; returns { ok, received, total } */
router.post("/data-transfer/import/chunk", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const { sessionId, chunkIndex, totalChunks, data } = req.body as any;
  if (!sessionId || typeof chunkIndex !== "number" || typeof totalChunks !== "number" || typeof data !== "string") {
    res.status(400).json({ error: "Invalid chunk payload" });
    return;
  }
  if (!importSessions.has(sessionId)) {
    importSessions.set(sessionId, { chunks: new Array(totalChunks).fill(null), total: totalChunks, createdAt: Date.now() });
  }
  const session = importSessions.get(sessionId)!;
  if (chunkIndex < 0 || chunkIndex >= session.total) {
    res.status(400).json({ error: "Chunk index out of range" });
    return;
  }
  session.chunks[chunkIndex] = data;
  const received = session.chunks.filter((c) => c !== null).length;
  res.json({ ok: true, received, total: session.total });
});

/* POST /api/data-transfer/import/finalize
   Assembles chunks → streams NDJSON import progress */
router.post("/data-transfer/import/finalize", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const { sessionId } = req.body as any;
  if (!sessionId || !importSessions.has(sessionId)) {
    res.status(400).json({ error: "Session not found or expired – re-upload and try again" });
    return;
  }
  const session = importSessions.get(sessionId)!;
  const missing = session.chunks.findIndex((c) => c === null);
  if (missing !== -1) {
    res.status(400).json({ error: `Missing chunk ${missing} – upload did not complete` });
    return;
  }
  let body: any;
  try {
    // Build the full string chunk-by-chunk, nulling each slot as we go so
    // the individual chunk strings can be GC'd before the final join completes.
    const parts = session.chunks as string[];
    let fullText = "";
    for (let i = 0; i < parts.length; i++) {
      fullText += parts[i];
      (session.chunks as any)[i] = null; // release chunk memory immediately
    }
    importSessions.delete(sessionId); // free session before parse
    body = JSON.parse(fullText);
    // Allow the raw string to be GC'd now that we have the parsed object
    (fullText as any) = null;
  } catch (e: any) {
    importSessions.delete(sessionId);
    res.status(400).json({ error: "Could not parse assembled file: " + (e?.message ?? String(e)) });
    return;
  }
  if (!body?.tables || !body?.version) {
    res.status(400).json({ error: "Invalid file – missing tables or version" });
    return;
  }
  await runStreamingImport(body, res);
});

/* ─────────────────────────────────────────
   POST /api/data-transfer/import/stream
   Legacy single-request path (kept for
   compatibility with small files < 50 MB)
───────────────────────────────────────── */
router.post("/data-transfer/import/stream", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const body = req.body as any;
  if (!body?.tables || !body?.version) {
    res.status(400).json({ error: "Invalid file – missing tables or version" });
    return;
  }
  await runStreamingImport(body, res);
});

async function runStreamingImport(body: any, res: any): Promise<void> {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (obj: object) => {
    try { res.write(JSON.stringify(obj) + "\n"); } catch { /* client disconnected */ }
  };

  const BATCH_SIZE = 200;
  const allResults: Record<string, { inserted: number; skipped: number }> = {};

  // Step definitions: key into body.tables, display label, and target table.
  // Rows are NOT stored here — they are pulled from body.tables one at a time
  // and deleted immediately after processing to keep peak RAM low.
  const STEP_DEFS: Array<{ key: string; label: string; table: any }> = [
    { key: "users",                   label: "Users",                  table: usersTable },
    { key: "subjects",                label: "Subjects",               table: subjectsTable },
    { key: "chapters",                label: "Chapters",               table: chaptersTable },
    // classes must come before question_bank_questions (FK: class_id → classes.id)
    { key: "classes",                 label: "Classes",                table: classesTable },
    { key: "enrollments",             label: "Enrollments",            table: enrollmentsTable },
    { key: "tests",                   label: "Tests",                  table: testsTable },
    { key: "testSections",            label: "Test Sections",          table: testSectionsTable },
    { key: "testQuestions",           label: "Test Questions",         table: testQuestionsTable },
    { key: "testSubmissions",         label: "Test Submissions",       table: testSubmissionsTable },
    { key: "testQuestionReports",     label: "Question Reports",       table: testQuestionReportsTable },
    // question_bank_questions must come before test_question_bank_links (FK: question_bank_question_id)
    { key: "questionBankQuestions",   label: "Question Bank",          table: questionBankQuestionsTable },
    { key: "testQuestionBankLinks",   label: "QB Links",               table: testQuestionBankLinksTable },
    { key: "questionBankProgress",    label: "QB Progress",            table: questionBankQuestionProgressTable },
    { key: "questionBankSaved",       label: "QB Saved",               table: questionBankSavedQuestionsTable },
    { key: "questionBankReports",     label: "QB Reports",             table: questionBankReportsTable },
    { key: "paymentHistory",          label: "Payment History",        table: paymentHistoryTable },
    { key: "notifications",           label: "Notifications",          table: notificationsTable },
    { key: "notificationPrefs",       label: "Notification Prefs",     table: notificationPreferencesTable },
    { key: "directMessages",          label: "Direct Messages",        table: directMessagesTable },
    { key: "platformSettings",        label: "Platform Settings",      table: platformSettingsTable },
    { key: "passwordResetRequests",   label: "Password Resets",        table: passwordResetRequestsTable },
    { key: "examTemplates",           label: "Exam Templates",         table: examTemplatesTable },
    { key: "emailProviderConfigs",    label: "Email Configs",          table: emailProviderConfigsTable },
    { key: "emailProviderDailyUsage", label: "Email Usage",            table: emailProviderDailyUsageTable },
    { key: "emailSendLogs",           label: "Email Logs",             table: emailSendLogsTable },
    { key: "activityLogs",            label: "Activity Logs",          table: userActivityLogs },
    { key: "sessions",                label: "Sessions",               table: userSessions },
    { key: "aiApiKeys",               label: "AI API Keys",            table: aiApiKeysTable },
    { key: "metaSessions",            label: "Meta Sessions",          table: metaSessionsTable },
  ];

  const total = STEP_DEFS.length + 1;

  try {
    const savedSuperAdmins: Record<string, any>[] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "super_admin"));

    write({ type: "start", key: "_truncate", label: "Clearing existing data", total: 0, done: 0, totalSteps: total });
    const tablesToClear = [
      "user_sessions",
      "user_activity_logs",
      "email_send_logs",
      "email_provider_daily_usage",
      "email_provider_configs",
      "exam_templates",
      "password_reset_requests",
      "platform_settings",
      "direct_messages",
      "notification_preferences",
      "notifications",
      "question_bank_reports",
      "question_bank_saved_questions",
      "question_bank_question_progress",
      "question_bank_questions",
      "test_question_reports",
      "test_submissions",
      "test_question_bank_links",
      "test_questions",
      "test_sections",
      "tests",
      "payment_history",
      "enrollments",
      "classes",
      "chapters",
      "subjects",
      "users",
      "ai_api_keys",
      "meta_sessions",
    ];
    for (const tableName of tablesToClear) {
      await db.execute(sql.raw(`DELETE FROM "${tableName}"`));
    }

    for (let idx = 0; idx < STEP_DEFS.length; idx++) {
      const { key, label, table } = STEP_DEFS[idx];

      // Pull rows from body, then immediately free them from body so GC can
      // reclaim memory before moving on to the next (potentially large) table.
      let rawRows: any[] = Array.isArray(body.tables[key]) ? body.tables[key] : [];
      if (key === "users") {
        rawRows = rawRows.map((u: any) => ({ ...u, passwordHash: u.passwordHash ?? "$2b$10$placeholder" }));
      }
      body.tables[key] = null; // release source rows

      write({ type: "start", key, label, total: rawRows.length, done: idx, totalSteps: total });

      let inserted = 0, skipped = 0;
      let lastError: string | undefined;
      const cleanRows = rawRows
        .map((r: any) => sanitizeRow(table, r))
        .filter((r: any) => Object.keys(r).length > 0)
        .map((r: any) => coerceRowForInsert(table, r));
      rawRows = []; // free original rows before inserting
      const deduped = dedupeRowsById(cleanRows);

      if (deduped.rows.length === 0 && (body.tables[key] === null ? 0 : rawRows.length) > 0) {
        skipped = rawRows.length;
        lastError = "All rows filtered by schema sanitization – possible key mismatch";
      }
      skipped += deduped.skipped;

      for (let i = 0; i < deduped.rows.length; i += BATCH_SIZE) {
        const chunk = deduped.rows.slice(i, i + BATCH_SIZE);
        try {
          await db.insert(table).values(chunk).onConflictDoNothing();
          inserted += chunk.length;
        } catch (batchErr: any) {
          for (const row of chunk) {
            try {
              await db.insert(table).values(row).onConflictDoNothing();
              inserted++;
            } catch (rowErr: any) {
              if ((rowErr?.cause?.code ?? rowErr?.code) === "23503") {
                try {
                  await db.insert(table).values(nullFkColumns(table, row)).onConflictDoNothing();
                  inserted++;
                  console.warn(`[import/stream] ${key} row id=${row?.id} inserted with nulled FK columns: ${buildRowError(rowErr)}`);
                  continue;
                } catch { /* fall through to skip */ }
              }
              const errSummary = buildRowError(rowErr);
              console.error(`[import/stream] ${key} row skipped (id=${row?.id}): ${errSummary}`);
              lastError = errSummary;
              skipped++;
            }
          }
        }
      }

      allResults[key] = { inserted, skipped };
      write({ type: "done", key, label, inserted, skipped, done: idx + 1, totalSteps: total, ...(lastError && skipped > 0 ? { lastError } : {}) });
    }

    for (const admin of savedSuperAdmins) {
      try {
        const { id: adminId, ...adminFields } = admin;
        const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, adminId));
        if (!existing) {
          await db.insert(usersTable).values(admin as any);
        } else {
          await db.update(usersTable).set(adminFields as any).where(eq(usersTable.id, adminId));
        }
      } catch (e: any) {
        console.warn("[import/stream] Could not restore super_admin:", e?.message);
      }
    }

    const totalInserted = Object.values(allResults).reduce((s, r) => s + r.inserted, 0);
    const totalSkipped  = Object.values(allResults).reduce((s, r) => s + r.skipped,  0);

    write({
      type: "complete",
      summary: { totalInserted, totalSkipped },
      details: allResults,
      done: total,
      totalSteps: total,
    });
    res.end();
  } catch (err: any) {
    write({ type: "error", message: err?.message ?? "Import failed" });
    res.end();
  }
}

/* ─────────────────────────────────────────
   POST /api/data-transfer/export/selective
   Export only specific table categories
───────────────────────────────────────── */
const ALL_TABLE_MAP: Record<string, { table: any; tableName: string; label: string }> = {
  users:                  { table: usersTable,                        tableName: "users",                        label: "Users" },
  subjects:               { table: subjectsTable,                     tableName: "subjects",                     label: "Subjects" },
  chapters:               { table: chaptersTable,                     tableName: "chapters",                     label: "Chapters" },
  tests:                  { table: testsTable,                        tableName: "tests",                        label: "Tests" },
  testSections:           { table: testSectionsTable,                 tableName: "test_sections",                label: "Test Sections" },
  testQuestions:          { table: testQuestionsTable,                tableName: "test_questions",               label: "Test Questions" },
  testSubmissions:        { table: testSubmissionsTable,              tableName: "test_submissions",             label: "Test Submissions" },
  testQuestionReports:    { table: testQuestionReportsTable,          tableName: "test_question_reports",        label: "Q Reports" },
  testQuestionBankLinks:  { table: testQuestionBankLinksTable,        tableName: "test_question_bank_links",     label: "QB Links" },
  activityLogs:           { table: userActivityLogs,                  tableName: "user_activity_logs",           label: "Activity Logs" },
  sessions:               { table: userSessions,                      tableName: "user_sessions",                label: "Sessions" },
  notifications:          { table: notificationsTable,                tableName: "notifications",                label: "Notifications" },
  notificationPrefs:      { table: notificationPreferencesTable,      tableName: "notification_preferences",     label: "Notification Prefs" },
  directMessages:         { table: directMessagesTable,               tableName: "direct_messages",              label: "Direct Messages" },
  questionBankQuestions:  { table: questionBankQuestionsTable,        tableName: "question_bank_questions",      label: "Question Bank" },
  questionBankProgress:   { table: questionBankQuestionProgressTable, tableName: "question_bank_question_progress", label: "QB Progress" },
  questionBankSaved:      { table: questionBankSavedQuestionsTable,   tableName: "question_bank_saved_questions", label: "QB Saved" },
  questionBankReports:    { table: questionBankReportsTable,          tableName: "question_bank_reports",        label: "QB Reports" },
  platformSettings:       { table: platformSettingsTable,             tableName: "platform_settings",            label: "Platform Settings" },
  passwordResetRequests:  { table: passwordResetRequestsTable,        tableName: "password_reset_requests",      label: "Password Resets" },
  examTemplates:          { table: examTemplatesTable,                tableName: "exam_templates",               label: "Exam Templates" },
  emailProviderConfigs:   { table: emailProviderConfigsTable,         tableName: "email_provider_configs",       label: "Email Configs" },
  emailProviderDailyUsage:{ table: emailProviderDailyUsageTable,      tableName: "email_provider_daily_usage",   label: "Email Usage" },
  emailSendLogs:          { table: emailSendLogsTable,                tableName: "email_send_logs",              label: "Email Logs" },
  paymentHistory:         { table: paymentHistoryTable,               tableName: "payment_history",              label: "Payment History" },
};

router.post("/data-transfer/export/selective", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { tables: requestedKeys, label: categoryLabel } = req.body as { tables: string[]; label?: string };
    if (!Array.isArray(requestedKeys) || requestedKeys.length === 0) {
      res.status(400).json({ error: "No tables specified" });
      return;
    }

    const result: Record<string, any[]> = {};
    const counts: Record<string, number> = {};

    for (const key of requestedKeys) {
      const entry = ALL_TABLE_MAP[key];
      if (!entry) continue;
      try {
        const rows = await db.select().from(entry.table);
        const exported = key === "users" ? rows.map(({ passwordHash, ...u }: any) => { void passwordHash; return u; }) : rows;
        result[key] = exported;
        counts[key] = exported.length;
      } catch {
        result[key] = [];
        counts[key] = 0;
      }
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      version: "2.0",
      exportType: "selective",
      category: categoryLabel ?? "selective",
      tables: result,
      meta: { counts, passwordsIncluded: false },
    };

    const date = new Date().toISOString().slice(0, 10);
    const slug = (categoryLabel ?? "selective").toLowerCase().replace(/\s+/g, "-");
    const json = JSON.stringify(payload);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="edtech-${slug}-${date}.json"`);
    res.setHeader("Content-Length", Buffer.byteLength(json, "utf8").toString());
    res.end(json);
  } catch (err: any) {
    res.status(500).json({ error: "Selective export failed", detail: err?.message });
  }
});

/* ─────────────────────────────────────────
   GET /api/data-transfer/export/csv/:type
   CSV exports for common reports
───────────────────────────────────────── */
function toCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return lines.join("\r\n");
}

router.get("/data-transfer/export/csv/students", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.role, "student"));
    const headers = ["ID", "Username", "Full Name", "Email", "Phone", "Subject", "Status", "Registered At"];
    const rows = users.map((u: any) => [
      String(u.id), u.username ?? "", u.fullName ?? "", u.email ?? "",
      u.phone ?? "", u.subject ?? "", u.status ?? "", u.createdAt ? new Date(u.createdAt).toISOString() : "",
    ]);
    const csv = toCsv(headers, rows);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="students-${date}.csv"`);
    res.end(csv);
  } catch (err: any) {
    res.status(500).json({ error: "CSV export failed", detail: err?.message });
  }
});

router.get("/data-transfer/export/csv/test-results", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const rows = await db
      .select({
        submissionId: testSubmissionsTable.id,
        submittedAt: testSubmissionsTable.submittedAt,
        score: testSubmissionsTable.score,
        totalPoints: testSubmissionsTable.totalPoints,
        percentage: testSubmissionsTable.percentage,
        passed: testSubmissionsTable.passed,
        studentId: usersTable.id,
        studentName: usersTable.fullName,
        studentUsername: usersTable.username,
        testId: testsTable.id,
        testTitle: testsTable.title,
      })
      .from(testSubmissionsTable)
      .leftJoin(usersTable, eq(testSubmissionsTable.studentId, usersTable.id))
      .leftJoin(testsTable, eq(testSubmissionsTable.testId, testsTable.id));

    const headers = ["Submission ID", "Submitted At", "Score", "Total Points", "Percentage", "Passed", "Student ID", "Student Name", "Username", "Test ID", "Test Title"];
    const csvRows = rows.map((r: any) => [
      String(r.submissionId),
      r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
      String(r.score ?? ""), String(r.totalPoints ?? ""),
      r.percentage != null ? r.percentage.toFixed(1) + "%" : "",
      r.passed ? "Yes" : "No",
      String(r.studentId ?? ""), r.studentName ?? "", r.studentUsername ?? "",
      String(r.testId ?? ""), r.testTitle ?? "",
    ]);
    const csv = toCsv(headers, csvRows);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="test-results-${date}.csv"`);
    res.end(csv);
  } catch (err: any) {
    res.status(500).json({ error: "CSV export failed", detail: err?.message });
  }
});

router.get("/data-transfer/export/csv/question-bank-structure", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const subjects = await db.select().from(subjectsTable);
    const chapters = await db.select().from(chaptersTable);

    const subjectMap = new Map(subjects.map((s: any) => [s.id, s.title]));

    const headers = ["Type", "ID", "Title", "Description", "Subject (for chapters)", "Order", "Target Questions", "Created At"];
    const rows: string[][] = [];

    for (const s of subjects) {
      rows.push([
        "Subject", String(s.id), s.title ?? "", s.description ?? "", "",
        String(s.order ?? 0), "", s.createdAt ? new Date(s.createdAt).toISOString() : "",
      ]);
    }
    for (const c of chapters) {
      rows.push([
        "Chapter", String(c.id), c.title ?? "", c.description ?? "",
        subjectMap.get(c.subjectId) ?? String(c.subjectId),
        String(c.order ?? 0), String(c.targetQuestions ?? 0),
        c.createdAt ? new Date(c.createdAt).toISOString() : "",
      ]);
    }

    rows.sort((a, b) => {
      if (a[0] !== b[0]) return a[0] === "Subject" ? -1 : 1;
      return parseInt(a[1]) - parseInt(b[1]);
    });

    const csv = toCsv(headers, rows);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="question-bank-structure-${date}.csv"`);
    res.end(csv);
  } catch (err: any) {
    res.status(500).json({ error: "CSV export failed", detail: err?.message });
  }
});

router.get("/data-transfer/export/csv/payments", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const students = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        fullName: usersTable.fullName,
        email: usersTable.email,
        phone: usersTable.phone,
        subject: usersTable.subject,
        studentProfileData: usersTable.studentProfileData,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "student"));

    const parseProfile = (raw: string | null) => {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };

    const paymentRows: string[][] = [];
    for (const student of students) {
      const profile = parseProfile(student.studentProfileData ?? null);
      const payments = getTestsPaymentHistory(profile);
      const lockEvents = getTestsLockEvents(profile);
      const pricing = getStudentFeatureUnlockPricing(profile);
      for (const p of payments) {
        paymentRows.push([
          String(student.id),
          student.fullName ?? student.username ?? "",
          student.email ?? "",
          student.phone ?? "",
          student.subject ?? "",
          String(p.amount),
          String(pricing.testsAmount),
          String(p.cycle),
          String(lockEvents.length + payments.length),
          p.paidAt ? new Date(p.paidAt).toISOString() : "",
          p.orderId ?? "",
          p.paymentId ?? "",
        ]);
      }
    }

    paymentRows.sort((a, b) => new Date(b[9]).getTime() - new Date(a[9]).getTime());

    const headers = [
      "Student ID", "Student Name", "Email", "Phone", "Subject",
      "Amount Paid (₹)", "Current Price (₹)", "Cycle",
      "Total Cycles", "Paid At", "Order ID", "Payment ID",
    ];
    const csv = toCsv(headers, paymentRows);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="payment-history-${date}.csv"`);
    res.end(csv);
  } catch (err: any) {
    res.status(500).json({ error: "CSV export failed", detail: err?.message });
  }
});

/** Truncate any string value longer than maxLen to avoid sending huge base64
 *  image blobs or enormous JSON columns over the wire.  The truncated marker
 *  is appended so the viewer makes it clear the value was cut. */
function truncateLargeFields(row: Record<string, any>, maxLen = 400): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && v.length > maxLen) {
      out[k] = `${v.slice(0, maxLen)}…[truncated ${v.length} chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ─────────────────────────────────────────
   GET /api/data-transfer/table/:key
   Return paginated rows for a single table (no passwords, large fields truncated)
   Query params: limit (default 100, max 500), offset (default 0)
───────────────────────────────────────── */
router.get("/data-transfer/table/:key", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const { key } = req.params;
  const entry = ALL_TABLE_MAP[key];
  if (!entry) { res.status(404).json({ error: "Unknown table key" }); return; }
  try {
    const limit  = Math.min(Math.max(parseInt((req.query.limit  as string) ?? "100", 10) || 100, 1), 500);
    const offset = Math.max(parseInt((req.query.offset as string) ?? "0",   10) || 0, 0);

    // COUNT first (cheap)
    const countResult = await executeD1Sql(`SELECT COUNT(*) AS n FROM ${entry.tableName}`, []);
    const countRow = countResult.rows[0] as { n?: number | string } | undefined;
    const total = Number(countRow?.n ?? 0);

    // Paginated SELECT — use raw D1 SQL so SQLite column names are preserved
    // exactly and we avoid Drizzle/D1 mapping gaps on some tables.
    const rowsResult = await executeD1Sql(
      `SELECT * FROM ${entry.tableName} LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    const rows: any[] = rowsResult.rows as any[];

    const safeRows = rows.map((row: any) => {
      const r = key === "users" ? (() => { const { passwordHash, ...u } = row; void passwordHash; return u; })() : row;
      return truncateLargeFields(r);
    });

    res.json({ key, label: entry.label, total, shown: safeRows.length, rows: safeRows, limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: "Query failed", detail: err?.message });
  }
});

/* ─────────────────────────────────────────
   PATCH /api/data-transfer/table/:key/:id
   Update a single row by id
───────────────────────────────────────── */
router.patch("/data-transfer/table/:key/:id", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const { key, id } = req.params;
  const entry = ALL_TABLE_MAP[key];
  if (!entry) { res.status(404).json({ error: "Unknown table key" }); return; }

  const numId = parseInt(id, 10);
  if (isNaN(numId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, any>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Body must be a JSON object" }); return;
  }

  const cols = getTableColumns(entry.table) as Record<string, any>;
  const idCol = cols["id"];
  if (!idCol) { res.status(400).json({ error: "Table has no id column" }); return; }

  // Strip id / passwordHash from update payload
  const { id: _id, passwordHash: _pw, ...rest } = body;
  void _id; void _pw;

  const clean = sanitizeRow(entry.table, rest);
  delete clean.id;
  const coerced = coerceRowForInsert(entry.table, clean);
  delete coerced.id;

  if (Object.keys(coerced).length === 0) {
    res.status(400).json({ error: "No valid fields to update" }); return;
  }

  try {
    const table: SQLiteTable = entry.table;
    const updated = await db.update(table).set(coerced).where(eq(idCol, numId)).returning();
    if (updated.length === 0) { res.status(404).json({ error: "Row not found" }); return; }
    const row = updated[0] as Record<string, any>;
    const safe = key === "users" ? (({ passwordHash: _p, ...u }) => { void _p; return u; })(row) : row;
    res.json({ success: true, row: safe });
  } catch (err: any) {
    res.status(500).json({ error: "Update failed", detail: err?.message });
  }
});

/* ─────────────────────────────────────────
   DELETE /api/data-transfer/table/:key
   Delete multiple rows by ids
───────────────────────────────────────── */
router.delete("/data-transfer/table/:key", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const { key } = req.params;
  const entry = ALL_TABLE_MAP[key];
  if (!entry) { res.status(404).json({ error: "Unknown table key" }); return; }

  const body = req.body as { ids?: unknown[] };
  const rawIds = body?.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    res.status(400).json({ error: "Provide a non-empty ids array" }); return;
  }

  const numIds = rawIds.map(Number).filter(n => Number.isFinite(n));
  if (numIds.length === 0) { res.status(400).json({ error: "No valid numeric ids" }); return; }

  const cols = getTableColumns(entry.table) as Record<string, any>;
  const idCol = cols["id"];
  if (!idCol) { res.status(400).json({ error: "Table has no id column" }); return; }

  try {
    const deleted = await db.delete(entry.table).where(inArray(idCol, numIds)).returning({ id: idCol });
    res.json({ success: true, deleted: deleted.length });
  } catch (err: any) {
    res.status(500).json({ error: "Delete failed", detail: err?.message });
  }
});

/* ─────────────────────────────────────────
   GET /api/data-transfer/export/users
   Export ALL users with passwords (super_admin only)
   Used for user-account migration / backup
───────────────────────────────────────── */
router.get("/data-transfer/export/users", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const users = await safeSelect("users", usersTable);
    const date = new Date().toISOString().slice(0, 10);
    const payload = {
      exportedAt: new Date().toISOString(),
      version: "2.0",
      exportType: "users_with_passwords",
      passwordsIncluded: true,
      meta: {
        userCount: users.length,
        roles: users.reduce((acc: Record<string, number>, u: any) => {
          acc[u.role] = (acc[u.role] ?? 0) + 1;
          return acc;
        }, {}),
      },
      users,
    };
    const json = JSON.stringify(payload);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="rankpulse-users-${date}.json"`);
    await streamJsonResponse(res, json);
  } catch (err: any) {
    console.error("User export failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Export failed", detail: err?.message });
  }
});

/* ─────────────────────────────────────────
   POST /api/data-transfer/import/users
   Upsert users from a user-export JSON file.
   Does NOT truncate — merges into existing data.
   Existing users are updated; new users are inserted.
   Super-admin accounts already in DB are never demoted.
───────────────────────────────────────── */
router.post("/data-transfer/import/users", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;

  const body = req.body as any;

  // Accept the app's envelopes as well as root arrays and common migration
  // wrappers. The frontend sends the extracted array, but this also keeps the
  // endpoint safe and useful for direct API clients.
  const rawUsers = extractImportedUsers(body);

  if (rawUsers.length === 0) {
    res.status(400).json({ error: "No users found in the uploaded file" });
    return;
  }

  // Protect existing super_admin accounts from being overwritten
  const existingSuperAdmins = new Set(
    (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "super_admin")))
      .map((r) => r.id),
  );

  let inserted = 0, updated = 0, skipped = 0;
  const errors: string[] = [];

  for (const rawRow of rawUsers) {
    if (!rawRow || typeof rawRow !== "object") {
      skipped++;
      errors.push("Invalid user record: expected an object");
      continue;
    }

    // Accept exports from this app as well as common snake_case/CSV-to-JSON
    // converters. The database schema uses camelCase, while many imported
    // files use the PostgreSQL column names.
    const normalizedRow: Record<string, any> = { ...rawRow };
    const aliases: Record<string, string[]> = {
      id: ["userId", "user_id"],
      username: ["userName", "user_name", "login", "user"],
      fullName: ["full_name", "name", "displayName", "display_name"],
      email: ["mail", "emailAddress", "email_address"],
      passwordHash: ["password_hash", "password_hash_hex"],
      additionalExams: ["additional_exams"],
      reviewBucketDismissedQuestionIds: ["review_bucket_dismissed_question_ids"],
      avatarUrl: ["avatar_url", "profileImage", "profile_image"],
      onboardingComplete: ["onboarding_complete"],
      studentProfileData: ["student_profile_data", "profileData", "profile_data"],
      mustChangePassword: ["must_change_password"],
      lastPasswordResetEmailAt: ["last_password_reset_email_at"],
      reviewedById: ["reviewed_by_id"],
      reviewedAt: ["reviewed_at"],
      approvedById: ["approved_by_id"],
      approvedAt: ["approved_at"],
      rejectionReason: ["rejection_reason"],
      pendingReviewStartedAt: ["pending_review_started_at"],
      pendingReviewEscalatedAt: ["pending_review_escalated_at"],
      emailOptOut: ["email_opt_out"],
      createdAt: ["created_at"],
      updatedAt: ["updated_at"],
    };
    for (const [target, candidates] of Object.entries(aliases)) {
      if (normalizedRow[target] !== undefined && normalizedRow[target] !== null) continue;
      const source = candidates.find((key) => normalizedRow[key] !== undefined && normalizedRow[key] !== null);
      if (source) normalizedRow[target] = normalizedRow[source];
    }

    // The app intentionally uses a SHA-256 password hash. A plain `password`
    // is accepted for migration and converted to that format. Existing
    // accounts are never overwritten with an incompatible hash (for example
    // bcrypt) because the app cannot verify that hash format.
    const plainPassword = typeof rawRow.password === "string" ? rawRow.password : "";
    const incomingHash = typeof normalizedRow.passwordHash === "string"
      ? normalizedRow.passwordHash.trim()
      : "";
    let importedPasswordHash = "";
    let passwordError = "";
    if (plainPassword) {
      importedPasswordHash = await hashPassword(plainPassword);
    } else if (/^[a-f0-9]{64}$/i.test(incomingHash)) {
      importedPasswordHash = incomingHash;
    } else if (incomingHash) {
      passwordError = "passwordHash is not a RankPulse SHA-256 hash; provide the plain password during import";
    }
    if (importedPasswordHash) normalizedRow.passwordHash = importedPasswordHash;
    else delete normalizedRow.passwordHash;

    const row = sanitizeRow(usersTable, normalizedRow);
    const numericId = Number(row.id);
    if (Number.isInteger(numericId) && numericId > 0) row.id = numericId;
    else delete row.id;
    if (!row.username && row.email) row.username = String(row.email).split("@")[0];
    if (!row.fullName && row.username) row.fullName = row.username;
    if (!row.email || !row.username) {
      skipped++;
      errors.push(`User record missing required email or username${rawRow.id ? ` (id=${rawRow.id})` : ""}`);
      continue;
    }

    try {
      // Match stable account identifiers first. IDs often differ between
      // databases, so using the imported ID as the only lookup key silently
      // updates the wrong account or skips a valid imported user.
      const byEmail = await db
        .select()
        .from(usersTable)
        .where(ilike(usersTable.email, String(row.email).trim().toLowerCase()));
      const byUsername = byEmail.length > 0
        ? []
        : await db.select().from(usersTable).where(eq(usersTable.username, String(row.username)));
      const byId = byEmail.length > 0 || byUsername.length > 0 || !row.id
        ? []
        : await db.select().from(usersTable).where(eq(usersTable.id, row.id));
      const existing = byEmail[0] ?? byUsername[0] ?? byId[0];

      if (passwordError && !existing) {
        throw new Error(passwordError);
      }
      if (existing && existingSuperAdmins.has(existing.id) && row.role !== "super_admin") {
        row.role = "super_admin";
      }
      if (!row.role) row.role = "student";
      if (!row.status) row.status = row.role === "student" ? "pending" : "active";

      const coerced = coerceRowForInsert(usersTable, row);

      if (existing) {
        // Never replace an existing password unless the imported password is
        // known to be compatible with this app. Also keep the local primary
        // key; imported IDs are not portable across databases.
        delete coerced.id;
        if (!importedPasswordHash) delete coerced.passwordHash;
        delete coerced.createdAt;
        const updateSet = Object.fromEntries(Object.entries(coerced).filter(([k]) => k !== "id"));
        if (Object.keys(updateSet).length > 0) {
          await db.update(usersTable).set(updateSet as any).where(eq(usersTable.id, existing.id));
        }
        updated++;
      } else {
        if (!importedPasswordHash) {
          throw new Error("A plain password or 64-character RankPulse passwordHash is required for a new account");
        }
        // Let PostgreSQL assign a new ID when importing from another DB.
        delete coerced.id;
        await db.insert(usersTable).values(coerced as any);
        inserted++;
      }
    } catch (err: any) {
      errors.push(`${row.username ?? rawRow.email ?? rawRow.id ?? "unknown"}: ${buildRowError(err)}`);
      skipped++;
    }
  }

  // Reset sequence
  try {
    await db.execute(sql.raw(`
      DO $ BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'users_id_seq' AND relkind = 'S') THEN
          PERFORM setval('users_id_seq', COALESCE((SELECT MAX(id) FROM "users"), 0) + 1, false);
        END IF;
      END $;
    `));
  } catch { /* ignore */ }

  res.json({
    success: true,
    summary: { inserted, updated, skipped, total: rawUsers.length },
    ...(errors.length > 0 ? { errors: errors.slice(0, 20) } : {}),
  });
});

/* ─────────────────────────────────────────
   POST /api/data-transfer/send-backup-email
   Trigger an immediate backup email (responds
   immediately; build+send runs in background)
───────────────────────────────────────── */
router.post("/data-transfer/send-backup-email", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  // Respond immediately so the UI isn't blocked for minutes
  res.json({
    success: true,
    queued: true,
    message: "Backup is being built in the background and will be emailed within a few minutes.",
  });
  // Fire-and-forget — build + email happens after response is sent
  setImmediate(async () => {
    try {
      const { triggerManualExportEmail } = await import("../lib/exportScheduler");
      await triggerManualExportEmail();
      console.info("Manual backup email sent successfully.");
    } catch (err: any) {
      console.error("Manual backup email failed:", err);
    }
  });
});

export default router;
