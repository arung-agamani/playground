import { Database } from "bun:sqlite";

export type MemoryTier = "lifetime" | "monthly" | "weekly" | "daily";

export interface MemoryRow {
  id: number;
  tier: MemoryTier;
  content: string;
  updated_at: string;
}

export interface FactRow {
  id: number;
  fact: string;
  source: string | null;
  confidence: number;
  created_at: string;
}

export function createMemoryStore(dbPath: string) {
  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tier       TEXT NOT NULL UNIQUE CHECK(tier IN ('lifetime','monthly','weekly','daily')),
      content    TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pinned_facts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      fact       TEXT NOT NULL,
      source     TEXT,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      tier,
      content,
      content=memories,
      content_rowid=id
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
      fact,
      content=pinned_facts,
      content_rowid=id
    )
  `);

  const upsertMemoryStmt = db.prepare(`
    INSERT INTO memories (tier, content, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(tier) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at
  `);

  const getMemoryStmt = db.prepare(`SELECT * FROM memories WHERE tier = ?`);
  const getAllMemoriesStmt = db.prepare(`SELECT * FROM memories ORDER BY tier`);
  const insertFactStmt = db.prepare(
    `INSERT INTO pinned_facts (fact, source, confidence) VALUES (?, ?, ?)`,
  );

  const searchMemoriesStmt = db.prepare(`
    SELECT memories.id, memories.tier, memories.content,
           bm25(memories_fts) as rank
    FROM memories_fts
    JOIN memories ON memories.id = memories_fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY rank
    LIMIT 5
  `);

  const searchFactsStmt = db.prepare(`
    SELECT pinned_facts.id, pinned_facts.fact, pinned_facts.confidence,
           bm25(facts_fts) as rank
    FROM facts_fts
    JOIN pinned_facts ON pinned_facts.id = facts_fts.rowid
    WHERE facts_fts MATCH ?
    ORDER BY rank
    LIMIT 5
  `);

  const getAllFactsStmt = db.prepare(
    `SELECT * FROM pinned_facts ORDER BY confidence DESC, created_at DESC`,
  );

  const deleteLowConfidenceStmt = db.prepare(
    `DELETE FROM pinned_facts WHERE confidence < ?`,
  );

  function upsertMemory(tier: MemoryTier, content: string): void {
    upsertMemoryStmt.run(tier, content);
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
  }

  function getMemory(tier: MemoryTier): string {
    const row = getMemoryStmt.get(tier) as MemoryRow | undefined;
    return row?.content ?? "";
  }

  function getAllMemories(): MemoryRow[] {
    return getAllMemoriesStmt.all() as MemoryRow[];
  }

  function buildMemoryBlock(): string {
    const rows = getAllMemories();
    if (rows.length === 0) return "";

    const include: MemoryTier[] = ["daily", "weekly"];
    const blocks = include
      .map((t) => rows.find((r) => r.tier === t))
      .filter((r): r is MemoryRow => !!r && r.content.length > 0);

    if (blocks.length === 0) return "";

    return blocks.map((r) => `[${r.tier}]: ${r.content}`).join("\n");
  }

  function insertFact(fact: string, source?: string, confidence = 0.5): void {
    insertFactStmt.run(fact, source ?? null, confidence);
    db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
  }

  function getAllFacts(): FactRow[] {
    return getAllFactsStmt.all() as FactRow[];
  }

  function searchMemories(query: string): Array<MemoryRow & { rank: number }> {
    const ftsQuery = query.split(/\s+/).map((w) => `"${w}"`).join(" OR ");
    return searchMemoriesStmt.all(ftsQuery) as Array<MemoryRow & { rank: number }>;
  }

  function searchFacts(query: string): Array<{ id: number; fact: string; confidence: number; rank: number }> {
    const ftsQuery = query.split(/\s+/).map((w) => `"${w}"`).join(" OR ");
    return searchFactsStmt.all(ftsQuery) as Array<{ id: number; fact: string; confidence: number; rank: number }>;
  }

  function cleanupFacts(minConfidence = 0.3): void {
    deleteLowConfidenceStmt.run(minConfidence);
    db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
  }

  function close(): void {
    db.close();
  }

  return {
    upsertMemory,
    getMemory,
    getAllMemories,
    buildMemoryBlock,
    insertFact,
    getAllFacts,
    searchMemories,
    searchFacts,
    cleanupFacts,
    close,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
