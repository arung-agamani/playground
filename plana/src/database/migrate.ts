/**
 * Migration runner:
 *  1. Apply pending SQLite SQL files from migrations/
 *  2. Optional: DATABASE_URL set → chunked copy SQLite → Postgres
 *
 * Usage:
 *   bun run src/database/migrate.ts [sqlite_path]
 *   DATABASE_URL=postgres://... bun run src/database/migrate.ts
 *   bun run src/database/migrate.ts --dry-run
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import postgres from "postgres";

const BATCH_SIZE = 500;
const migrationsDir = join(import.meta.dir, "migrations");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sqlitePath =
  args.find((a) => !a.startsWith("--")) ??
  join(import.meta.dir, "..", "..", "data", "plana.db");

const TABLES = [
  "conversations",
  "messages",
  "memories",
  "pinned_facts",
  "lore_entries",
  "reminders",
  "tasks",
] as const;

function listSqlFiles(): string[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _plana_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

function appliedSet(db: Database): Set<string> {
  const rows = db
    .query("SELECT id FROM _plana_migrations")
    .all() as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

export function applySqliteMigrations(
  db: Database,
  opts: { dryRun?: boolean } = {},
): string[] {
  ensureMigrationsTable(db);
  const applied = appliedSet(db);
  const files = listSqlFiles();
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    if (opts.dryRun) {
      console.log(`[dry-run] would apply ${file}`);
      ran.push(file);
      continue;
    }
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT INTO _plana_migrations (id, applied_at) VALUES (?, ?)",
      ).run(file, new Date().toISOString());
      db.exec("COMMIT");
      console.log(`Applied ${file}`);
      ran.push(file);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return ran;
}

export function countRows(db: Database, table: string): number {
  try {
    const row = db.query(`SELECT COUNT(*) as n FROM ${table}`).get() as {
      n: number;
    };
    return row.n;
  } catch {
    return 0;
  }
}

export function checksumSqlite(db: Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    out[t] = countRows(db, t);
  }
  return out;
}

export async function migrateToPostgres(
  sqlitePath: string,
  databaseUrl: string,
  opts: { dryRun?: boolean; batchSize?: number } = {},
): Promise<{ pre: Record<string, number>; post: Record<string, number> }> {
  if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    throw new Error(
      "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    );
  }

  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const sqlite = new Database(sqlitePath, { readonly: true });
  const pre = checksumSqlite(sqlite);

  console.log("SQLite row counts:", pre);

  if (opts.dryRun) {
    console.log("[dry-run] skip Postgres write");
    sqlite.close();
    return { pre, post: pre };
  }

  const sql = postgres(databaseUrl, { max: 5 });

  try {
    for (const table of TABLES) {
      const total = pre[table] ?? 0;
      if (total === 0) {
        console.log(`Skip empty table ${table}`);
        continue;
      }

      let offset = 0;
      while (offset < total) {
        const rows = sqlite
          .query(`SELECT * FROM ${table} LIMIT ? OFFSET ?`)
          .all(batchSize, offset) as Record<string, unknown>[];
        if (rows.length === 0) break;

        // Generic insert — columns from first row
        const cols = Object.keys(rows[0]!);
        const colList = cols.map((c) => `"${c}"`).join(", ");
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");

        for (const row of rows) {
          const values = cols.map((c) => row[c]);
          await sql.unsafe(
            `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values as postgres.ParameterOrJSON<never>[],
          );
        }

        offset += rows.length;
        console.log(`  ${table}: ${Math.min(offset, total)}/${total}`);
      }
    }

    const post: Record<string, number> = {};
    for (const table of TABLES) {
      const r = await sql.unsafe(`SELECT COUNT(*)::int as n FROM ${table}`);
      post[table] = (r[0] as { n: number }).n;
    }

    for (const table of TABLES) {
      if ((pre[table] ?? 0) !== (post[table] ?? 0)) {
        console.warn(
          `Row count mismatch on ${table}: sqlite=${pre[table]} pg=${post[table]}`,
        );
      }
    }

    console.log("Postgres row counts:", post);
    return { pre, post };
  } finally {
    await sql.end({ timeout: 5 });
    sqlite.close();
  }
}

// CLI entry
if (import.meta.main) {
  console.log(`SQLite path: ${sqlitePath}`);
  console.log(dryRun ? "Mode: dry-run" : "Mode: apply");

  if (!existsSync(migrationsDir) || listSqlFiles().length === 0) {
    console.log("No migration SQL files. Run `bun run db:generate` first.");
  } else {
    const db = new Database(sqlitePath);
    db.exec("PRAGMA journal_mode = WAL");
    const ran = applySqliteMigrations(db, { dryRun });
    if (ran.length === 0) console.log("No pending SQLite migrations.");
    const counts = checksumSqlite(db);
    console.log("Checksum:", counts);
    db.close();
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    console.log("DATABASE_URL present — running chunked SQLite → Postgres copy");
    await migrateToPostgres(sqlitePath, databaseUrl, { dryRun });
  } else if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL === "") {
    console.error("DATABASE_URL is set but empty.");
    process.exit(1);
  } else {
    console.log("No DATABASE_URL — SQLite only.");
  }
}
