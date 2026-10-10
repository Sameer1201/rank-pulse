import { pgTable, serial, integer, timestamp } from "./sqlite";
import { usersTable } from "./users";
import { classesTable } from "./classes";

export const enrollmentsTable = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Enrollment = typeof enrollmentsTable.$inferSelect;
