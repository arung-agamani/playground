import { eq, and, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../database";
import { nowIso } from "../database/time";
import { encrypt, decrypt } from "../database/crypto";
import { reminderCreateSchema, parseOrError } from "../database/validation";

export type ActionType = "remind" | "greeting" | "nudge";
export type ReminderStatus = "active" | "completed" | "cancelled";

export interface ReminderRow {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  message: string;
  action_type: ActionType;
  action_config: string;
  type: "once" | "recurring";
  status: ReminderStatus;
  due_at: string;
  recurrence: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function createReminderStore(db: PostgresJsDatabase<typeof schema>) {
  function decodeRow(row: Record<string, unknown>): ReminderRow {
    return {
      id: row.id as number,
      guild_id: row.guild_id as string,
      channel_id: row.channel_id as string,
      user_id: row.user_id as string,
      message: decrypt(row.message as string) ?? (row.message as string),
      action_type: row.action_type as ActionType,
      action_config: row.action_config as string,
      type: row.type as "once" | "recurring",
      status: row.status as ReminderStatus,
      due_at: row.due_at instanceof Date ? row.due_at.toISOString() : (row.due_at as string),
      recurrence: row.recurrence as string | null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at as string),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at as string),
      completed_at: row.completed_at instanceof Date ? row.completed_at.toISOString() : (row.completed_at as string | null),
    };
  }

  async function create(params: {
    guildId: string;
    channelId: string;
    userId: string;
    message: string;
    actionType?: ActionType;
    actionConfig?: Record<string, unknown>;
    type: "once" | "recurring";
    dueAt: string;
    recurrence?: string | null;
  }): Promise<ReminderRow> {
    const parsed = parseOrError(reminderCreateSchema, params, "reminder.create");
    if (!parsed.ok) throw new Error(parsed.error);

    const ts = nowIso();
    const [row] = await db.insert(schema.reminders).values({
      guild_id: parsed.data.guildId,
      channel_id: parsed.data.channelId,
      user_id: parsed.data.userId,
      message: encrypt(parsed.data.message) ?? parsed.data.message,
      action_type: parsed.data.actionType ?? "remind",
      action_config: parsed.data.actionConfig
        ? JSON.stringify(parsed.data.actionConfig)
        : "{}",
      type: parsed.data.type,
      due_at: sql`${parsed.data.dueAt}::timestamp`,
      recurrence: parsed.data.recurrence ?? null,
      created_at: sql`${ts}::timestamp`,
      updated_at: sql`${ts}::timestamp`,
    }).returning();
    return decodeRow(row as unknown as ReminderRow);
  }

  async function getDue(): Promise<ReminderRow[]> {
    const ts = nowIso();
    const rows = await db.select().from(schema.reminders)
      .where(and(
        eq(schema.reminders.status, "active"),
        sql`${schema.reminders.due_at} <= ${ts}::timestamp`,
      ))
      .orderBy(schema.reminders.due_at);
    return (rows as unknown as ReminderRow[]).map(decodeRow);
  }

  async function getActive(channelId: string): Promise<ReminderRow[]> {
    const rows = await db.select().from(schema.reminders)
      .where(and(
        eq(schema.reminders.channel_id, channelId),
        eq(schema.reminders.status, "active"),
      ))
      .orderBy(schema.reminders.due_at);
    return (rows as unknown as ReminderRow[]).map(decodeRow);
  }

  async function getById(id: number): Promise<ReminderRow | null> {
    const [row] = await db.select().from(schema.reminders)
      .where(eq(schema.reminders.id, id)).limit(1);
    return row ? decodeRow(row as unknown as ReminderRow) : null;
  }

  async function update(
    id: number,
    updates: { message?: string; dueAt?: string; recurrence?: string | null },
  ): Promise<boolean> {
    const updateData: Record<string, unknown> = { updated_at: sql`${nowIso()}::timestamp` };
    if (updates.message !== undefined) updateData.message = encrypt(updates.message) ?? updates.message;
    if (updates.dueAt !== undefined) updateData.due_at = sql`${updates.dueAt}::timestamp`;
    if (updates.recurrence !== undefined) updateData.recurrence = updates.recurrence;

    const [row] = await db.update(schema.reminders)
      .set(updateData)
      .where(and(eq(schema.reminders.id, id), eq(schema.reminders.status, "active")))
      .returning();
    return !!row;
  }

  async function complete(id: number): Promise<void> {
    const ts = nowIso();
    await db.update(schema.reminders)
      .set({ status: "completed", completed_at: sql`${ts}::timestamp`, updated_at: sql`${ts}::timestamp` })
      .where(eq(schema.reminders.id, id));
  }

  async function cancel(id: number): Promise<boolean> {
    const [row] = await db.update(schema.reminders)
      .set({ status: "cancelled", updated_at: sql`${nowIso()}::timestamp` })
      .where(and(eq(schema.reminders.id, id), eq(schema.reminders.status, "active")))
      .returning();
    return !!row;
  }

  async function reschedule(id: number, nextDueAt: string): Promise<void> {
    await db.update(schema.reminders)
      .set({ due_at: sql`${nextDueAt}::timestamp`, updated_at: sql`${nowIso()}::timestamp` })
      .where(eq(schema.reminders.id, id));
  }

  function close(): void {}

  return {
    create,
    getDue,
    getActive,
    getById,
    update,
    complete,
    cancel,
    reschedule,
    close,
  };
}

export type ReminderStore = ReturnType<typeof createReminderStore>;
