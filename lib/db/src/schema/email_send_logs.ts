import { index, pgTable, serial, text, timestamp } from "./sqlite";

export const emailSendLogsTable = pgTable("email_send_logs", {
  id: serial("id").primaryKey(),
  providerKey: text("provider_key").notNull(),
  providerName: text("provider_name").notNull(),
  providerSource: text("provider_source").notNull().default("database"),
  senderEmail: text("sender_email").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  messageType: text("message_type").notNull().default("transactional"),
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  metadata: text("metadata"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("email_send_logs_recipient_email_sent_at_id_idx").on(t.recipientEmail, t.sentAt, t.id),
  index("email_send_logs_sent_at_id_idx").on(t.sentAt, t.id),
]);

export type EmailSendLog = typeof emailSendLogsTable.$inferSelect;
