import type { Message } from "discord.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ConversationStore } from "../conversation/store";
import type { ToolRegistry } from "../tools/registry";
import { createConversationManager } from "../conversation/manager";
import { createOpenCodeClient } from "../llm/opencode";
import { compileSystemPrompt } from "../llm/prompts";
import type { PersonaDefinition } from "../persona/types";
import type { MemoryStore } from "../memory/store";
import type { ThresholdState } from "../memory/thresholds";
import { shouldRefresh, recordWrite, incrementCount } from "../memory/thresholds";
import { runMemoryWriter, type WriterConfig } from "../memory/writer";
import { log } from "../debug";

export interface HandlerDeps {
  store: ConversationStore;
  toolRegistry: ToolRegistry;
  persona: PersonaDefinition;
  memoryStore: MemoryStore;
  thresholdState: ThresholdState;
  writerConfig: WriterConfig;
  appConfig: {
    opencodeBaseUrl: string;
    opencodeApiKey: string;
    defaultModel: string;
    visionModel: string;
    defaultTimezone: string;
  };
}

function lastAssistantMessage(
  messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") return messages[i];
  }
  return undefined;
}

function extractToolCalls(
  msg: ChatCompletionMessageParam | undefined,
): Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> {
  if (!msg || !("tool_calls" in msg) || !msg.tool_calls) return [];
  if (!Array.isArray(msg.tool_calls)) {
    log.warn("tool_calls is not an array", { type: typeof msg.tool_calls, value: msg.tool_calls });
    return [];
  }
  return msg.tool_calls as Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export function createHandlers(deps: HandlerDeps) {
  const { store, toolRegistry, persona, memoryStore, thresholdState, writerConfig, appConfig } = deps;
  const llm = createOpenCodeClient(appConfig.opencodeBaseUrl, appConfig.opencodeApiKey);
  const convManager = createConversationManager(store);
  const systemPrompt = compileSystemPrompt(persona);

  async function handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.guildId) return;

    const { guildId, channelId } = message;
    log.messageReceived(message.author.tag, guildId, channelId, message.content);
    await message.channel.sendTyping();

    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8_000);

    try {
      const imageAttachments = message.attachments.filter(
        (a) => a.contentType?.startsWith("image/") && a.url,
      );
      const hasImages = imageAttachments.size > 0;

      const memoryBlock = await memoryStore.buildMemoryBlock();

      let currentMessages = await convManager.buildApiMessages(
        guildId,
        channelId,
        systemPrompt,
        message.content,
        appConfig.defaultTimezone,
        memoryBlock || undefined,
      );

      if (hasImages) {
        const imageUrls = imageAttachments.map((a) => a.url);
        const imageBlocks = imageUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        }));
        const textBlock = {
          type: "text" as const,
          text: message.content || "What do you see in this image?",
        };
        const lastIdx = currentMessages.length - 1;
        currentMessages[lastIdx] = {
          role: "user",
          content: [...imageBlocks, textBlock],
        } as ChatCompletionMessageParam;
      }

      const activeModel = hasImages ? appConfig.visionModel : appConfig.defaultModel;

      await store.saveMessage(guildId, channelId, "user", message.content);
      incrementCount(thresholdState);

      const allToolNames: string[] = [];
      const allResultLines: string[] = [];
      let statusMsg: Message | null = null;
      let responseSent = false;
      const MAX_ROUNDS = 6;

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const isFirstRound = round === 0;
        if (isFirstRound) {
          log.llmRequest(activeModel, currentMessages, toolRegistry.definitions.length);
        } else {
          log.llmRequestFollowUp(activeModel, currentMessages);
        }

        const result = await llm.chat({
          model: activeModel,
          messages: currentMessages,
          tools: toolRegistry.definitions,
          maxToolIterations: 3,
        });

        const lastAsst = lastAssistantMessage(result.messages);
        const toolCalls = extractToolCalls(lastAsst);

        if (toolCalls.length > 0) {
          log.llmResponse("tool_calls", null, toolCalls);

          const recallOnly = toolCalls.every(
            (tc) => tc.function.name === "recall_knowledge",
          );

          if (!recallOnly) {
            const hasText =
              lastAsst?.content &&
              typeof lastAsst.content === "string" &&
              lastAsst.content.trim().length > 0;

            if (hasText) {
              await message.channel.send(stripTimestamp((lastAsst!.content as string).trim()));
            }

            const roundNames = toolCalls.map((tc) => tc.function.name);
            allToolNames.push(...roundNames);

            if (!statusMsg) {
              statusMsg = await message.channel.send({
                content: `🔧 *using ${roundNames.join(", ")}...*`,
              });
            } else {
              await statusMsg.edit({
                content: `🔧 *using ${allToolNames.join(", ")}...*`,
              });
            }
          }

          const roundToolResults: ChatCompletionMessageParam[] = [];
          for (const tc of toolCalls) {
            if (tc.type !== "function") continue;
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = {};
            }
            const toolResult = await toolRegistry.dispatch(
              tc.function.name,
              args,
              {
                guildId,
                channelId,
                userId: message.author.id,
                defaultTimezone: appConfig.defaultTimezone,
              },
            );
            log.toolCall(tc.function.name, args, toolResult);
            roundToolResults.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult,
            });
            allResultLines.push(toolResult);
          }

          await store.saveMessage(
            guildId,
            channelId,
            "assistant",
            (lastAsst?.content as string) ?? null,
            toolCalls,
          );

          for (const tr of roundToolResults) {
            await store.saveMessage(guildId, channelId, "tool", tr.content as string, null, tr.tool_call_id);
          }

          currentMessages = [
            ...currentMessages,
            lastAsst!,
            ...roundToolResults,
          ] as ChatCompletionMessageParam[];

          continue;
        }

        if (result.content) {
          const text = stripTimestamp(result.content);

          if (statusMsg) {
            const header = `🔧 *using ${allToolNames.join(", ")}* ✓`;
            const resultPreview = truncateToolResults(allResultLines, header);
            await statusMsg.edit({ content: resultPreview });
          }

          log.llmResponse("stop", text);
          await store.saveMessage(guildId, channelId, "assistant", text);
          log.responseSent(channelId, text);

          if (statusMsg) {
            await sendChunked(message, text);
          } else {
            await sendResponse(message, text);
          }

          responseSent = true;
          scheduleMemoryRefresh(memoryStore, store, guildId, channelId, thresholdState, writerConfig);

          return;
        }

        break;
      }

      if (!responseSent) {
        log.llmRequestFollowUp(activeModel, currentMessages);

        const finalResult = await llm.chat({
          model: activeModel,
          messages: currentMessages,
        });

        if (finalResult.content) {
          const text = stripTimestamp(finalResult.content);

          if (statusMsg) {
            const header = `🔧 *using ${allToolNames.join(", ")}* ✓`;
            const resultPreview = truncateToolResults(allResultLines, header);
            await statusMsg.edit({ content: resultPreview });
          }

          log.llmResponse("stop", text);
          await store.saveMessage(guildId, channelId, "assistant", text);
          log.responseSent(channelId, text);

          if (statusMsg) {
            await sendChunked(message, text);
          } else {
            await sendResponse(message, text);
          }

          scheduleMemoryRefresh(memoryStore, store, guildId, channelId, thresholdState, writerConfig);
        }
      }
    } catch (error) {
      log.error("Error handling message", error);
      await message.reply({
        content: "Ah... something seems to have gone wrong, Sensei. My apologies...",
      });
    } finally {
      clearInterval(typingInterval);
    }
  }

  async function clearConversation(guildId: string, channelId: string): Promise<void> {
    await store.clearConversation(guildId, channelId);
    log.info(`Conversation cleared: ${guildId}:${channelId}`);
  }

  function scheduleMemoryRefresh(
    memStore: MemoryStore,
    convStore: ConversationStore,
    guildId: string,
    channelId: string,
    state: ThresholdState,
    config: WriterConfig,
  ): void {
    if (!shouldRefresh(state)) {
      log.debug(
        `Memory writer: skip (count=${state.messageCount}/15, sinceWrite=${((Date.now() - state.lastWriteTime) / 60_000).toFixed(1)}min)`,
      );
      return;
    }

    log.info("Memory writer: threshold reached, scheduling...");
    recordWrite(state);

    runMemoryWriter(convStore, memStore, guildId, channelId, config)
      .then(() => log.info("Memory writer: complete"))
      .catch((err) => log.error("Memory writer: failed", err));
  }

  function getStatus(): string {
    const p = persona;
    return [
      `**Persona:** ${p.meta.display_name} (${p.meta.source})`,
      `**Model:** ${appConfig.defaultModel}`,
      `**Archetype:** ${p.identity.archetype}`,
      `**Endpoint:** ${appConfig.opencodeBaseUrl}`,
    ].join("\n");
  }

  function getPersonaInfo(): string {
    const p = persona;
    return [
      `**${p.meta.display_name}** (${p.meta.source})`,
      `ID: \`${p.id}\` | Version: ${p.meta.version}`,
      "",
      `**Archetype:** ${p.identity.archetype}`,
      "",
      "**Traits:**",
      ...p.identity.traits.map((t) => `- **${t.trait}**: ${t.description}`),
      "",
      `**Speech:** ${p.speech.formality} register, uses ${p.speech.first_person}, addresses user as "${p.speech.user_address}"`,
    ].join("\n");
  }

  async function forceMemoryWrite(guildId: string, channelId: string): Promise<string> {
    log.info("Memory writer: manual trigger");
    recordWrite(thresholdState);
    try {
      await runMemoryWriter(store, memoryStore, guildId, channelId, writerConfig);
      log.info("Memory writer: manual trigger complete");
      return "Memories updated, Sensei.";
    } catch (err) {
      log.error("Memory writer: manual trigger failed", err);
      return "I tried... but something went wrong updating my memories.";
    }
  }

  async function showMemory(): Promise<string> {
    const block = await memoryStore.buildMemoryBlock();
    if (!block) return "I do not have any memories stored yet, Sensei.";
    const facts = await memoryStore.getAllFacts();
    const factsText = facts.length > 0
      ? `\n\nKnown facts (${facts.length}):\n${facts.map((f) => `- ${f.fact} (${f.confidence.toFixed(1)})`).join("\n")}`
      : "";
    return `**Memories:**\n\`\`\`\n${block}\n\`\`\`${factsText}`;
  }

  return { handleMessage, clearConversation, getStatus, getPersonaInfo, forceMemoryWrite, showMemory };
}

