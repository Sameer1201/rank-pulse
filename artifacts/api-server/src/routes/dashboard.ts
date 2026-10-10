import { Router, type IRouter } from "express";
import {
  db,
  executeD1Sql,
  usersTable,
  testsTable,
  testSubmissionsTable,
  chaptersTable,
  subjectsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  getStudentAccessWindow,
  getStudentReviewAutomationSettings,
  updateRegistrationClosedUntil,
  updateStudentReviewAutomationSettings,
} from "../lib/platformSettings";
import { platformSettingsTable } from "@workspace/db";
import { listStudentReviewEmailRecipients } from "../lib/studentReview";
import { getSignedUserId } from "../lib/authUtils";

const router: IRouter = Router();

function requireRole(req: any, res: any, allowedRoles: string[]): string | null {
  const callerRole = req.cookies?.userRole;
  if (!callerRole) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  if (!allowedRoles.includes(callerRole)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return callerRole;
}

function serializeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash, ...rest } = user;
  void passwordHash;
  return rest;
}

function getRawUserField<T = unknown>(user: Record<string, unknown>, camelKey: string, snakeKey?: string): T | undefined {
  if (camelKey in user) return user[camelKey] as T;
  if (snakeKey && snakeKey in user) return user[snakeKey] as T;
  return undefined;
}

