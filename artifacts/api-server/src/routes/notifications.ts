import { Router, type IRouter } from "express";
import { db, notificationsTable, notificationPreferencesTable, usersTable, testSubmissionsTable, userSessions } from "@workspace/db";
import { eq, and, desc, lt, inArray, max, sql, gte } from "drizzle-orm";
import { getSignedUserId } from "../lib/authUtils";
import { addSSEClient } from "../lib/sseClients";
import { pushNotificationToMany } from "../lib/pushNotification";
import {
  listBrevoEmailSendLogs,
  isGmailSmtpConfigured,
  buildPersonalizedBroadcastEmailHtml,
  buildBroadcastEmailHtml,
  sendBroadcastEmail,
  type StudentEmailStats,
} from "../lib/brevo";
import { readPublicAppUrl } from "../lib/publicAppUrl";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function getUser(req: any) {
  return getSignedUserId(req);
}

async function requireSuperAdmin(req: any, res: any): Promise<number | null> {
  const userId = getUser(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  try {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!user || user.role !== "super_admin") {
      res.status(403).json({ error: "Only super admin can access this section" });
      return null;
    }
    return userId;
  } catch {
    res.status(500).json({ error: "Auth check failed" });
    return null;
  }
}

/* ── SSE stream ── */
router.get("/notifications/stream", (req, res): void => {
  const userId = getUser(req);
  if (!userId) { res.status(401).end(); return; }
  addSSEClient(userId, res);
  // Keep the request open (SSE handles cleanup on close)
});

/* ── List (paginated) ── */
router.get("/notifications", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 100);
  const cursor = req.query.cursor ? parseInt(String(req.query.cursor), 10) : null;

  let query = db
    .select()
    .from(notificationsTable)
    .where(
      cursor
        ? and(eq(notificationsTable.userId, userId), lt(notificationsTable.id, cursor))
        : eq(notificationsTable.userId, userId)
    )
    .orderBy(desc(notificationsTable.id))
    .limit(limit + 1);

  const rows = await query;
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);

  res.json({
    notifications: data.map((n) => ({ ...n, createdAt: n.createdAt?.toISOString() ?? null })),
    hasMore,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  });
});

/* ── Unread count ── */
router.get("/notifications/unread-count", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.json({ count: 0 }); return; }

  const all = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

  res.json({ count: all.length });
});

/* ── Mark one read ── */
router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id);
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.json({ ok: true });
});

/* ── Mark all read ── */
router.patch("/notifications/read-all", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ ok: true });
});

/* ── Delete one ── */
router.delete("/notifications/:id", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id);
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.json({ ok: true });
});

/* ── Delete all read ── */
router.delete("/notifications/clear-read", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, true)));
  res.json({ ok: true });
});

/* ── Delete ALL ── */
router.delete("/notifications/clear-all", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
  res.json({ ok: true });
});

/* ══════════════════════════════════════
   NOTIFICATION PREFERENCES
══════════════════════════════════════ */

/* ── Get preferences ── */
router.get("/notification-preferences", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [pref] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);

  if (!pref) {
    // Return defaults
    res.json({
      assignment: true, grade: true, test: true, class: true,
      system: true, community: true, digest: true, weeklyDigest: true,
    });
    return;
  }

  res.json({
    assignment: pref.assignment,
    grade: pref.grade,
    test: pref.test,
    class: pref.class,
    system: pref.system,
    community: pref.community,
    digest: pref.digest,
    weeklyDigest: pref.weeklyDigest,
  });
});

/* ── Update preferences ── */
router.patch("/notification-preferences", async (req, res): Promise<void> => {
  const userId = getUser(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const allowed = ["assignment", "grade", "test", "class", "system", "community", "digest", "weeklyDigest"];
  const updates: any = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in req.body) updates[key] = Boolean(req.body[key]);
  }

  const [existing] = await db
    .select({ id: notificationPreferencesTable.id })
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);

  if (existing) {
    await db.update(notificationPreferencesTable).set(updates)
      .where(eq(notificationPreferencesTable.userId, userId));
  } else {
    await db.insert(notificationPreferencesTable).values({ userId, ...updates });
  }

  res.json({ ok: true });
});

/* ── Broadcast (super_admin only) ── */
router.post("/notifications/broadcast", async (req, res): Promise<void> => {
  const userId = await requireSuperAdmin(req, res);
  if (!userId) return;

  const { title, message, link, type, target } = req.body as {
    title: string;
    message?: string;
    link?: string;
    type: string;
    target: "all" | "admins" | "students";
  };

  if (!title?.trim()) { res.status(400).json({ error: "Title is required" }); return; }
  if (!["all", "admins", "students"].includes(target)) { res.status(400).json({ error: "Invalid target" }); return; }

  let users = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable);

  if (target === "admins") users = users.filter((u) => u.role === "admin");
  else if (target === "students") users = users.filter((u) => u.role === "student");
  else users = users.filter((u) => u.role !== "super_admin");

  const userIds = users.map((u) => u.id);
  await pushNotificationToMany(userIds, {
    type: type ?? "system",
    title: title.trim(),
    message: message?.trim() ?? null,
    link: link?.trim() ?? null,
  });

  res.json({ sent: userIds.length });
});

