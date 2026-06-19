import type { MemoryStore, MemoryRow } from "./store";

const RELEVANCE_CUTOFF = -5;

interface ScoredMemory extends MemoryRow {
  rank: number;
}

export function searchMemories(
  store: MemoryStore,
  query: string,
): { memories: ScoredMemory[]; facts: string[]; needsRerank: boolean } {
  const rawResults = store.searchMemories(query);
  const memories = rawResults as ScoredMemory[];
  const facts = store.getAllFacts().map((f) => f.fact);

  const topScore = memories[0]?.rank ?? Infinity;
  const needsRerank = topScore > RELEVANCE_CUTOFF;

  return { memories, facts, needsRerank };
}

export async function rerankWithLlm(
  query: string,
  memories: ScoredMemory[],
  facts: string[],
  opencodeBaseUrl: string,
  opencodeApiKey: string,
): Promise<string> {
  const allCandidates = [
    ...memories.map((m) => `[memory:${m.tier}] ${m.content}`),
    ...facts.map((f) => `[fact] ${f}`),
  ];

  if (allCandidates.length === 0) return "No memories or facts available.";

  const prompt = [
    "You are a relevance ranker. Given a user query and a list of memories/facts,",
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
    // If JSON parse fails, return raw text
  }

  return text;
}
