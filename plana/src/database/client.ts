import { Database } from "bun:sqlite";

let shared: Database | null = null;
let sharedPath: string | null = null;

export function openDatabase(dbPath: string): Database {
  if (shared) {
    if (sharedPath !== dbPath) {
      throw new Error(
        `Database already open at "${sharedPath}"; cannot open "${dbPath}"`,
      );
    }
    return shared;
  }

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  shared = db;
  sharedPath = dbPath;
  return db;
}

/** Open a standalone connection (CLI tools). Caller must close. */
export function openStandalone(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function getDatabase(): Database {
  if (!shared) {
    throw new Error("Database not opened. Call openDatabase(path) first.");
  }
  return shared;
}

export function closeDatabase(): void {
  if (shared) {
    shared.close();
    shared = null;
    sharedPath = null;
  }
}
