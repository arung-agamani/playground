import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";
import { config } from "dotenv";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createDb, closeDb } from "../src/db";
import * as schema from "../src/database";
import { createStore } from "../src/conversation/store";
import { createMemoryStore } from "../src/memory/store";
import { createLoreStore } from "../src/lore/store";
import { createReminderStore } from "../src/reminders/store";
import { nowIso } from "../src/database/time";

config({ path: join(import.meta.dir, "..", ".env") });

const appConfig = loadConfig();
const sqlitePath = appConfig.dbPath;

console.log(`Migrating from: ${sqlitePath}`);
console.log(`Migrating to:   ${appConfig.databaseUrl}\n`);

const sqlite = new Database(sqlitePath);
const pg = createDb(appConfig.databaseUrl!);

// ── Date normalization ───────────────────────────────────

function normalizeDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;

  // Already ISO with Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    if (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s)) return s;
    return s + "Z";
  }

  // Space-separated: "2026-06-18 19:05:38" → ISO with Z
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return s.replace(" ", "T") + "Z";
  }

  // Space-separated without seconds: "2026-07-07 23:59"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
    return s.replace(" ", "T") + ":00Z";
  }

  // Date-only: "2026-06-28"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s + "T00:00:00.000Z";
  }

  // "Mon DD YYYY" e.g. "Jul 28 2026"
  const monDayYear = s.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})$/);
  if (monDayYear) {
    const d = new Date(`${monDayYear[1]} ${monDayYear[2]}, ${monDayYear[3]} UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // "today 2:00 PM"
  const todayMatch = s.match(/^today\s+(.+)$/i);
  if (todayMatch) {
    const parts = todayMatch[1].match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (parts) {
      let h = Number(parts[1]);
      const m = Number(parts[2]);
      if (/PM/i.test(parts[3]!) && h !== 12) h += 12;
      if (/AM/i.test(parts[3]!) && h === 12) h = 0;
      const today = new Date();
      today.setUTCHours(h, m, 0, 0);
      return today.toISOString();
    }
  }

  // "July 7" — assume this year
  const monthDay = s.match(/^([A-Z][a-z]+)\s+(\d{1,2})$/);
  if (monthDay) {
    const d = new Date(`${monthDay[1]} ${monthDay[2]}, ${new Date().getUTCFullYear()} UTC`);
    if (!Number.isNaN(d.getTime())) {
      if (d.getTime() < Date.now()) d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d.toISOString();
    }
  }

  console.warn(`  ⚠ WARNING: unrecognized date "${raw}" — storing as null`);
  return null;
}

// ── Migration ────────────────────────────────────────────

async function migrateConversations(): Promise<number> {
  const rows = sqlite.query("SELECT * FROM conversations ORDER BY id").all() as Array<{
    id: string; persona_name: string; created_at: string; updated_at: string;
  }>;

  for (const r of rows) {
    await pg.insert(schema.conversations).values({
      id: r.id,
      persona_name: r.persona_name,
      created_at: sql`${normalizeDate(r.created_at) ?? nowIso()}::timestamp`,
      updated_at: sql`${normalizeDate(r.updated_at) ?? nowIso()}::timestamp`,
    }).onConflictDoNothing({ target: schema.conversations.id });
  }
  return rows.length;
}

async function migrateMessages(): Promise<number> {
  const total = (
    sqlite.query("SELECT COUNT(*) as n FROM messages").get() as { n: number }
  ).n;
  const BATCH = 500;
  let migrated = 0;

  while (migrated < total) {
    const rows = sqlite.query(
      `SELECT * FROM messages ORDER BY id LIMIT ${BATCH} OFFSET ${migrated}`,
    ).all() as Array<{
      id: number; conversation_id: string; role: string;
      content: string | null; tool_calls: string | null;
      tool_call_id: string | null; created_at: string;
    }>;

    for (const r of rows) {
      await pg.insert(schema.messages).values({
        conversation_id: r.conversation_id,
        role: r.role,
        content: r.content,
        tool_calls: r.tool_calls,
        tool_call_id: r.tool_call_id,
      created_at: sql`${normalizeDate(r.created_at)}::timestamp`,
    });
    }

    migrated += rows.length;
    process.stdout.write(`\r  Messages: ${migrated}/${total}`);
  }
  console.log("");
  return migrated;
}

async function migrateMemories(): Promise<number> {
  const rows = sqlite.query("SELECT * FROM memories ORDER BY tier").all() as Array<{
    id: number; tier: string; content: string; updated_at: string;
  }>;
  const store = createMemoryStore(pg);
  for (const r of rows) {
    await store.upsertMemory(
      r.tier as "lifetime" | "monthly" | "weekly" | "daily",
      r.content,
    );
  }
  return rows.length;
}

async function migrateFacts(): Promise<number> {
  const rows = sqlite.query("SELECT * FROM pinned_facts ORDER BY id").all() as Array<{
    id: number; fact: string; source: string | null; confidence: number;
    nature: string; freshness: number; revision: number;
    created_at: string; updated_at: string;
  }>;

  for (const r of rows) {
    await pg.insert(schema.pinnedFacts).values({
      fact: r.fact,
      source: r.source,
      confidence: r.confidence,
      nature: r.nature,
      freshness: r.freshness,
      revision: r.revision,
      created_at: sql`${normalizeDate(r.created_at) ?? nowIso()}::timestamp`,
      updated_at: sql`${normalizeDate(r.updated_at) ?? nowIso()}::timestamp`,
    }).onConflictDoNothing({ target: schema.pinnedFacts.id });
  }
  return rows.length;
}

async function migrateLore(): Promise<number> {
  const rows = sqlite.query("SELECT * FROM lore_entries ORDER BY id").all() as Array<{
    id: number; character_name: string; category: string; title: string;
    content: string; source: string | null; created_at: string;
  }>;

  for (const r of rows) {
    await pg.insert(schema.loreEntries).values({
      character_name: r.character_name,
      category: r.category,
      title: r.title,
      content: r.content,
      source: r.source,
      created_at: sql`${normalizeDate(r.created_at) ?? nowIso()}::timestamp`,
    }).onConflictDoNothing({ target: schema.loreEntries.id });
  }
  return rows.length;
}

async function migrateReminders(): Promise<number> {
  const rows = sqlite.query("SELECT * FROM reminders ORDER BY id").all() as Array<{
    id: number; guild_id: string; channel_id: string; user_id: string;
    message: string; action_type: string; action_config: string;
    type: string; status: string; due_at: string; recurrence: string | null;
    created_at: string; updated_at: string; completed_at: string | null;
  }>;

  for (const r of rows) {
    await pg.insert(schema.reminders).values({
      guild_id: r.guild_id,
      channel_id: r.channel_id,
      user_id: r.user_id,
      message: r.message,
      action_type: r.action_type,
      action_config: r.action_config,
      type: r.type as "once" | "recurring",
      status: r.status,
      due_at: sql`${normalizeDate(r.due_at) ?? nowIso()}::timestamp`,
      recurrence: r.recurrence,
      created_at: sql`${normalizeDate(r.created_at) ?? nowIso()}::timestamp`,
      updated_at: sql`${normalizeDate(r.updated_at) ?? nowIso()}::timestamp`,
      completed_at: r.completed_at
        ? sql`${normalizeDate(r.completed_at)}::timestamp`
        : null,
    }).onConflictDoNothing({ target: schema.reminders.id });
  }
  return rows.length;
}

async function migrateTasks(): Promise<number> {
  const rows = sqlite.query("SELECT * FROM tasks ORDER BY id").all() as Array<{
    id: number; user_id: string; title: string; status: string;
    priority: string; category: string; notes: string | null;
    deadline: string | null; created_at: string; updated_at: string;
    archived: number; sprint: number;
  }>;

  for (const r of rows) {
    await pg.insert(schema.tasks).values({
      user_id: r.user_id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      category: r.category,
      notes: r.notes,
      deadline: r.deadline
        ? sql`${normalizeDate(r.deadline)}::timestamp`
        : null,
      created_at: sql`${normalizeDate(r.created_at) ?? nowIso()}::timestamp`,
      updated_at: sql`${normalizeDate(r.updated_at) ?? nowIso()}::timestamp`,
      archived: r.archived,
      sprint: r.sprint,
    }).onConflictDoNothing({ target: schema.tasks.id });
  }
  return rows.length;
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log("Starting SQLite → PostgreSQL data migration\n");

  const tables = [
    { name: "conversations", fn: migrateConversations },
    { name: "messages", fn: migrateMessages },
    { name: "memories", fn: migrateMemories },
    { name: "pinned_facts", fn: migrateFacts },
    { name: "lore_entries", fn: migrateLore },
    { name: "reminders", fn: migrateReminders },
    { name: "tasks", fn: migrateTasks },
  ];

  for (const { name, fn } of tables) {
    process.stdout.write(`  ${name}...`);
    const migrated = await fn();
    console.log(` ${migrated} rows`);
  }

  await closeDb();
  sqlite.close();
  console.log("\nMigration complete!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
