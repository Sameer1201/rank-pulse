import { pgTable, text, serial, timestamp, integer, boolean, index } from "./sqlite";
import { usersTable } from "./users";

export const subjectsTable = pgTable("subjects", {
  id: serial("id").primaryKey(),
  classId: integer("class_id"),
  teacherId: integer("teacher_id").references(() => usersTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  isLocked: boolean("is_locked").notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("subjects_class_id_order_created_at_id_idx").on(t.classId, t.order, t.createdAt, t.id),
]);

export type Subject = typeof subjectsTable.$inferSelect;
