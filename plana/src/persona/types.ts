export interface PersonaDefinition {
  id: string;
  meta: PersonaMeta;
  identity: IdentityLayer;
  speech: SpeechLayer;
  lore: LoreLayer;
  emotionality: EmotionalityLayer;
  boundaries: BoundariesLayer;
  corpus: CorpusEntry[];
}

export interface PersonaMeta {
  display_name: string;
  source: string;
  source_url?: string;
  author_note?: string;
  version: number;
  created: string;
}

export interface IdentityLayer {
  essence: string;
  archetype: string;
  traits: TraitDef[];
  role_in_world: string;
  self_perception?: string;
}

export interface TraitDef {
  trait: string;
  description: string;
  expresses_as: string;
}

export type Formality = "very-formal" | "polite-natural" | "casual";

export interface SpeechLayer {
  formality: Formality;
  first_person: string;
  user_address: string;
  sentence_endings: SentenceEnding[];
  signature_phrases: SignaturePhrase[];
  verbal_tics: string[];
  question_style: string;
  agreement_style: string;
  emotional_anchors: Record<string, EmotionSpeechAnchor>;
  greeting_template?: string;
  farewell_template?: string;
}

export interface SentenceEnding {
  ending: string;
  usage_context: string;
}

export interface SignaturePhrase {
  phrase: string;
  context: string;
  frequency: "often" | "occasionally" | "rare";
}

export interface EmotionSpeechAnchor {
  speech_shift: string;
  sample: string;
}

export interface LoreLayer {
  world_description: string;
  personal_history: string;
  key_events: LoreEvent[];
  relationships: RelationshipDef[];
  knowledge_domains: string[];
  knowledge_boundaries: string[];
}

export interface LoreEvent {
  event: string;
  significance: string;
}

export interface RelationshipDef {
  name: string;
  relation: string;
  dynamic: string;
  how_they_address_them?: string;
}

export interface EmotionalityLayer {
  sentiment_detection: string;
  emotional_responses: EmotionalResponse[];
  own_emotional_range: string[];
  suppressed_emotions?: string[];
}

export interface EmotionalResponse {
  when_user_is: string;
  response_pattern: string;
  sample_line?: string;
}

export interface BoundariesLayer {
  core_directive: string;
  forbidden: string[];
  out_of_world_handling: string;
  max_response_chars?: number;
}

export interface CorpusEntry {
  tag: "dialogue" | "lore" | "analysis" | "voice_line" | "scene";
  source?: string;
  priority: "always" | "contextual" | "reference";
  label?: string;
  context_trigger?: string;
  content: string;
  demonstrates?: string;
}
