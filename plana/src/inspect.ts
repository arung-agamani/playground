import { eq, sql } from "drizzle-orm";
import { loadConfig } from "./config";
import { createDb, closeDb } from "./db";
import * as schema from "./database";
import { decrypt } from "./database/crypto";

const appConfig = loadConfig();

const db = createDb(appConfig.databaseUrl!);

const args = process.argv.slice(2);
const command = args[0];
const arg1 = args[1];

const SECTION = "\u2500".repeat(60);

main()
  .catch(console.error)
  .finally(() => closeDb());

async function main() {
  switch (command) {
    case "db":
      await showDbOverview();
      break;
    case "reminders":
    case "rem":
      await showReminders(arg1);
      break;
    case "show":
      if (arg1) await showConversation(arg1);
      else showUsage();
      break;
    case "clean":
      if (arg1) await cleanConversation(arg1);
      else showUsage();
      break;
    case "list":
      await listConversations();
      break;
    default:
      await listConversations();
      break;
  }
}

async function showDbOverview() {
  const tables = [
    { name: "conversations", rel: schema.conversations },
    { name: "messages", rel: schema.messages },
    { name: "memories", rel: schema.memories },
    { name: "pinned_facts", rel: schema.pinnedFacts },
    { name: "lore_entries", rel: schema.loreEntries },
    { name: "reminders", rel: schema.reminders },
    { name: "tasks", rel: schema.tasks },
  ];

  console.log("Database Overview");
  console.log(SECTION);

  for (const t of tables) {
    const rows = await db.select({ n: sql`COUNT(*)::int` }).from(t.rel);
    console.log(`  ${t.name.padEnd(20)} ${(rows[0] as unknown as { n: number })?.n ?? 0} rows`);
  }

  console.log();
  console.log("Table Schemas:");
  console.log(SECTION);

  for (const t of tables) {
    const res = await db.execute(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = '${t.name}'
       ORDER BY ordinal_position`,
    );
    const cols = res as unknown as Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>;
    console.log(`  ${t.name}:`);
    for (const c of cols) {
      const flags: string[] = [];
      if (c.is_nullable === "NO") flags.push("NOT NULL");
      if (c.column_default) flags.push(`DEFAULT ${c.column_default}`);
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      console.log(
        `    ${c.column_name.padEnd(18)} ${(c.data_type || "\u2014").padEnd(12)}${flagStr}`,
      );
    }
    console.log();
  }
}

async function showReminders(idFilter?: string) {
  let reminders: Array<{
    id: number;
    channel_id: string;
    user_id: string;
    message: string;
    action_type: string;
    type: string;
    status: string;
    due_at: string;
    recurrence: string | null;
    created_at: string;
    completed_at: string | null;
  }>;

  if (idFilter) {
    const id = Number(idFilter);
    if (Number.isNaN(id)) {
      console.log(`Invalid reminder ID: ${idFilter}`);
      return;
    }
    const rows = await db.select().from(schema.reminders)
      .where(eq(schema.reminders.id, id)).limit(1);
    reminders = rows as unknown as typeof reminders;
  } else {
    const rows = await db.select().from(schema.reminders)
      .orderBy(schema.reminders.status, schema.reminders.due_at);
    reminders = rows as unknown as typeof reminders;
  }

  if (reminders.length === 0) {
    console.log("No reminders found.");
    return;
  }

  const statusCount: Record<string, number> = {};
  for (const r of reminders) {
    statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
  }

  console.log(
    `Reminders: ${reminders.length} (${Object.entries(statusCount)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")})`,
  );
  console.log(SECTION);

  for (const r of reminders) {
    const statusIcon =
      r.status === "active" ? "\u25CF" : r.status === "completed" ? "\u2713" : "\u2717";
    const typeLabel = r.recurrence
      ? `${r.type}(${r.recurrence})`
      : r.type;
    console.log(
      `  ${statusIcon} [#${String(r.id).padStart(2)}] ${r.status.padEnd(9)} ${typeLabel.padEnd(18)} due: ${r.due_at}`,
    );
    console.log(`      msg: "${decrypt(r.message) ?? r.message}"`);
    console.log(
      `      channel: ${shortId(r.channel_id)}  user: ${shortId(r.user_id)}  action: ${r.action_type}`,
    );
    console.log(
      `      created: ${r.created_at}${r.completed_at ? `  completed: ${r.completed_at}` : ""}`,
    );
    console.log();
  }
}

async function listConversations() {
  const rows = await db.execute(
    `SELECT c.id, c.updated_at, COUNT(m.id) as msg_count
     FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
  );

  const convos = rows as unknown as Array<{
    id: string;
    updated_at: string;
    msg_count: number;
  }>;

  if (convos.length === 0) {
    console.log("No conversations found.");
    return;
  }

  console.log("Conversations:");
  console.log(SECTION);
  for (const row of convos) {
    console.log(
      `  ${row.id}  (${row.msg_count} messages, last: ${row.updated_at})`,
    );
  }

  console.log();
  await showDbOverview();
}

async function showConversation(convoId: string) {
  const messages = await db.select()
    .from(schema.messages)
    .where(eq(schema.messages.conversation_id, convoId))
    .orderBy(schema.messages.id);

  const rows = messages as unknown as Array<{
    id: number;
    role: string;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    created_at: string;
  }>;

  if (rows.length === 0) {
    console.log(`No messages found for ${convoId}`);
    return;
  }

  let totalChars = 0;
  let corrupted = 0;

  console.log(`Conversation: ${convoId}`);
  console.log(`Messages: ${rows.length}`);
  console.log(SECTION);

  for (const msg of rows) {
    const plain = decrypt(msg.content);
    const plainTc = decrypt(msg.tool_calls);
    const contentLen = plain?.length ?? 0;
    totalChars += contentLen;
    if (plainTc) totalChars += plainTc.length;

    const contentPreview = plain
      ? plain.length > 100
        ? plain.slice(0, 100) + "\u2026"
        : plain
      : "null";

    const flags: string[] = [];
    if (plainTc) {
      try {
        const parsed = JSON.parse(plainTc);
        if (!Array.isArray(parsed)) {
          flags.push("CORRUPTED");
          corrupted++;
        }
      } catch {
        flags.push("BROKEN_JSON");
        corrupted++;
      }
      flags.push(`tc:[${truncate(plainTc, 50)}]`);
    }
    if (msg.tool_call_id) {
      flags.push(`tid:${msg.tool_call_id}`);
    }

    const charCount = String(plain?.length ?? 0) + "c";
    const flagStr = flags.length > 0 ? ` ${flags.join(" ")}` : "";

    console.log(
      `  [${String(msg.id).padStart(3)}] ${msg.role.padEnd(9)} (${charCount.padStart(5)}) ${contentPreview}${flagStr}`,
    );
  }

  const estimatedTokens = Math.ceil(totalChars / 4);
  console.log(SECTION);
  console.log(
    `Total: ~${totalChars} chars, ~${estimatedTokens} tokens` +
      (corrupted > 0 ? `, ${corrupted} CORRUPTED rows` : ""),
  );
  if (corrupted > 0) {
    console.log(
      `Run: bun inspect clean ${convoId}   (to clear corrupted data)`,
    );
  }
}

async function cleanConversation(_convoId: string) {
  console.log("Cleaning conversation messages is currently disabled for safety reasons.");
}

function showUsage() {
  console.log("Usage:");
  console.log("  bun inspect                        List conversations + DB overview");
  console.log("  bun inspect list                   List conversations");
  console.log("  bun inspect show <guild:channel>   Show conversation details");
  console.log("  bun inspect clean <guild:channel>  Clear conversation messages");
  console.log("  bun inspect reminders [id]         List reminders or show one by ID");
  console.log("  bun inspect db                     Show database overview + schemas");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\u2026";
}

function shortId(id: string): string {
  return id.slice(-8);
}
