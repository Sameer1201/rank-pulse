import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index } from "./sqlite";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["student", "admin", "super_admin", "planner"] }).notNull().default("student"),
  status: text("status", { enum: ["pending", "approved", "rejected", "active"] }).notNull().default("pending"),
  priorityAccess: boolean("priority_access").notNull().default(false),
  phone: text("phone"),
  subject: text("subject"),
  additionalExams: jsonb("additional_exams").$type<string[]>().notNull().default([]),
  reviewBucketDismissedQuestionIds: jsonb("review_bucket_dismissed_question_ids").$type<number[]>().notNull().default([]),
  avatarUrl: text("avatar_url"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  studentProfileData: text("student_profile_data"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastPasswordResetEmailAt: timestamp("last_password_reset_email_at", { withTimezone: true }),
  reviewedById: integer("reviewed_by_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedById: integer("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  pendingReviewStartedAt: timestamp("pending_review_started_at", { withTimezone: true }),
  pendingReviewEscalatedAt: timestamp("pending_review_escalated_at", { withTimezone: true }),
  emailOptOut: boolean("email_opt_out").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("users_lower_email_idx").on(sql`lower(${t.email})`),
  index("users_lower_username_idx").on(sql`lower(${t.username})`),
  index("users_created_at_id_idx").on(t.createdAt, t.id),
  index("users_full_name_id_idx").on(t.fullName, t.id),
  index("users_role_full_name_id_idx").on(t.role, t.fullName, t.id),
  index("users_role_created_at_id_idx").on(t.role, t.createdAt, t.id),
  index("users_role_status_created_at_id_idx").on(t.role, t.status, t.createdAt, t.id),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
