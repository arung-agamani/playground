import type { MemoryStore, MemoryRow } from "./store";
import type { LoreStore, LoreRow } from "../lore/store";

interface ScoredMemory extends MemoryRow {
  rank: number;
}

interface ScoredLore extends LoreRow {
  rank: number;
}

export async function searchAll(
  memStore: MemoryStore,
  loreStore: LoreStore,
  query: string,
): Promise<{ memories: ScoredMemory[]; facts: string[]; lore: ScoredLore[] }> {
  const rawMemories = await memStore.searchMemories(query);
  const memories = rawMemories as ScoredMemory[];
  const rawFacts = await memStore.searchFacts(query);
  const facts = rawFacts.map((f) => f.fact);
  const lore = await loreStore.search(query) as ScoredLore[];

  return { memories, facts, lore };
}

export async function rerankWithLlm(
  query: string,
  memories: ScoredMemory[],
  facts: string[],
  lore: ScoredLore[],
  opencodeBaseUrl: string,
  opencodeApiKey: string,
): Promise<string> {
  const allCandidates = [
    ...memories.map((m) => `[memory:${m.tier}] ${m.content.slice(0, 300)}`),
    ...facts.map((f) => `[fact] ${f}`),
    ...lore.map((l) => `[lore:${l.character_name}] ${l.title}: ${l.content.slice(0, 200)}`),
  ];

  if (allCandidates.length === 0) return "No results found.";

  const prompt = [
    "You are a relevance ranker. Given a user query and a list of memories/facts/lore,",
    "select the top 3 most relevant items. Return ONLY a JSON array of the exact",
    "text of the most relevant items (their full [type] content).",
    "",
    `Query: "${query}"`,
    "",
    "Candidates:",
    ...allCandidates.map((c, i) => `${i + 1}. ${c}`),
    "",
    `Output: ["[type] content of #X", ...]`,
  ].join("\n");

  const res = await fetch(`${opencodeBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opencodeApiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0,
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message: { content: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "[]";

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.join("\n");
    }
  } catch {
  }

  return text;
}
