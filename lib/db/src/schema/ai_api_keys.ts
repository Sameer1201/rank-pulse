import { pgTable, text, integer, boolean, timestamp } from "./sqlite";

export type AiProvider =
  | "openrouter" | "openai" | "anthropic" | "google" | "groq"
  | "nvidia" | "mistral" | "codestral" | "huggingface"
  | "vercel" | "kilo" | "opencodezen" | "cerebras" | "cohere";

export const aiApiKeysTable = pgTable("ai_api_keys", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  provider: text("provider").notNull().default("openrouter"),
  priority: integer("priority").notNull().default(0),
  limitExhausted: boolean("limit_exhausted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiApiKey = typeof aiApiKeysTable.$inferSelect;
