import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../database";
import { nowIso } from "../database/time";

export interface LoreRow {
  id: number;
  character_name: string;
  category: string;
  title: string;
  content: string;
  source: string;
}

export function createLoreStore(db: PostgresJsDatabase<typeof schema>) {
  async function insert(params: {
    characterName: string;
    category: string;
    title: string;
    content: string;
    source?: string;
  }): Promise<void> {
    await db.insert(schema.loreEntries).values({
      character_name: params.characterName,
      category: params.category,
      title: params.title,
      content: params.content,
      source: params.source ?? null,
      created_at: sql`${nowIso()}::timestamp`,
    });
  }

  async function search(query: string): Promise<Array<LoreRow & { rank: number }>> {
    const tsquery = query.split(/\s+/).map((w) => `${w}:*`).join(" & ");
    const rows = await db.execute(sql`
      SELECT id, character_name, category, title, content, source,
        ts_rank(
          to_tsvector('english', content || ' ' || coalesce(title, '')),
          to_tsquery('english', ${tsquery})
        ) as rank
      FROM ${schema.loreEntries}
      WHERE to_tsvector('english', content || ' ' || coalesce(title, ''))
        @@ to_tsquery('english', ${tsquery})
      ORDER BY rank DESC
      LIMIT 5
    `);
    return rows as unknown as Array<LoreRow & { rank: number }>;
  }

  async function clear(): Promise<void> {
    await db.delete(schema.loreEntries);
  }

  async function rebuild(): Promise<void> {
  }

  function close(): void {}

  return { insert, search, clear, rebuild, close };
}

export type LoreStore = ReturnType<typeof createLoreStore>;
