import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPersonaFromConfig } from "../src/config";
import { compileSystemPrompt, estimateTokens } from "../src/llm/prompts";

const persona = loadPersonaFromConfig();
const prompt = compileSystemPrompt(persona);
const tokens = estimateTokens(prompt);

const outPath = join(import.meta.dir, "..", "personas", persona.id, "system-prompt.txt");
writeFileSync(outPath, prompt, "utf-8");

console.log(`Exported system prompt for "${persona.meta.display_name}"`);
console.log(`  File: ${outPath}`);
console.log(`  Size: ${prompt.length} chars, ~${tokens} tokens`);
