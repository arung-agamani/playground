import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createLoreStore } from "./store";

const DB_PATH = join(import.meta.dir, "..", "..", "data", "plana.db");
const LORE_DIR = join(import.meta.dir, "..", "..", "docs", "lore");

if (!existsSync(LORE_DIR)) {
  console.log(`Lore directory not found: ${LORE_DIR}`);
  process.exit(1);
}

const store = createLoreStore(DB_PATH);
store.clear();

const files = readdirSync(LORE_DIR).filter((f) => f.endsWith(".md"));
let inserted = 0;

for (const file of files) {
  const raw = readFileSync(join(LORE_DIR, file), "utf-8");
  const { meta, sections } = parseLoreMarkdown(raw);

  for (const s of sections) {
    store.insert({
      characterName: meta.character ?? file.replace(".md", ""),
      category: s.category ?? meta.category ?? "general",
      title: s.title,
      content: s.content,
      source: meta.source,
    });
    inserted++;
  }
}

store.rebuild();
store.close();

console.log(`Seeded ${inserted} lore entries from ${files.length} file(s).`);

// ── Parser ──────────────────────────────────────────────

function parseLoreMarkdown(raw: string): {
  meta: Record<string, string>;
  sections: Array<{ category?: string; title: string; content: string }>;
} {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let meta: Record<string, string> = {};
  let body = raw;

  if (fmMatch) {
    for (const line of fmMatch[1]!.split("\n")) {
      const kv = line.match(/^([a-z_]+):\s*(.+)$/i);
      if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim();
    }
    body = fmMatch[2] ?? "";
  }

  const sections: Array<{ category?: string; title: string; content: string }> = [];
  const parts = body.split(/^(?=##\s)/m);

  for (const part of parts) {
    const lines = part.trim().split("\n");
    if (lines.length < 2) continue;
    const heading = lines[0]?.replace(/^##\s*/, "").trim() ?? "";
    const content = lines.slice(1).join("\n").trim();
    if (heading && content) {
      sections.push({ title: heading, content });
    }
  }

  // If no ## sections found, use the whole body as one entry
  if (sections.length === 0 && body.trim()) {
    sections.push({
      title: meta.title ?? file.replace(".md", ""),
      content: body.trim(),
    });
  }

  return { meta, sections };
}
