import { Router, type IRouter } from "express";
import { revokeNodeUserSessions } from '../lib/nodeSession';
import {
  db,
  executeD1Sql,
  usersTable,
  chaptersTable,
  emailSendLogsTable,
  testSubmissionsTable,
  testQuestionReportsTable,
  directMessagesTable,
  examTemplatesTable,
  passwordResetRequestsTable,
  questionBankSavedQuestionsTable,
  questionBankQuestionsTable,
  questionBankReportsTable,
  questionBankQuestionProgressTable,
  notificationsTable,
  notificationPreferencesTable,
  subjectsTable,
  userActivityLogs,
  userSessions,
  testsTable,
} from "@workspace/db";
import { count, desc, eq, inArray, max, or, sql } from "drizzle-orm";
import {
  ListUsersQueryParams,
  CreateAdminBody,
  GetUserParams,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
  ApproveStudentParams,
  ApproveStudentBody,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/auth";
import { readProfilePyqPerformance } from "../lib/studentProfilePerformance";
import { isGmailSmtpConfigured, queueStudentApprovedEmail, queueStudentRejectedEmail, queueStudentTestsLockedEmail, queueTeacherWelcomeEmail } from "../lib/brevo";
import { createFirebaseEmailUser, deleteFirebaseUser, deleteFirebaseUserByEmail, ensureFirebaseEmailUser, isFirebaseAdminConfigured, isFirebaseRestCreationAvailable } from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";
import { getSignedUserId } from "../lib/authUtils";
import {
  appendAnalysisLockEvent,
  appendAnalysisPayment,
  appendQuestionBankPayment,
  appendPyqPayment,
  appendTestsLockEvent,
  appendTestsPayment,
  getAnalysisLockEvents,
  getAnalysisPaymentHistory,
  getQuestionBankPaymentHistory,
  getPyqPaymentHistory,
  getStudentFeatureAccess,
  getStudentFeatureUnlockPricing,
  getTestsLockEvents,
  getTestsPaymentHistory,
  mergeStudentFeatureAccess,
  mergeStudentFeatureUnlockPricing,
} from "../lib/studentFeatureAccess";
import {
  captureRazorpayPayment,
  createRazorpayOrder,
  getRazorpayKeyId,
  getRazorpayPayment,
  isRazorpayConfigured,
  verifyRazorpayPaymentSignature,
} from "../lib/razorpay";

const router: IRouter = Router();

function toISOStringSafe(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      return normalizeStringList(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }

  return [];
}

function serializeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash, ...rest } = user;
  void passwordHash;
  const parsedProfileDetails = parseStudentProfileData(user.studentProfileData ?? null);
  // Earlier records were imported before `onboarding_complete` existed. A
  // selected target exam is the same completion signal used by auth/session.
  const onboardingComplete = Boolean(
    user.onboardingComplete || (user.role === "student" && user.subject?.trim()),
  );
  return {
    ...rest,
    additionalExams: normalizeStringList(user.additionalExams),
    onboardingComplete,
    profileDetails: parsedProfileDetails,
    studentFeatureAccess: getStudentFeatureAccess(parsedProfileDetails),
    studentFeaturePricing: getStudentFeatureUnlockPricing(parsedProfileDetails),
  };
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
}

function parseStudentProfileData(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toDateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundMetric(value: number) {
  return Math.round(value * 10) / 10;
}

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

function isMissingRelationError(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string }; message?: string } | null;
  const code = candidate?.cause?.code ?? candidate?.code;
  if (code === "42P01") return true;
  return typeof candidate?.message === "string" && candidate.message.toLowerCase().includes("does not exist");
}

router.get("/users", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin", "admin"]);
  if (!callerRole) return;

  const params = ListUsersQueryParams.safeParse(req.query);

  let users = await db.select().from(usersTable).orderBy(usersTable.createdAt);

  if (params.success) {
    if (params.data.role) {
      users = users.filter((u) => u.role === params.data.role);
    }
    if (params.data.status) {
      users = users.filter((u) => u.status === params.data.status);
    }
  }

  // For student lists, augment with activity + test counts so the frontend
  // can sort by "most active" / "most tests given" without per-student API calls.
  const requestedRole = params.success ? params.data.role : undefined;
  if (requestedRole === "student" && users.length > 0) {
    const ids = users.map((u) => u.id);
    // The Cloudflare D1 HTTP API limits SQL bind variables. Split the student
    // IDs so large imported databases still load their admin student list.
    const idChunks = chunkValues(ids, 80);
    const countBatches = await Promise.all(
      idChunks.map(async (studentIds) => {
        const [testCounts, activityStats] = await Promise.all([
          db
            .select({
              studentId: testSubmissionsTable.studentId,
              testCount: count(testSubmissionsTable.id),
            })
            .from(testSubmissionsTable)
            .where(inArray(testSubmissionsTable.studentId, studentIds))
            .groupBy(testSubmissionsTable.studentId),
          db
            .select({
              userId: userActivityLogs.userId,
              activityCount: count(userActivityLogs.id),
              aiUsageCount: sql<number>`COALESCE(SUM(CASE WHEN ${userActivityLogs.action} IN ('ai_hint', 'ai_performance', 'ai_test_result') THEN 1 ELSE 0 END), 0)`,
              lastActivityAt: max(userActivityLogs.createdAt),
            })
            .from(userActivityLogs)
            .where(inArray(userActivityLogs.userId, studentIds))
            .groupBy(userActivityLogs.userId),
        ]);
        return { testCounts, activityStats };
      }),
    );
    const testCounts = countBatches.flatMap(({ testCounts }) => testCounts);
    const activityStats = countBatches.flatMap(({ activityStats }) => activityStats);

    const testCountMap = new Map(testCounts.map((r) => [r.studentId, Number(r.testCount)]));
    const activityMap = new Map(
      activityStats.map((r) => [r.userId, {
        activityCount: Number(r.activityCount),
        aiUsageCount: Number(r.aiUsageCount),
        lastActivityAt: r.lastActivityAt,
      }])
    );

    return void res.json(
      users.map((u) => ({
        ...serializeUser(u),
        testCount: testCountMap.get(u.id) ?? 0,
        activityCount: activityMap.get(u.id)?.activityCount ?? 0,
        aiUsageCount: activityMap.get(u.id)?.aiUsageCount ?? 0,
        lastActivityAt: activityMap.get(u.id)?.lastActivityAt ?? null,
      }))
    );
  }

  res.json(users.map(serializeUser));
});