function serializeRawUser(user: Record<string, unknown>) {
  const createdAtRaw = getRawUserField<string | number | null>(user, "createdAt", "created_at");
  return {
    id: Number(getRawUserField<number>(user, "id", "id") ?? 0),
    username: String(getRawUserField<string>(user, "username", "username") ?? ""),
    fullName: String(getRawUserField<string>(user, "fullName", "full_name") ?? ""),
    email: String(getRawUserField<string>(user, "email", "email") ?? ""),
    role: String(getRawUserField<string>(user, "role", "role") ?? ""),
    status: String(getRawUserField<string>(user, "status", "status") ?? ""),
    phone: getRawUserField<string | null>(user, "phone", "phone") ?? null,
    subject: getRawUserField<string | null>(user, "subject", "subject") ?? null,
    createdAt: createdAtRaw ? new Date(createdAtRaw as string | number) : null,
  };
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

function getStudentExamKeys(student: { subject?: string | null; additionalExams?: unknown[] | null }) {
  const examKeys = new Set<string>();
  const primaryExamKey = normalizeExamKey(student.subject);
  if (primaryExamKey) examKeys.add(primaryExamKey);
  for (const exam of student.additionalExams ?? []) {
    const key = normalizeExamKey(exam);
    if (key) examKeys.add(key);
  }
  return examKeys;
}

function canStudentAccessTest(
  test: { examType?: unknown },
  access: { examKeys: Set<string> },
) {
  const examKey = normalizeExamKey(test.examType);
  return examKey ? access.examKeys.has(examKey) : false;
}

function toIsoString(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function getTimeValue(value: Date | null | undefined) {
  return value ? value.getTime() : Number.POSITIVE_INFINITY;
}

router.get("/dashboard/super-admin", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

  const [usersResult, testsResult, studentReviewSettings, reviewRecipients, visitorRow] = await Promise.all([
    executeD1Sql(`SELECT * FROM users ORDER BY created_at ASC`, []),
    executeD1Sql(`SELECT * FROM tests`, []),
    getStudentReviewAutomationSettings(),
    listStudentReviewEmailRecipients(),
    executeD1Sql(`SELECT total_visitors AS totalVisitors, today_visitors AS todayVisitors, today_date AS todayDate FROM platform_settings WHERE id = 1 LIMIT 1`, []),
  ]);

  const allUsers = usersResult.rows as Record<string, unknown>[];
  const allTests = testsResult.rows as Record<string, unknown>[];
  const admins = allUsers.filter((u) => getRawUserField<string>(u, "role", "role") === "admin");
  const students = allUsers.filter((u) => getRawUserField<string>(u, "role", "role") === "student");
  const pendingStudents = students.filter((u) => u.status === "pending");
  const approvedStudents = students.filter((u) => u.status === "approved");

  const recentAdmins = [...admins].reverse().slice(0, 5);
  const recentStudents = [...students].reverse().slice(0, 5);

  // Sign-ups for the last 7 days
  const now = new Date();
  const signupTrend: { date: string; students: number; admins: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayStart = new Date(dateStr + "T00:00:00Z");
    const dayEnd = new Date(dateStr + "T23:59:59Z");
    signupTrend.push({
      date: dateStr,
      students: students.filter((u) => {
        const createdAt = getRawUserField<string | number>(u, "createdAt", "created_at");
        return createdAt ? new Date(createdAt) >= dayStart && new Date(createdAt) <= dayEnd : false;
      }).length,
      admins: admins.filter((u) => {
        const createdAt = getRawUserField<string | number>(u, "createdAt", "created_at");
        return createdAt ? new Date(createdAt) >= dayStart && new Date(createdAt) <= dayEnd : false;
      }).length,
    });
  }

  // Top teachers by test activity and student reach
  const teacherStats = admins.map((t) => {
    const teacherId = Number(getRawUserField<number>(t, "id", "id") ?? 0);
    const myTests = allTests.filter((test) => Number(getRawUserField<number>(test, "createdBy", "created_by") ?? 0) === teacherId);
    return {
      id: teacherId,
      fullName: String(getRawUserField<string>(t, "fullName", "full_name") ?? ""),
      subject: (getRawUserField<string | null>(t, "subject", "subject") ?? null),
      studentsCount: 0,
      testsCount: myTests.length,
    };
  }).sort((a, b) => {
    if (b.testsCount !== a.testsCount) return b.testsCount - a.testsCount;
    return b.studentsCount - a.studentsCount;
  }).slice(0, 4);

  res.json({
    totalAdmins: admins.length,
    totalStudents: students.length,
    approvedStudents: approvedStudents.length,
    pendingStudents: pendingStudents.length,
    totalEnrollments: 0,
    totalTests: allTests.length,
    openTickets: 0,
    communityPosts: 0,
    totalVisitors: Number((visitorRow.rows[0] as Record<string, unknown> | undefined)?.totalVisitors ?? 0),
    todayVisitors: (visitorRow.rows[0] as Record<string, unknown> | undefined)?.todayDate === new Date().toISOString().slice(0, 10)
      ? Number((visitorRow.rows[0] as Record<string, unknown> | undefined)?.todayVisitors ?? 0)
      : 0,
    recentAdmins: recentAdmins.map(serializeRawUser),
    recentStudents: recentStudents.map(serializeRawUser),
    pendingApprovals: pendingStudents.map(serializeRawUser),
    signupTrend,
    topTeachers: teacherStats,
    studentReviewAutomation: {
      emailEnabled: studentReviewSettings.emailEnabled,
      quickActionsEnabled: studentReviewSettings.quickActionsEnabled,
      recipientsCount: reviewRecipients.length,
      recipientEmails: reviewRecipients.map((recipient) => recipient.reviewerEmail),
    },
  });
});

router.patch("/dashboard/super-admin/student-review-settings", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const patch: { emailEnabled?: boolean; quickActionsEnabled?: boolean } = {};

  if (typeof body.emailEnabled === "boolean") {
    patch.emailEnabled = body.emailEnabled;
  }
  if (typeof body.quickActionsEnabled === "boolean") {
    patch.quickActionsEnabled = body.quickActionsEnabled;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid student review setting provided" });
    return;
  }

  const [settings, recipients] = await Promise.all([
    updateStudentReviewAutomationSettings(patch),
    listStudentReviewEmailRecipients(),
  ]);

  res.json({
    emailEnabled: settings.emailEnabled,
    quickActionsEnabled: settings.quickActionsEnabled,
    recipientsCount: recipients.length,
    recipientEmails: recipients.map((recipient) => recipient.reviewerEmail),
  });
});

router.get("/dashboard/super-admin/access-controls", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

  const accessWindow = await getStudentAccessWindow();
  res.json({
    isClosed: accessWindow.isClosed,
    closedUntil: accessWindow.registrationClosedUntil?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
  });
});

router.patch("/dashboard/super-admin/access-controls", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

  const rawUntil = req.body?.closedUntil;
  if (rawUntil !== null && typeof rawUntil !== "string") {
    res.status(400).json({ error: "closedUntil must be an ISO date or null" });
    return;
  }

  let closedUntil: Date | null = null;
  if (typeof rawUntil === "string" && rawUntil.trim()) {
    const parsed = new Date(rawUntil);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      res.status(400).json({ error: "Close time must be a future date" });
      return;
    }
    closedUntil = parsed;
  }

  const savedUntil = await updateRegistrationClosedUntil(closedUntil);
  res.json({
    isClosed: Boolean(savedUntil),
    closedUntil: savedUntil?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
  });
});

