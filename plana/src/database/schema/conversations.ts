import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  persona_name: text("persona_name").notNull().default("default"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
