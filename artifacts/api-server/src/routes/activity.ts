import { Router } from "express";
import { getSignedUserId, getSignedUserIdOrThrow } from "../lib/authUtils";
import {
  db,
  executeD1Sql,
  userActivityLogs,
  userSessions,
  usersTable,
  testsTable,
  testQuestionsTable,
  questionBankQuestionsTable,
  questionBankReportsTable,
} from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";

const router = Router();
const ONLINE_WINDOW_MS = 180_000;

function getClientIp(req: any) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "";
  const candidate = ip || req.headers["x-real-ip"] || req.socket?.remoteAddress || req.ip || "";
  const normalized = String(candidate || "").replace(/^::ffff:/, "").trim();
  return normalized || "Unknown IP";
}

function isPrivateIp(ip: string) {
  return (
    ip === "127.0.0.1"
    || ip === "::1"
    || ip.startsWith("10.")
    || ip.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function getLocationLabel(req: any, ipAddress: string) {
  const city = String(req.headers["x-vercel-ip-city"] || req.headers["cf-ipcity"] || "").trim();
  const region = String(req.headers["x-vercel-ip-country-region"] || req.headers["x-vercel-ip-region"] || req.headers["cf-region"] || "").trim();
  const country = String(req.headers["x-vercel-ip-country"] || req.headers["cf-ipcountry"] || "").trim();
  const location = [city, region, country].filter(Boolean).join(", ");
  if (location) return location;
  if (!ipAddress || ipAddress === "Unknown IP") return "Unknown location";
  if (isPrivateIp(ipAddress)) return "Local network";
  return "Unknown location";
}

function parseUserAgent(userAgentHeader: string | undefined) {
  const userAgent = String(userAgentHeader || "");
  const lower = userAgent.toLowerCase();

  const browserName = lower.includes("edg/")
    ? "Edge"
    : lower.includes("opr/") || lower.includes("opera")
      ? "Opera"
      : lower.includes("firefox/")
        ? "Firefox"
        : lower.includes("safari/") && !lower.includes("chrome/")
          ? "Safari"
          : lower.includes("chrome/")
            ? "Chrome"
            : "Unknown";

  const deviceType = lower.includes("ipad") || lower.includes("tablet")
    ? "Tablet"
    : lower.includes("mobi") || lower.includes("android")
      ? "Mobile"
      : "Desktop";

  return {
    browserName,
    deviceType,
    userAgent: userAgent || "Unknown",
  };
}

function requireAuth(req: any, res: any, next: any) {
  if (!getSignedUserIdOrThrow(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function requireSuperAdmin(req: any, res: any, next: any) {
  const userId = getSignedUserIdOrThrow(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user || user.role !== "super_admin") return res.status(403).json({ error: "Forbidden" });
    next();
  } catch {
    return res.status(500).json({ error: "Auth check failed" });
  }
}

function toDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

// POST /api/activity/log — log a user action
router.post("/log", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const { action, page, detail } = req.body;
    if (!action) return res.status(400).json({ error: "action required" });

    await db.insert(userActivityLogs).values({ userId, action, page: page || null, detail: detail || null });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to log activity" });
  }
});

// POST /api/activity/session/start — start or resume a session
router.post("/session/start", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ error: "sessionToken required" });
    const ipAddress = getClientIp(req);
    const locationLabel = getLocationLabel(req, ipAddress);
    const { browserName, deviceType, userAgent } = parseUserAgent(req.headers["user-agent"]);

    // Check if session already exists
    const existing = await db.select().from(userSessions)
      .where(and(eq(userSessions.userId, userId), eq(userSessions.sessionToken, sessionToken)));
    if (existing.length > 0) {
      await db.update(userSessions)
        .set({ lastActiveAt: new Date(), endedAt: null, isActive: true, ipAddress, locationLabel, browserName, deviceType, userAgent })
        .where(eq(userSessions.id, existing[0].id));
      return res.json({ sessionId: existing[0].id });
    }

    const [row] = await db.insert(userSessions).values({
      userId, sessionToken, isActive: true, ipAddress, locationLabel, browserName, deviceType, userAgent,
    }).returning({ id: userSessions.id });
    res.json({ sessionId: row.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to start session" });
  }
});

