import type { ReminderStore } from "../reminders/store";
import type { TaskStore } from "../tasks/store";
import type { TaskStatus } from "../tasks/store";
import type { MemoryStore } from "../memory/store";
import type { MemoryTier } from "../memory/store";
import type { LoreStore } from "../lore/store";
import { searchAll, rerankWithLlm } from "../memory/search";
import { parseWhen, parseRecurrence, formatDueAt } from "../reminders/parser";
import type { ToolContext } from "./registry";

export function createReminderTools(store: ReminderStore) {
  function create(ctx: ToolContext, args: Record<string, unknown>): string {
    const message = args.message as string;
    const when = args.when as string;
    const recurrenceStr = args.recurrence as string | undefined;

    if (!message?.trim()) return "Error: message is required.";
    if (!when?.trim()) return "Error: when is required.";

    let dueDate: Date;
    try {
      dueDate = parseWhen(when.trim(), ctx.defaultTimezone);
    } catch {
      return `Error: could not parse "${when}". Try "in 30 minutes", "tomorrow 3pm", "next Monday 9am", or ISO 8601 format.`;
    }

    const dueAt = dueDate.toISOString();

    if (dueDate <= new Date()) {
      return `Error: the time "${when}" is in the past. Please provide a future time.`;
    }

    let recurrence = null;
    if (recurrenceStr?.trim()) {
      const parsed = parseRecurrence(recurrenceStr.trim());
      if (!parsed) {
        return `Error: could not parse recurrence "${recurrenceStr}". Use: daily, weekly, monthly, weekday, weekend, weekly:mon,wed, or monthly:1,15.`;
      }
      recurrence = recurrenceStr.trim().toLowerCase();
    }

    const row = store.create({
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      userId: ctx.userId,
      message: message.trim(),
      type: recurrence ? "recurring" : "once",
      dueAt,
      recurrence,
    });

    const formatted = formatDueAt(dueAt, ctx.defaultTimezone);
    const typeLabel = recurrence ? ` (${recurrence})` : "";
    return [
      `Reminder created (id=${row.id}):`,
      `  Message: "${row.message}"`,
      `  When: ${formatted}${typeLabel}`,
      `  Status: active`,
    ].join("\n");
  }

  function edit(ctx: ToolContext, args: Record<string, unknown>): string {
    const id = args.reminder_id as number;
    const message = args.message as string | undefined;
    const when = args.when as string | undefined;

    if (!id) return "Error: reminder_id is required.";

    const existing = store.getById(id);
    if (!existing || existing.status !== "active") {
      return `Error: no active reminder found with id=${id}.`;
    }
    if (existing.channel_id !== ctx.channelId) {
      return `Error: reminder id=${id} belongs to a different channel.`;
    }

    let dueAt: string | undefined;
    if (when?.trim()) {
      try {
        const dueDate = parseWhen(when.trim(), ctx.defaultTimezone);
        dueAt = dueDate.toISOString();
      } catch {
        return `Error: could not parse "${when}".`;
      }
    }

    const success = store.update(id, {
      message: message?.trim() || undefined,
      dueAt,
    });

    if (!success) return `Error: could not update reminder id=${id}.`;

    const updated = store.getById(id);
    const formatted = updated ? formatDueAt(updated.due_at, ctx.defaultTimezone) : "unknown";
    return `Reminder id=${id} updated. Due: ${formatted}`;
  }

  function remove(_ctx: ToolContext, args: Record<string, unknown>): string {
    const id = args.reminder_id as number;
    if (!id) return "Error: reminder_id is required.";

    const success = store.cancel(id);
    if (!success) return `Error: no active reminder found with id=${id}.`;
    return `Reminder id=${id} cancelled.`;
  }

  function list(ctx: ToolContext): string {
    const reminders = store.getActive(ctx.channelId);
    if (reminders.length === 0) {
      return "No active reminders in this channel.";
    }

    const lines = reminders.map((r) => {
      const formatted = formatDueAt(r.due_at, ctx.defaultTimezone);
      const typeLabel = r.recurrence ? ` (${r.recurrence})` : "";
      return `[${r.id}] ${r.message} — ${formatted}${typeLabel}`;
    });

    return `${reminders.length} active reminder(s):\n${lines.join("\n")}`;
  }

  return { create, edit, remove, list };
}

export function createWebSearchTool(apiKey: string) {
  return async function webSearch(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    if (!query?.trim()) return "Error: query is required.";

    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: query.trim(),
          max_results: 3,
          include_answer: true,
        }),
      });

      if (!res.ok) {
        return `Web search failed (HTTP ${res.status}). Please try again later.`;
      }

      const data = (await res.json()) as {
        answer?: string;
        results?: Array<{ title: string; url: string; content: string }>;
      };

      const lines: string[] = [];

      if (data.answer) {
        lines.push(data.answer);
        lines.push("");
      }

      if (data.results && data.results.length > 0) {
        lines.push("Results:");
        for (let i = 0; i < data.results.length; i++) {
          const r = data.results[i]!;
          lines.push(`${i + 1}. ${r.title}`);
          lines.push(`   ${r.url}`);
          lines.push(`   ${r.content}`);
          lines.push("");
        }
      }

      if (lines.length === 0) {
        return "No results found for that query.";
      }

      return lines.join("\n").trim();
    } catch (error) {
      return `Web search error: ${error instanceof Error ? error.message : "unknown"}`;
    }
  };
}

