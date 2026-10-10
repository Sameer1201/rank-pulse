import { pgTable, text, integer, jsonb, timestamp } from "./sqlite";

export const metaSessionsTable = pgTable("meta_sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  testTitle: text("test_title"),
  fileNames: jsonb("file_names").notNull().$type<string[]>(),
  questionCount: integer("question_count").notNull(),
  rows: jsonb("rows").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MetaSession = typeof metaSessionsTable.$inferSelect;