router.post("/users", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

  const parsed = CreateAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password, fullName, email, subject } = parsed.data;
  const role = parsed.data.role ?? "admin";

  if (role !== "admin") {
    res.status(400).json({ error: "Only teacher accounts can be created from this panel" });
    return;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (existing) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  const [existingEmail] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existingEmail) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  // firebaseUid is null when: Firebase is not configured, OR email already existed in Firebase (REST-only).
  // canRollbackFirebase is true only when we freshly created a Firebase user and can delete it on failure.
  let firebaseUid: string | null = null;
  let canRollbackFirebase = false;

  try {
    if (isFirebaseAdminConfigured() || isFirebaseRestCreationAvailable()) {
      try {
        const firebaseUser = await createFirebaseEmailUser({ email, password, fullName });
        firebaseUid = firebaseUser.uid ?? null;
        canRollbackFirebase = Boolean(firebaseUid);
      } catch (firebaseError) {
        const errMsg = firebaseError instanceof Error ? firebaseError.message : "";
        if (!errMsg.includes("email address is already in use") && !errMsg.includes("EMAIL_EXISTS")) {
          throw firebaseError;
        }
        // Email already in Firebase — ensureFirebaseEmailUser updates or returns reusedExisting
        const firebaseUser = await ensureFirebaseEmailUser({ email, password, fullName });
        // If reusedExisting, uid is null — cannot roll back a pre-existing Firebase user
        firebaseUid = ("reusedExisting" in firebaseUser && firebaseUser.reusedExisting) ? null : (firebaseUser.uid ?? null);
        canRollbackFirebase = false;
      }
    }

    const [newAdmin] = await db.insert(usersTable).values({
      username,
      passwordHash: await hashPassword(password),
      fullName,
      email,
      subject: role === "admin" ? subject ?? null : null,
      role,
      status: "active",
    }).returning();

    if (isGmailSmtpConfigured()) {
      queueTeacherWelcomeEmail({
        teacherName: fullName,
        email,
        username,
        password,
        subject: subject ?? null,
      });
    }

    res.status(201).json(serializeUser(newAdmin));
  } catch (error) {
    // Roll back Firebase user only if we created it fresh and have a real UID
    if (canRollbackFirebase && firebaseUid) {
      await deleteFirebaseUser(firebaseUid).catch((deleteErr) => {
        logger.warn({ deleteErr, firebaseUid }, "Failed to roll back Firebase user after DB insert failure");
      });
    }
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create teacher account",
    });
  }
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const callerId = getSignedUserId(req);
  if (!callerId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  if (!['admin', 'super_admin'].includes(req.cookies?.userRole) && callerId !== Number(req.params.id)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(serializeUser(user));
});

router.patch("/users/:id/student-feature-access", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.role !== "student") {
    res.status(400).json({ error: "Only student access can be locked from this panel" });
    return;
  }

  const testsLockedRaw = req.body?.testsLocked;
  const questionBankLockedRaw = req.body?.questionBankLocked;
  const analysisLockedRaw = req.body?.analysisLocked;
  const pyqLockedRaw = req.body?.pyqLocked;
  const testsAmountRaw = req.body?.testsAmount;
  const questionBankAmountRaw = req.body?.questionBankAmount;
  const analysisAmountRaw = req.body?.analysisAmount;
  const pyqAmountRaw = req.body?.pyqAmount;
  const updates: Record<string, boolean> = {};
  const pricingUpdates: Record<string, number | null> = {};

  if (typeof testsLockedRaw === "boolean") updates.testsLocked = testsLockedRaw;
  if (typeof questionBankLockedRaw === "boolean") updates.questionBankLocked = questionBankLockedRaw;
  if (typeof analysisLockedRaw === "boolean") updates.analysisLocked = analysisLockedRaw;
  if (typeof pyqLockedRaw === "boolean") updates.pyqLocked = pyqLockedRaw;

  if (testsAmountRaw === null || testsAmountRaw === "" || testsAmountRaw === undefined) {
    if (testsAmountRaw !== undefined) pricingUpdates.testsAmount = null;
  } else {
    const parsedTestsAmount = Number(testsAmountRaw);
    if (!Number.isFinite(parsedTestsAmount) || parsedTestsAmount <= 0) {
      res.status(400).json({ error: "Tests unlock amount must be a positive number" });
      return;
    }
    pricingUpdates.testsAmount = Math.round(parsedTestsAmount * 100) / 100;
  }

  if (questionBankAmountRaw === null || questionBankAmountRaw === "" || questionBankAmountRaw === undefined) {
    if (questionBankAmountRaw !== undefined) pricingUpdates.questionBankAmount = null;
  } else {
    const parsedQuestionBankAmount = Number(questionBankAmountRaw);
    if (!Number.isFinite(parsedQuestionBankAmount) || parsedQuestionBankAmount <= 0) {
      res.status(400).json({ error: "Question bank unlock amount must be a positive number" });
      return;
    }
    pricingUpdates.questionBankAmount = Math.round(parsedQuestionBankAmount * 100) / 100;
  }

  if (analysisAmountRaw === null || analysisAmountRaw === "" || analysisAmountRaw === undefined) {
    if (analysisAmountRaw !== undefined) pricingUpdates.analysisAmount = null;
  } else {
    const parsedAnalysisAmount = Number(analysisAmountRaw);
    if (!Number.isFinite(parsedAnalysisAmount) || parsedAnalysisAmount <= 0) {
      res.status(400).json({ error: "Analysis unlock amount must be a positive number" });
      return;
    }
    pricingUpdates.analysisAmount = Math.round(parsedAnalysisAmount * 100) / 100;
  }

  if (pyqAmountRaw === null || pyqAmountRaw === "" || pyqAmountRaw === undefined) {
    if (pyqAmountRaw !== undefined) pricingUpdates.pyqAmount = null;
  } else {
    const parsedPyqAmount = Number(pyqAmountRaw);
    if (!Number.isFinite(parsedPyqAmount) || parsedPyqAmount <= 0) {
      res.status(400).json({ error: "PYQ unlock amount must be a positive number" });
      return;
    }
    pricingUpdates.pyqAmount = Math.round(parsedPyqAmount * 100) / 100;
  }

  if (Object.keys(updates).length === 0 && Object.keys(pricingUpdates).length === 0) {
    res.status(400).json({ error: "No valid student access or pricing updates were provided" });
    return;
  }

  const existingProfileData = parseStudentProfileData(user.studentProfileData ?? null);
  const adminId = getSignedUserId(req);

  let profileWithAccess = existingProfileData;
  if (Object.keys(updates).length > 0) {
    profileWithAccess = mergeStudentFeatureAccess(existingProfileData, updates);
    if (typeof updates.testsLocked === "boolean" && updates.testsLocked === true) {
      profileWithAccess = appendTestsLockEvent(profileWithAccess, {
        lockedAt: new Date().toISOString(),
        lockedByAdminId: Number.isFinite(adminId) ? adminId : null,
      });
    }
    if (typeof updates.analysisLocked === "boolean" && updates.analysisLocked === true) {
      profileWithAccess = appendAnalysisLockEvent(profileWithAccess, {
        lockedAt: new Date().toISOString(),
        lockedByAdminId: Number.isFinite(adminId) ? adminId : null,
      });
    }
  }
  const nextProfileWithAccess = profileWithAccess;
  const nextProfileData = Object.keys(pricingUpdates).length > 0
    ? mergeStudentFeatureUnlockPricing(nextProfileWithAccess, pricingUpdates)
    : nextProfileWithAccess;

  const [updated] = await db
    .update(usersTable)
    .set({ studentProfileData: JSON.stringify(nextProfileData) })
    .where(eq(usersTable.id, user.id))
    .returning();

  if (typeof updates.testsLocked === "boolean" && updates.testsLocked === true && user.email) {
    const updatedProfile = parseStudentProfileData(updated.studentProfileData ?? null);
    const lockEvents = getTestsLockEvents(updatedProfile);
    const pricing = getStudentFeatureUnlockPricing(updatedProfile);
    const cycle = lockEvents.length;
    queueStudentTestsLockedEmail({
      studentName: user.fullName ?? user.username ?? "Student",
      email: user.email,
      cycle,
      unlockAmount: pricing.testsAmount,
      supportEmail: "Rankpulsee@gmail.com",
    });
  }

  res.json(serializeUser(updated));
});

