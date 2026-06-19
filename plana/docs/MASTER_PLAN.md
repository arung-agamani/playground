# Plana — Master Plan

> A persona-driven Discord chat bot powered by OpenCode Go LLM.
> Core mission: immersive character roleplay as Plana from Blue Archive.

---

## 1. Project Overview

| Aspect | Decision |
|---|---|
| **Language** | TypeScript (Bun runtime) |
| **LLM Provider** | OpenCode Go — `https://opencode.ai/zen/go/v1/chat/completions` |
| **Primary Model** | DeepSeek V4 Flash ($0.14/$0.028 input, $0.28 output per 1M tokens) |
| **Discord** | discord.js v14, single-server, personal bot |
| **Database** | SQLite via `bun:sqlite` |
| **Persona** | App-wide persona (one definition), switchable via config |
| **Validation** | zod |

---

## 2. Architecture

### Data Flow (per message)

```
Discord message
  │
  ▼
┌─────────────────────────────────────────────────┐
│ HANDLER                                          │
│  1. Load conversation from SQLite               │
│  2. Load memory block (lifetime/monthly/weekly/  │
│     daily summaries)                             │
│  3. Build messages array:                        │
│     [system_prompt, memory_block, ...history,    │
│      current_msg]                                │
│  4. Call Persona Agent (LLM with tools)          │
│     ├─ If tool_call → execute → append result    │
│     │   → call LLM again → repeat                │
│     └─ If final response → break                 │
│  5. Send response to Discord                     │
│  6. Persist messages to SQLite (async)           │
│  7. Check memory thresholds → trigger            │
│     Memory Writer subagent if needed (async)     │
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

- **System prompt at position 0** — never changes, always cached by provider
- **Memory block after system prompt** — changes slowly, mostly cached
- **Messages append-only** — never insert/reorder, preserves KV cache
- **Lore is external** — stored in SQLite FTS5, retrieved via tool calls
- **Subagents are thin LLM calls** — no persona, task-specific prompts
- **Cost target** — ~$0.0002 per message, 300K messages/month under Go limits

---

## 3. Directory Structure

```
plana/
├── package.json
├── tsconfig.json
├── .env                          # DISCORD_TOKEN, OPENCODE_API_KEY
├── .env.example
├── .gitignore
│
├── src/
│   ├── index.ts                  # Entry: init db, start Discord client
│   ├── config.ts                 # Load .env + validate persona file
│   │
│   ├── discord/
│   │   ├── client.ts             # Client setup, login, guild whitelist
│   │   ├── handlers.ts           # messageCreate + interaction handlers
│   │   └── commands.ts           # Slash command definitions (/reset, /status)
│   │
│   ├── llm/
│   │   ├── opencode.ts           # OpenAI-compatible client wrapping opencode Go
│   │   └── prompts.ts            # System prompt compiler (persona → string)
│   │
│   ├── persona/
│   │   ├── types.ts              # PersonaDefinition, all sub-interfaces
│   │   ├── schema.ts             # Zod validation schemas
│   │   └── manager.ts            # Load/validate/reload persona file
│   │
│   ├── conversation/
│   │   ├── store.ts              # SQLite CRUD — messages, summaries
│   │   └── manager.ts            # Sliding window, memory injection
│   │
│   ├── memory/
│   │   ├── writer.ts             # Memory Writer subagent (summarization)
│   │   └── thresholds.ts         # Triggers for memory refresh
│   │
│   ├── lore/
│   │   ├── store.ts              # SQLite FTS5 CRUD for lore entries
│   │   └── search.ts             # Lore search tool implementation
│   │
│   └── tools/
│       ├── registry.ts           # Tool definitions + dispatch map
│       ├── handlers.ts           # Tool execution (calls store, search, etc.)
│       └── subagents/
│           └── planner.ts        # Future: task planner subagent
│
├── config/
│   └── persona.json              # Persona definition (the big one)
│
├── data/
│   ├── plana.db                  # SQLite database (gitignored)
│   └── lore/                     # Lore seed data (SQL or JSON)
│       └── seed.json
│
└── docs/
    └── MASTER_PLAN.md            # This document