export function createTaskTools(store: TaskStore) {
  function formatTask(t: {
    id: number;
    title: string;
    status: string;
    priority: string;
    category: string;
    notes: string | null;
    deadline: string | null;
  }): string {
    const parts = [
      `[${t.id}] ${t.title}`,
      `    status: ${t.status} | priority: ${t.priority} | category: ${t.category}`,
    ];
    if (t.notes) parts.push(`    notes: ${t.notes}`);
    if (t.deadline) parts.push(`    deadline: ${t.deadline}`);
    return parts.join("\n");
  }

  function add(ctx: ToolContext, args: Record<string, unknown>): string {
    const title = (args.title as string)?.trim();
    if (!title) return "Error: title is required.";

    const row = store.create({
      userId: ctx.userId,
      title,
      priority: (args.priority as string) ?? undefined,
      category: (args.category as string) ?? undefined,
      notes: (args.notes as string) ?? undefined,
      deadline: (args.deadline as string) ?? undefined,
    });

    return `Task added:\n${formatTask(row)}`;
  }

  function list(ctx: ToolContext, args: Record<string, unknown>): string {
    const filter: { status?: string; priority?: string; category?: string } = {};
    if (args.status) filter.status = args.status as string;
    if (args.priority) filter.priority = args.priority as string;
    if (args.category) filter.category = args.category as string;

    const tasks = store.list(ctx.userId, filter);

    if (tasks.length === 0) {
      const filterDesc = Object.entries(filter)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return filterDesc
        ? `No tasks found for filter: ${filterDesc}.`
        : "No tasks yet. Use add_task to create one.";
    }

    const counts = store.statusCounts(ctx.userId);
    const summary = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ");

    return [`Tasks (${summary}):`, ...tasks.map(formatTask)].join("\n");
  }

  function move(ctx: ToolContext, args: Record<string, unknown>): string {
    const id = args.task_id as number;
    const status = args.status as string;
    if (!id) return "Error: task_id is required.";
    if (!status) return "Error: status is required.";

    const valid = ["backlog", "ready", "in-progress", "done"];
    if (!valid.includes(status)) {
      return `Error: invalid status "${status}". Use: ${valid.join(", ")}`;
    }

    const task = store.getById(id);
    if (!task || task.user_id !== ctx.userId || task.archived) {
      return `Error: task #${id} not found.`;
    }

    const oldStatus = task.status;
    store.move(id, status as TaskStatus);
    return `"${task.title}" moved from ${oldStatus} → ${status}.`;
  }

  function edit(ctx: ToolContext, args: Record<string, unknown>): string {
    const id = args.task_id as number;
    if (!id) return "Error: task_id is required.";

    const task = store.getById(id);
    if (!task || task.user_id !== ctx.userId || task.archived) {
      return `Error: task #${id} not found.`;
    }

    const fields: Record<string, string> = {};
    if (args.title !== undefined) fields.title = args.title as string;
    if (args.priority !== undefined) fields.priority = args.priority as string;
    if (args.category !== undefined) fields.category = args.category as string;
    if (args.notes !== undefined) fields.notes = args.notes as string;
    if (args.deadline !== undefined) fields.deadline = args.deadline as string;

    if (Object.keys(fields).length === 0) {
      return "Error: at least one field to update is required.";
    }

    const success = store.update(id, fields);
    if (!success) return `Error: could not update task #${id}.`;

    const updated = store.getById(id)!;
    return `Task #${id} updated:\n${formatTask(updated)}`;
  }

  function remove(ctx: ToolContext, args: Record<string, unknown>): string {
    const id = args.task_id as number;
    if (!id) return "Error: task_id is required.";

    const task = store.getById(id);
    if (!task || task.user_id !== ctx.userId) {
      return `Error: task #${id} not found.`;
    }

    const title = task.title;
    store.remove(id);
    return `Task #${id} "${title}" deleted.`;
  }

  function sprint(ctx: ToolContext, args: Record<string, unknown>): string {
    const taskIds = args.task_ids as number[] | undefined;

    if (taskIds && taskIds.length > 0) {
      return store.sprintSet(ctx.userId, taskIds);
    }

    const tasks = store.sprintList(ctx.userId);
    if (tasks.length === 0) {
      return "Sprint is empty. Use sprint_set with task_ids to add tasks.";
    }

    return [`Sprint (${tasks.length} tasks):`, ...tasks.map(formatTask)].join(
      "\n",
    );
  }

  function sprintSet(ctx: ToolContext, args: Record<string, unknown>): string {
    const taskIds = args.task_ids as number[] | undefined;
    if (!taskIds || taskIds.length === 0) return store.sprintSet(ctx.userId, []);
    return store.sprintSet(ctx.userId, taskIds);
  }

  function sprintClear(ctx: ToolContext): string {
    store.sprintClear(ctx.userId);
    return "Sprint cleared.";
  }

  function archive(ctx: ToolContext): string {
    const n = store.archiveDone(ctx.userId);
    return n === 0
      ? "No completed tasks to archive."
      : `${n} completed task(s) archived.`;
  }

  function daily(ctx: ToolContext): string {
    const tasks = store.list(ctx.userId);
    const counts = store.statusCounts(ctx.userId);
    const deadlines = store.upcomingDeadlines(ctx.userId);

    const lines: string[] = [];
    lines.push("☀ Morning Digest");

    const summary = [
      `backlog: ${counts["backlog"] ?? 0}`,
      `ready: ${counts["ready"] ?? 0}`,
      `in-progress: ${counts["in-progress"] ?? 0}`,
      `done: ${counts["done"] ?? 0}`,
    ].join(" | ");
    lines.push(summary);

    const ready = tasks.filter((t) => t.status === "ready");
    if (ready.length > 0) {
      lines.push("");
      lines.push("Ready to start:");
      for (const t of ready.slice(0, 5)) {
        lines.push(`  [${t.id}] ${t.title} (${t.priority})`);
      }
    }

    const inProgress = tasks.filter((t) => t.status === "in-progress");
    if (inProgress.length > 0) {
      lines.push("");
      lines.push("In progress:");
      for (const t of inProgress) {
        lines.push(`  [${t.id}] ${t.title} (${t.priority})`);
      }
    }

    if (deadlines.length > 0) {
      lines.push("");
      lines.push("Upcoming deadlines:");
      for (const t of deadlines) {
        lines.push(
          `  [${t.id}] ${t.title} — ${t.deadline} (${t.status})`,
        );
      }
    }

    return lines.join("\n");
  }

  return { add, list, move, edit, remove, sprint, sprintSet, sprintClear, archive, daily };
}

