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
  nature: "persistent" | "temporal";
  freshness: number;
  revision: number;
  created_at: string;
  updated_at: string;
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

  // ── Migration: add nature, freshness, revision, updated_at ────

  const cols = db.query("PRAGMA table_info(pinned_facts)").all() as Array<{ name: string }>;
  const hasFreshness = cols.some((c) => c.name === "freshness");

  if (!hasFreshness) {
    db.exec("BEGIN");
    db.exec("ALTER TABLE pinned_facts RENAME TO pinned_facts_old");
    db.exec(`
      CREATE TABLE pinned_facts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fact       TEXT NOT NULL,
        source     TEXT,
        confidence REAL NOT NULL DEFAULT 0.5,
        nature     TEXT NOT NULL DEFAULT 'temporal'
                   CHECK(nature IN ('persistent', 'temporal')),
        freshness  REAL NOT NULL DEFAULT 0.5,
        revision   INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      INSERT INTO pinned_facts (id, fact, source, confidence, nature, freshness, revision, created_at, updated_at)
      SELECT id, fact, source, confidence, 'temporal', 0.5, 1, created_at, datetime('now')
      FROM pinned_facts_old
    `);
    db.exec("DROP TABLE pinned_facts_old");
    db.exec("DROP TABLE IF EXISTS facts_fts");
    db.exec(`
      CREATE VIRTUAL TABLE facts_fts USING fts5(
        fact,
        content=pinned_facts,
        content_rowid=id
      )
    `);
    db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
    db.exec("COMMIT");
    console.log("Migrated pinned_facts: added nature/freshness/revision, default temporal 0.5");
  }

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

  const insertFactStmt = db.prepare(`
    INSERT INTO pinned_facts (fact, source, confidence, nature, freshness)
    VALUES (?, ?, ?, ?, ?)
  `);

  const searchFactDupStmt = db.prepare(`
    SELECT pinned_facts.id, pinned_facts.fact, pinned_facts.confidence,
           pinned_facts.nature, pinned_facts.freshness, pinned_facts.revision,
           bm25(facts_fts) as rank
    FROM facts_fts
    JOIN pinned_facts ON pinned_facts.id = facts_fts.rowid
    WHERE facts_fts MATCH ?
    ORDER BY rank
    LIMIT 1
  `);

  const updateFactStmt = db.prepare(`
    UPDATE pinned_facts
    SET fact = ?,
        confidence = ?,
        nature = ?,
        freshness = 1.0,
        revision = revision + 1,
        updated_at = datetime('now')
    WHERE id = ?
  `);

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
    `SELECT * FROM pinned_facts ORDER BY freshness DESC, confidence DESC, created_at DESC`,
  );

  const decayFactsStmt = db.prepare(`
    UPDATE pinned_facts
    SET freshness = MAX(0, freshness - 0.1),
        updated_at = datetime('now')
    WHERE nature = 'temporal' AND freshness > 0
  `);

  const cleanupFactsStmt = db.prepare(`
    DELETE FROM pinned_facts WHERE nature = 'temporal' AND freshness <= 0
  `);

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

  function insertFact(
    fact: string,
    options?: {
      source?: string;
      confidence?: number;
      nature?: "persistent" | "temporal";
    },
  ): { id: number; merged: boolean } {
    const nature = options?.nature ?? "temporal";
    const confidence = options?.confidence ?? 0.8;

    const ftsQuery = fact.split(/\s+/).map((w) => `"${w}"`).join(" OR ");
    const existing = searchFactDupStmt.get(ftsQuery) as {
      id: number;
      rank: number;
      fact: string;
      confidence: number;
      nature: string;
      freshness: number;
      revision: number;
    } | undefined;

    if (existing && existing.rank < -4) {
      const newConfidence = Math.max(existing.confidence, confidence);
      updateFactStmt.run(fact, newConfidence, nature, existing.id);
      db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
      return { id: existing.id, merged: true };
    }

    const result = insertFactStmt.run(
      fact,
      options?.source ?? null,
      confidence,
      nature,
      1.0,
    );
    db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
    return { id: Number(result.lastInsertRowid), merged: false };
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

  function decayAndCleanup(): { decayed: number; cleaned: number } {
    const decayResult = decayFactsStmt.run();
    const cleanResult = cleanupFactsStmt.run();
    if (decayResult.changes > 0 || cleanResult.changes > 0) {
      db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
    }
    return { decayed: decayResult.changes, cleaned: cleanResult.changes };
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
    decayAndCleanup,
    close,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
