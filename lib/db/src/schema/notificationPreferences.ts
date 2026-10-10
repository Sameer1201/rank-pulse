import { pgTable, serial, integer, boolean, timestamp } from "./sqlite";
import { usersTable } from "./users";

export const notificationPreferencesTable = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull().unique(),
  assignment: boolean("assignment").default(true).notNull(),
  grade: boolean("grade").default(true).notNull(),
  test: boolean("test").default(true).notNull(),
  class: boolean("class").default(true).notNull(),
  system: boolean("system").default(true).notNull(),
  community: boolean("community").default(true).notNull(),
  digest: boolean("digest").default(true).notNull(),
  weeklyDigest: boolean("weekly_digest").default(true).notNull(),
  lastDigestAt: timestamp("last_digest_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type NotificationPreferences = typeof notificationPreferencesTable.$inferSelect;
