import { SlashCommandBuilder, Collection } from "discord.js";
import type {
  ChatInputCommandInteraction,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export interface SlashCommand {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export function buildCommands(): Collection<string, SlashCommand> {
  const commands = new Collection<string, SlashCommand>();

  commands.set("reset", {
    data: new SlashCommandBuilder()
      .setName("reset")
      .setDescription("Clear conversation history for this channel"),
    async execute(interaction) {
      const { guildId, channelId } = interaction;
      if (!guildId) {
        await interaction.reply({
          content: "This command can only be used in a server.",
          ephemeral: true,
        });
        return;
      }

      const handlers = (interaction.client as Record<string, unknown>)
        .__handlers as Record<string, unknown> | undefined;

      if (handlers?.clearConversation) {
        await (handlers.clearConversation as (g: string, c: string) => Promise<void>)(
          guildId,
          channelId,
        );
        await interaction.reply({
          content: "Conversation history has been reset. Let us begin anew, Sensei.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "Unable to reset conversation at this time.",
          ephemeral: true,
        });
      }
    },
  });

  commands.set("status", {
    data: new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show current bot status"),
    async execute(interaction) {
      const handlers = (interaction.client as Record<string, unknown>)
        .__handlers as Record<string, unknown> | undefined;

      const statusInfo = handlers?.getStatus
        ? (handlers.getStatus as () => string)()
        : "Status unavailable.";

      await interaction.reply({
        content: statusInfo,
        ephemeral: true,
      });
    },
  });

  commands.set("persona", {
    data: new SlashCommandBuilder()
      .setName("persona")
      .setDescription("View persona information")
      .addSubcommand((sub) =>
        sub.setName("info").setDescription("Show current persona details"),
      ),
    async execute(interaction) {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "info") {
        const handlers = (interaction.client as Record<string, unknown>)
          .__handlers as Record<string, unknown> | undefined;

        const info = handlers?.getPersonaInfo
          ? (handlers.getPersonaInfo as () => string)()
          : "Persona information unavailable.";

        await interaction.reply({ content: info, ephemeral: true });
      }
    },
  });

  commands.set("memory", {
    data: new SlashCommandBuilder()
      .setName("memory")
      .setDescription("Manage Plana's memories")
      .addSubcommand((sub) =>
        sub.setName("show").setDescription("Show current memories"),
      )
      .addSubcommand((sub) =>
        sub.setName("write").setDescription("Manually trigger memory summarization"),
      ),
    async execute(interaction) {
      const subcommand = interaction.options.getSubcommand();
      const handlers = (interaction.client as Record<string, unknown>)
        .__handlers as Record<string, unknown> | undefined;

      if (subcommand === "show") {
        const result = handlers?.showMemory
          ? await (handlers.showMemory as () => Promise<string>)()
          : "Memory unavailable.";
        await interaction.reply({ content: result, ephemeral: true });
      }

      if (subcommand === "write") {
        await interaction.deferReply({ ephemeral: true });
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;
        if (!guildId) {
          await interaction.editReply("This command can only be used in a server.");
          return;
        }
        const result = handlers?.forceMemoryWrite
          ? await (handlers.forceMemoryWrite as (g: string, c: string) => Promise<string>)(guildId, channelId)
          : "Memory writer unavailable.";
        await interaction.editReply(result);
      }
    },
  });

  return commands;
}
