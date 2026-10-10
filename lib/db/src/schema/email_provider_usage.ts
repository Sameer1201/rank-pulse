import { integer, pgTable, serial, text, timestamp, unique } from "./sqlite";

export const emailProviderDailyUsageTable = pgTable("email_provider_daily_usage", {
  id: serial("id").primaryKey(),
  providerKey: text("provider_key").notNull(),
  usageDate: text("usage_date").notNull(),
  sentCount: integer("sent_count").notNull().default(0),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("email_provider_daily_usage_provider_date_unique").on(t.providerKey, t.usageDate),
]);

export type EmailProviderDailyUsage = typeof emailProviderDailyUsageTable.$inferSelect;
