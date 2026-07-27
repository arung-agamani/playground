import { pgTable, text, serial, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversation_id: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content"),
    tool_calls: text("tool_calls"),
    tool_call_id: text("tool_call_id"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    convoIdx: index("idx_messages_conversation").on(t.conversation_id, t.id),
    roleCheck: check("ck_messages_role", sql`${t.role} IN ('user','assistant','tool')`),
  }),
);