router.patch("/users/:id/priority-access", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (typeof req.body?.priorityAccess !== "boolean") {
    res.status(400).json({ error: "priorityAccess must be a boolean" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.role !== "student") {
    res.status(400).json({ error: "Priority access can only be assigned to students" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ priorityAccess: req.body.priorityAccess })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  res.json(serializeUser(updated));
});

router.post("/users/me/student-feature-unlock/order", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["student"]);
  if (!callerRole) return;

  const userId = getSignedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const feature = req.body?.feature === "question-bank" ? "question-bank" : req.body?.feature === "analysis" ? "analysis" : req.body?.feature === "pyq" ? "pyq" : req.body?.feature === "tests" ? "tests" : null;
  if (!feature) {
    res.status(400).json({ error: "A valid feature is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.role !== "student") {
    res.status(404).json({ error: "Student account not found" });
    return;
  }

  const existingProfileData = parseStudentProfileData(user.studentProfileData ?? null);
  const access = getStudentFeatureAccess(existingProfileData);
  const pricing = getStudentFeatureUnlockPricing(existingProfileData);
  const isLocked = feature === "tests" ? access.testsLocked : feature === "analysis" ? access.analysisLocked : feature === "pyq" ? access.pyqLocked : access.questionBankLocked;
  const amount = feature === "tests" ? pricing.testsAmount : feature === "analysis" ? pricing.analysisAmount : feature === "pyq" ? pricing.pyqAmount : pricing.questionBankAmount;

  if (!isLocked) {
    res.status(400).json({ error: "This feature is already unlocked for your account." });
    return;
  }

  if (!amount) {
    res.status(400).json({ error: "The unlock amount has not been configured for this student yet." });
    return;
  }

  if (!isRazorpayConfigured()) {
    res.status(500).json({ error: "Razorpay is not configured on the server yet." });
    return;
  }

  const amountPaise = Math.round(amount * 100);

  try {
    const order = await createRazorpayOrder({
      amountPaise,
      currency: "INR",
      receipt: `unlock_${user.id}_${feature}_${Date.now()}`.slice(0, 40),
      notes: {
        studentId: String(user.id),
        feature,
      },
    });

    res.json({
      keyId: getRazorpayKeyId(),
      orderId: order.id,
      amountPaise: order.amount,
      currency: order.currency,
      feature,
      amount,
    });
  } catch (error) {
    logger.error({ error, userId, feature }, "Failed to create Razorpay unlock order");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create payment order",
    });
  }
});

