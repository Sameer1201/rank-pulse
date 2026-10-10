import { boolean, integer, pgTable, real, serial, text, timestamp } from "./sqlite";
import { usersTable } from "./users";

export const examTemplatesTable = pgTable("exam_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  examHeader: text("exam_header"),
  examSubheader: text("exam_subheader"),
  instructions: text("instructions"),
  durationMinutes: integer("duration_minutes").notNull().default(180),
  passingScore: integer("passing_score"),
  defaultPositiveMarks: real("default_positive_marks").notNull().default(1),
  defaultNegativeMarks: real("default_negative_marks").notNull().default(0),
  sections: text("sections").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  isLocked: boolean("is_locked").notNull().default(false),
  showInRegistration: boolean("show_in_registration").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ExamTemplate = typeof examTemplatesTable.$inferSelect;
