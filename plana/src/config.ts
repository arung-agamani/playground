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
}

export function loadConfig(): AppConfig {
  const token = process.env.DISCORD_TOKEN;
  const apiKey = process.env.OPENCODE_API_KEY;
  const baseUrl = process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/zen/go/v1";
  const model = process.env.DEFAULT_MODEL ?? "deepseek-v4-flash";
  const visionModel = process.env.VISION_MODEL ?? "mimo-v2.5";
  const guildId = process.env.GUILD_ID ?? "";
  const timezone = process.env.DEFAULT_TIMEZONE ?? "Asia/Jakarta";

  if (!token) {
    throw new Error("DISCORD_TOKEN is required in .env");
  }
  if (!apiKey) {
    throw new Error("OPENCODE_API_KEY is required in .env");
  }

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
  };
}

export function loadPersonaFromConfig(personaPath?: string): PersonaDefinition {
  const personaName = process.env.PERSONA ?? "plana";
  const path = personaPath ?? join(process.cwd(), "personas", personaName);
  return loadPersona(path);
}

export { getPersona };
