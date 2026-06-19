import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ConversationStore, MessageRow } from "./store";
import { estimateTokens } from "../llm/prompts";

export interface ConversationContext {
  messages: ChatCompletionMessageParam[];
  systemPromptTokens: number;
  historyTokens: number;
}

const MAX_CONTEXT_TOKENS = 24000;
const MAX_HISTORY_MESSAGES = 30;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatTs(isoString: string, timezone: string): string {
  try {
    const normalized = isoString.replace(" ", "T") + "Z";
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) throw new Error("invalid");

    const local = new Date(d.toLocaleString("en-US", { timeZone: timezone }));
    const month = MONTHS[local.getMonth()]!;
    const day = String(local.getDate()).padStart(2, "0");
    const hour = String(local.getHours()).padStart(2, "0");
    const min = String(local.getMinutes()).padStart(2, "0");
    return `[${month} ${day} ${hour}:${min}]`;
  } catch {
    const d = new Date(isoString);
    const month = MONTHS[d.getUTCMonth()]!;
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hour = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    return `[${month} ${day} ${hour}:${min}]`;
  }
}

export function createConversationManager(store: ConversationStore) {
  function buildContext(
    guildId: string,
    channelId: string,
    systemPrompt: string,
    timezone: string,
  ): ConversationContext {
    const systemTokens = estimateTokens(systemPrompt);
    const availableForHistory = MAX_CONTEXT_TOKENS - systemTokens - 500;
    const rows = store.getMessages(guildId, channelId);

    const messages: ChatCompletionMessageParam[] = [];
    let historyTokens = 0;
    let i = rows.length - 1;

    while (i >= 0 && messages.length < MAX_HISTORY_MESSAGES) {
      const row = rows[i]!;
      const entry = rowToMessageParam(row, timezone);

      if (row.role === "tool") {
        let asstIdx = i - 1;
        while (asstIdx >= 0 && rows[asstIdx]!.role === "tool") {
          asstIdx--;
        }

        const asstRow = rows[asstIdx];
        if (asstRow && asstRow.role === "assistant" && asstRow.tool_calls) {
          let chainTokens = 0;
          const chainEntries: ChatCompletionMessageParam[] = [];
          for (let j = asstIdx + 1; j <= i; j++) {
            const toolRow = rows[j]!;
            chainEntries.push(rowToMessageParam(toolRow, timezone));
            chainTokens += estimateMessageTokens(toolRow);
          }
          chainEntries.push(rowToMessageParam(asstRow, timezone));
          chainTokens += estimateMessageTokens(asstRow);

          if (historyTokens + chainTokens > availableForHistory) break;

          for (const e of chainEntries) messages.unshift(e);
          historyTokens += chainTokens;
          i = asstIdx - 1;
          continue;
        }

        i--;
        continue;
      }

      const tokens = estimateMessageTokens(row);
      if (historyTokens + tokens > availableForHistory) break;

      messages.unshift(entry);
      historyTokens += tokens;
      i--;
    }

    return {
      messages,
      systemPromptTokens: systemTokens,
      historyTokens,
    };
  }

  function buildApiMessages(
    guildId: string,
    channelId: string,
    systemPrompt: string,
    currentMessage: string,
    timezone: string,
    memoryBlock?: string,
  ): ChatCompletionMessageParam[] {
    const ctx = buildContext(guildId, channelId, systemPrompt, timezone);

    const apiMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    if (memoryBlock) {
      apiMessages.push({
        role: "system",
        content: `MEMORIES ABOUT SENSEI:\n${memoryBlock}\n\nUse this information to personalize your responses. You know these things about Sensei.`,
      });
    }

    apiMessages.push(...ctx.messages, { role: "user", content: currentMessage });
    return apiMessages;
  }

  return { buildContext, buildApiMessages };
}

function rowToMessageParam(row: MessageRow, timezone: string): ChatCompletionMessageParam {
  const ts = row.created_at ? formatTs(row.created_at, timezone) : "";

  switch (row.role) {
    case "user":
      return { role: "user", content: ts ? `${ts} ${row.content ?? ""}` : (row.content ?? "") };
    case "assistant": {
      if (row.tool_calls) {
        const parsed = JSON.parse(row.tool_calls);
        return {
          role: "assistant",
          content: row.content ? (ts ? `${ts} ${row.content}` : row.content) : null,
          tool_calls: parsed,
        } as ChatCompletionMessageParam;
      }
      return { role: "assistant", content: ts ? `${ts} ${row.content ?? ""}` : (row.content ?? "") };
    }
    case "tool":
      return {
        role: "tool",
        tool_call_id: row.tool_call_id ?? "",
        content: row.content ?? "",
      };
    default:
      return { role: "user", content: row.content ?? "" };
  }
}

function estimateMessageTokens(row: MessageRow): number {
  let total = 0;
  if (row.content) total += estimateTokens(row.content);
  if (row.tool_calls) total += estimateTokens(row.tool_calls);
  return total || 1;
}