router.post("/users/me/student-feature-unlock/verify", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["student"]);
  if (!callerRole) return;

  const userId = getSignedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const feature = req.body?.feature === "question-bank" ? "question-bank" : req.body?.feature === "analysis" ? "analysis" : req.body?.feature === "pyq" ? "pyq" : req.body?.feature === "tests" ? "tests" : null;
  const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
  const paymentId = typeof req.body?.paymentId === "string" ? req.body.paymentId.trim() : "";
  const signature = typeof req.body?.signature === "string" ? req.body.signature.trim() : "";

  if (!feature || !orderId || !paymentId || !signature) {
    res.status(400).json({ error: "Payment verification data is incomplete." });
    return;
  }

  if (!verifyRazorpayPaymentSignature({ orderId, paymentId, signature })) {
    res.status(400).json({ error: "Payment signature is invalid." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.role !== "student") {
    res.status(404).json({ error: "Student account not found" });
    return;
  }

  const existingProfileData = parseStudentProfileData(user.studentProfileData ?? null);
  const access = getStudentFeatureAccess(existingProfileData);
  const pricing = getStudentFeatureUnlockPricing(existingProfileData);
  const isLocked = feature === "tests" ? access.testsLocked : feature === "analysis" ? access.analysisLocked : feature === "pyq" ? access.pyqLocked : access.questionBankLocked;
  const amount = feature === "tests" ? pricing.testsAmount : feature === "analysis" ? pricing.analysisAmount : feature === "pyq" ? pricing.pyqAmount : pricing.questionBankAmount;

  if (!isLocked) {
    res.json({
      message: "Feature is already unlocked.",
      user: serializeUser(user),
    });
    return;
  }

  if (!amount) {
    res.status(400).json({ error: "The unlock amount has not been configured for this student yet." });
    return;
  }

  const expectedAmountPaise = Math.round(amount * 100);

  try {
    let payment = await getRazorpayPayment(paymentId);

    if (payment.order_id !== orderId) {
      res.status(400).json({ error: "This payment does not belong to the requested order." });
      return;
    }

    if (payment.amount !== expectedAmountPaise) {
      res.status(400).json({ error: "The payment amount does not match this student unlock amount." });
      return;
    }

    if (payment.status === "authorized") {
      payment = await captureRazorpayPayment({
        paymentId,
        amountPaise: expectedAmountPaise,
        currency: payment.currency,
      });
    }

    if (payment.status !== "captured") {
      res.status(400).json({ error: "Payment is not captured yet. Please try again in a moment." });
      return;
    }

    const accessUpdate = feature === "tests"
      ? { testsLocked: false }
      : feature === "analysis"
      ? { analysisLocked: false }
      : feature === "pyq"
      ? { pyqLocked: false }
      : { questionBankLocked: false };

    const withUnlock = mergeStudentFeatureAccess(existingProfileData, accessUpdate);

    const paymentRecord = {
      paidAt: new Date().toISOString(),
      amount: amount,
      orderId,
      paymentId,
    };

    const nextProfileData = feature === "tests"
      ? appendTestsPayment(withUnlock, paymentRecord)
      : feature === "analysis"
      ? appendAnalysisPayment(withUnlock, paymentRecord)
      : feature === "pyq"
      ? appendPyqPayment(withUnlock, paymentRecord)
      : appendQuestionBankPayment(withUnlock, paymentRecord);

    const [updated] = await db
      .update(usersTable)
      .set({ studentProfileData: JSON.stringify(nextProfileData) })
      .where(eq(usersTable.id, user.id))
      .returning();

    res.json({
      message: feature === "tests"
        ? "Tests unlocked successfully."
        : feature === "analysis"
        ? "Full analysis unlocked successfully."
        : feature === "pyq"
        ? "PYQ unlocked successfully."
        : "Question bank unlocked successfully.",
      user: serializeUser(updated),
    });
  } catch (error) {
    logger.error({ error, userId, feature, orderId, paymentId }, "Failed to verify student unlock payment");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to verify payment",
    });
  }
});

router.get("/users/me/payment-history", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["student"]);
  if (!callerRole) return;

  const userId = getSignedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const profile = parseStudentProfileData(user.studentProfileData ?? null);
  const testsPayments    = getTestsPaymentHistory(profile).map((p) => ({ ...p, feature: "tests" as const }));
  const analysisPayments = getAnalysisPaymentHistory(profile).map((p) => ({ ...p, feature: "analysis" as const }));
  const qbPayments       = getQuestionBankPaymentHistory(profile).map((p) => ({ ...p, feature: "question-bank" as const }));
  const pyqPayments      = getPyqPaymentHistory(profile).map((p) => ({ ...p, feature: "pyq" as const }));

  const payments = [...testsPayments, ...analysisPayments, ...qbPayments, ...pyqPayments]
    .sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());

  res.json({ payments });
});

router.get("/users/payments/all", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin"]);
  if (!callerRole) return;

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
    .where(eq(usersTable.role, "student"))
    .orderBy(desc(usersTable.id));

  const rows = students.flatMap((student) => {
    const profile = parseStudentProfileData(student.studentProfileData ?? null);
    const testsPayments    = getTestsPaymentHistory(profile);
    const analysisPayments = getAnalysisPaymentHistory(profile);
    const qbPayments       = getQuestionBankPaymentHistory(profile);
    const pyqPayments      = getPyqPaymentHistory(profile);
    const lockEvents       = getTestsLockEvents(profile);
    const pricing          = getStudentFeatureUnlockPricing(profile);

    const baseInfo = {
      studentId:   student.id,
      studentName: student.fullName ?? student.username,
      email:       student.email,
      phone:       student.phone ?? null,
      subject:     student.subject ?? null,
      testsAmount: pricing.testsAmount,
      totalCycles: lockEvents.length + testsPayments.length,
    };

    return [
      ...testsPayments.map((p) => ({ ...baseInfo, feature: "tests" as const, cycle: p.cycle, paidAt: p.paidAt, amount: p.amount, orderId: p.orderId, paymentId: p.paymentId })),
      ...analysisPayments.map((p) => ({ ...baseInfo, feature: "analysis" as const, cycle: p.cycle, paidAt: p.paidAt, amount: p.amount, orderId: p.orderId, paymentId: p.paymentId })),
      ...qbPayments.map((p) => ({ ...baseInfo, feature: "question-bank" as const, cycle: p.cycle, paidAt: p.paidAt, amount: p.amount, orderId: p.orderId, paymentId: p.paymentId })),
      ...pyqPayments.map((p) => ({ ...baseInfo, feature: "pyq" as const, cycle: p.cycle, paidAt: p.paidAt, amount: p.amount, orderId: p.orderId, paymentId: p.paymentId })),
    ];
  });

  rows.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());

  const summary = {
    totalPayments: rows.length,
    totalRevenue: rows.reduce((sum, r) => sum + r.amount, 0),
    uniqueStudents: new Set(rows.map((r) => r.studentId)).size,
  };

  res.json({ payments: rows, summary });
});

