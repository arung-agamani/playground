import { join } from "node:path";
import { loadPersona, getPersona } from "./persona/manager";
import type { PersonaDefinition } from "./persona/types";

export interface AppConfig {
  discordToken: string;
  opencodeApiKey: string;
  opencodeBaseUrl: string;
  defaultModel: string;
  visionModel: string;
  guildId: string;
  defaultTimezone: string;
  greetingTime: string;
  greetingChannelId: string;
  tavilyApiKey?: string;
  /** When set, use Postgres; when unset, SQLite at dbPath. */
  databaseUrl?: string;
  dbPath: string;
  /** Optional AES-256-GCM key (64 hex chars). */
  encryptionKey?: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required in .env`);
  return v;
}

export function loadConfig(): AppConfig {
  const token = requireEnv("DISCORD_TOKEN");
  const apiKey = requireEnv("OPENCODE_API_KEY");
  const baseUrl = process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/zen/go/v1";
  const model = process.env.DEFAULT_MODEL ?? "deepseek-v4-flash";
  const visionModel = process.env.VISION_MODEL ?? "mimo-v2.5";
  const guildId = process.env.GUILD_ID ?? "";
  const timezone = process.env.DEFAULT_TIMEZONE ?? "Asia/Jakarta";

  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL.trim() === "") {
    throw new Error(
      "DATABASE_URL is set but empty. Provide a postgres:// URL or unset it for SQLite.",
    );
  }

  const encryptionKey = process.env.ENCRYPTION_KEY?.trim() || undefined;
  if (encryptionKey && !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex characters (32 bytes) when set",
    );
  }

  const dbPath =
    process.env.DB_PATH?.trim() ||
    join(process.cwd(), "data", "plana.db");

  return {
    discordToken: token,
    opencodeApiKey: apiKey,
    opencodeBaseUrl: baseUrl,
    defaultModel: model,
    visionModel,
    guildId,
    defaultTimezone: timezone,
    greetingTime: process.env.GREETING_TIME ?? "",
    greetingChannelId: process.env.GREETING_CHANNEL_ID ?? "",
    tavilyApiKey: process.env.TAVILY_API_KEY || undefined,
    databaseUrl,
    dbPath,
    encryptionKey,
  };
}

export function loadPersonaFromConfig(personaPath?: string): PersonaDefinition {
  const personaName = process.env.PERSONA ?? "plana";
  const path = personaPath ?? join(process.cwd(), "personas", personaName);
  return loadPersona(path);
}

export { getPersona };
