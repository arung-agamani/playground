import { Database } from "bun:sqlite";

export interface MessageRow {
  id: number;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
}

export function createStore(dbPath: string) {
  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id            TEXT PRIMARY KEY,
      persona_name  TEXT NOT NULL DEFAULT 'default',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role             TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
      content          TEXT,
      tool_calls       TEXT,
      tool_call_id     TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, id)
  `);

  const ensureConversation = db.prepare(`
    INSERT INTO conversations (id) VALUES (?)
    ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
  `);

  const insertMessage = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const loadMessages = db.prepare(`
    SELECT id, conversation_id, role, content, tool_calls, tool_call_id, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
  `);

  const deleteMessages = db.prepare(`
    DELETE FROM messages WHERE conversation_id = ?
  `);

  function convoKey(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  return {
    convoKey,

    ensureConversation(guildId: string, channelId: string): void {
      ensureConversation.run(convoKey(guildId, channelId));
    },

    saveMessage(
      guildId: string,
      channelId: string,
      role: "user" | "assistant" | "tool",
      content: string | null,
      toolCalls?: object | null,
      toolCallId?: string | null,
    ): void {
      const key = convoKey(guildId, channelId);
      ensureConversation.run(key);
      insertMessage.run(
        key,
        role,
        content,
        toolCalls ? JSON.stringify(toolCalls) : null,
        toolCallId ?? null,
      );
    },

    getMessages(guildId: string, channelId: string): MessageRow[] {
      const key = convoKey(guildId, channelId);
      return loadMessages.all(key) as MessageRow[];
    },

    clearConversation(guildId: string, channelId: string): void {
      const key = convoKey(guildId, channelId);
      deleteMessages.run(key);
    },

    close(): void {
      db.close();
    },
  };
}

export type ConversationStore = ReturnType<typeof createStore>;
