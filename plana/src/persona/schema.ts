import { z } from "zod";

const Formality = z.enum(["very-formal", "polite-natural", "casual"]);
const Frequency = z.enum(["often", "occasionally", "rare"]);
const CorpusTag = z.enum([
  "dialogue",
  "lore",
  "analysis",
  "voice_line",
  "scene",
]);
const CorpusPriority = z.enum(["always", "contextual", "reference"]);

const PersonaMeta = z.object({
  display_name: z.string(),
  source: z.string(),
  source_url: z.string().optional(),
  author_note: z.string().optional(),
  version: z.number(),
  created: z.string(),
});

const TraitDef = z.object({
  trait: z.string(),
  description: z.string(),
  expresses_as: z.string(),
});

const IdentityLayer = z.object({
  essence: z.string(),
  archetype: z.string(),
  traits: z.array(TraitDef).min(3),
  role_in_world: z.string(),
  self_perception: z.string().optional(),
});

const SentenceEnding = z.object({
  ending: z.string(),
  usage_context: z.string(),
});

const EmotionSpeechAnchor = z.object({
  speech_shift: z.string(),
  sample: z.string(),
});

const SignaturePhrase = z.object({
  phrase: z.string(),
  context: z.string(),
  frequency: Frequency,
});

const SpeechLayer = z.object({
  formality: Formality,
  first_person: z.string(),
  user_address: z.string(),
  sentence_endings: z.array(SentenceEnding),
  signature_phrases: z.array(SignaturePhrase),
  verbal_tics: z.array(z.string()),
  question_style: z.string(),
  agreement_style: z.string(),
  emotional_anchors: z.record(z.string(), EmotionSpeechAnchor),
  greeting_template: z.string().optional(),
  farewell_template: z.string().optional(),
});

const LoreEvent = z.object({
  event: z.string(),
  significance: z.string(),
});

const RelationshipDef = z.object({
  name: z.string(),
  relation: z.string(),
  dynamic: z.string(),
  how_they_address_them: z.string().optional(),
});

const LoreLayer = z.object({
  world_description: z.string(),
  personal_history: z.string(),
  key_events: z.array(LoreEvent),
  relationships: z.array(RelationshipDef),
  knowledge_domains: z.array(z.string()),
  knowledge_boundaries: z.array(z.string()),
});

const EmotionalResponse = z.object({
  when_user_is: z.string(),
  response_pattern: z.string(),
  sample_line: z.string().optional(),
});

const EmotionalityLayer = z.object({
  sentiment_detection: z.string(),
  emotional_responses: z.array(EmotionalResponse),
  own_emotional_range: z.array(z.string()),
  suppressed_emotions: z.array(z.string()).optional(),
});

const BoundariesLayer = z.object({
  core_directive: z.string(),
  forbidden: z.array(z.string()),
  out_of_world_handling: z.string(),
  max_response_chars: z.number().int().positive().optional(),
});

const CorpusEntry = z.object({
  tag: CorpusTag,
  source: z.string().optional(),
  priority: CorpusPriority,
  label: z.string().optional(),
  context_trigger: z.string().optional(),
  content: z.string(),
  demonstrates: z.string().optional(),
});

export const PersonaDefinitionSchema = z.object({
  id: z.string(),
  meta: PersonaMeta,
  identity: IdentityLayer,
  speech: SpeechLayer,
  lore: LoreLayer,
  emotionality: EmotionalityLayer,
  boundaries: BoundariesLayer,
  corpus: z.array(CorpusEntry),
});