router.get("/dashboard/student", async (req, res): Promise<void> => {
  const studentId = getSignedUserId(req);

  if (!studentId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [student] = await db.select().from(usersTable).where(eq(usersTable.id, studentId));
  if (!student) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (student.role !== "student") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const now = new Date();

  const studentSubmissions = await db
    .select({
      id: testSubmissionsTable.id,
      testId: testSubmissionsTable.testId,
      score: testSubmissionsTable.score,
      totalPoints: testSubmissionsTable.totalPoints,
      percentage: testSubmissionsTable.percentage,
      passed: testSubmissionsTable.passed,
      submittedAt: testSubmissionsTable.submittedAt,
      title: testsTable.title,
      subjectName: subjectsTable.title,
      chapterName: chaptersTable.title,
    })
    .from(testSubmissionsTable)
    .leftJoin(testsTable, eq(testSubmissionsTable.testId, testsTable.id))
    .leftJoin(chaptersTable, eq(testsTable.chapterId, chaptersTable.id))
    .leftJoin(subjectsTable, eq(chaptersTable.subjectId, subjectsTable.id))
    .where(eq(testSubmissionsTable.studentId, studentId))
    .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id));

  const access = {
    examKeys: getStudentExamKeys(student),
  };

  const allPublishedTests = await db
    .select({
      id: testsTable.id,
      title: testsTable.title,
      description: testsTable.description,
      examType: testsTable.examType,
      durationMinutes: testsTable.durationMinutes,
      scheduledAt: testsTable.scheduledAt,
      subjectName: subjectsTable.title,
      chapterName: chaptersTable.title,
    })
    .from(testsTable)
    .leftJoin(chaptersTable, eq(testsTable.chapterId, chaptersTable.id))
    .leftJoin(subjectsTable, eq(chaptersTable.subjectId, subjectsTable.id))
    .where(eq(testsTable.isPublished, true))
    .orderBy(testsTable.scheduledAt);

  const visibleTests = allPublishedTests.filter((test) => canStudentAccessTest(test, access));

  const submittedTestIds = new Set(studentSubmissions.map((submission) => submission.testId));
  const pendingTests = visibleTests
    .filter((test) => !submittedTestIds.has(test.id))
    .map((test) => ({
      id: test.id,
      title: test.title,
      description: test.description,
      durationMinutes: test.durationMinutes,
      scheduledAt: toIsoString(test.scheduledAt),
      classId: null,
      className: null,
      subjectName: test.subjectName,
      chapterName: test.chapterName,
      status: test.scheduledAt && test.scheduledAt.getTime() > now.getTime() ? "upcoming" : "active",
    }))
    .slice(0, 5);

  const averageTestScore = studentSubmissions.length > 0
    ? Number((studentSubmissions.reduce((sum, submission) => sum + Number(submission.percentage ?? 0), 0) / studentSubmissions.length).toFixed(1))
    : null;
  const bestResult = studentSubmissions.length > 0
    ? studentSubmissions.reduce((best, submission) =>
      Number(submission.percentage ?? 0) > Number(best.percentage ?? 0) ? submission : best,
    )
    : null;

  res.json({
    enrolledClasses: 0,
    liveClasses: 0,
    availableClassesCount: 0,
    totalVisibleTests: visibleTests.length,
    pendingTestsCount: visibleTests.filter((test) => !submittedTestIds.has(test.id)).length,
    completedTests: studentSubmissions.length,
    averageTestScore,
    attendance: { total: 0, present: 0, late: 0, absent: 0, percentage: 0 },
    assignmentSummary: { pending: 0, overdue: 0, submitted: 0 },
    bestResult: bestResult
      ? {
          testId: bestResult.testId,
          title: bestResult.title,
          percentage: Number(bestResult.percentage ?? 0),
          score: Number(bestResult.score ?? 0),
          totalPoints: bestResult.totalPoints,
        }
      : null,
    liveClassesNow: [],
    upcomingClasses: [],
    availableClasses: [],
    pendingTests,
    recentResults: studentSubmissions.slice(0, 5).map((submission) => ({
      id: submission.id,
      testId: submission.testId,
      title: submission.title,
      submittedAt: toIsoString(submission.submittedAt),
      percentage: Number(submission.percentage ?? 0),
      score: Number(submission.score ?? 0),
      totalPoints: submission.totalPoints,
      passed: submission.passed,
      className: null,
      subjectName: submission.subjectName,
      chapterName: submission.chapterName,
    })),
    nextAssignment: null,
  });
});

export default router;
