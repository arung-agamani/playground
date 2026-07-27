import { config } from "dotenv";
import { join } from "node:path";
import { loadConfig, loadPersonaFromConfig } from "./config";
import { createDb, closeDb } from "./db";
import { createStore } from "./conversation/store";
import { createReminderStore } from "./reminders/store";
import { createTaskStore } from "./tasks/store";
import { createMemoryStore } from "./memory/store";
import { createLoreStore } from "./lore/store";
import { createThresholds } from "./memory/thresholds";
import { startReminderEngine } from "./reminders/engine";
import { createToolRegistry } from "./tools/registry";
import { startDiscord } from "./discord/client";

config({ path: join(import.meta.dir, "..", ".env") });

const appConfig = loadConfig();

const persona = loadPersonaFromConfig();

const db = createDb(appConfig.databaseUrl!);

const store = createStore(db);
const reminderStore = createReminderStore(db);
const taskStore = createTaskStore(db);
const memoryStore = createMemoryStore(db);
const loreStore = createLoreStore(db);

const initialMessages = await store.getMessages(appConfig.guildId, "0");
const thresholdState = createThresholds(initialMessages.length || 0);

const toolRegistry = createToolRegistry(
  reminderStore,
  taskStore,
  memoryStore,
  loreStore,
  appConfig.tavilyApiKey,
  {
    baseUrl: appConfig.opencodeBaseUrl,
    apiKey: appConfig.opencodeApiKey,
  },
);

const client = await startDiscord(
  appConfig.discordToken,
  appConfig.guildId,
  appConfig.defaultTimezone,
  {
    store,
    toolRegistry,
    persona,
    memoryStore,
    thresholdState,
    writerConfig: {
      opencodeBaseUrl: appConfig.opencodeBaseUrl,
      opencodeApiKey: appConfig.opencodeApiKey,
      defaultModel: appConfig.defaultModel,
    },
    appConfig: {
      opencodeBaseUrl: appConfig.opencodeBaseUrl,
      opencodeApiKey: appConfig.opencodeApiKey,
      defaultModel: appConfig.defaultModel,
      visionModel: appConfig.visionModel,
      defaultTimezone: appConfig.defaultTimezone,
    },
  },
);

await seedGreetingReminder(reminderStore, appConfig);

const engine = await startReminderEngine({
  client,
  reminderStore,
  convStore: store,
  memStore: memoryStore,
  persona,
  toolRegistry,
  timezone: appConfig.defaultTimezone,
  llmConfig: {
    baseUrl: appConfig.opencodeBaseUrl,
    apiKey: appConfig.opencodeApiKey,
    model: appConfig.defaultModel,
  },
});

process.on("SIGINT", async () => {
  engine.stop();
  await closeDb();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  engine.stop();
  await closeDb();
  process.exit(0);
});

async function seedGreetingReminder(
  store: ReturnType<typeof createReminderStore>,
  config: ReturnType<typeof loadConfig>,
) {
  if (!config.greetingTime || !config.greetingChannelId) return;

  const active = await store.getActive(config.greetingChannelId);
  const exists = active.some((r) => r.action_type === "greeting");
  if (exists) return;

  const [h, m] = config.greetingTime.split(":").map(Number);
  if (isNaN(h!) || isNaN(m!)) {
    console.error(`Invalid GREETING_TIME: "${config.greetingTime}". Use 24h format like "08:00".`);
    return;
  }

  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h!, m!, 0, 0);
  if (due <= now) due.setDate(due.getDate() + 1);

  await store.create({
    guildId: config.guildId,
    channelId: config.greetingChannelId,
    userId: client?.user?.id ?? "0",
    message: "Morning greeting",
    actionType: "greeting",
    type: "recurring",
    dueAt: due.toISOString(),
    recurrence: "daily",
  });

  const nudgeDue = new Date(due.getTime() + 30 * 60_000);
  await store.create({
    guildId: config.guildId,
    channelId: config.greetingChannelId,
    userId: client?.user?.id ?? "0",
    message: "Nudge check-in",
    actionType: "nudge",
    type: "once",
    dueAt: nudgeDue.toISOString(),
  });

  console.log(`Greeting seeded: daily at ${config.greetingTime}, nudge at +30min`);
}
