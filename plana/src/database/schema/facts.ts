import { pgTable, text, serial, timestamp, doublePrecision, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const pinnedFacts = pgTable(
  "pinned_facts",
  {
    id: serial("id").primaryKey(),
    fact: text("fact").notNull(),
    source: text("source"),
    confidence: doublePrecision("confidence").notNull().default(0.5),
    nature: text("nature").notNull().default("temporal"),
    freshness: doublePrecision("freshness").notNull().default(0.5),
    revision: integer("revision").notNull().default(1),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    natureCheck: check("ck_facts_nature", sql`${t.nature} IN ('persistent','temporal')`),
  }),
);
