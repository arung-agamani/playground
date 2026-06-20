import type { Client, TextChannel } from "discord.js";
import type { ReminderStore } from "./store";
import { computeNextDue, parseRecurrence } from "./parser";
import { createOpenCodeClient } from "../llm/opencode";
import { compileSystemPrompt } from "../llm/prompts";
import type { ConversationStore } from "../conversation/store";
import type { MemoryStore } from "../memory/store";
import type { ToolRegistry } from "../tools/registry";
import { PROACTIVE_ALLOWED_TOOLS } from "../tools/registry";
import type { PersonaDefinition } from "../persona/types";
import { log } from "../debug";

type ActionContext = {
  client: Client;
  reminderStore: ReminderStore;
  convStore: ConversationStore;
  memStore: MemoryStore;
  persona: PersonaDefinition;
  toolRegistry: ToolRegistry;
  timezone: string;
  llmConfig: { baseUrl: string; apiKey: string; model: string };
};

type ActionHandler = (ctx: ActionContext, row: {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  message: string;
}) => Promise<void>;

const actionHandlers: Record<string, ActionHandler> = {
  async remind({ client, reminderStore }, row) {
    const channel = (await client.channels.fetch(row.channel_id)) as TextChannel | null;
    if (!channel) {
      log.warn(`Reminder channel not found: ${row.channel_id}`, { reminderId: row.id });
      return;
    }
    await channel.send({
      content: `🔔 <@${row.user_id}> — you asked me to remind you:\n> ${row.message}`,
      allowedMentions: { users: [row.user_id] },
    });
    log.info(`Reminder sent: id=${row.id} to ${row.channel_id} user=${row.user_id} msg="${row.message}"`);
  },

  async greeting(ctx, row) {
    const { client, convStore, memStore, persona, toolRegistry, timezone, llmConfig } = ctx;
    const llm = createOpenCodeClient(llmConfig.baseUrl, llmConfig.apiKey);
    const systemPrompt = compileSystemPrompt(persona);
    const memoryBlock = memStore.buildMemoryBlock();

    const hasRecentActivity = checkRecentActivity(convStore, row.guild_id, row.channel_id);
    if (hasRecentActivity) {
      log.info(`Greeting skipped: user was active recently in ${row.channel_id}`);
      return;
    }

    log.info(`Greeting: preparing morning message for ${row.channel_id}`);

    const messages = [
      { role: "system" as const, content: systemPrompt },
    ];
    if (memoryBlock) {
      messages.push({
        role: "system" as const,
        content: `MEMORIES ABOUT SENSEI:\n${memoryBlock}`,
      });
    }
    messages.push({
      role: "system" as const,
      content: [
        "PROACTIVE GREETING MODE",
        "",
        "It is morning and Sensei has not been active yet today.",
        "Greet them warmly in character. Check their tasks, reminders, and any upcoming deadlines.",
        "Provide a brief morning summary. Be warm but concise (under 3 paragraphs).",
        "",
        "You have read-only tools available. You may check the time, list tasks,",
        "list reminders, get the daily digest, search knowledge, or search the web.",
        "You may NOT create, edit, or delete anything — only report on current state.",
        "",
        "Begin your greeting now.",
      ].join("\n"),
    });

    try {
      const result = await llm.chat({
        model: llmConfig.model,
        messages,
        tools: filterProactiveTools(toolRegistry.definitions),
        maxToolIterations: 3,
      });

      let responseText = result.content;

      if (responseText === null && result.messages.length > messages.length) {
        const lastAsst = findLastAssistant(result.messages);
        const toolCalls = extractToolCalls(lastAsst);
        if (toolCalls.length > 0) {
          const toolResults = await executeProactiveTools(ctx, toolCalls, row);
          const followUpMessages = [...result.messages, ...toolResults];
          const followUp = await llm.chat({
            model: llmConfig.model,
            messages: followUpMessages,
          });
          responseText = followUp.content;
        }
      }

      if (responseText) {
        const clean = stripTimestamp(responseText);
        const channel = (await client.channels.fetch(row.channel_id)) as TextChannel | null;
        if (channel) {
          await channel.send(clean);
          convStore.saveMessage(row.guild_id, row.channel_id, "assistant", clean);
          log.info(`Greeting sent to ${row.channel_id}`);
        }
      }
    } catch (error) {
      log.error("Greeting handler error:", error);
    }
  },

  async nudge(ctx, row) {
    const { client, convStore } = ctx;
    const hasRecentActivity = checkRecentActivity(convStore, row.guild_id, row.channel_id);
    if (hasRecentActivity) {
      log.info(`Nudge skipped: user was active recently in ${row.channel_id}`);
      return;
    }

    const channel = (await client.channels.fetch(row.channel_id)) as TextChannel | null;
    if (!channel) return;

    await channel.send(`<@${row.user_id}> Sensei, I hope you are okay... I wanted to check in on you.`);
    convStore.saveMessage(row.guild_id, row.channel_id, "assistant", "Sensei, I hope you are okay... I wanted to check in on you.");
    log.info(`Nudge sent to ${row.channel_id}`);
  },
};

// ── Engine ──────────────────────────────────────────────