```

---

## 4. Persona System

### Persona Definition Format

A single `config/persona.json` validated against a Zod schema. Six layers:

| Layer | Purpose | Prompt weight |
|---|---|---|
| `meta` | Display metadata, version tracking | Not in prompt |
| `identity` | Who they are — essence, archetype, traits | High |
| `speech` | How they speak — pronouns, endings, emotional anchors | **Highest** |
| `lore` | World knowledge — history, relationships, boundaries | Medium |
| `emotionality` | Reading user emotion, emotional response maps | Medium |
| `boundaries` | Forbidden behaviors, OOC guardrails, core directive | High |
| `corpus` | Raw reference material — dialogues, analysis | Low (always entries) |

### Speech Layer (Critical)

- Formality register selection (`very-formal` | `polite-natural` | `casual`)
- First-person pronoun selection (`watashi`, `boku`, `ore`, etc.)
- User address pattern (`Sensei`, `-san`, `-kun`, name-based)
- Sentence-ending habits with context (e.g. `desu ne`, `...`, `ne`)
- Signature phrases with frequency (`often` | `occasionally` | `rare`)
- Emotional speech anchors per emotion state
- Question/agreement/disagreement styles

### Persona Operation

- Loaded once at startup, validated via Zod
- Compiled into system prompt by `prompts.ts`
- Placed at position 0 for permanent caching
- Switchable at runtime via config reload (future)

### How to Fill the Persona

| When you research... | Put it in... |
|---|---|
| Wiki page about Plana | `lore.personal_history`, `lore.key_events` |
| Character relationship chart | `lore.relationships` |
| Screenshots of in-game dialogue | `corpus[]` with tag `"dialogue"` |
| Voice line compilations | `speech.signature_phrases`, `speech.sentence_endings` |
| Fan character analysis | `corpus[]` with tag `"analysis"` |
| Observations about how she speaks | `speech.*` — this is manual work |
| What she would never do/say | `boundaries.forbidden` |

Start with `meta`, `identity`, and `speech` — these three layers alone produce a recognizable character. Add `lore` and `corpus` as you gather material. Refine `emotionality` and `boundaries` after testing.

---

## 5. Memory System

### Architecture

```
[System Prompt]          ← Static, always cached
[MEMORY BLOCK]            ← Changes slowly, mostly cached
  ├─ Lifetime summary     ← 2-3 sentences
  ├─ Monthly highlights   ← 2-3 sentences
  ├─ Weekly recap         ← 2-3 sentences
  └─ Daily context        ← 1-2 sentences
[Recent Messages]         ← Last N messages (configurable, ~20-30)
[Current User Message]
```

### Memory Writer Subagent

- **Triggered**: conversation exceeds threshold messages OR time interval passed
- **Model**: DeepSeek V4 Flash (cheapest, no persona)
- **Input**: conversation segment to summarize
- **Output**: updated summaries per tier
- **Merging**: cumulative — old summary + new events → new summary
- **Execution**: async, never blocks user response

### Database Tables

```sql
-- Core conversation storage
CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,
  persona_name  TEXT NOT NULL DEFAULT 'default',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id),
  role             TEXT NOT NULL,  -- 'user' | 'assistant' | 'tool'
  content          TEXT,
  tool_calls       TEXT,           -- JSON
  tool_call_id     TEXT,           -- for tool results
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tiered memory summaries
CREATE TABLE memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tier       TEXT NOT NULL,  -- 'lifetime' | 'monthly' | 'weekly' | 'daily'
  content    TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pinned user facts
CREATE TABLE pinned_facts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fact       TEXT NOT NULL,
  source     TEXT,
  confidence REAL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 6. Lore Retrieval

### Design

- Lore stored in SQLite with FTS5 full-text search
- LLM calls `lookup_lore` tool when needed
- NOT pre-loaded into system prompt (saves tokens)
- Future upgrade path: embedding-based semantic search

### Database Table

```sql
CREATE VIRTUAL TABLE lore_entries USING fts5(
  id,
  character_name,
  category,        -- 'personality' | 'history' | 'relationship' | 'world_setting'
  title,
  content,
  source,
  token_count
);
```

### Tool Interface

```
Tool: lookup_lore
Params: query (string), character? (string), category? (string)
Returns: top 3 matching entries (≤ 500 tokens total)
```

### Future: Semantic Search

- Compute embeddings for lore entries (batch, offline)
- Store in vector column or separate index
- `lookup_lore` uses FTS5 for keyword + embeddings for meaning
- Same tool interface, upgraded backend

---

## 7. Cost Optimization

### Per-Message Cost Estimate (DeepSeek V4 Flash)

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| System prompt (cached) | ~2000 | $0.028/1M | $0.000056 |
| Memory block (cached) | ~300 | $0.028/1M | $0.000008 |
| History ~20 msgs (cached) | ~1500 | $0.028/1M | $0.000042 |
| New user message (fresh) | ~50 | $0.14/1M | $0.000007 |
| Response output (fresh) | ~200 | $0.28/1M | $0.000056 |
| **Total** | | | **~$0.00017** |

### Capacity at Go $10/month ($60/mo limit)

~**350,000 messages per month** — effectively unlimited for personal use.

### Optimization Rules

