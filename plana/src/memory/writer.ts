import { createOpenCodeClient } from "../llm/opencode";
import type { ConversationStore } from "../conversation/store";
import type { MemoryStore } from "./store";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { log } from "../debug";

export interface WriterConfig {
  opencodeBaseUrl: string;
  opencodeApiKey: string;
  defaultModel: string;
}

export async function runMemoryWriter(
  convStore: ConversationStore,
  memStore: MemoryStore,
  guildId: string,
  channelId: string,
  config: WriterConfig,
): Promise<void> {
  const llm = createOpenCodeClient(config.opencodeBaseUrl, config.opencodeApiKey);

  const oldSummaries = memStore.getAllMemories();
  const messages = convStore.getMessages(guildId, channelId);
  const recent = messages.slice(-30);

  const conversationText = recent
    .map((m) => {
      const role = m.role === "user" ? "Sensei" : m.role === "assistant" ? "Plana" : "Tool";
      const content = m.content ? m.content.slice(0, 200) : "(tool call)";
      return `${role}: ${content}`;
    })
    .join("\n");

  const oldSummariesText = oldSummaries.length > 0
    ? oldSummaries
        .map((s) => `[${s.tier}]: ${s.content}`)
        .join("\n")
    : "(no prior memories)";

  const prompt = [
    "You are a memory summarizer for a personal AI assistant named Plana.",
    "Your job is to maintain summarized memories of conversations with Sensei.",
    "",
    "Focus on:",
    "- Behavioral patterns and preferences (when Sensei works, how they communicate)",
    "- Recurring topics and interests (projects, hobbies, concerns)",
    "- Emotional patterns (what they enjoy, what stresses them)",
    "- Important facts about Sensei's life, work, and preferences",
    "- Relationship development with Plana",
    "",
    "TIERS:",
    "- lifetime: 2-3 sentences. Core identity — who Sensei is, persistent traits, unchanging facts.",
    "- monthly: 2-3 sentences. Key developments this month.",
    "- weekly: 2-3 sentences. What happened this week, current focus.",
    "- daily: 1-2 sentences. Today's conversations and immediate context.",
    "",
    "Merge old summaries with new conversation. Be cumulative — retain important old",
    "information while adding new insights. If nothing new in a tier, keep old content.",
    "",
    "Also extract any important facts about Sensei. A fact is a specific, verifiable",
    "piece of information (preference, trait, situation). Give each fact a confidence",
    "score (0-1). Only include facts with confidence > 0.5.",
    "",
    "For each fact, classify its nature:",
    "- 'persistent': unchanging truth about Sensei (identity, preferences, personality traits, history)",
    "- 'temporal': current state that may change (schedules, deadlines, mood, work-in-progress, recent events)",
    "",
    "EXISTING MEMORIES:",
    oldSummariesText,
    "",
    "RECENT CONVERSATION:",
    conversationText,
    "",
    "Respond with ONLY a JSON object (no markdown, no code fences):",
    "{",
    '  "summaries": {',
    '    "lifetime": "string",',
    '    "monthly": "string",',
    '    "weekly": "string",',
    '    "daily": "string"',
    "  },",
    '  "facts": [',
    '    { "fact": "string", "confidence": 0.8, "nature": "persistent" }',
    "  ]",
    "}",
  ].join("\n");
  const msg: ChatCompletionMessageParam[] = [
    { role: "system", content: "You are a memory summarizer. Always respond with valid JSON only — no markdown, no code fences, no extra text." },
    { role: "user", content: prompt },
  ];

  try {
    log.info(`Memory writer: sending (${prompt.length}c prompt, ${Math.ceil(prompt.length / 4)} est tokens)`);

    const result = await llm.chat({
      model: config.defaultModel,
      messages: msg,
      temperature: 0,
      maxTokens: 15000,
    });

    if (!result.content) {
      const lastMsg = result.messages[result.messages.length - 1];
      log.warn("Memory writer: no response from LLM", {
        finishReason: result.finishReason,
        promptChars: prompt.length,
        messagesCount: result.messages.length,
        hasToolCalls: lastMsg && "tool_calls" in lastMsg && !!(lastMsg as Record<string,unknown>).tool_calls,
        lastRole: lastMsg?.role,
      });
      return;
    }

    log.info(`Memory writer: response received (${result.content.length}c, finish=${result.finishReason})`);

    let parsed: {
      summaries?: Record<string, string>;
      facts?: Array<{ fact: string; confidence: number; nature?: string }>;
    };

    try {
      const clean = result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      log.warn("Memory writer: failed to parse LLM response as JSON");
      log.warn("--- RAW RESPONSE START ---");
      log.warn(result.content);
      log.warn("--- RAW RESPONSE END ---");
      return;
    }

    if (parsed.summaries) {
      const { decayed, cleaned } = memStore.decayAndCleanup();
      if (decayed > 0 || cleaned > 0) {
        log.info(`Memory writer: decayed ${decayed} facts, cleaned ${cleaned} stale`);
      }

      for (const [tier, content] of Object.entries(parsed.summaries)) {
        if (typeof content === "string" && content.trim()) {
          memStore.upsertMemory(tier as "lifetime" | "monthly" | "weekly" | "daily", content.trim());
          log.info(
            `Memory writer: wrote [${tier}] (${content.trim().length}c) "${content.trim().slice(0, 80)}${content.trim().length > 80 ? "…" : ""}"`,
          );
        }
      }
    }

    if (parsed.facts && Array.isArray(parsed.facts)) {
      let added = 0;
      let merged = 0;
      for (const f of parsed.facts) {
        if (typeof f.fact === "string" && f.fact.trim() && f.confidence > 0.5) {
          const nature = f.nature === "persistent" ? "persistent" : "temporal";
          const result = memStore.insertFact(f.fact.trim(), {
            source: "memory_writer",
            confidence: f.confidence,
            nature,
          });
          if (result.merged) merged++;
          else added++;
        }
      }
      if (added > 0 || merged > 0) {
        const previews = parsed.facts!
          .filter((f) => typeof f.fact === "string" && f.fact.trim() && f.confidence > 0.5)
          .map((f) => `"${f.fact}" (${f.confidence} ${f.nature ?? "temporal"})`)
          .join(", ");
        log.info(`Memory writer: extracted ${added} new + ${merged} merged fact(s): ${previews}`);
      }
    }
  } catch (error) {
    log.error("Memory writer: error", error);
  }
}
