import { pgTable, text, serial, timestamp, integer, boolean, index } from "./sqlite";
import { subjectsTable } from "./subjects";

export const chaptersTable = pgTable("chapters", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id").notNull().references(() => subjectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  targetQuestions: integer("target_questions").notNull().default(0),
  isLocked: boolean("is_locked").notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("chapters_subject_id_order_created_at_id_idx").on(t.subjectId, t.order, t.createdAt, t.id),
]);

export type Chapter = typeof chaptersTable.$inferSelect;
