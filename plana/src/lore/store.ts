import { Database } from "bun:sqlite";

export interface LoreRow {
  id: number;
  character_name: string;
  category: string;
  title: string;
  content: string;
  source: string;
}

export function createLoreStore(dbPath: string) {
  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS lore_entries (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      character_name TEXT NOT NULL,
      category       TEXT NOT NULL,
      title          TEXT NOT NULL,
      content        TEXT NOT NULL,
      source         TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS lore_fts USING fts5(
      character_name,
      category,
      title,
      content,
      content=lore_entries,
      content_rowid=id
    )
  `);

  const insertStmt = db.prepare(`
    INSERT INTO lore_entries (character_name, category, title, content, source)
    VALUES (?, ?, ?, ?, ?)
  `);

  const searchStmt = db.prepare(`
    SELECT lore_entries.*, bm25(lore_fts) as rank
    FROM lore_fts
    JOIN lore_entries ON lore_entries.id = lore_fts.rowid
    WHERE lore_fts MATCH ?
    ORDER BY rank
    LIMIT 5
  `);

  const clearStmt = db.prepare(`DELETE FROM lore_entries`);

  function insert(params: {
    characterName: string;
    category: string;
    title: string;
    content: string;
    source?: string;
  }): void {
    insertStmt.run(
      params.characterName,
      params.category,
      params.title,
      params.content,
      params.source ?? null,
    );
  }

  function search(query: string): Array<LoreRow & { rank: number }> {
    const ftsQuery = query.split(/\s+/).map((w) => `"${w}"`).join(" OR ");
    return searchStmt.all(ftsQuery) as Array<LoreRow & { rank: number }>;
  }

  function clear(): void {
    clearStmt.run();
    db.exec("INSERT INTO lore_fts(lore_fts) VALUES('rebuild')");
  }

  function rebuild(): void {
    db.exec("INSERT INTO lore_fts(lore_fts) VALUES('rebuild')");
  }

  function close(): void {
    db.close();
  }

  return { insert, search, clear, rebuild, close };
}

export type LoreStore = ReturnType<typeof createLoreStore>;