router.get("/users/:id/profile-insights", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin", "admin"]);
  if (!callerRole) return;

  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.role !== "student") {
    res.status(400).json({ error: "Insights are only available for student accounts" });
    return;
  }

  const [approver, submissions, savedQuestions, practiceProgress, activityLogs, sessions, questionBankPerformanceRows, emailLogs, pyqPerformance] = await Promise.all([
    user.approvedById
      ? db
        .select({ fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, user.approvedById))
        .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({
        id: testSubmissionsTable.id,
        testId: testSubmissionsTable.testId,
        score: testSubmissionsTable.score,
        totalPoints: testSubmissionsTable.totalPoints,
        percentage: testSubmissionsTable.percentage,
        passed: testSubmissionsTable.passed,
        submittedAt: testSubmissionsTable.submittedAt,
        testTitle: testsTable.title,
      })
      .from(testSubmissionsTable)
      .leftJoin(testsTable, eq(testSubmissionsTable.testId, testsTable.id))
      .where(eq(testSubmissionsTable.studentId, user.id))
      .orderBy(desc(testSubmissionsTable.submittedAt), desc(testSubmissionsTable.id)),
    db
      .select({ id: questionBankSavedQuestionsTable.id })
      .from(questionBankSavedQuestionsTable)
      .where(eq(questionBankSavedQuestionsTable.studentId, user.id)),
    db
      .select()
      .from(questionBankQuestionProgressTable)
      .where(eq(questionBankQuestionProgressTable.studentId, user.id))
      .catch((error) => {
        if (isMissingRelationError(error)) {
          return [] as Array<typeof questionBankQuestionProgressTable.$inferSelect>;
        }
        throw error;
      }),
    db
      .select()
      .from(userActivityLogs)
      .where(eq(userActivityLogs.userId, user.id))
      .orderBy(desc(userActivityLogs.createdAt))
      .limit(250),
    db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, user.id))
      .orderBy(desc(userSessions.lastActiveAt))
      .limit(40),
    db
      .select({
        attemptCount: questionBankQuestionProgressTable.attemptCount,
        correctCount: questionBankQuestionProgressTable.correctCount,
        lastAttemptedAt: questionBankQuestionProgressTable.lastAttemptedAt,
        subjectName: subjectsTable.title,
      })
      .from(questionBankQuestionProgressTable)
      .leftJoin(subjectsTable, eq(questionBankQuestionProgressTable.subjectId, subjectsTable.id))
      .where(eq(questionBankQuestionProgressTable.studentId, user.id))
      .catch(() => [] as Array<{
        attemptCount: number;
        correctCount: number;
        lastAttemptedAt: Date | string;
        subjectName: string | null;
      }>),
    db
      .select({
        id: emailSendLogsTable.id,
        providerKey: emailSendLogsTable.providerKey,
        providerName: emailSendLogsTable.providerName,
        senderEmail: emailSendLogsTable.senderEmail,
        recipientEmail: emailSendLogsTable.recipientEmail,
        subject: emailSendLogsTable.subject,
        messageType: emailSendLogsTable.messageType,
        status: emailSendLogsTable.status,
        sentAt: emailSendLogsTable.sentAt,
      })
      .from(emailSendLogsTable)
      .where(eq(emailSendLogsTable.recipientEmail, user.email))
      .orderBy(desc(emailSendLogsTable.sentAt))
      .limit(12)
      .catch(() => [] as Array<{
        id: number;
        providerKey: string;
        providerName: string;
        senderEmail: string;
        recipientEmail: string;
        subject: string;
        messageType: string;
        status: string;
        sentAt: Date | string;
      }>),
    readProfilePyqPerformance(async (store, query, params) => {
      if (store === 'main') return (await executeD1Sql(query, params)).rows;
      const url = (store === 'jam' ? process.env.JAM_PYQ_PROXY_URL : process.env.PYQ_PROXY_URL)?.trim().replace(/\/$/, '');
      const token = (store === 'jam' ? process.env.JAM_PYQ_PROXY_TOKEN : process.env.PYQ_PROXY_TOKEN)?.trim();
      if (!url || !token) throw new Error('PYQ source is not configured');
      const response = await fetch(`${url}/query`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ method: 'all', sql: query, params }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json() as { ok?: boolean; results?: Record<string, unknown>[] };
      if (!response.ok || !payload.ok) throw new Error('PYQ source is unavailable');
      return payload.results ?? [];
    }, user.id),
  ]);

  const profileDetails = parseStudentProfileData(user.studentProfileData ?? null);
  const address = (profileDetails?.address && typeof profileDetails.address === "object"
    ? profileDetails.address
    : {}) as Record<string, unknown>;
  const preparation = (profileDetails?.preparation && typeof profileDetails.preparation === "object"
    ? profileDetails.preparation
    : {}) as Record<string, unknown>;
  const learningMode = (profileDetails?.learningMode && typeof profileDetails.learningMode === "object"
    ? profileDetails.learningMode
    : {}) as Record<string, unknown>;
  const country = typeof address.country === "string" && address.country.trim() ? address.country.trim() : "India";
  const state = typeof address.state === "string" ? address.state.trim() : "";
  const district = typeof address.district === "string" ? address.district.trim() : "";
  const street = typeof address.street === "string" ? address.street.trim() : "";
  const city = typeof address.city === "string" ? address.city.trim() : "";
  const pincode = typeof address.pincode === "string" ? address.pincode.trim() : "";
  const classLevelRaw = typeof preparation.classLevel === "string" ? preparation.classLevel.trim() : "";
  const classLevelLegacyMap: Record<string, string> = {
    "College 1st Year": "Clg 1st",
    "College 2nd Year": "Clg 2nd",
    "College 3rd Year": "Clg 3rd",
    "College 4th Year": "Clg 4th",
    Graduate: "Graduated",
  };
  const classLevel = classLevelLegacyMap[classLevelRaw] ?? classLevelRaw;
  const board = typeof preparation.board === "string" ? preparation.board.trim() : "";
  const targetYear = typeof preparation.targetYear === "string" ? preparation.targetYear.trim() : "";
  const targetExam = typeof preparation.targetExam === "string" && preparation.targetExam.trim()
    ? preparation.targetExam.trim()
    : (typeof user.subject === "string" ? user.subject.trim() : "");
  const collegeStages = new Set(["Clg 1st", "Clg 2nd", "Clg 3rd", "Clg 4th", "Graduated", "College 1st Year", "College 2nd Year", "College 3rd Year", "College 4th Year", "Graduate"]);
  const isCollegeStage = collegeStages.has(classLevel) || board === "UG University";
  const rawInstitutionName = typeof preparation.institutionName === "string" ? preparation.institutionName.trim() : "";
  const rawCollegeName = typeof preparation.collegeName === "string" ? preparation.collegeName.trim() : "";
  const institutionName = rawInstitutionName || rawCollegeName;
  const collegeName = isCollegeStage ? (rawCollegeName || rawInstitutionName) : "";
  const universityName = isCollegeStage && typeof preparation.universityName === "string"
    ? preparation.universityName.trim()
    : "";
  const learningModeName = typeof learningMode.mode === "string" ? learningMode.mode.trim() : "";
  const learningProvider = typeof learningMode.provider === "string" && learningMode.provider.trim()
    ? learningMode.provider.trim()
    : (learningModeName === "Self Study using Free Resources" ? "Self Study using Free Resources" : "");
  const hearAboutUs = typeof profileDetails?.hearAboutUs === "string" ? profileDetails.hearAboutUs.trim() : "";

  const completionSteps = [
    {
      key: "personal",
      label: "Personal details",
      complete: Boolean(
        user.avatarUrl?.trim()
        && user.fullName?.trim()
        && user.phone?.trim()
        && profileDetails?.dateOfBirth
        && (profileDetails?.whatsappOnSameNumber === true || (typeof profileDetails?.whatsappNumber === "string" && profileDetails.whatsappNumber.trim())),
      ),
    },
    {
      key: "address",
      label: "Address",
      complete: Boolean(country && state && district && street && city && pincode),
    },
    {
      key: "preparation",
      label: "College & target",
      complete: Boolean(
        classLevel
        && targetYear
        && targetExam
        && (isCollegeStage ? (collegeName && universityName) : institutionName),
      ),
    },
    {
      key: "learning",
      label: "Learning mode",
      complete: Boolean(learningModeName),
    },
    {
      key: "discovery",
      label: "Source",
      complete: Boolean(hearAboutUs),
    },
  ];

  const completedSteps = completionSteps.filter((step) => step.complete).length;
  const completionPercent = Math.round((completedSteps / completionSteps.length) * 100);

  const accountCreatedAt = toDateValue(user.createdAt);
  const latestActivityDate = [
    toDateValue(activityLogs[0]?.createdAt),
    toDateValue(sessions[0]?.lastActiveAt),
    toDateValue(submissions[0]?.submittedAt),
  ]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const testsAttempted = submissions.length;
  const averageScore = testsAttempted > 0
    ? roundMetric(submissions.reduce((sum, submission) => sum + Number(submission.percentage ?? 0), 0) / testsAttempted)
    : 0;
  const bestScore = testsAttempted > 0
    ? roundMetric(Math.max(...submissions.map((submission) => Number(submission.percentage ?? 0))))
    : 0;
  const latestScore = testsAttempted > 0 ? roundMetric(Number(submissions[0]?.percentage ?? 0)) : 0;
  const passRate = testsAttempted > 0
    ? roundMetric((submissions.filter((submission) => submission.passed).length / testsAttempted) * 100)
    : 0;

  const totalPracticeAttempts = practiceProgress.reduce((sum, item) => sum + item.attemptCount, 0);
  const correctPracticeAttempts = practiceProgress.reduce((sum, item) => sum + item.correctCount, 0);
  const solvedQuestions = practiceProgress.filter((item) => Boolean(item.solvedAt) || item.lastIsCorrect).length;
  const practiceAccuracy = totalPracticeAttempts > 0
    ? roundMetric((correctPracticeAttempts / totalPracticeAttempts) * 100)
    : 0;

  const today = new Date();
  const activityTrend = Array.from({ length: 7 }, (_, index) => {
    const current = new Date(today);
    current.setHours(0, 0, 0, 0);
    current.setDate(today.getDate() - (6 - index));
    const next = new Date(current);
    next.setDate(current.getDate() + 1);
    const count = activityLogs.filter((entry) => {
      const createdAt = toDateValue(entry.createdAt);
      return createdAt ? createdAt >= current && createdAt < next : false;
    }).length;
    return {
      label: current.toLocaleDateString("en-US", { weekday: "short" }),
      count,
      date: current.toISOString(),
    };
  });

  const activityBuckets = activityLogs.reduce<Record<string, number>>((acc, entry) => {
    const page = (entry.page ?? "").toLowerCase();
    const action = (entry.action ?? "").toLowerCase();
    const bucket = page.includes("question-bank") || action.includes("question")
      ? "Question Bank"
      : page.includes("/student/tests") || action.includes("test")
        ? "Tests"
        : page.includes("analysis")
          ? "Analysis"
          : "Other";
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});

  const activityBreakdown = [
    { name: "Tests", value: activityBuckets.Tests ?? 0 },
    { name: "Question Bank", value: activityBuckets["Question Bank"] ?? 0 },
    { name: "Analysis", value: activityBuckets.Analysis ?? 0 },
    { name: "Other", value: activityBuckets.Other ?? 0 },
  ].filter((item) => item.value > 0);

  const recentActivity = activityLogs.slice(0, 8).map((entry) => ({
    id: entry.id,
    action: entry.action,
    page: entry.page,
    detail: entry.detail,
    createdAt: entry.createdAt,
  }));

  const scoreTrend = submissions
    .slice(0, 8)
    .reverse()
    .map((submission, index) => ({
      label: `T${index + 1}`,
      title: submission.testTitle ?? `Test #${submission.testId}`,
      percentage: roundMetric(Number(submission.percentage ?? 0)),
      score: roundMetric(Number(submission.score ?? 0)),
      totalPoints: submission.totalPoints,
      submittedAt: submission.submittedAt,
      passed: submission.passed,
    }));

  const questionBankPerformanceMap = new Map<string, {
    subject: string;
    attempted: number;
    correct: number;
  }>();

  questionBankPerformanceRows.forEach((row) => {
    const subject = row.subjectName?.trim() || "General Practice";
    const existing = questionBankPerformanceMap.get(subject) ?? {
      subject,
      attempted: 0,
      correct: 0,
    };

    existing.attempted += row.attemptCount ?? 0;
    existing.correct += row.correctCount ?? 0;
    questionBankPerformanceMap.set(subject, existing);
  });

  const questionBankPerformance = Array.from(questionBankPerformanceMap.values())
    .map((item) => {
      return {
        subject: item.subject,
        attempted: item.attempted,
        correct: item.correct,
        accuracy: item.attempted > 0 ? roundMetric((item.correct / item.attempted) * 100) : 0,
      };
    })
    .sort((a, b) => b.attempted - a.attempted);

  const studyActivityMap = new Map<string, number>();
  const bumpStudyDay = (value: Date | string | null | undefined) => {
    const parsed = toDateValue(value);
    if (!parsed) return;
    const key = parsed.toISOString().slice(0, 10);
    studyActivityMap.set(key, (studyActivityMap.get(key) ?? 0) + 1);
  };

  activityLogs.forEach((entry) => bumpStudyDay(entry.createdAt));
  sessions.forEach((session) => {
    bumpStudyDay(session.startedAt);
    bumpStudyDay(session.lastActiveAt);
  });
  submissions.forEach((submission) => bumpStudyDay(submission.submittedAt));

  const heatmapStart = new Date(today);
  heatmapStart.setHours(0, 0, 0, 0);
  heatmapStart.setDate(heatmapStart.getDate() - 83);

  const heatmap = Array.from({ length: 84 }, (_, index) => {
    const date = new Date(heatmapStart);
    date.setDate(heatmapStart.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const count = studyActivityMap.get(key) ?? 0;
    const level = count === 0
      ? 0
      : count < 2
        ? 1
        : count < 4
          ? 2
          : count < 7
            ? 3
            : 4;

    return {
      date: key,
      count,
      level,
    };
  });

  const dailyCounts = heatmap.map((item) => item.count);
  let currentStreak = 0;
  for (let index = dailyCounts.length - 1; index >= 0; index -= 1) {
    if (dailyCounts[index] > 0) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  let longestStreak = 0;
  let activeRun = 0;
  dailyCounts.forEach((count) => {
    if (count > 0) {
      activeRun += 1;
      longestStreak = Math.max(longestStreak, activeRun);
    } else {
      activeRun = 0;
    }
  });

  const sessionsHistory = sessions.slice(0, 8).map((session) => ({
    id: session.id,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    endedAt: session.endedAt,
    totalSeconds: session.totalSeconds,
    isActive: session.isActive,
    ipAddress: session.ipAddress ?? null,
    locationLabel: session.locationLabel ?? null,
    browserName: session.browserName ?? null,
    deviceType: session.deviceType ?? null,
  }));

  const emailHistory = emailLogs.map((entry) => ({
    id: entry.id,
    providerKey: entry.providerKey,
    providerName: entry.providerName,
    senderEmail: entry.senderEmail,
    recipientEmail: entry.recipientEmail,
    subject: entry.subject,
    messageType: entry.messageType,
    status: entry.status,
    sentAt: entry.sentAt,
  }));

  res.json({
    student: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      subject: targetExam || user.subject,
      additionalExams: normalizeStringList(user.additionalExams),
      avatarUrl: user.avatarUrl,
      onboardingComplete: user.onboardingComplete,
      approvedAt: user.approvedAt,
      approverName: approver?.fullName ?? null,
      rejectionReason: user.rejectionReason ?? null,
      createdAt: user.createdAt,
      profileDetails,
    },
    overview: {
      testsAttempted,
      averageScore,
      bestScore,
      latestScore,
      passRate,
      savedQuestions: savedQuestions.length,
      solvedQuestions,
      trackedPracticeQuestions: practiceProgress.length,
      practiceAccuracy,
      totalPracticeAttempts,
      activeDaysLast7: activityTrend.filter((item) => item.count > 0).length,
      accountAgeDays: accountCreatedAt
        ? Math.max(1, Math.ceil((today.getTime() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)))
        : 0,
      lastActiveAt: toISOStringSafe(latestActivityDate),
    },
    profileCompletion: {
      percent: completionPercent,
      completedSteps,
      totalSteps: completionSteps.length,
      steps: completionSteps,
    },
    scoreTrend,
    testHistory: submissions.map((s) => ({
      id: s.id,
      testId: s.testId,
      title: s.testTitle ?? `Test #${s.testId}`,
      score: roundMetric(Number(s.score ?? 0)),
      totalPoints: s.totalPoints,
      percentage: roundMetric(Number(s.percentage ?? 0)),
      passed: s.passed,
      submittedAt: s.submittedAt,
    })),
    testsPaymentHistory: getTestsPaymentHistory(profileDetails),
    testsLockEvents: getTestsLockEvents(profileDetails),
    analysisPaymentHistory: getAnalysisPaymentHistory(profileDetails),
    analysisLockEvents: getAnalysisLockEvents(profileDetails),
    activityTrend,
    activityBreakdown,
    recentActivity,
    studyStreak: {
      heatmap: heatmap.slice(-28),
      currentStreak,
      longestStreak,
      totalActiveDays: heatmap.filter((item) => item.count > 0).length,
    },
    questionBankPerformance,
    ...pyqPerformance,
    sessionsHistory,
    emailHistory,
    preparationSnapshot: {
      dateOfBirth: profileDetails?.dateOfBirth ?? null,
      whatsappOnSameNumber: profileDetails?.whatsappOnSameNumber === true,
      whatsappNumber: typeof profileDetails?.whatsappNumber === "string" ? profileDetails.whatsappNumber : "",
      address: {
        country,
        state,
        district,
        street,
        city,
        pincode,
      },
      preparation: {
        classLevel,
        board,
        targetYear,
        targetExam,
        institutionName,
        collegeName,
        universityName,
      },
      learningMode: {
        mode: learningModeName,
        provider: learningProvider,
      },
      hearAboutUs,
    },
  });
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const callerRole = req.cookies?.userRole;
  if (!callerRole || (callerRole !== "super_admin" && callerRole !== "admin")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }
  if (callerRole === 'admin' && target.role !== 'student') { res.status(403).json({ error: 'Admins can only edit student accounts.' }); return; }
  if (body.data.fullName != null) updateData.fullName = body.data.fullName;
  if (body.data.email != null) updateData.email = body.data.email;
  if (body.data.phone !== undefined) updateData.phone = body.data.phone;
  if (body.data.subject !== undefined) updateData.subject = body.data.subject;

  const newPassword = (req.body as any).newPassword;
  if (typeof newPassword === "string" && newPassword.trim().length >= 6) {
    updateData.passwordHash = await hashPassword(newPassword.trim());
    updateData.mustChangePassword = !!(req.body as any).forcePasswordChange;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (updateData.passwordHash) await revokeNodeUserSessions(updated.id);
  res.json(serializeUser(updated));
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin", "admin"]);
  if (!callerRole) return;

  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = params.data.id;

  const user = await db.select().from(usersTable).where(eq(usersTable.id, userId)).then((r) => r[0]);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (callerRole === "admin" && user.role !== "student") {
    res.status(403).json({ error: "Admins can only permanently delete student accounts" });
    return;
  }

  try {
    // Clear nullable references that can otherwise block staff deletion.
    await db.update(subjectsTable).set({ teacherId: null }).where(eq(subjectsTable.teacherId, userId));
    await db.update(passwordResetRequestsTable).set({ resolvedBy: null }).where(eq(passwordResetRequestsTable.resolvedBy, userId));
    await db.update(questionBankQuestionsTable).set({ createdBy: null }).where(eq(questionBankQuestionsTable.createdBy, userId));
    await db.update(testsTable).set({ createdBy: null }).where(eq(testsTable.createdBy, userId));
    await db.update(examTemplatesTable).set({ createdBy: null }).where(eq(examTemplatesTable.createdBy, userId));

    // Delete direct references that should disappear with the account.
    await db.delete(directMessagesTable).where(or(eq(directMessagesTable.senderId, userId), eq(directMessagesTable.receiverId, userId)));
    await db.delete(questionBankReportsTable).where(or(eq(questionBankReportsTable.reportedBy, userId), eq(questionBankReportsTable.teacherId, userId)));
    await db
      .delete(testQuestionReportsTable)
      .where(or(eq(testQuestionReportsTable.reportedBy, userId), eq(testQuestionReportsTable.teacherId, userId)))
      .catch((error) => {
        if (!isMissingRelationError(error)) throw error;
      });
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
    await db.delete(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, userId));
    await db.delete(userActivityLogs).where(eq(userActivityLogs.userId, userId));
    await db.delete(userSessions).where(eq(userSessions.userId, userId));

    // Cascade delete: remove role-specific data before deleting the user.
    if (user.role === "student") {
      await db.delete(testSubmissionsTable).where(eq(testSubmissionsTable.studentId, userId));
      await db.delete(questionBankSavedQuestionsTable).where(eq(questionBankSavedQuestionsTable.studentId, userId));
      await db.delete(passwordResetRequestsTable).where(eq(passwordResetRequestsTable.userId, userId));
    }

    await db.delete(usersTable).where(eq(usersTable.id, userId));

    if (isFirebaseAdminConfigured() && user.email?.trim()) {
      await deleteFirebaseUserByEmail(user.email.trim()).catch((error) => {
        logger.warn({ error, email: user.email, userId }, "Failed to delete Firebase user for deleted account");
      });
    }

    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to delete user",
    });
  }
});