export function createMemoryTools(
  memStore: MemoryStore,
  loreStore: LoreStore,
  opencodeBaseUrl: string,
  opencodeApiKey: string,
) {
  async function recallKnowledge(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    if (!query?.trim()) return "Error: query is required.";

    const { memories, facts, lore } = searchAll(
      memStore,
      loreStore,
      query.trim(),
    );

    const totalResults = memories.length + facts.length + lore.length;

    if (totalResults === 0) {
      console.error("  recall_knowledge: 0 results → returning empty");
      return "Nothing found matching that query in memories, facts, or lore.";
    }

    console.error(
      `  recall_knowledge: ${memories.length}m ${facts.length}f ${lore.length}l → ${totalResults} total`,
    );

    if (totalResults <= 5) {
      const lines: string[] = [];
      if (memories.length > 0) {
        lines.push("Memories:");
        memories.forEach((m) => lines.push(`  [${m.tier}] ${m.content}`));
      }
      if (facts.length > 0) {
        lines.push("Facts:");
        facts.forEach((f) => lines.push(`  - ${f}`));
      }
      if (lore.length > 0) {
        lines.push("Lore:");
        lore.forEach((l) => lines.push(`  [${l.character_name}] ${l.title}: ${l.content}`));
      }
      const result = lines.join("\n");
      console.error("  recall_knowledge: direct return (≤5) → length:", result.length);
      console.error("  recall_knowledge: result preview:", result.slice(0, 300));
      return result;
    }

    console.error("  recall_knowledge: reranking via LLM...");
    const reranked = await rerankWithLlm(
      query.trim(),
      memories,
      facts,
      lore,
      opencodeBaseUrl,
      opencodeApiKey,
    );

    console.error("  recall_knowledge: reranked length:", reranked.length, "| preview:", reranked.slice(0, 200));
    return reranked || "No relevant results found.";
  }

  function addFact(_ctx: ToolContext, args: Record<string, unknown>): string {
    const fact = args.fact as string;
    if (!fact?.trim()) return "Error: fact is required.";

    memStore.insertFact(fact.trim(), {
      source: "explicit",
      confidence: 0.9,
      nature: "persistent",
    });
    return `Fact recorded: "${fact.trim()}"`;
  }

  function saveMemory(_ctx: ToolContext, args: Record<string, unknown>): string {
    const memory = (args.memory as string)?.trim();
    if (!memory) return "Error: memory is required.";

    const tier = (args.tier as string)?.trim() || "daily";
    const validTiers: MemoryTier[] = ["daily", "weekly", "monthly", "lifetime"];
    const resolvedTier = validTiers.includes(tier as MemoryTier)
      ? (tier as MemoryTier)
      : "daily";

    const existing = memStore.getMemory(resolvedTier);
    const newContent = existing
      ? `${existing}\n${memory}`
      : memory;

    memStore.upsertMemory(resolvedTier, newContent);
    return `Saved to [${resolvedTier}] memory: "${memory}"`;
  }

  return { recallKnowledge, addFact, saveMemory };
}
