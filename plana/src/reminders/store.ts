import { Database } from "bun:sqlite";

export type ActionType = "remind";

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
  completed_at: string | null;
}

export function createReminderStore(dbPath: string) {
  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id        TEXT NOT NULL,
      channel_id      TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      message         TEXT NOT NULL,
      action_type     TEXT NOT NULL DEFAULT 'remind'
                      CHECK(action_type IN ('remind')),
      action_config   TEXT NOT NULL DEFAULT '{}',
      type            TEXT NOT NULL CHECK(type IN ('once', 'recurring')),
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK(status IN ('active', 'completed', 'cancelled')),
      due_at          TEXT NOT NULL,
      recurrence      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    )
  `);

  const hasUpdatedAt = db
    .query("PRAGMA table_info(reminders)")
    .all()
    .some((r: unknown) => (r as Record<string, string>).name === "updated_at");

  if (!hasUpdatedAt) {
    db.exec("DROP TABLE IF EXISTS reminders");
    db.exec(`
      CREATE TABLE reminders (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id        TEXT NOT NULL,
        channel_id      TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        message         TEXT NOT NULL,
        action_type     TEXT NOT NULL DEFAULT 'remind'
                        CHECK(action_type IN ('remind')),
        action_config   TEXT NOT NULL DEFAULT '{}',
        type            TEXT NOT NULL CHECK(type IN ('once', 'recurring')),
        status          TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active', 'completed', 'cancelled')),
        due_at          TEXT NOT NULL,
        recurrence      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at    TEXT
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON reminders(status, due_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reminders_channel
    ON reminders(channel_id, status)
  `);

  const createStmt = db.prepare(`
    INSERT INTO reminders (guild_id, channel_id, user_id, message, action_type, action_config, type, due_at, recurrence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getDueStmt = db.prepare(`
    SELECT * FROM reminders
    WHERE status = 'active' AND datetime(due_at) <= datetime('now')
    ORDER BY due_at ASC
  `);

  const getActiveStmt = db.prepare(`
    SELECT * FROM reminders
    WHERE channel_id = ? AND status = 'active'
    ORDER BY due_at ASC
  `);

  const getByIdStmt = db.prepare(`
    SELECT * FROM reminders WHERE id = ?
  `);

  const updateStmt = db.prepare(`
    UPDATE reminders
    SET message = COALESCE(?, message),
        due_at = COALESCE(?, due_at),
        recurrence = COALESCE(?, recurrence),
        updated_at = datetime('now')
    WHERE id = ? AND status = 'active'
  `);

  const completeStmt = db.prepare(`
    UPDATE reminders
    SET status = 'completed', completed_at = datetime('now')
    WHERE id = ?
  `);

  const cancelStmt = db.prepare(`
    UPDATE reminders
    SET status = 'cancelled'
    WHERE id = ? AND status = 'active'
  `);

  const rescheduleStmt = db.prepare(`
    UPDATE reminders
    SET due_at = ?
    WHERE id = ?
  `);

  return {
    create(params: {
      guildId: string;
      channelId: string;
      userId: string;
      message: string;
      actionType?: ActionType;
      actionConfig?: Record<string, unknown>;
      type: "once" | "recurring";
      dueAt: string;
      recurrence?: string | null;
    }): ReminderRow {
      const result = createStmt.run(
        params.guildId,
        params.channelId,
        params.userId,
        params.message,
        params.actionType ?? "remind",
        params.actionConfig ? JSON.stringify(params.actionConfig) : "{}",
        params.type,
        params.dueAt,
        params.recurrence ?? null,
      );
      return getByIdStmt.get(result.lastInsertRowid) as ReminderRow;
    },

    getDue(): ReminderRow[] {
      return getDueStmt.all() as ReminderRow[];
    },

    getActive(channelId: string): ReminderRow[] {
      return getActiveStmt.all(channelId) as ReminderRow[];
    },

    getById(id: number): ReminderRow | null {
      return (getByIdStmt.get(id) as ReminderRow) ?? null;
    },

    update(
      id: number,
      updates: { message?: string; dueAt?: string; recurrence?: string | null },
    ): boolean {
      const result = updateStmt.run(
        updates.message ?? null,
        updates.dueAt ?? null,
        updates.recurrence ?? null,
        id,
      );
      return result.changes > 0;
    },

    complete(id: number): void {
      completeStmt.run(id);
    },

    cancel(id: number): boolean {
      const result = cancelStmt.run(id);
      return result.changes > 0;
    },

    reschedule(id: number, nextDueAt: string): void {
      rescheduleStmt.run(nextDueAt, id);
    },

    close(): void {
      db.close();
    },
  };
}

export type ReminderStore = ReturnType<typeof createReminderStore>;
