import { pgTable, serial, text, integer, boolean, timestamp, index } from "./sqlite";
import { usersTable } from "./users";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message"),
  link: text("link"),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("notifications_user_id_created_at_id_idx").on(t.userId, t.createdAt, t.id),
  index("notifications_user_id_is_read_id_idx").on(t.userId, t.isRead, t.id),
]);
