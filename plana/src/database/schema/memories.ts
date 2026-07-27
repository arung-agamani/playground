import { pgTable, text, serial, timestamp, index, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    tier: text("tier").notNull(),
    content: text("content").notNull().default(""),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    tierIdx: index("idx_memories_tier").on(t.tier),
    tierUnique: uniqueIndex("uq_memories_tier").on(t.tier),
    tierCheck: check("ck_memories_tier", sql`${t.tier} IN ('lifetime','monthly','weekly','daily')`),
  }),
);
