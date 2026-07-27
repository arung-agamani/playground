import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../database";

let client: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

export function createDb(connectionString: string): PostgresJsDatabase<typeof schema> {
  client = postgres(connectionString, { max: 5, idle_timeout: 30, connect_timeout: 10 });
  db = drizzle(client, { schema });
  return db;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) throw new Error("Database not initialized. Call createDb() first.");
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}
