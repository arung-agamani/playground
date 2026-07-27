import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../database";
import { nowIso } from "../database/time";
import { encrypt, decrypt } from "../database/crypto";
import { saveMessageSchema, parseOrError } from "../database/validation";

export interface MessageRow {
  id: number;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
}

export function createStore(db: PostgresJsDatabase<typeof schema>) {
  function convoKey(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  function decodeRow(row: Record<string, unknown>): MessageRow {
    return {
      id: row.id as number,
      conversation_id: row.conversation_id as string,
      role: row.role as MessageRow["role"],
      content: decrypt(row.content as string | null),
      tool_calls: decrypt(row.tool_calls as string | null),
      tool_call_id: row.tool_call_id as string | null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at as string),
    };
  }

  async function ensureConversation(guildId: string, channelId: string): Promise<void> {
    const key = convoKey(guildId, channelId);
    const ts = nowIso();
    await db.insert(schema.conversations).values({
      id: key,
      persona_name: "default",
      created_at: sql`${ts}::timestamp`,
      updated_at: sql`${ts}::timestamp`,
    }).onConflictDoUpdate({
      target: schema.conversations.id,
      set: { updated_at: sql`${ts}::timestamp` },
    });
  }

  async function saveMessage(
    guildId: string,
    channelId: string,
    role: "user" | "assistant" | "tool",
    content: string | null,
    toolCalls?: object | null,
    toolCallId?: string | null,
  ): Promise<void> {
    const parsed = parseOrError(
      saveMessageSchema,
      { role, content, toolCalls, toolCallId },
      "saveMessage",
    );
    if (!parsed.ok) throw new Error(parsed.error);

    const key = convoKey(guildId, channelId);
    const ts = nowIso();
    await ensureConversation(guildId, channelId);

    await db.insert(schema.messages).values({
      conversation_id: key,
      role: parsed.data.role,
      content: encrypt(parsed.data.content ?? null),
      tool_calls: parsed.data.toolCalls
        ? encrypt(JSON.stringify(parsed.data.toolCalls))
        : null,
      tool_call_id: parsed.data.toolCallId ?? null,
      created_at: sql`${ts}::timestamp`,
    });
  }

  async function getMessages(guildId: string, channelId: string): Promise<MessageRow[]> {
    const key = convoKey(guildId, channelId);
    const rows = await db.select().from(schema.messages)
      .where(eq(schema.messages.conversation_id, key))
      .orderBy(schema.messages.id);
    return (rows as unknown as MessageRow[]).map(decodeRow);
  }

  async function clearConversation(guildId: string, channelId: string): Promise<void> {
    const key = convoKey(guildId, channelId);
    await db.delete(schema.messages)
      .where(eq(schema.messages.conversation_id, key));
  }

  function close(): void {}

  return {
    convoKey,
    ensureConversation,
    saveMessage,
    getMessages,
    clearConversation,
    close,
  };
}

export type ConversationStore = ReturnType<typeof createStore>;
