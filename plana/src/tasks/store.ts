import { Database } from "bun:sqlite";

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

export function createTaskStore(dbPath: string) {
  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      title       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'backlog'
                  CHECK(status IN ('backlog', 'ready', 'in-progress', 'done')),
      priority    TEXT NOT NULL DEFAULT 'medium'
                  CHECK(priority IN ('low', 'medium', 'high', 'critical')),
      category    TEXT NOT NULL DEFAULT 'Other',
      notes       TEXT,
      deadline    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      archived    INTEGER NOT NULL DEFAULT 0,
      sprint      INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status
    ON tasks(user_id, status, archived)
  `);

  const insertStmt = db.prepare(`
    INSERT INTO tasks (user_id, title, status, priority, category, notes, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getByIdStmt = db.prepare(`SELECT * FROM tasks WHERE id = ?`);

  const listStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND archived = 0
    ORDER BY
      CASE status
        WHEN 'in-progress' THEN 1
        WHEN 'ready' THEN 2
        WHEN 'backlog' THEN 3
        WHEN 'done' THEN 4
      END,
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      created_at ASC
  `);

  const listByStatusStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND status = ? AND archived = 0
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1 WHEN 'high' THEN 2
        WHEN 'medium' THEN 3 WHEN 'low' THEN 4
      END,
      created_at ASC
  `);

  const listByPriorityStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND priority = ? AND archived = 0
    ORDER BY status, created_at ASC
  `);

  const listByCategoryStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND category = ? AND archived = 0
    ORDER BY status, priority, created_at ASC
  `);

  const listSprintStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND sprint = 1 AND archived = 0
    ORDER BY status, priority, created_at ASC
  `);

  const updateStmt = db.prepare(`
    UPDATE tasks
    SET title = COALESCE(?, title),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        category = COALESCE(?, category),
        notes = COALESCE(?, notes),
        deadline = COALESCE(?, deadline),
        updated_at = datetime('now')
    WHERE id = ? AND archived = 0
  `);

  const moveStmt = db.prepare(`
    UPDATE tasks SET status = ?, updated_at = datetime('now')
    WHERE id = ? AND archived = 0
  `);

  const deleteStmt = db.prepare(`
    DELETE FROM tasks WHERE id = ? AND archived = 0
  `);

  const archiveDoneStmt = db.prepare(`
    UPDATE tasks SET archived = 1, updated_at = datetime('now')
    WHERE user_id = ? AND status = 'done' AND archived = 0
  `);

  const setSprintStmt = db.prepare(`
    UPDATE tasks SET sprint = ?, updated_at = datetime('now')
    WHERE id = ? AND archived = 0
  `);

  const clearSprintStmt = db.prepare(`
    UPDATE tasks SET sprint = 0
    WHERE user_id = ? AND sprint = 1
  `);

  const countByStatusStmt = db.prepare(`
    SELECT status, COUNT(*) as n FROM tasks
    WHERE user_id = ? AND archived = 0
    GROUP BY status
  `);

  const upcomingDeadlinesStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND deadline IS NOT NULL AND deadline >= datetime('now') AND archived = 0 AND status != 'done'
    ORDER BY deadline ASC
    LIMIT 5
  `);

  function create(params: {
    userId: string;
    title: string;
    priority?: TaskPriority;
    category?: string;
    notes?: string;
    deadline?: string;
  }): TaskRow {
    const result = insertStmt.run(
      params.userId,
      params.title,
      "backlog",
      params.priority ?? "medium",
      params.category ?? "Other",
      params.notes ?? null,
      params.deadline ?? null,
    );
    return getByIdStmt.get(result.lastInsertRowid) as TaskRow;
  }

  function getById(id: number): TaskRow | null {
    return (getByIdStmt.get(id) as TaskRow) ?? null;
  }

  function list(userId: string, filter?: { status?: string; priority?: string; category?: string }): TaskRow[] {
    if (filter?.status) {
      return listByStatusStmt.all(userId, filter.status) as TaskRow[];
    }
    if (filter?.priority) {
      return listByPriorityStmt.all(userId, filter.priority) as TaskRow[];
    }
    if (filter?.category) {
      return listByCategoryStmt.all(userId, filter.category) as TaskRow[];
    }
    return listStmt.all(userId) as TaskRow[];
  }

  function move(id: number, status: TaskStatus): boolean {
    const result = moveStmt.run(status, id);
    return result.changes > 0;
  }

  function update(
    id: number,
    fields: { title?: string; priority?: string; category?: string; notes?: string; deadline?: string },
  ): boolean {
    const result = updateStmt.run(
      fields.title ?? null,
      null,
      fields.priority ?? null,
      fields.category ?? null,
      fields.notes ?? null,
      fields.deadline ?? null,
      id,
    );
    return result.changes > 0;
  }

  function remove(id: number): boolean {
    const result = deleteStmt.run(id);
    return result.changes > 0;
  }

  function sprintSet(userId: string, taskIds: number[]): string {
    clearSprintStmt.run(userId);
    let added = 0;
    for (const id of taskIds) {
      const task = getById(id);
      if (task && task.user_id === userId && task.archived === 0) {
        setSprintStmt.run(1, id);
        added++;
      }
    }
    return `Sprint set with ${added} task(s).`;
  }

  function sprintList(userId: string): TaskRow[] {
    return listSprintStmt.all(userId) as TaskRow[];
  }

  function sprintClear(userId: string): void {
    clearSprintStmt.run(userId);
  }

  function archiveDone(userId: string): number {
    const result = archiveDoneStmt.run(userId);
    return result.changes;
  }

  function statusCounts(userId: string): Record<string, number> {
    const rows = countByStatusStmt.all(userId) as Array<{ status: string; n: number }>;
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.status] = r.n;
    }
    return counts;
  }

  function upcomingDeadlines(userId: string): TaskRow[] {
    return upcomingDeadlinesStmt.all(userId) as TaskRow[];
  }

  function close(): void {
    db.close();
  }

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