// POST /api/activity/heartbeat — update session last active time
router.post("/heartbeat", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ error: "sessionToken required" });
    const ipAddress = getClientIp(req);
    const locationLabel = getLocationLabel(req, ipAddress);
    const { browserName, deviceType, userAgent } = parseUserAgent(req.headers["user-agent"]);

    const existing = await db.select().from(userSessions)
      .where(and(eq(userSessions.userId, userId), eq(userSessions.sessionToken, sessionToken)));
    if (existing.length > 0) {
      const sess = existing[0];
      const elapsedSeconds = Math.floor((Date.now() - sess.lastActiveAt.getTime()) / 1000);
      const newTotal = (sess.totalSeconds || 0) + Math.min(elapsedSeconds, 120); // cap at 2 min per heartbeat to avoid counting idle
      await db.update(userSessions)
        .set({ lastActiveAt: new Date(), endedAt: null, totalSeconds: newTotal, isActive: true, ipAddress, locationLabel, browserName, deviceType, userAgent })
        .where(eq(userSessions.id, sess.id));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// POST /api/activity/session/end — end a session
router.post("/session/end", requireAuth, async (req, res) => {
  try {
    const userId = getSignedUserIdOrThrow(req);
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ error: "sessionToken required" });
    const ipAddress = getClientIp(req);
    const locationLabel = getLocationLabel(req, ipAddress);
    const { browserName, deviceType, userAgent } = parseUserAgent(req.headers["user-agent"]);

    const existing = await db.select().from(userSessions)
      .where(and(eq(userSessions.userId, userId), eq(userSessions.sessionToken, sessionToken)));
    if (existing.length > 0) {
      const sess = existing[0];
      const elapsedSeconds = Math.floor((Date.now() - sess.lastActiveAt.getTime()) / 1000);
      const newTotal = (sess.totalSeconds || 0) + Math.min(elapsedSeconds, 120);
      await db.update(userSessions)
        .set({
          endedAt: new Date(),
          isActive: false,
          lastActiveAt: new Date(),
          totalSeconds: newTotal,
          ipAddress,
          locationLabel,
          browserName,
          deviceType,
          userAgent,
        })
        .where(eq(userSessions.id, sess.id));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// GET /api/activity/overview — super admin: all users with activity summary
router.get("/overview", requireSuperAdmin, async (_req, res) => {
  try {
    const now = Date.now();
    const onlineSince = now - ONLINE_WINDOW_MS;
    const rows = (await executeD1Sql(`
      SELECT
        u.id,
        u.username,
        u.full_name AS fullName,
        u.role,
        (SELECT COALESCE(SUM(s.total_seconds), 0) FROM user_sessions s WHERE s.user_id = u.id) AS totalSeconds,
        (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id) AS sessionsCount,
        (SELECT COUNT(*) FROM user_activity_logs a WHERE a.user_id = u.id) AS activityCount,
        (SELECT COUNT(*) FROM user_activity_logs a WHERE a.user_id = u.id AND lower(COALESCE(a.action, '') || ' ' || COALESCE(a.page, '') || ' ' || COALESCE(a.detail, '')) LIKE '%test%') AS testActivityCount,
        (SELECT COUNT(*) FROM user_activity_logs a WHERE a.user_id = u.id AND (lower(COALESCE(a.action, '') || ' ' || COALESCE(a.page, '') || ' ' || COALESCE(a.detail, '')) LIKE '%question-bank%' OR lower(COALESCE(a.action, '') || ' ' || COALESCE(a.page, '') || ' ' || COALESCE(a.detail, '')) LIKE '%question bank%' OR lower(COALESCE(a.action, '') || ' ' || COALESCE(a.page, '') || ' ' || COALESCE(a.detail, '')) LIKE '%questionbank%')) AS questionBankActivityCount,
        (SELECT s.last_active_at FROM user_sessions s WHERE s.user_id = u.id ORDER BY s.last_active_at DESC, s.id DESC LIMIT 1) AS lastActiveAt,
        (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id AND s.is_active = 1 AND s.last_active_at >= ${onlineSince} AND s.last_active_at <= ${now}) AS activeSessionCount,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', a.id,
            'user_id', a.user_id,
            'action', a.action,
            'page', a.page,
            'detail', a.detail,
            'created_at', a.created_at
          ))
          FROM (
            SELECT id, user_id, action, page, detail, created_at
            FROM user_activity_logs
            WHERE user_id = u.id
            ORDER BY created_at DESC, id DESC
            LIMIT 5
          ) a
        ), '[]') AS recentActivities
      FROM users u
      ORDER BY u.full_name ASC, u.id ASC
    `, [])).rows as Record<string, unknown>[];
    const result = rows.map((row) => {
      const lastActiveAt = toDate(row.lastActiveAt ?? row.last_active_at);
      const rawActivities = typeof row.recentActivities === "string" ? row.recentActivities : "[]";
      let recentActivities: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(rawActivities);
        recentActivities = Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
      } catch {
        recentActivities = [];
      }
      return {
        id: Number(row.id ?? 0),
        username: String(row.username ?? ""),
        fullName: String(row.fullName ?? ""),
        role: String(row.role ?? ""),
        totalSeconds: Number(row.totalSeconds ?? 0),
        sessionsCount: Number(row.sessionsCount ?? 0),
        activityCount: Number(row.activityCount ?? 0),
        testActivityCount: Number(row.testActivityCount ?? 0),
        questionBankActivityCount: Number(row.questionBankActivityCount ?? 0),
        lastActiveAt,
        isOnline: Number(row.activeSessionCount ?? 0) > 0,
        recentActivities,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("activity overview error:", err);
    res.status(500).json({ error: "Failed" });
  }
});

// GET /api/activity/user/:id — super admin: full activity log for one user
router.get("/user/:id", requireSuperAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    const [userRows, activitiesRows, sessionsRows, createdTestsRows, questionBankQuestionsRows, questionBankReportsRows] = await Promise.all([
      executeD1Sql(`SELECT id, username, full_name AS fullName, role FROM users WHERE id = ? LIMIT 1`, [userId]),
      executeD1Sql(`SELECT * FROM user_activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`, [userId]),
      executeD1Sql(`SELECT * FROM user_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 50`, [userId]),
      executeD1Sql(`SELECT * FROM tests WHERE created_by = ?`, [userId]),
      executeD1Sql(`SELECT * FROM question_bank_questions WHERE created_by = ?`, [userId]),
      executeD1Sql(`SELECT * FROM question_bank_reports WHERE teacher_id = ?`, [userId]),
    ]);
    const user = (userRows.rows as Record<string, unknown>[])[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    const activities = activitiesRows.rows as Record<string, unknown>[];
    const sessions = sessionsRows.rows as Record<string, unknown>[];
    const createdTests = createdTestsRows.rows as Record<string, unknown>[];
    const questionBankQuestions = questionBankQuestionsRows.rows as Record<string, unknown>[];
    const questionBankReports = questionBankReportsRows.rows as Record<string, unknown>[];
    const createdTestIds = createdTests.map((test) => Number(test.id ?? 0)).filter(Boolean);
    const testQuestions = createdTestIds.length > 0
      ? (await executeD1Sql(`SELECT * FROM test_questions WHERE test_id IN (${createdTestIds.map(() => "?").join(",")})`, createdTestIds)).rows as Record<string, unknown>[]
      : [];
    const openQuestionBankReports = questionBankReports.filter((report) => report.status === "open");

    res.json({
      user: { id: Number(user.id ?? 0), username: String(user.username ?? ""), fullName: String(user.fullName ?? ""), role: String(user.role ?? "") },
      totalSeconds: sessions.reduce((sum, s) => sum + Number(s.totalSeconds ?? s.total_seconds ?? 0), 0),
      sessions,
      activities,
      stats: {
        testsCreated: createdTests.length,
        testQuestionsCreated: testQuestions.length,
        questionBankQuestionsCreated: questionBankQuestions.length,
        reportedQuestionsReceived: questionBankReports.length,
        openReportedQuestions: openQuestionBankReports.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
