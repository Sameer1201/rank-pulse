import { boolean, date, integer, pgTable, timestamp } from "./sqlite";

export const platformSettingsTable = pgTable("platform_settings", {
  id: integer("id").primaryKey().default(1),
  studentReviewEmailEnabled: boolean("student_review_email_enabled").notNull().default(true),
  studentReviewEmailActionsEnabled: boolean("student_review_email_actions_enabled").notNull().default(true),
  registrationClosedUntil: timestamp("registration_closed_until", { withTimezone: true }),
  totalVisitors: integer("total_visitors").notNull().default(0),
  todayVisitors: integer("today_visitors").notNull().default(0),
  todayDate: date("today_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PlatformSettings = typeof platformSettingsTable.$inferSelect;
