import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  PersonaDefinition,
  IdentityLayer,
  SpeechLayer,
  LoreLayer,
  EmotionalityLayer,
  BoundariesLayer,
  CorpusEntry,
  TraitDef,
  SentenceEnding,
  SignaturePhrase,
  EmotionSpeechAnchor,
  EmotionalResponse,
  LoreEvent,
  RelationshipDef,
} from "./types";

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([a-z_]+):\s*(.+)$/i);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim();
  }
  return { meta, body: match[2] ?? "" };
}

function splitSections(text: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];
  const parts = text.split(/^(?=##)/m);
  for (const part of parts) {
    const lines = part.trim().split("\n");
    const heading = lines[0]?.replace(/^#{2,4}\s*/, "").trim() ?? "";
    const content = lines.slice(1).join("\n").trim();
    if (heading) sections.push({ heading, content });
  }
  return sections;
}

function parseTraits(text: string): TraitDef[] {
  const traits: TraitDef[] = [];
  const allBlocks = text.split(/^(?=###\s)/m);

  for (const block of allBlocks) {
    const lines = block.trim().split("\n");
    const rawHeading = lines[0] ?? "";
    if (!rawHeading.startsWith("### ")) continue;

    const content = lines.slice(1).join("\n").trim();
    const hasHowManifests = content.toLowerCase().includes("how this manifests");
    if (!hasHowManifests) continue;

    const headingName = rawHeading.replace(/^###\s+/, "").trim();
    const contentLines = content.split("\n");

    let description = "";
    let expresses = "";

    for (const line of contentLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.toLowerCase().startsWith("how this manifests")) {
        expresses = trimmed.replace(/^how this manifests:?\s*/i, "").trim();
        continue;
      }
      if (description === "") {
        description = trimmed;
      }
    }

    if (description) {
      traits.push({
        trait: headingName,
        description,
        expresses_as: expresses || description,
      });
    }
  }

  return traits;
}

function parseSentenceEndings(text: string): SentenceEnding[] {
  const endings: SentenceEnding[] = [];
  const section = splitSections(text).find((s) =>
    s.heading.toLowerCase().includes("sentence ending"),
  );
  if (!section) return endings;

  const blocks = section.content.split(/(?=^###?\s)/m);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const ending = lines[0]?.replace(/^###?\s*/, "").trim();
    const context = lines.slice(1).join(" ").trim();
    if (ending && context && ending.length < 20) {
      endings.push({ ending, usage_context: context });
    }
  }
  return endings;
}

function parseSignaturePhrases(text: string): SignaturePhrase[] {
  const phrases: SignaturePhrase[] = [];
  const section = splitSections(text).find((s) =>
    s.heading.toLowerCase().includes("signature phrase"),
  );
  if (!section) return phrases;

  const blocks = section.content.split(/(?=^###?\s)/m);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const quoteLine = lines[0]?.replace(/^###?\s*"?/, "").replace(/"$/, "").trim();
    if (!quoteLine) continue;

    let context = "";
    let frequency: "often" | "occasionally" | "rare" = "often";
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (l.toLowerCase().startsWith("context:")) {
        context = l.replace(/^context:\s*/i, "").trim();
      } else if (l.toLowerCase().startsWith("frequency:")) {
        const f = l.replace(/^frequency:\s*/i, "").trim().toLowerCase();
        if (f === "rare" || f === "occasionally") frequency = f as "rare" | "occasionally";
      }
    }

    phrases.push({ phrase: quoteLine, context, frequency });
  }
  return phrases;
}

function parseEmotionalAnchors(text: string): Record<string, EmotionSpeechAnchor> {
  const anchors: Record<string, EmotionSpeechAnchor> = {};
  const section = splitSections(text).find((s) =>
    s.heading.toLowerCase().includes("emotional speech"),
  );
  if (!section) return anchors;

  const blocks = section.content.split(/(?=^###?\s+When\s)/m);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const heading = lines[0]?.replace(/^###?\s*When\s+/i, "").trim().toLowerCase();
    if (!heading) continue;

    const emotion = heading.replace(/\s+/g, "_");
    let speechShift = "";
    let sample = "";

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (l.startsWith(">")) {
        sample = l.replace(/^>\s*/, "").trim();
      } else if (l && !l.startsWith("#")) {
        speechShift += l + " ";
      }
    }

    if (speechShift || sample) {
      anchors[emotion] = {
        speech_shift: speechShift.trim(),
        sample,
      };
    }
  }
  return anchors;
}

function parseEmotionalResponses(text: string): EmotionalResponse[] {
  const responses: EmotionalResponse[] = [];
  const section = splitSections(text).find((s) =>
    s.heading.toLowerCase().includes("emotional response"),
  );
  if (!section) return responses;

  const blocks = section.content.split(/(?=^###?\s+When\s)/m);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const heading = lines[0]?.replace(/^###?\s*When\s+[Ss]ensei\s+/i, "").replace(/seems?\s+/i, "").trim();
    if (!heading) continue;

    let pattern = "";
    let sampleLine = "";

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (l.startsWith(">")) {
        sampleLine = l.replace(/^>\s*/, "").trim();
      } else if (l && !l.startsWith("#")) {
        pattern += l + " ";
      }
    }

    responses.push({
      when_user_is: heading,
      response_pattern: pattern.trim(),
      sample_line: sampleLine || undefined,
    });
  }
  return responses;
}

function parseDialogueExamples(text: string): string {
  const cleaned = text
    .replace(/^#.*$/gm, "")
    .replace(/^---[\s\S]*?---$/m, "")
    .trim();
  return cleaned || text;
}

function loadIdentity(identityText: string): IdentityLayer {
  const { meta } = parseFrontmatter(identityText);
  const sections = splitSections(identityText);

  const essenceSection = sections.find((s) => s.heading.toLowerCase() === "essence");
  const traits = parseTraits(identityText);

  return {
    essence: essenceSection?.content ?? "",
    archetype: meta.archetype ?? "",
    traits,
    role_in_world: meta.role_in_world ?? "",
    self_perception: meta.self_perception,
  };
}

function loadSpeech(speechText: string): SpeechLayer {
  const { meta } = parseFrontmatter(speechText);
  const sections = splitSections(speechText);

  const questionStyle =
    sections.find((s) => s.heading.toLowerCase().includes("question"))?.content ?? "";
  const agreementStyle =
    sections
      .find((s) => s.heading.toLowerCase().includes("agreement"))
      ?.content.trim()
      .split("\n")
      .join(" ") ?? "";

  const verbalTics: string[] = [];
  const verbalSection = sections.find((s) => s.heading.toLowerCase().includes("verbal habit"));
  if (verbalSection) {
    for (const line of verbalSection.content.split("\n")) {
      const cleaned = line.replace(/^-\s*/, "").trim();
      if (cleaned) verbalTics.push(cleaned);
    }
  }

  const greetingMatch = speechText.match(/[Gg]reeting:\s*"([^"]+)"/);
  const farewellMatch = speechText.match(/[Ff]arewell:\s*"([^"]+)"/);

  let greetingTemplate: string | undefined;
  let farewellTemplate: string | undefined;

  const greetSection = sections.find((s) => s.heading.toLowerCase().includes("greeting"));
  if (greetSection) {
    const quoteMatch = greetSection.content.match(/>\s*(.+)/);
    if (quoteMatch) greetingTemplate = quoteMatch[1]!.trim();
  }

  const fareSection = sections.find((s) => s.heading.toLowerCase().includes("farewell"));
  if (fareSection) {
    const quoteMatch = fareSection.content.match(/>\s*(.+)/);
    if (quoteMatch) farewellTemplate = quoteMatch[1]!.trim();
  }

  if (!greetingTemplate && greetingMatch) greetingTemplate = greetingMatch[1];
  if (!farewellTemplate && farewellMatch) farewellTemplate = farewellMatch[1];

  return {
    formality: (meta.formality as SpeechLayer["formality"]) ?? "polite-natural",
    first_person: meta.first_person ?? "watashi",
    user_address: meta.user_address ?? "Sensei",
    sentence_endings: parseSentenceEndings(speechText),
    signature_phrases: parseSignaturePhrases(speechText),
    verbal_tics: verbalTics,
    question_style: questionStyle,
    agreement_style: agreementStyle,
    emotional_anchors: parseEmotionalAnchors(speechText),
    greeting_template: greetingTemplate,
    farewell_template: farewellTemplate,
  };
}

function loadLore(loreText: string): LoreLayer {
  const body = parseFrontmatter(loreText).body;
  const sections = splitSections(body);

  const worldDesc = sections.find((s) =>
    s.heading.toLowerCase().includes("world description"),
  );
  const personalHist = sections.find((s) =>
    s.heading.toLowerCase().includes("personal history"),
  );
  const keyEventsSection = sections.find((s) =>
    s.heading.toLowerCase().includes("key event"),
  );
  const relsSection = sections.find((s) =>
    s.heading.toLowerCase().includes("relationship"),
  );
  const domainsSection = sections.find((s) =>
    s.heading.toLowerCase().includes("knowledge domain"),
  );
  const boundariesSection = sections.find((s) =>
    s.heading.toLowerCase().includes("knowledge bound"),
  );

  const keyEvents: LoreEvent[] = [];
  if (keyEventsSection) {
    const items = keyEventsSection.content.split(/(?=^-\s)/m);
    for (const item of items) {
      const match = item.match(/-\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+)/s);
      if (match) {
        keyEvents.push({ event: match[1]!.trim(), significance: match[2]!.trim() });
      }
    }
  }

  const relationships: RelationshipDef[] = [];
  const relsRaw = extractSection(body, "## Relationships");
  if (relsRaw) {
    const blocks = relsRaw.split(/(?=^###\s)/m);
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 2) continue;
      const headingLine = lines[0]!;
      const rest = lines.slice(1).join(" ").trim();

      const headingMatch = headingLine.match(/^###\s+(.+?)\s*\((.+?)\)\s*$/);
      if (headingMatch) {
        relationships.push({
          name: headingMatch[1]!.trim(),
          relation: headingMatch[2]!.trim(),
          dynamic: rest,
          how_they_address_them: headingMatch[1]!.trim(),
        });
      }
    }
  }

  const domains = domainsSection
    ? domainsSection.content
        .split("\n")
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter(Boolean)
    : [];

  const boundaries = boundariesSection
    ? boundariesSection.content
        .split("\n")
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter(Boolean)
    : [];

  return {
    world_description: worldDesc?.content ?? "",
    personal_history: personalHist?.content ?? "",
    key_events: keyEvents,
    relationships,
    knowledge_domains: domains,
    knowledge_boundaries: boundaries,
  };
}

function loadEmotionality(text: string): EmotionalityLayer {
  const sections = splitSections(parseFrontmatter(text).body);

  const sentimentSection = sections.find((s) =>
    s.heading.toLowerCase().includes("sentiment detection"),
  );

  const emotionalRange: string[] = [];
  const suppressedList: string[] = [];
  const rangeSection = sections.find((s) =>
    s.heading.toLowerCase().includes("own emotional"),
  );
  if (rangeSection) {
    const parts = rangeSection.content.split(/\n(?=Emotions you)/);
    for (const part of parts) {
      const items = part.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
      if (part.toLowerCase().includes("express:")) {
        emotionalRange.push(
          ...items.filter((i) => !i.toLowerCase().includes("emotion")),
        );
      } else if (part.toLowerCase().includes("not express") || part.toLowerCase().includes("suppress")) {
        suppressedList.push(
          ...items.filter((i) => !i.toLowerCase().includes("emotion")),
        );
      }
    }
  }

  return {
    sentiment_detection: sentimentSection?.content ?? "",
    emotional_responses: parseEmotionalResponses(text),
    own_emotional_range: emotionalRange.length > 0 ? emotionalRange : [],
    suppressed_emotions: suppressedList.length > 0 ? suppressedList : undefined,
  };
}

function loadBoundaries(text: string): BoundariesLayer {
  const body = parseFrontmatter(text).body;
  const sections = splitSections(body);

  const directive = sections.find((s) =>
    s.heading.toLowerCase().includes("prime directive"),
  );
  const neverSection = sections.find((s) =>
    s.heading.toLowerCase().includes("never do"),
  );
  const handlingSection = sections.find((s) =>
    s.heading.toLowerCase().includes("handling"),
  );
  const lengthSection = sections.find((s) =>
    s.heading.toLowerCase().includes("response length"),
  );

  const forbidden = neverSection
    ? neverSection.content
        .split("\n")
        .map((l) => l.replace(/^-\s*[Nn]ever\s*/, "").replace(/^-\s*/, "").trim())
        .filter(Boolean)
    : [];

  let maxChars: number | undefined;
  if (lengthSection) {
    const match = lengthSection.content.match(/(\d+)/);
    if (match) maxChars = Number(match[1]);
  }

  return {
    core_directive: directive?.content ?? "",
    forbidden,
    out_of_world_handling: handlingSection?.content ?? "",
    max_response_chars: maxChars,
  };
}

function loadCorpus(dirPath: string): CorpusEntry[] {
  if (!existsSync(dirPath)) return [];

  const entries: CorpusEntry[] = [];
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const raw = readFileSync(join(dirPath, file), "utf-8");
    const { meta, body } = parseFrontmatter(raw);

    if (meta.ignore) continue;

    const entry: CorpusEntry = {
      tag: (meta.tag as CorpusEntry["tag"]) ?? "dialogue",
      priority: (meta.priority as CorpusEntry["priority"]) ?? "always",
      content: parseDialogueExamples(body) || raw,
    };

    if (meta.label) entry.label = meta.label;
    if (meta.source) entry.source = meta.source;
    if (meta.demonstrates) entry.demonstrates = meta.demonstrates;

    entries.push(entry);
  }

  return entries;
}

function extractSection(text: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  const match = text.match(regex);
  return match ? match[1]!.trim() : null;
}

export function loadPersonaDir(dirPath: string): PersonaDefinition {
  if (!existsSync(dirPath)) {
    throw new Error(`Persona directory not found: ${dirPath}`);
  }

  const read = (filename: string): string => {
    const filePath = join(dirPath, filename);
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  };

  const cardText = read("card.md");
  const cardMeta = parseFrontmatter(cardText).meta;

  const identity = loadIdentity(read("identity.md"));
  const speech = loadSpeech(read("speech.md"));
  const lore = loadLore(read("lore.md"));
  const emotionality = loadEmotionality(read("emotionality.md"));
  const boundaries = loadBoundaries(read("boundaries.md"));
  const corpus = loadCorpus(join(dirPath, "corpus"));

  const id = cardMeta.id ?? basename(dirPath).toLowerCase();

  return {
    id,
    meta: {
      display_name: cardMeta.display_name ?? id,
      source: cardMeta.source ?? "",
      source_url: cardMeta.source_url,
      author_note: cardMeta.author_note,
      version: Number(cardMeta.version) || 1,
      created: cardMeta.created ?? new Date().toISOString().slice(0, 10),
    },
    identity,
    speech,
    lore,
    emotionality,
    boundaries,
    corpus,
  };
}