router.get("/notifications/email-log", async (req, res): Promise<void> => {
  const callerId = await requireSuperAdmin(req, res);
  if (!callerId) return;

  const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
  const logs = await listBrevoEmailSendLogs(Number.isFinite(rawLimit) ? rawLimit : 50);
  res.json({ logs });
});

/* ── Email recipients list (all students with name + email) ── */
router.get("/notifications/email-recipients", async (req, res): Promise<void> => {
  const callerId = await requireSuperAdmin(req, res);
  if (!callerId) return;

  const students = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, email: usersTable.email, role: usersTable.role, emailOptOut: usersTable.emailOptOut })
    .from(usersTable);

  // Get last active time for each student from sessions
  const sessionRows = await db
    .select({ userId: userSessions.userId, lastActiveAt: max(userSessions.lastActiveAt) })
    .from(userSessions)
    .groupBy(userSessions.userId);

  const lastActiveMap = new Map<number, Date>();
  for (const row of sessionRows) {
    if (row.lastActiveAt) lastActiveMap.set(row.userId, row.lastActiveAt);
  }

  const now = Date.now();
  const list = students
    .filter((u) => u.role === "student" && u.email)
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""))
    .map((u) => {
      const lastActive = lastActiveMap.get(u.id);
      const inactiveDays = lastActive
        ? Math.floor((now - lastActive.getTime()) / 86_400_000)
        : null;
      return { id: u.id, name: u.fullName ?? "", email: u.email, emailOptOut: u.emailOptOut, inactiveDays };
    });

  res.json({ recipients: list, total: list.length });
});