1. System prompt never changes → always cached
2. Memory block changes slowly → mostly cached
3. Append-only message history → preserves prefix cache
4. Evict from beginning when window full → single cache miss per eviction
5. Lore stored externally → 0 tokens until fetched
6. Subagents use cheap model, separate calls → no persona overhead

---

## 8. Tool System

### Initial Tools (Phase 1)

| Tool | Description | Handler |
|---|---|---|
| `lookup_lore` | Search Blue Archive lore | SQLite FTS5 query |
| `recall_memory` | Retrieve past conversation memories | SQLite memory query |
| `get_current_time` | Get date/time in timezone | System clock |

### Tool Definition Format (OpenAI function-calling style)

```typescript
{
  type: "function",
  function: {
    name: "lookup_lore",
    description: "Search Blue Archive lore...",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "..." },
        character: { type: "string", description: "..." }
      },
      required: ["query"]
    }
  }
}
```

### Tool Execution Loop

```
Persona Agent calls tool ──→ Tool Registry dispatches
    ↑                                    │
    │                                    ▼
    │                           Handler executes
    │                                    │
    └────────── Result appended ─────────┘
    ↓
Persona Agent called again (with tool result in messages)
    ↓
Either calls another tool (loop) or produces final response
Max iterations: 3 (prevents infinite loops)
```

---

## 9. Discord Integration

### Initial Setup

- Bot joins exactly one server (whitelist in config)
- Responds in all channels it can read (or configurable channel list)
- Listens to DMs optionally

### Commands (Phase 1)

| Command | Purpose |
|---|---|
| `/reset` | Clear conversation history for current channel |
| `/status` | Show bot status, model, memory usage |
| `/persona info` | Show current persona name and basic description |

### Future Commands

| Command | Purpose |
|---|---|
| `/persona reload` | Hot-reload persona from config file |
| `/model <id>` | Switch LLM model |
| `/memory show` | Display memory summaries |
| `/memory clear` | Clear all memory for clean start |

---

## 10. Phased Implementation Plan

### Phase 1 — Core (Minimal Viable) ✅ COMPLETE

```
[x] Project scaffolding (package.json, tsconfig, .env, gitignore)
[x] Config loader (dotenv + persona.json loader)
[x] Persona types + Zod schema + manager
[x] LLM client (OpenCode Go wrapper)
[x] System prompt compiler (persona → prompt string)
[x] SQLite store (conversations + messages tables)
[x] Conversation manager (load/save messages, sliding window)
[x] Basic tool registry (get_current_time only)
[x] Discord client + messageCreate handler
[x] Single-turn: user message → LLM → Discord response
[x] Slash commands: /reset, /status, /persona info
```

### Phase 2 — Persona Polish

```
[ ] Speech layer refinement (emotional anchors, phrase tuning)
[ ] Lore seed data loaded into SQLite FTS5
[ ] lookup_lore tool implementation
[ ] Persona responds in-character to tool results
[ ] OOC guardrail testing and refinement
[ ] Max response length enforcement
```

### Phase 3 — Memory

```
[ ] Memories table + CRUD
[ ] Memory Writer subagent (summarization)
[ ] Threshold triggers (message count, time-based)
[ ] Memory block injection into system prompt
[ ] recall_memory tool implementation
[ ] Pinned facts extraction (implicit)
```

### Phase 4 — Polish & Expansion

```
[ ] Per-channel conversation contexts
[ ] /persona reload (hot swap)
[ ] /model switch command
[ ] Optional DM support
[ ] Response streaming (discord typing indicator + chunks)
[ ] Error handling improvements
[ ] Logging (structured)
```

### Phase 5 — Future (Post-MVP)

```
[ ] Semantic lore search (embeddings)
[ ] Planner subagent (task decomposition)
[ ] Proactive context gathering (pre-processing step)
[ ] Multi-user support (per-user persona contexts)
[ ] Web dashboard for monitoring
[ ] Conversation export tool
[ ] Custom tool plugin system
[ ] MCP server wrapping for external tool access
[ ] Voice channel integration
```

---

## 11. Key Dependencies

```json
{
  "dependencies": {
    "discord.js": "^14.26.4",
    "openai": "^6.44.0",
    "zod": "^4.4.3",
    "dotenv": "^17.4.2"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/bun": "latest",
    "@types/node": "^25.9.3"
  }
}
```

---

## 12. Configuration

### `.env`

```
DISCORD_TOKEN=your_discord_bot_token
OPENCODE_API_KEY=your_opencode_api_key
OPENCODE_BASE_URL=https://opencode.ai/zen/go/v1
DEFAULT_MODEL=deepseek-v4-flash
GUILD_ID=your_guild_id
```

### Commands

```bash
bun start    # Run the bot
bun dev      # Run with watch mode (auto-reload on file changes)
```
