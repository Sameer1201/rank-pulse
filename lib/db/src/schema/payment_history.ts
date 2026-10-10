import { pgTable, serial, integer, text, numeric, timestamp } from "./sqlite";
import { usersTable } from "./users";

export const paymentHistoryTable = pgTable("payment_history", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  feature: text("feature", { enum: ["tests", "analysis"] }).notNull().default("tests"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  orderId: text("order_id").notNull().default(""),
  paymentId: text("payment_id").notNull().default(""),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  cycle: integer("cycle").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentHistory = typeof paymentHistoryTable.$inferSelect;
export type InsertPaymentHistory = typeof paymentHistoryTable.$inferInsert;