export interface EngineDeps {
  client: Client;
  reminderStore: ReminderStore;
  convStore: ConversationStore;
  memStore: MemoryStore;
  persona: PersonaDefinition;
  toolRegistry: ToolRegistry;
  timezone: string;
  llmConfig: { baseUrl: string; apiKey: string; model: string };
}

export function startReminderEngine(deps: EngineDeps, pollIntervalMs = 15_000) {
  const { client, reminderStore } = deps;
  let pollCount = 0;

  log.info(`Reminder engine: starting (poll=${pollIntervalMs}ms)...`);

  const dueNow = reminderStore.getDue();
  if (dueNow.length > 0) {
    log.info(`Reminder engine: startup — executing ${dueNow.length} pending action(s)`);
    for (const row of dueNow.slice(0, 50)) {
      executeAction(deps, row);
    }
  } else {
    log.info("Reminder engine: no pending actions on startup");
  }

  const timer = setInterval(() => {
    pollCount++;
    poll(deps);

    if (pollCount % 4 === 0) {
      log.debug(`Reminder engine: heartbeat (poll #${pollCount}, alive)`);
    }
  }, pollIntervalMs);

  log.info("Reminder engine: started");

  return {
    stop() {
      clearInterval(timer);
      log.info(`Reminder engine: stopped (${pollCount} polls total)`);
    },
  };
}

async function poll(deps: EngineDeps) {
  const dueReminders = deps.reminderStore.getDue();
  if (dueReminders.length > 0) {
    log.info(`Reminder engine: poll found ${dueReminders.length} due action(s)`);
  }
  for (const row of dueReminders) {
    await executeAction(deps, row);
  }
}

async function executeAction(deps: EngineDeps, row: {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  message: string;
  action_type: string;
  type: "once" | "recurring";
  due_at: string;
  recurrence: string | null;
}) {
  const handler = actionHandlers[row.action_type];
  if (!handler) {
    log.warn(`Reminder engine: unknown action_type "${row.action_type}" for id=${row.id}`);
    return;
  }

  const ctx: ActionContext = {
    client: deps.client,
    reminderStore: deps.reminderStore,
    convStore: deps.convStore,
    memStore: deps.memStore,
    persona: deps.persona,
    toolRegistry: deps.toolRegistry,
    timezone: deps.timezone,
    llmConfig: deps.llmConfig,
  };

  try {
    await handler(ctx, row);

    if (row.type === "recurring" && row.recurrence) {
      const spec = parseRecurrence(row.recurrence);
      if (spec) {
        const nextDue = computeNextDue(row.due_at, spec);
        deps.reminderStore.reschedule(row.id, nextDue);
        log.info(`Reminder engine: rescheduled id=${row.id} next=${nextDue} recurrence=${row.recurrence}`);
      } else {
        deps.reminderStore.complete(row.id);
        log.info(`Reminder engine: completed (bad recurrence) id=${row.id}`);
      }
    } else {
      deps.reminderStore.complete(row.id);
      log.info(`Reminder engine: completed id=${row.id}`);
    }
  } catch (error) {
    log.error(`Reminder engine: error executing id=${row.id}`, error);
  }
}

// ── Helpers ─────────────────────────────────────────────

function checkRecentActivity(convStore: ConversationStore, guildId: string, channelId: string): boolean {
  const messages = convStore.getMessages(guildId, channelId);
  const today = new Date().toISOString().slice(0, 10);
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "user" && msg.created_at >= today) return true;
  }
  return false;
}

function filterProactiveTools(definitions: ToolRegistry["definitions"]): ToolRegistry["definitions"] {
  return definitions.filter((t) =>
    t.type === "function" && PROACTIVE_ALLOWED_TOOLS.has(t.function.name),
  );
}

async function executeProactiveTools(
  ctx: ActionContext,
  toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>,
  row: { guild_id: string; channel_id: string; user_id: string },
) {
  const results: Array<{ role: "tool"; tool_call_id: string; content: string }> = [];
  for (const tc of toolCalls) {
    if (tc.type !== "function") continue;
    if (!PROACTIVE_ALLOWED_TOOLS.has(tc.function.name)) {
      results.push({
        role: "tool",
        tool_call_id: tc.id,
        content: `Tool "${tc.function.name}" is not available in proactive mode.`,
      });
      continue;
    }
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
    const toolResult = await ctx.toolRegistry.dispatch(tc.function.name, args, {
      guildId: row.guild_id,
      channelId: row.channel_id,
      userId: row.user_id,
      defaultTimezone: ctx.timezone,
    });
    results.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
  }
  return results;
}

function findLastAssistant(messages: Array<{ role: string; tool_calls?: unknown }>): {
  role: string;
  content: string | null;
  tool_calls?: unknown;
} | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]! as Record<string, unknown>;
    if (m.role === "assistant" && m.tool_calls) return m as { role: string; content: string | null; tool_calls?: unknown };
  }
  return undefined;
}

function extractToolCalls(msg: { role: string; content: string | null; tool_calls?: unknown } | undefined): Array<{
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}> {
  if (!msg?.tool_calls) return [];
  if (!Array.isArray(msg.tool_calls)) return [];
  return msg.tool_calls as Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

const TS_RE = /^\[[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}\]\s*/;
function stripTimestamp(text: string): string {
  return text.replace(TS_RE, "");
}
