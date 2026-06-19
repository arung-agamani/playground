import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import type { SlashCommand } from "./commands";
import { buildCommands } from "./commands";
import type { HandlerDeps } from "./handlers";
import { createHandlers } from "./handlers";

export async function startDiscord(
  token: string,
  guildId: string,
  defaultTimezone: string,
  deps: HandlerDeps,
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const handlers = createHandlers(deps);
  const commands = buildCommands();

  (client as Record<string, unknown>).__handlers = handlers;

  client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user?.tag}`);

    const commandData = commands.map((cmd) => cmd.data.toJSON());

    if (guildId) {
      const rest = new REST({ version: "10" }).setToken(token);
      try {
        await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
          body: commandData,
        });
        console.log(`Registered ${commandData.length} slash commands for guild ${guildId}`);
      } catch (error) {
        console.error("Failed to register slash commands:", error);
      }
    }

    console.log(`Persona: ${deps.persona.meta.display_name}`);
    console.log(`Model: ${deps.appConfig.defaultModel}`);
    console.log(`Timezone: ${defaultTimezone}`);
    console.log("Plana is ready.");
  });

  client.on("messageCreate", async (message) => {
    if (guildId && message.guildId !== guildId) return;
    await handlers.handleMessage(message);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error("Command execution error:", error);
      const reply = {
        content: "Something went wrong executing that command...",
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  });

  await client.login(token);
  return client;
}
