import { pgTable, text, serial, timestamp, integer, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("backlog"),
    priority: text("priority").notNull().default("medium"),
    category: text("category").notNull().default("Other"),
    notes: text("notes"),
    deadline: timestamp("deadline"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    archived: integer("archived").notNull().default(0),
    sprint: integer("sprint").notNull().default(0),
  },
  (t) => ({
    userStatusIdx: index("idx_tasks_user_status").on(t.user_id, t.status, t.archived),
    statusCheck: check("ck_tasks_status", sql`${t.status} IN ('backlog','ready','in-progress','done')`),
    priorityCheck: check("ck_tasks_priority", sql`${t.priority} IN ('low','medium','high','critical')`),
  }),
);
