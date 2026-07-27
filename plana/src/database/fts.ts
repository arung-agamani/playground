import type { Database } from "bun:sqlite";

/** Install incremental FTS5 sync triggers (external content mode). Idempotent. */
export function ensureFtsTriggers(
  db: Database,
  ftsTable: string,
  contentTable: string,
  columns: string[],
): void {
  const cols = columns.join(", ");
  const newCols = columns.map((c) => `new.${c}`).join(", ");
  const oldCols = columns.map((c) => `old.${c}`).join(", ");

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${ftsTable}_ai
    AFTER INSERT ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(rowid, ${cols}) VALUES (new.id, ${newCols});
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${ftsTable}_ad
    AFTER DELETE ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${cols})
      VALUES('delete', old.id, ${oldCols});
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${ftsTable}_au
    AFTER UPDATE ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${cols})
      VALUES('delete', old.id, ${oldCols});
      INSERT INTO ${ftsTable}(rowid, ${cols}) VALUES (new.id, ${newCols});
    END;
  `);
}

export function rebuildFts(db: Database, ftsTable: string): void {
  db.exec(`INSERT INTO ${ftsTable}(${ftsTable}) VALUES('rebuild')`);
}