router.patch("/users/:id/approve", async (req, res): Promise<void> => {
  const callerRole = requireRole(req, res, ["super_admin", "admin"]);
  if (!callerRole) return;

  const params = ApproveStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = ApproveStudentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const approverId = getSignedUserId(req);
  if (!approverId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const newStatus = body.data.status;
  const reviewReason = typeof body.data.reason === "string" ? body.data.reason.trim() : "";
  if (newStatus === "rejected" && reviewReason.length < 5) {
    res.status(400).json({ error: "Please provide a short rejection reason." });
    return;
  }
  const setData: any = {
    status: newStatus,
    reviewedById: approverId || null,
    reviewedAt: new Date(),
    pendingReviewStartedAt: null,
    pendingReviewEscalatedAt: null,
  };
  if (newStatus === "approved" && approverId) {
    setData.approvedById = approverId;
    setData.approvedAt = new Date();
    setData.rejectionReason = null;
  }
  if (newStatus === "rejected") {
    setData.approvedById = null;
    setData.approvedAt = null;
    setData.rejectionReason = reviewReason;
  }

  const [updated] = await db
    .update(usersTable)
    .set(setData)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (newStatus === "approved") {
    if (updated.role === "student" && updated.email) {
      queueStudentApprovedEmail({
        studentName: updated.fullName,
        email: updated.email,
      });
    }
  }

  if (newStatus === "rejected" && updated.role === "student" && updated.email) {
    queueStudentRejectedEmail({
      studentName: updated.fullName,
      email: updated.email,
      reason: reviewReason,
    });
  }

  res.json(serializeUser(updated));
});

export default router;
