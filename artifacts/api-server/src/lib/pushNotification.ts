import { db, notificationsTable, notificationPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendSSEToUser } from "./sseClients";

interface NotifData {
  userId: number;
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
}

const PREF_KEYS: Record<string, keyof typeof notificationPreferencesTable.$inferSelect> = {
  assignment: "assignment",
  grade: "grade",
  test: "test",
  class: "class",
  system: "system",
  community: "community",
  digest: "digest",
};

export async function pushNotification(data: NotifData): Promise<void> {
  try {
    // Check user preferences — if they've disabled this type, skip
    const prefKey = PREF_KEYS[data.type];
    if (prefKey) {
      const [pref] = await db
        .select()
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.userId, data.userId))
        .limit(1);
      if (pref && pref[prefKey] === false) return;
    }

    const [inserted] = await db
      .insert(notificationsTable)
      .values({
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message ?? null,
        link: data.link ?? null,
        isRead: false,
      })
      .returning();

    if (inserted) {
      sendSSEToUser(data.userId, "notification", {
        ...inserted,
        createdAt: inserted.createdAt?.toISOString() ?? null,
      });
    }
  } catch (err) {
    console.error("pushNotification error:", err);
  }
}

export async function pushNotificationToMany(
  userIds: number[],
  data: Omit<NotifData, "userId">
): Promise<void> {
  await Promise.all(userIds.map((userId) => pushNotification({ ...data, userId })));
}
