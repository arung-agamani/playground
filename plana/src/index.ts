import { config } from "dotenv";
import { join } from "node:path";
import { loadConfig, loadPersonaFromConfig } from "./config";
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

console.log(`Loaded persona: ${persona.meta.display_name} v${persona.meta.version}`);

const dbPath = join(import.meta.dir, "..", "data", "plana.db");
const store = createStore(dbPath);
const reminderStore = createReminderStore(dbPath);
const taskStore = createTaskStore(dbPath);
const memoryStore = createMemoryStore(dbPath);
const loreStore = createLoreStore(dbPath);

const thresholdState = createThresholds(store.getMessages(appConfig.guildId, "0").length || 0);

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

seedGreetingReminder(reminderStore, appConfig);

const engine = startReminderEngine({
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

process.on("SIGINT", () => {
  engine.stop();
  loreStore.close();
  memoryStore.close();
  taskStore.close();
  reminderStore.close();
  store.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  engine.stop();
  loreStore.close();
  memoryStore.close();
  taskStore.close();
  reminderStore.close();
  store.close();
  process.exit(0);
});

function seedGreetingReminder(
  store: ReturnType<typeof createReminderStore>,
  config: ReturnType<typeof loadConfig>,
) {
  if (!config.greetingTime || !config.greetingChannelId) return;

  const active = store.getActive(config.greetingChannelId);
  const exists = active.some((r) => r.action_type === "greeting");
  if (exists) return;

  const [h, m] = config.greetingTime.split(":").map(Number);
  if (isNaN(h!) || isNaN(m!)) {
    console.error(`Invalid GREETING_TIME: "${config.greetingTime}". Use 24h format like "08:00".`);
    return;
  }

  const now = new Date();
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h!, m!));
  if (due <= now) due.setUTCDate(due.getUTCDate() + 1);

  store.create({
    guildId: config.guildId,
    channelId: config.greetingChannelId,
    userId: client?.user?.id ?? "0",
    message: "Morning greeting",
    actionType: "greeting",
    type: "recurring",
    dueAt: due.toISOString(),
    recurrence: "daily",
  });

  // Nudge: follows 30 min after greeting
  const nudgeDue = new Date(due.getTime() + 30 * 60_000);
  store.create({
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
