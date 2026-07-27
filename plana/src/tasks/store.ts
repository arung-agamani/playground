import { eq, and, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../database";
import { nowIso } from "../database/time";
import { encrypt, decrypt } from "../database/crypto";
import {
  taskCreateSchema,
  taskUpdateSchema,
  taskStatusSchema,
  parseOrError,
} from "../database/validation";

export type TaskStatus = "backlog" | "ready" | "in-progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface TaskRow {
  id: number;
  user_id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: string;
  notes: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
  archived: number;
  sprint: number;
}

const SORT_STATUS = sql`CASE status WHEN 'in-progress' THEN 1 WHEN 'ready' THEN 2 WHEN 'backlog' THEN 3 WHEN 'done' THEN 4 END`;
const SORT_PRIORITY = sql`CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END`;

export function createTaskStore(db: PostgresJsDatabase<typeof schema>) {
  function decodeRow(row: TaskRow): TaskRow {
    return {
      ...row,
      notes: decrypt(row.notes),
    };
  }

  async function create(params: {
    userId: string;
    title: string;
    priority?: TaskPriority;
    category?: string;
    notes?: string;
    deadline?: string;
  }): Promise<TaskRow> {
    const parsed = parseOrError(taskCreateSchema, params, "task.create");
    if (!parsed.ok) throw new Error(parsed.error);

    const ts = nowIso();
    const [row] = await db.insert(schema.tasks).values({
      user_id: parsed.data.userId,
      title: parsed.data.title,
      status: "backlog",
      priority: parsed.data.priority ?? "medium",
      category: parsed.data.category ?? "Other",
      notes: encrypt(parsed.data.notes ?? null),
      deadline: parsed.data.deadline ? sql`${parsed.data.deadline}::timestamp` : null,
      created_at: sql`${ts}::timestamp`,
      updated_at: sql`${ts}::timestamp`,
    }).returning();
    return decodeRow(row as unknown as TaskRow);
  }

  async function getById(id: number): Promise<TaskRow | null> {
    const [row] = await db.select().from(schema.tasks)
      .where(eq(schema.tasks.id, id)).limit(1);
    return row ? decodeRow(row as unknown as TaskRow) : null;
  }

  async function list(
    userId: string,
    filter?: { status?: string; priority?: string; category?: string },
  ): Promise<TaskRow[]> {
    const conditions = [
      eq(schema.tasks.user_id, userId),
      eq(schema.tasks.archived, 0),
    ];
    if (filter?.status) conditions.push(eq(schema.tasks.status, filter.status as TaskStatus));
    if (filter?.priority) conditions.push(eq(schema.tasks.priority, filter.priority as TaskPriority));
    if (filter?.category) conditions.push(eq(schema.tasks.category, filter.category));

    const rows = await db.select().from(schema.tasks)
      .where(and(...conditions))
      .orderBy(SORT_STATUS, SORT_PRIORITY, schema.tasks.created_at);
    return (rows as unknown as TaskRow[]).map(decodeRow);
  }

  async function move(id: number, status: TaskStatus): Promise<boolean> {
    const parsed = parseOrError(taskStatusSchema, status, "task.move");
    if (!parsed.ok) throw new Error(parsed.error);

    const [row] = await db.update(schema.tasks)
      .set({ status: parsed.data as TaskStatus, updated_at: sql`${nowIso()}::timestamp` })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.archived, 0)))
      .returning();
    return !!row;
  }

  async function update(
    id: number,
    fields: {
      title?: string;
      priority?: string;
      category?: string;
      notes?: string;
      deadline?: string;
    },
  ): Promise<boolean> {
    const parsed = parseOrError(taskUpdateSchema, fields, "task.update");
    if (!parsed.ok) throw new Error(parsed.error);

    const updateData: Record<string, unknown> = { updated_at: sql`${nowIso()}::timestamp` };
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
    if (parsed.data.notes !== undefined) updateData.notes = encrypt(parsed.data.notes);
    if (parsed.data.deadline !== undefined) updateData.deadline = parsed.data.deadline ? sql`${parsed.data.deadline}::timestamp` : null;

    const [row] = await db.update(schema.tasks)
      .set(updateData)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.archived, 0)))
      .returning();
    return !!row;
  }

  async function remove(id: number): Promise<boolean> {
    const [row] = await db.delete(schema.tasks)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.archived, 0)))
      .returning();
    return !!row;
  }

  async function sprintSet(userId: string, taskIds: number[]): Promise<string> {
    await db.update(schema.tasks)
      .set({ sprint: 0 })
      .where(and(eq(schema.tasks.user_id, userId), eq(schema.tasks.sprint, 1)));

    let added = 0;
    for (const id of taskIds) {
      const task = await getById(id);
      if (task && task.user_id === userId && task.archived === 0) {
        await db.update(schema.tasks)
          .set({ sprint: 1, updated_at: sql`${nowIso()}::timestamp` })
          .where(eq(schema.tasks.id, id));
        added++;
      }
    }
    return `Sprint set with ${added} task(s).`;
  }

  async function sprintList(userId: string): Promise<TaskRow[]> {
    const rows = await db.select().from(schema.tasks)
      .where(and(
        eq(schema.tasks.user_id, userId),
        eq(schema.tasks.sprint, 1),
        eq(schema.tasks.archived, 0),
      ))
      .orderBy(SORT_STATUS, SORT_PRIORITY, schema.tasks.created_at);
    return (rows as unknown as TaskRow[]).map(decodeRow);
  }

  async function sprintClear(userId: string): Promise<void> {
    await db.update(schema.tasks)
      .set({ sprint: 0 })
      .where(and(eq(schema.tasks.user_id, userId), eq(schema.tasks.sprint, 1)));
  }

  async function archiveDone(userId: string): Promise<number> {
    const rows = await db.update(schema.tasks)
      .set({ archived: 1, updated_at: sql`${nowIso()}::timestamp` })
      .where(and(
        eq(schema.tasks.user_id, userId),
        eq(schema.tasks.status, "done"),
        eq(schema.tasks.archived, 0),
      ))
      .returning();
    return rows.length;
  }

  async function statusCounts(userId: string): Promise<Record<string, number>> {
    const rows = await db.select({
      status: schema.tasks.status,
      n: sql<number>`COUNT(*)::int`,
    }).from(schema.tasks)
      .where(and(eq(schema.tasks.user_id, userId), eq(schema.tasks.archived, 0)))
      .groupBy(schema.tasks.status);

    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.status] = r.n;
    }
    return counts;
  }

  async function upcomingDeadlines(userId: string): Promise<TaskRow[]> {
    const rows = await db.select().from(schema.tasks)
      .where(and(
        eq(schema.tasks.user_id, userId),
        sql`${schema.tasks.deadline} IS NOT NULL`,
        sql`${schema.tasks.deadline} >= ${nowIso()}::timestamp`,
        eq(schema.tasks.archived, 0),
        sql`${schema.tasks.status} != 'done'`,
      ))
      .orderBy(schema.tasks.deadline)
      .limit(5);
    return (rows as unknown as TaskRow[]).map(decodeRow);
  }

  function close(): void {}

  return {
    create,
    getById,
    list,
    move,
    update,
    remove,
    sprintSet,
    sprintList,
    sprintClear,
    archiveDone,
    statusCounts,
    upcomingDeadlines,
    close,
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;
