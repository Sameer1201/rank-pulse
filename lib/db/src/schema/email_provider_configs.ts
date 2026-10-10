import { boolean, integer, pgTable, serial, text, timestamp, unique } from "./sqlite";

export const emailProviderConfigsTable = pgTable("email_provider_configs", {
  id: serial("id").primaryKey(),
  providerKey: text("provider_key").notNull(),
  providerName: text("provider_name").notNull(),
  providerType: text("provider_type").notNull().default("brevo"),
  apiKey: text("api_key").notNull(),
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name").notNull().default("Rank Pulse"),
  replyToEmail: text("reply_to_email"),
  replyToName: text("reply_to_name"),
  dailyLimit: integer("daily_limit").notNull().default(300),
  dailySoftLimit: integer("daily_soft_limit").notNull().default(250),
  isActive: boolean("is_active").notNull().default(true),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("email_provider_configs_provider_key_unique").on(t.providerKey),
]);

export type EmailProviderConfig = typeof emailProviderConfigsTable.$inferSelect;
