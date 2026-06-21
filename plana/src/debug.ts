import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const currentLevel = (process.env.LOG_LEVEL ?? "info") as LogLevel;

function enabled(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel];
}

const ICONS: Record<string, string> = {
  debug: "·",
  info: "→",
  warn: "△",
  error: "✕",
  llm_req: "──▶",
  llm_res: "◀──",
  tool: "⚙ ",
  msg: "✉ ",
  send: "▲ ",
};

function ts(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export const log = {
  debug(label: string, data?: unknown) {
    if (!enabled("debug")) return;
    console.error(`${ts()} ${ICONS.debug} [DEBUG] ${label}`);
    if (data !== undefined) console.error(formatData(data));
  },

  info(label: string) {
    if (!enabled("info")) return;
    console.error(`${ts()} ${ICONS.info} ${label}`);
  },

  warn(label: string, data?: unknown) {
    if (!enabled("warn")) return;
    console.error(`${ts()} ${ICONS.warn} [WARN] ${label}`);
    if (data !== undefined) console.error(formatData(data));
  },

  error(label: string, data?: unknown) {
    if (!enabled("error")) return;
    console.error(`${ts()} ${ICONS.error} [ERROR] ${label}`);
    if (data !== undefined) console.error(formatData(data));
  },

  llmRequest(model: string, messages: ChatCompletionMessageParam[], tools: number) {
    if (!enabled("debug")) return;
    console.error(
      `${ts()} ${ICONS.llm_req} [LLM REQ] model=${model} messages=${messages.length} tools=${tools}`,
    );
    console.error(formatMessages(messages, 80));
  },

  llmRequestFollowUp(model: string, messages: ChatCompletionMessageParam[]) {
    if (!enabled("debug")) return;
    console.error(
      `${ts()} ${ICONS.llm_req} [LLM REQ] (follow-up) model=${model} messages=${messages.length}`,
    );
    console.error(formatMessages(messages, 80));
  },

  llmResponse(finishReason: string, content: string | null, toolCalls?: unknown) {
    if (!enabled("debug")) return;
    if (toolCalls) {
      const names = Array.isArray(toolCalls)
        ? (toolCalls as Array<Record<string, unknown>>).map(
            (tc) => `{name:${(tc as Record<string, unknown>).function ? (tc as Record<string, {name: string}>).function.name : "?"}}`,
          ).join(", ")
        : typeof toolCalls;
      console.error(
        `${ts()} ${ICONS.llm_res} [LLM RES] finish=${finishReason} content=${content ? (content.length > 40 ? content.slice(0, 40) + "…" : content) : "null"} tool_calls=[${names}]`,
      );
    } else {
      const preview = content
        ? content.length > 60
          ? content.slice(0, 60) + "…"
          : content
        : "null";
      console.error(
        `${ts()} ${ICONS.llm_res} [LLM RES] finish=${finishReason} content="${preview}"`,
      );
    }
  },

  toolCall(name: string, args: Record<string, unknown>, result: string) {
    if (!enabled("debug")) return;
    const resultPreview =
      result.length > 80 ? result.slice(0, 80) + "…" : result;
    console.error(
      `${ts()} ${ICONS.tool} [TOOL] ${name}(${JSON.stringify(args)}) → "${resultPreview}"`,
    );
  },

  messageReceived(author: string, guildId: string, channelId: string, content: string) {
    if (!enabled("debug")) return;
    const preview =
      content.length > 60 ? content.slice(0, 60) + "…" : content;
    console.error(
      `${ts()} ${ICONS.msg} [MSG] ${author} in ${shortConvo(guildId, channelId)}: "${preview}"`,
    );
  },

  responseSent(channelId: string, content: string) {
    if (!enabled("debug")) return;
    const preview =
      content.length > 60 ? content.slice(0, 60) + "…" : content;
    console.error(`${ts()} ${ICONS.send} [SEND] → ${channelId}: "${preview}"`);
  },
};

function shortConvo(guildId: string, channelId: string): string {
  return `${guildId.slice(-6)}:${channelId.slice(-6)}`;
}

function formatData(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function formatMessages(messages: ChatCompletionMessageParam[], maxLen: number): string {
  return messages
    .map((m, i) => {
      const role = m.role;
      let content = "";
      if (typeof m.content === "string") {
        content = truncate(m.content, maxLen);
      } else if (m.content === null) {
        content = "null";
      } else if (Array.isArray(m.content)) {
        content = "[multipart]";
      }

      let extra = "";
      if ("tool_calls" in m && m.tool_calls) {
        if (Array.isArray(m.tool_calls)) {
          const names = m.tool_calls.map((tc) =>
            "function" in tc && tc.function
              ? (tc.function as { name: string }).name
              : tc.type,
          );
          extra = ` | tool_calls: [${names.join(", ")}]`;
        } else {
          extra = ` | tool_calls: INVALID(${typeof m.tool_calls})`;
        }
      }
      if (m.role === "tool" && "tool_call_id" in m) {
        extra = ` | tool_call_id: ${m.tool_call_id}`;
      }
      return `    [${i}] ${role}: ${content}${extra}`;
    })
    .join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}
