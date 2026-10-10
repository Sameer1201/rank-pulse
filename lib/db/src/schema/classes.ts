import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index } from "./sqlite";
import { usersTable } from "./users";

export const classesTable = pgTable("classes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  subject: text("subject"),
  workflowType: text("workflow_type").notNull().default("question_bank"),
  adminId: integer("admin_id").references(() => usersTable.id, { onDelete: "set null" }),
  plannerId: integer("planner_id").references(() => usersTable.id, { onDelete: "set null" }),
  assignedTeacherIds: jsonb("assigned_teacher_ids").$type<number[]>().notNull().default([]),
  status: text("status").notNull().default("scheduled"),
  isLocked: boolean("is_locked").default(false),
  weeklyTargetQuestions: integer("weekly_target_questions"),
  weeklyTargetDeadline: text("weekly_target_deadline"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  maxStudents: integer("max_students"),
  meetingLink: text("meeting_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("classes_workflow_type_title_id_idx").on(t.workflowType, t.title, t.id),
]);
