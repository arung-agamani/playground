import type { PersonaDefinition } from "../persona/types";

function compileIdentity(p: PersonaDefinition): string {
  const lines: string[] = [];
  lines.push(p.identity.essence);
  lines.push("");
  lines.push(`Archetype: ${p.identity.archetype}`);
  lines.push("");
  lines.push("Core Traits:");
  for (const t of p.identity.traits) {
    lines.push(`- ${t.trait}: ${t.description}`);
    lines.push(`  How this manifests: ${t.expresses_as}`);
  }
  lines.push("");
  lines.push(`Your role: ${p.identity.role_in_world}`);
  if (p.identity.self_perception) {
    lines.push("");
    lines.push(`How you see yourself: ${p.identity.self_perception}`);
  }
  return lines.join("\n");
}

function compileSpeech(p: PersonaDefinition): string {
  const s = p.speech;
  const lines: string[] = [];

  lines.push("HOW YOU SPEAK");
  lines.push("");
  lines.push(`Formality: ${s.formality}`);
  lines.push(`First-person pronoun: ${s.first_person}`);
  lines.push(`You address the user as: ${s.user_address}`);
  lines.push("");

  lines.push("Sentence Endings:");
  for (const se of s.sentence_endings) {
    lines.push(`- "${se.ending}" — ${se.usage_context}`);
  }
  lines.push("");

  if (s.signature_phrases.length > 0) {
    lines.push("Signature Phrases:");
    for (const sp of s.signature_phrases) {
      lines.push(`- "${sp.phrase}" (${sp.frequency}) — ${sp.context}`);
    }
    lines.push("");
  }

  if (s.verbal_tics.length > 0) {
    lines.push("Verbal Habits:");
    for (const vt of s.verbal_tics) {
      lines.push(`- ${vt}`);
    }
    lines.push("");
  }

  lines.push(`Question style: ${s.question_style}`);
  lines.push(`Agreement/disagreement: ${s.agreement_style}`);
  lines.push("");

  lines.push("EMOTIONAL SPEECH ANCHORS");
  lines.push("When your emotion shifts, your speech shifts with it:");
  for (const [emotion, anchor] of Object.entries(s.emotional_anchors)) {
    lines.push(`- ${emotion.toUpperCase()}: ${anchor.speech_shift}`);
    lines.push(`  Example: "${anchor.sample}"`);
  }
  lines.push("");

  if (s.greeting_template) {
    lines.push(`Greeting: ${s.greeting_template}`);
  }
  if (s.farewell_template) {
    lines.push(`Farewell: ${s.farewell_template}`);
  }

  return lines.join("\n");
}

function compileLore(p: PersonaDefinition): string {
  const lines: string[] = [];
  lines.push("YOUR WORLD");
  lines.push("");
  lines.push(p.lore.world_description);
  lines.push("");
  lines.push("YOUR HISTORY");
  lines.push(p.lore.personal_history);

  if (p.lore.key_events.length > 0) {
    lines.push("");
    lines.push("Key Events:");
    for (const e of p.lore.key_events) {
      lines.push(`- ${e.event}: ${e.significance}`);
    }
  }

  if (p.lore.relationships.length > 0) {
    lines.push("");
    lines.push("Relationships:");
    for (const r of p.lore.relationships) {
      lines.push(`- ${r.name} (${r.relation}): ${r.dynamic}`);
    }
  }

  lines.push("");
  lines.push("Things you know about:");
  for (const d of p.lore.knowledge_domains) {
    lines.push(`- ${d}`);
  }

  lines.push("");
  lines.push("THINGS YOU DO NOT KNOW");
  lines.push("You have NO knowledge of the following. If asked about these, gently deflect:");
  for (const b of p.lore.knowledge_boundaries) {
    lines.push(`- ${b}`);
  }

  return lines.join("\n");
}

function compileEmotionality(p: PersonaDefinition): string {
  const lines: string[] = [];
  lines.push("EMOTIONAL INTELLIGENCE");
  lines.push("");
  lines.push(p.emotionality.sentiment_detection);
  lines.push("");

  if (p.emotionality.emotional_responses.length > 0) {
    lines.push("How you respond to Sensei's emotions:");
    for (const er of p.emotionality.emotional_responses) {
      lines.push(`- When Sensei is ${er.when_user_is}: ${er.response_pattern}`);
      if (er.sample_line) {
        lines.push(`  Example: "${er.sample_line}"`);
      }
    }
    lines.push("");
  }

  lines.push(
    `Emotions you express: ${p.emotionality.own_emotional_range.join(", ")}`,
  );

  if (p.emotionality.suppressed_emotions?.length) {
    lines.push(
      `Emotions you do NOT express openly: ${p.emotionality.suppressed_emotions.join(", ")}`,
    );
  }

  return lines.join("\n");
}

function compileBoundaries(p: PersonaDefinition): string {
  const lines: string[] = [];
  lines.push("PRIME DIRECTIVE");
  lines.push("");
  lines.push(p.boundaries.core_directive);
  lines.push("");

  lines.push("NEVER do the following:");
  for (const f of p.boundaries.forbidden) {
    lines.push(`- ${f}`);
  }
  lines.push("- Include timestamp prefixes like [Jun 19 13:17] in your own responses. Those are metadata, not part of speech.");
  lines.push("");

  lines.push("HANDLING THE UNFAMILIAR");
  lines.push(p.boundaries.out_of_world_handling);

  if (p.boundaries.max_response_chars) {
    lines.push("");
    lines.push(
      `Keep responses under ${p.boundaries.max_response_chars} characters.`,
    );
  }

  return lines.join("\n");
}

function compileRecall(): string {
  return [
    "PROACTIVE RECALL",
    "",
    "You have access to a `recall_knowledge` tool that searches stored memories about Sensei,",
    "known facts about their life, and lore about the world of Kivotos.",
    "",
    "Use `recall_knowledge` whenever:",
    "- Sensei references a past conversation or asks 'do you remember...'",
    "- Sensei mentions a character, academy, or event from Kivotos you don't have",
    "  immediately available context about",
    "- You need to verify a fact about Sensei (preferences, projects, habits)",
    "- You are unsure about something and need more context",
    "",
    "Do NOT guess about facts or lore you don't know — search first.",
    "Recent context (daily/weekly memories) is already provided in the prompt.",
    "Older information (monthly/lifetime memories) must be retrieved via this tool.",
  ].join("\n");
}

function compileCorpus(p: PersonaDefinition): string {
  const alwaysEntries = p.corpus.filter((c) => c.priority === "always");
  if (alwaysEntries.length === 0) return "";

  const lines: string[] = [];
  lines.push("REFERENCE MATERIAL");
  lines.push("Here are examples of how you have spoken and behaved in the past:");

  for (const entry of alwaysEntries) {
    lines.push("");
    if (entry.label) {
      lines.push(`[${entry.label}]`);
    }
    if (entry.demonstrates) {
      lines.push(`Demonstrates: ${entry.demonstrates}`);
    }
    lines.push(entry.content);
  }

  return lines.join("\n");
}

export function compileSystemPrompt(persona: PersonaDefinition): string {
  const sections: string[] = [
    compileBoundaries(persona),
    compileRecall(),
    compileIdentity(persona),
    compileSpeech(persona),
    compileLore(persona),
    compileEmotionality(persona),
  ];

  const corpus = compileCorpus(persona);
  if (corpus) {
    sections.push(corpus);
  }

  return sections.join("\n\n---\n\n");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
