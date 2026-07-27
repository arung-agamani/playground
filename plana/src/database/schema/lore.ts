import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const loreEntries = pgTable("lore_entries", {
  id: serial("id").primaryKey(),
  character_name: text("character_name").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  source: text("source"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
