import { config } from "dotenv";
import { join } from "node:path";
import { loadConfig, loadPersonaFromConfig } from "./config";
import { createStore } from "./conversation/store";
import { createReminderStore } from "./reminders/store";
import { createTaskStore } from "./tasks/store";
import { createMemoryStore } from "./memory/store";
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

const thresholdState = createThresholds(store.getMessages(appConfig.guildId, "0").length || 0);
// The initial count doesn't matter much — first response will trigger if needed

const toolRegistry = createToolRegistry(
  reminderStore,
  taskStore,
  memoryStore,
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
      defaultTimezone: appConfig.defaultTimezone,
    },
  },
);

const engine = startReminderEngine(client, reminderStore);

process.on("SIGINT", () => {
  engine.stop();
  memoryStore.close();
  taskStore.close();
  reminderStore.close();
  store.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  engine.stop();
  memoryStore.close();
  taskStore.close();
  reminderStore.close();
  store.close();
  process.exit(0);
});