/* ── Toggle email opt-out for a student (super admin only) ── */
router.patch("/notifications/email-opt-out/:userId", async (req, res): Promise<void> => {
  const callerId = await requireSuperAdmin(req, res);
  if (!callerId) return;

  const userId = parseInt(req.params.userId, 10);
  if (!userId || Number.isNaN(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  const optOut = Boolean(req.body?.optOut);
  await db.update(usersTable).set({ emailOptOut: optOut }).where(eq(usersTable.id, userId));

  logger.info({ callerId, userId, optOut }, "Email opt-out toggled by super admin");
  res.json({ ok: true, userId, emailOptOut: optOut });
});

/* ── Email preview (returns rendered HTML) ── */
router.get("/notifications/email-preview", async (req, res): Promise<void> => {
  const callerId = await requireSuperAdmin(req, res);
  if (!callerId) return;

  const title       = typeof req.query.title       === "string" ? req.query.title.trim()       : "Notification Title";
  const message     = typeof req.query.message     === "string" ? req.query.message.trim()     : "";
  const emoji       = typeof req.query.emoji       === "string" ? req.query.emoji.trim()       : "📢";
  const category    = typeof req.query.category    === "string" ? req.query.category.trim()    : "Announcement";
  const previewName = typeof req.query.previewName === "string" ? req.query.previewName.trim() : "Rahul Sharma";
  const inactiveDaysRaw = typeof req.query.inactiveDays === "string" ? parseInt(req.query.inactiveDays, 10) : null;
  const inactiveDays = inactiveDaysRaw && Number.isFinite(inactiveDaysRaw) ? inactiveDaysRaw : null;

  const portalUrl = readPublicAppUrl();
  const html = buildPersonalizedBroadcastEmailHtml({
    title, message, emoji, category, portalUrl,
    countdownDate: null, countdownLabel: "",
    stats: { name: previewName, rank: 5, totalStudents: 120, totalScore: 2340, testsCompleted: 12, avgPercentage: 72, inactiveDays },
  });
  res.json({ html });
});

/* ── Email broadcast (send actual email to students/all) ── */
router.post("/notifications/email-broadcast", async (req, res): Promise<void> => {
  const callerId = await requireSuperAdmin(req, res);
  if (!callerId) return;

  const { title, message, emoji, category, target, inactiveDaysThreshold } = req.body as {
    title: string;
    message: string;
    emoji: string;
    category: string;
    target: "all" | "students" | "inactive";
    inactiveDaysThreshold?: number;
  };

  if (!title?.trim())   { res.status(400).json({ error: "Title is required" }); return; }
  if (!message?.trim()) { res.status(400).json({ error: "Message is required" }); return; }
  if (!isGmailSmtpConfigured()) {
    res.status(400).json({ error: "Email provider not configured. Set SMTP_USER and SMTP_PASS." });
    return;
  }

  let allUsers = await db
    .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName, role: usersTable.role, emailOptOut: usersTable.emailOptOut })
    .from(usersTable);

  // Always filter out users who opted out of emails
  allUsers = allUsers.filter((u) => !u.emailOptOut && u.email);

  // Get last active time for all users from sessions
  const sessionRows = await db
    .select({ userId: userSessions.userId, lastActiveAt: max(userSessions.lastActiveAt) })
    .from(userSessions)
    .groupBy(userSessions.userId);

  const lastActiveMap = new Map<number, Date>();
  for (const row of sessionRows) {
    if (row.lastActiveAt) lastActiveMap.set(row.userId, row.lastActiveAt);
  }

  const now = Date.now();
  const getInactiveDays = (userId: number): number | null => {
    const lastActive = lastActiveMap.get(userId);
    if (!lastActive) return null;
    return Math.floor((now - lastActive.getTime()) / 86_400_000);
  };

  let recipients: typeof allUsers;
  if (target === "inactive") {
    const threshold = typeof inactiveDaysThreshold === "number" ? inactiveDaysThreshold : 7;
    recipients = allUsers.filter((u) => {
      if (u.role !== "student") return false;
      const days = getInactiveDays(u.id);
      return days !== null && days >= threshold;
    });
  } else if (target === "students") {
    recipients = allUsers.filter((u) => u.role === "student");
  } else {
    recipients = allUsers.filter((u) => u.role !== "super_admin");
  }

  // ── Batch-query real per-student stats ────────────────────────────────────
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [allTimeRows, weeklyRows, studentCountRows] = await Promise.all([
    db
      .select({
        studentId: testSubmissionsTable.studentId,
        testsCompleted: sql<number>`cast(count(*) as integer)`,
        avgPct:        sql<number>`coalesce(avg(${testSubmissionsTable.percentage}), 0)`,
        totalScore:    sql<number>`coalesce(sum(${testSubmissionsTable.score}), 0)`,
      })
      .from(testSubmissionsTable)
      .groupBy(testSubmissionsTable.studentId),

    db
      .select({
        studentId:   testSubmissionsTable.studentId,
        weeklyTests: sql<number>`cast(count(*) as integer)`,
        weeklyAvgPct: sql<number>`coalesce(avg(${testSubmissionsTable.percentage}), 0)`,
      })
      .from(testSubmissionsTable)
      .where(gte(testSubmissionsTable.submittedAt, weekAgo))
      .groupBy(testSubmissionsTable.studentId),

    db
      .select({ cnt: sql<number>`cast(count(*) as integer)` })
      .from(usersTable)
      .where(eq(usersTable.role, "student")),
  ]);

  const allTimeMap  = new Map(allTimeRows.map((r) => [r.studentId, r]));
  const weeklyMap   = new Map(weeklyRows.map((r) => [r.studentId, r]));
  const totalStudentCount = Number(studentCountRows[0]?.cnt ?? 0);

  // Rank students by all-time avg % descending (1 = best)
  const sortedByAvg = [...allTimeRows].sort(
    (a, b) => Number(b.avgPct) - Number(a.avgPct),
  );
  const rankMap = new Map(sortedByAvg.map((r, i) => [r.studentId, i + 1]));
  // ──────────────────────────────────────────────────────────────────────────

  let sent = 0;
  let failed = 0;
  for (const user of recipients) {
    if (!user.email) continue;
    try {
      const inactiveDays = getInactiveDays(user.id);
      const allTime  = allTimeMap.get(user.id);
      const weekly   = weeklyMap.get(user.id);

      await sendBroadcastEmail({
        to: user.email,
        title: title.trim(),
        message: message.trim(),
        emoji: emoji?.trim() || "📢",
        category: category?.trim() || "Announcement",
        countdownDate: null,
        countdownLabel: "",
        stats: {
          name:           user.fullName?.trim() || "Student",
          rank:           rankMap.get(user.id) ?? null,
          totalStudents:  totalStudentCount,
          totalScore:     Math.round(Number(allTime?.totalScore)   ?? 0),
          testsCompleted: Number(allTime?.testsCompleted)           ?? 0,
          avgPercentage:  Math.round(Number(allTime?.avgPct)        ?? 0),
          inactiveDays,
          weeklyTests:    Number(weekly?.weeklyTests)               ?? 0,
          weeklyAvgPct:   Math.round(Number(weekly?.weeklyAvgPct)   ?? 0),
        },
      });
      sent++;
    } catch (err) {
      failed++;
      logger.warn({ error: err, recipientId: user.id }, "Broadcast email failed for recipient");
    }
  }

  logger.info({ callerId, sent, failed, target }, "Email broadcast completed");
  res.json({ sent, failed, total: recipients.length });
});

/* ── Test email ── */
router.post("/notifications/email-test", async (req, res): Promise<void> => {
  const callerId = await requireSuperAdmin(req, res);
  if (!callerId) return;

  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(to)) {
    res.status(400).json({ error: "Valid recipient email is required." });
    return;
  }

  const gmailSmtp = isGmailSmtpConfigured();

  if (!gmailSmtp) {
    res.status(400).json({ error: "No email provider is configured. Set SMTP_USER and SMTP_PASS." });
    return;
  }

  const { sendTestEmail } = await import("../lib/brevo");

  try {
    await sendTestEmail({ to });
    logger.info({ recipient: to, callerId }, "Test email sent by super admin");
    res.json({ ok: true, message: `Test email sent to ${to}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send test email";
    logger.warn({ error, recipient: to }, "Test email send failed");
    res.status(500).json({ error: message });
  }
});

export default router;
