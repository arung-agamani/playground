import { pgTable, text, serial, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    guild_id: text("guild_id").notNull(),
    channel_id: text("channel_id").notNull(),
    user_id: text("user_id").notNull(),
    message: text("message").notNull(),
    action_type: text("action_type").notNull().default("remind"),
    action_config: text("action_config").notNull().default("{}"),
    type: text("type").notNull(),
    status: text("status").notNull().default("active"),
    due_at: timestamp("due_at").notNull(),
    recurrence: text("recurrence"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    completed_at: timestamp("completed_at"),
  },
  (t) => ({
    dueIdx: index("idx_reminders_due").on(t.status, t.due_at),
    channelIdx: index("idx_reminders_channel").on(t.channel_id, t.status),
    actionTypeCheck: check("ck_reminders_action_type", sql`${t.action_type} IN ('remind','greeting','nudge')`),
    typeCheck: check("ck_reminders_type", sql`${t.type} IN ('once','recurring')`),
    statusCheck: check("ck_reminders_status", sql`${t.status} IN ('active','completed','cancelled')`),
  }),
);