async function sendResponse(message: Message, content: string): Promise<void> {
  if (content.length <= 2000) {
    await message.reply({ content });
    return;
  }

  const chunks = splitMessage(content, 1990);
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      await message.reply({ content: chunks[i]! });
    } else {
      await message.channel.send(chunks[i]!);
    }
  }
}

async function sendChunked(message: Message, content: string): Promise<void> {
  if (content.length <= 2000) {
    await message.channel.send(content);
    return;
  }
  const chunks = splitMessage(content, 1990);
  for (const chunk of chunks) {
    await message.channel.send(chunk);
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) {
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt === -1 || splitAt < maxLen / 2) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }
  chunks.push(remaining);
  return chunks;
}

function truncateToolResults(lines: string[], header: string): string {
  const MAX_LEN = 1950;
  let result = header;

  if (lines.length > 0) {
    result += "\n>>> ";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const truncated = line.length > 300 ? line.slice(0, 300) + "…" : line;
      const sep = i === 0 ? "" : "\n";
      if (result.length + sep.length + truncated.length > MAX_LEN) {
        result += "\n…";
        break;
      }
      result += sep + truncated;
    }
  }

  return result;
}

const TS_RE = /^\[[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}\]\s*/;

function stripTimestamp(text: string): string {
  return text.replace(TS_RE, "");
}
