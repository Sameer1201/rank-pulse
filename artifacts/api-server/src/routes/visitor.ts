import { Router, type IRouter } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureSettings() {
  const existing = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.id, 1));
  if (existing.length === 0) {
    await db.insert(platformSettingsTable).values({ id: 1 });
  }
}

router.post("/visitor/ping", async (req, res): Promise<void> => {
  try {
    await ensureSettings();
    const today = todayISO();
    const [row] = await db
      .select({ todayDate: platformSettingsTable.todayDate })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.id, 1));

    const isSameDay = row?.todayDate === today;

    await db
      .update(platformSettingsTable)
      .set({
        totalVisitors: sql`${platformSettingsTable.totalVisitors} + 1`,
        todayVisitors: isSameDay
          ? sql`${platformSettingsTable.todayVisitors} + 1`
          : 1,
        todayDate: today,
      })
      .where(eq(platformSettingsTable.id, 1));

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to record visit" });
  }
});

router.get("/visitor/stats", async (req, res): Promise<void> => {
  const callerRole = req.cookies?.userRole;
  if (!callerRole || !["admin", "super_admin"].includes(callerRole)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    await ensureSettings();
    const today = todayISO();
    const [row] = await db
      .select({
        totalVisitors: platformSettingsTable.totalVisitors,
        todayVisitors: platformSettingsTable.todayVisitors,
        todayDate: platformSettingsTable.todayDate,
      })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.id, 1));

    const todayVisitors = row?.todayDate === today ? (row?.todayVisitors ?? 0) : 0;

    res.json({
      totalVisitors: row?.totalVisitors ?? 0,
      todayVisitors,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
