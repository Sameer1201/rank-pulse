import { pgTable, serial, integer, text, timestamp, boolean, index } from "../schema/sqlite";

export const userActivityLogs = pgTable("user_activity_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),
  page: text("page"),
  detail: text("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("user_activity_logs_user_id_created_at_id_idx").on(t.userId, t.createdAt, t.id),
]);

export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sessionToken: text("session_token").notNull(),
  ipAddress: text("ip_address"),
  locationLabel: text("location_label"),
  browserName: text("browser_name"),
  deviceType: text("device_type"),
  userAgent: text("user_agent"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  totalSeconds: integer("total_seconds").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
}, (t) => [
  index("user_sessions_is_active_idx").on(t.isActive),
  index("user_sessions_user_id_last_active_at_id_idx").on(t.userId, t.lastActiveAt, t.id),
  index("user_sessions_user_id_started_at_id_idx").on(t.userId, t.startedAt, t.id),
]);
