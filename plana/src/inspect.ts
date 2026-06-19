import { Database } from "bun:sqlite";
import { join } from "node:path";

interface MessageRow {
  id: number;
  conversation_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
}

const dbPath = join(import.meta.dir, "..", "data", "plana.db");
const db = new Database(dbPath);

const args = process.argv.slice(2);
const command = args[0];
const arg1 = args[1];

const SECTION = "─".repeat(60);

switch (command) {
  case "db":
    showDbOverview();
    break;
  case "reminders":
  case "rem":
    showReminders(arg1);
    break;
  case "show":
    if (arg1) showConversation(arg1);
    else showUsage();
    break;
  case "clean":
    if (arg1) cleanConversation(arg1);
    else showUsage();
    break;
  case "list":
    listConversations();
    break;
  default:
    listConversations();
    break;
}

// ── DB Overview ──────────────────────────────────────────

function showDbOverview() {
  const tables = db
    .query(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  console.log("Database Overview");
  console.log(SECTION);

  for (const t of tables) {
    const count = db
      .query(`SELECT COUNT(*) as n FROM "${t.name}"`)
      .get() as { n: number };
    console.log(`  ${t.name.padEnd(20)} ${count.n} rows`);
  }

  console.log();
  console.log("Table Schemas:");
  console.log(SECTION);

  for (const t of tables) {
    const cols = db
      .query(`PRAGMA table_info("${t.name}")`)
      .all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    console.log(`  ${t.name}:`);
    for (const c of cols) {
      const flags: string[] = [];
      if (c.pk) flags.push("PK");
      if (c.notnull) flags.push("NOT NULL");
      if (c.dflt_value) flags.push(`DEFAULT ${c.dflt_value}`);
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      console.log(
        `    ${c.name.padEnd(18)} ${(c.type || "—").padEnd(12)}${flagStr}`,
      );
    }
    console.log();
  }

  const dbSize = db.query("SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()").get() as { size: number };
  if (dbSize) {
    const kb = (dbSize.size / 1024).toFixed(1);
    console.log(`DB file size: ${kb} KB`);
  }
}

// ── Reminders ────────────────────────────────────────────

function showReminders(idFilter?: string) {
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
    const r = db
      .query(`SELECT * FROM reminders WHERE id = ?`)
      .get(id) as typeof reminders extends Array<infer T> ? T : never;
    reminders = r ? [r] : [];
  } else {
    reminders = db
      .query(
        `SELECT * FROM reminders ORDER BY status, due_at ASC`,
      )
      .all() as typeof reminders;
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
      r.status === "active" ? "●" : r.status === "completed" ? "✓" : "✗";
    const typeLabel = r.recurrence
      ? `${r.type}(${r.recurrence})`
      : r.type;
    console.log(
      `  ${statusIcon} [#${String(r.id).padStart(2)}] ${r.status.padEnd(9)} ${typeLabel.padEnd(18)} due: ${r.due_at}`,
    );
    console.log(`      msg: "${r.message}"`);
    console.log(
      `      channel: ${shortId(r.channel_id)}  user: ${shortId(r.user_id)}  action: ${r.action_type}`,
    );
    console.log(
      `      created: ${r.created_at}${r.completed_at ? `  completed: ${r.completed_at}` : ""}`,
    );
    console.log();
  }
}

// ── Conversations ────────────────────────────────────────

function listConversations() {
  const rows = db
    .query(
      `SELECT c.id, c.updated_at, COUNT(m.id) as msg_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
    )
    .all() as Array<{ id: string; updated_at: string; msg_count: number }>;

  if (rows.length === 0) {
    console.log("No conversations found.");
    return;
  }

  console.log("Conversations:");
  console.log(SECTION);
  for (const row of rows) {
    console.log(
      `  ${row.id}  (${row.msg_count} messages, last: ${row.updated_at})`,
    );
  }

  console.log();
  showDbOverview();
}

function showConversation(convoId: string) {
  const messages = db
    .query(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC`,
    )
    .all(convoId) as MessageRow[];

  if (messages.length === 0) {
    console.log(`No messages found for ${convoId}`);
    return;
  }

  let totalChars = 0;
  let corrupted = 0;

  console.log(`Conversation: ${convoId}`);
  console.log(`Messages: ${messages.length}`);
  console.log(SECTION);

  for (const msg of messages) {
    const contentLen = msg.content?.length ?? 0;
    totalChars += contentLen;
    if (msg.tool_calls) totalChars += msg.tool_calls.length;

    const contentPreview = msg.content
      ? msg.content.length > 100
        ? msg.content.slice(0, 100) + "…"
        : msg.content
      : "null";

    const flags: string[] = [];
    if (msg.tool_calls) {
      try {
        const parsed = JSON.parse(msg.tool_calls);
        if (!Array.isArray(parsed)) {
          flags.push("CORRUPTED");
          corrupted++;
        }
      } catch {
        flags.push("BROKEN_JSON");
        corrupted++;
      }
      flags.push(`tc:[${truncate(msg.tool_calls, 50)}]`);
    }
    if (msg.tool_call_id) {
      flags.push(`tid:${msg.tool_call_id}`);
    }

    const charCount = String(msg.content?.length ?? 0) + "c";
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

function cleanConversation(convoId: string) {
  console.log("Cleaning conversation messages is currently disabled for safety reasons.");
  // const result = db
  //   .query(`DELETE FROM messages WHERE conversation_id = ?`)
  //   .run(convoId);
  // console.log(
  //   `Cleared ${result.changes} messages from ${convoId}. Run /reset in Discord to fully reset.`,
  // );
}

// ── Helpers ──────────────────────────────────────────────

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
  return text.slice(0, maxLen) + "…";
}

function shortId(id: string): string {
  return id.slice(-8);
}

db.close();
