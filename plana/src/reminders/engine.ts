import type { Client, TextChannel } from "discord.js";
import type { ReminderStore } from "./store";
import { computeNextDue } from "./parser";
import { parseRecurrence } from "./parser";
import { log } from "../debug";

type ActionHandler = (
  client: Client,
  store: ReminderStore,
  row: {
    id: number;
    guild_id: string;
    channel_id: string;
    user_id: string;
    message: string;
  },
) => Promise<void>;

const actionHandlers: Record<string, ActionHandler> = {
  async remind(client, _store, row) {
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
};

export function startReminderEngine(
  client: Client,
  store: ReminderStore,
  pollIntervalMs = 15_000,
) {
  let pollCount = 0;

  log.info(`Reminder engine: starting (poll=${pollIntervalMs}ms)...`);

  const dueNow = store.getDue();
  if (dueNow.length > 0) {
    log.info(`Reminder engine: startup — sending ${Math.min(dueNow.length, 50)} missed reminder(s)`);
    for (const row of dueNow.slice(0, 50)) {
      executeAction(client, store, row);
    }
  } else {
    log.info("Reminder engine: no missed reminders on startup");
  }

  const timer = setInterval(() => {
    pollCount++;
    poll(client, store);

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

async function poll(client: Client, store: ReminderStore) {
  const dueReminders = store.getDue();

  if (dueReminders.length > 0) {
    log.info(`Reminder engine: poll found ${dueReminders.length} due reminder(s)`);
  }

  for (const row of dueReminders) {
    await executeAction(client, store, row);
  }
}

async function executeAction(
  client: Client,
  store: ReminderStore,
  row: {
    id: number;
    guild_id: string;
    channel_id: string;
    user_id: string;
    message: string;
    action_type: string;
    type: "once" | "recurring";
    due_at: string;
    recurrence: string | null;
  },
) {
  const handler = actionHandlers[row.action_type];
  if (!handler) {
    log.warn(`Reminder engine: unknown action_type "${row.action_type}" for id=${row.id}`);
    return;
  }

  try {
    await handler(client, store, row);

    if (row.type === "recurring" && row.recurrence) {
      const spec = parseRecurrence(row.recurrence);
      if (spec) {
        const nextDue = computeNextDue(row.due_at, spec);
        store.reschedule(row.id, nextDue);
        log.info(`Reminder engine: rescheduled id=${row.id} next=${nextDue} recurrence=${row.recurrence}`);
      } else {
        store.complete(row.id);
        log.info(`Reminder engine: completed (bad recurrence) id=${row.id}`);
      }
    } else {
      store.complete(row.id);
      log.info(`Reminder engine: completed id=${row.id}`);
    }
  } catch (error) {
    log.error(`Reminder engine: error executing id=${row.id}`, error);
  }
}
