import { integer, pgTable, serial, text, timestamp } from "./sqlite";
import { usersTable } from "./users";

export const passwordResetRequestsTable = pgTable("password_reset_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  requestedUsername: text("requested_username").notNull(),
  requestedEmail: text("requested_email").notNull(),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PasswordResetRequest = typeof passwordResetRequestsTable.$inferSelect;
