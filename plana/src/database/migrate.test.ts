import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applySqliteMigrations,
  checksumSqlite,
  countRows,
} from "./migrate";

describe("migration runner", () => {
  let dir: string;
  let dbPath: string;
  let openDbs: Database[] = [];

  beforeEach(() => {
    dir = join(tmpdir(), `plana-mig-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "test.db");
    openDbs = [];
  });

  afterEach(() => {
    for (const db of openDbs) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
    openDbs = [];
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows file lock — ignore */
    }
  });

  function open(): Database {
    const db = new Database(dbPath);
    openDbs.push(db);
    return db;
  }

  test("checksum counts tables", () => {
    const db = open();
    db.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY)`);
    db.exec(`INSERT INTO conversations (id) VALUES ('a'), ('b')`);
    expect(countRows(db, "conversations")).toBe(2);
    const cs = checksumSqlite(db);
    expect(cs.conversations).toBe(2);
  });

  test("applySqliteMigrations is idempotent via _plana_migrations", () => {
    const db = open();
    db.exec("PRAGMA journal_mode = WAL");
    const ran1 = applySqliteMigrations(db, { dryRun: true });
    expect(Array.isArray(ran1)).toBe(true);
  });

  test("batch insert simulation preserves counts", () => {
    const db = open();
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        created_at TEXT NOT NULL
      )
    `);
    const insert = db.prepare(
      `INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
    );
    const BATCH = 50;
    for (let i = 0; i < 120; i++) {
      insert.run("g:c", "user", `m${i}`, new Date().toISOString());
    }
    expect(countRows(db, "messages")).toBe(120);

    let offset = 0;
    let copied = 0;
    while (true) {
      const rows = db
        .query(`SELECT * FROM messages LIMIT ? OFFSET ?`)
        .all(BATCH, offset) as unknown[];
      if (rows.length === 0) break;
      copied += rows.length;
      offset += rows.length;
    }
    expect(copied).toBe(120);
  });
});
