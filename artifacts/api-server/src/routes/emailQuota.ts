import { Router, type IRouter } from "express";
import { getBrevoProviderUsageSummary } from "../lib/brevo";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function requireSuperAdmin(req: any, res: any): boolean {
  const callerRole = req.cookies?.userRole;
  if (!callerRole) { res.status(401).json({ error: "Not authenticated" }); return false; }
  if (callerRole !== "super_admin") { res.status(403).json({ error: "Forbidden – super_admin only" }); return false; }
  return true;
}

const router: IRouter = Router();

function formatHourLabel(isoString: string) {
  return new Date(isoString).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

router.get("/api/email-quota", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const summary = await getBrevoProviderUsageSummary();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 6);
    last7Days.setHours(0, 0, 0, 0);

    const hourlyRows = await db.execute(sql`
      SELECT
        strftime('%Y-%m-%dT%H:00:00.000Z', sent_at / 1000, 'unixepoch') AS hour,
        COUNT(*) AS count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM email_send_logs
      WHERE sent_at >= ${todayStart}
      GROUP BY 1
      ORDER BY 1
    `);

    const dailyRows = await db.execute(sql`
      SELECT
        date(sent_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM email_send_logs
      WHERE sent_at >= ${last7Days}
      GROUP BY 1
      ORDER BY 1
    `);

    const hourlyData = (hourlyRows.rows as any[]).map((r) => ({
      hour: formatHourLabel(r.hour),
      sent: Number(r.count ?? 0),
      failed: Number(r.failed ?? 0),
    }));

    const dailyData = (dailyRows.rows as any[]).map((r) => ({
      day: r.day,
      sent: Number(r.count ?? 0),
      failed: Number(r.failed ?? 0),
    }));

    res.json({
      ...summary,
      hourlyToday: hourlyData,
      daily7Days: dailyData,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to fetch email quota" });
  }
});

export default router;
