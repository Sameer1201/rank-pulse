import { db, notificationsTable, notificationPreferencesTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { pushNotification } from "./pushNotification";

async function generateWeeklyDigests() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const prefs = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.weeklyDigest, true));

  for (const pref of prefs) {
    // Skip if digest was sent within the last 7 days
    if (pref.lastDigestAt && pref.lastDigestAt > weekAgo) continue;

    // Gather recent activity (excluding digest notifications themselves)
    const recentNotifs = await db
      .select({ id: notificationsTable.id, type: notificationsTable.type })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, pref.userId),
          gte(notificationsTable.createdAt, weekAgo)
        )
      );

    const nonDigest = recentNotifs.filter((n) => n.type !== "digest");
    if (nonDigest.length === 0) continue;

    // Aggregate by type
    const counts: Record<string, number> = {};
    for (const n of nonDigest) {
      counts[n.type] = (counts[n.type] || 0) + 1;
    }

    const summary = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${count} ${type} update${count !== 1 ? "s" : ""}`)
      .join(", ");

    await pushNotification({
      userId: pref.userId,
      type: "digest",
      title: "Your Weekly Activity Digest",
      message: `This week you had: ${summary}. Keep up the great work!`,
      link: "/activity",
    });

    await db
      .update(notificationPreferencesTable)
      .set({ lastDigestAt: new Date() })
      .where(eq(notificationPreferencesTable.userId, pref.userId));
  }
}

export function startDigestScheduler() {
  // Run every 6 hours
  setInterval(async () => {
    try {
      await generateWeeklyDigests();
    } catch (err) {
      console.error("Digest scheduler error:", err);
    }
  }, 6 * 60 * 60 * 1000);

  // Also run once at startup after a short delay
  setTimeout(async () => {
    try {
      await generateWeeklyDigests();
    } catch (err) {
      console.error("Digest scheduler startup error:", err);
    }
  }, 30_000);
}
