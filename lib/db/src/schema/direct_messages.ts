import { pgTable, serial, integer, text, timestamp, boolean } from "./sqlite";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const directMessagesTable = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  receiverId: integer("receiver_id").notNull().references(() => usersTable.id),
  content: text("content").notNull(),
  isReported: boolean("is_reported").notNull().default(false),
  reportReason: text("report_reason"),
  reportedAt: timestamp("reported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDirectMessageSchema = createInsertSchema(directMessagesTable).omit({ id: true, createdAt: true });
export type DirectMessage = typeof directMessagesTable.$inferSelect;
