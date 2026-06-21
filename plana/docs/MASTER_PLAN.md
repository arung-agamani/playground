# Plana — Master Plan

> A persona-driven Discord chat bot powered by OpenCode Go LLM.
> Core mission: immersive character roleplay as Plana from Blue Archive.

---

## 1. Project Overview

| Aspect | Decision |
|---|---|
| **Language** | TypeScript (Bun runtime) |
| **LLM Provider** | OpenCode Go — `https://opencode.ai/zen/go/v1/chat/completions` |
| **Primary Model** | DeepSeek V4 Flash (text) / MiMo-V2.5 (vision) |
| **Discord** | discord.js v14, single-server, personal bot |
| **Database** | SQLite via `bun:sqlite` |
| **Persona** | Markdown-based character cards in `personas/` directory |
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
│  1. Check for image attachments → vision model  │
│  2. Load conversation from SQLite               │
│  3. Build memory block (daily + weekly)          │
│  4. Build messages:                              │
│     [system_prompt, memory_block, ...history,    │
│      current_msg]                                │
│  5. Call Persona Agent (LLM with tools)          │
│     └─ Up to 6 rounds of tool calls              │
│  6. Send response to Discord (chunked if >2000c) │
│  7. Save to SQLite                               │
│  8. Check memory thresholds → trigger            │
│     Memory Writer subagent (async)               │
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

- **System prompt at position 0** — never changes (~10K tokens), always cached
- **Memory block**: daily + weekly in prompt (~130 tokens); lifetime/monthly in FTS5
- **Messages append-only** — preserves KV cache prefix
- **Tool messages bundled as atomic chain** — entire assistant+tool sequence loaded or none
- **Persona as markdown** — `personas/plana/` directory, human-editable, switchable via `PERSONA=name`
- **Context budget**: 24K tokens total, 30 message hard cap

---

## 3. Directory Structure

```
plana/
├── package.json
├── tsconfig.json
├── .env / .env.example
├── .gitignore
│
├── src/
│   ├── index.ts                  # Entry: init stores, start Discord, seed greeting
│   ├── config.ts                 # Load .env + persona
│   ├── debug.ts                  # Logging utility (LOG_LEVEL)
│   │
│   ├── discord/
│   │   ├── client.ts             # Client setup, login, guild whitelist
│   │   ├── handlers.ts           # Message handler, tool loop, memory triggers
│   │   └── commands.ts           # Slash commands
│   │
│   ├── llm/
│   │   ├── opencode.ts           # OpenAI-compatible client (timeout: 120s)
│   │   └── prompts.ts            # System prompt compiler (persona → string)
│   │
│   ├── persona/
│   │   ├── types.ts              # PersonaDefinition interfaces
│   │   ├── schema.ts             # Zod schemas
│   │   ├── manager.ts            # Load persona from directory
│   │   └── loader.ts             # Markdown → PersonaDefinition parser
│   │
│   ├── conversation/
│   │   ├── store.ts              # Messages + conversations CRUD
│   │   └── manager.ts            # Sliding window + timestamp injection
│   │
│   ├── memory/
│   │   ├── store.ts              # Memories + Facts + FTS5 tables
│   │   ├── writer.ts             # Memory Writer subagent (summarization + facts)
│   │   ├── search.ts             # Unified FTS5 search (memories + facts + lore)
│   │   └── thresholds.ts         # Trigger logic (15 msgs / 30 min)
│   │
│   ├── lore/
│   │   ├── store.ts              # Lore FTS5 table + search
│   │   └── seed.ts               # Markdown → FTS5 seeder
│   │
│   ├── reminders/
│   │   ├── store.ts              # Reminders table (action dispatcher foundation)
│   │   ├── engine.ts             # Polling scheduler + action handlers
│   │   └── parser.ts             # Time/recurrence parsing (chrono-node)
│   │
│   ├── tasks/
│   │   └── store.ts              # Backlog/task management CRUD
│   │
│   └── tools/
│       ├── registry.ts           # All tool definitions + dispatch map
│       └── handlers.ts           # Tool implementations (reminders, tasks, search, memory)
│
├── personas/                     # Character cards
│   └── plana/
│       ├── card.md               # Metadata (name, source, version)
│       ├── identity.md            # Essence, traits, role in world
│       ├── speech.md              # ★ Critical: speech patterns + dialogue examples
│       ├── lore.md                # Personal history, relationships, knowledge
│       ├── emotionality.md        # Sentiment detection, emotional responses
│       ├── boundaries.md          # Prime directive, forbidden behaviors
│       └── corpus/                # Dialogue examples by situation
│           ├── greetings.md
│           ├── casual.md
│           ├── concern.md
│           ├── tools.md
│           └── situations.md
│
├── docs/
│   ├── MASTER_PLAN.md
│   └── lore/                     # Blue Archive world knowledge
│       └── sample.md
│
└── data/
    └── plana.db                  # SQLite (gitignored)
```

---

## 4. Persona System

### Character Card Format

Markdown files in `personas/{name}/`. Each file has optional YAML frontmatter + freeform body. Loaded by `loader.ts` at startup.

| File | Purpose | ~Tokens |
|---|---|---|
| `card.md` | Metadata (name, source, archetype, version) | — |
| `speech.md` | ★ Speech patterns, emotional anchors, extensive dialogue examples | ~4500 |
| `identity.md` | Essence, traits (3-5), role in world | ~2000 |
| `lore.md` | Personal history, relationships, knowledge domains/boundaries | ~1500 |
| `emotionality.md` | Sentiment detection, emotional response maps | ~1500 |
| `boundaries.md` | Prime directive, forbidden list, timestamp rule | ~1000 |
| `corpus/*.md` | Dialogue examples by situation (greetings, casual, concern, tools, situations) | ~1500 |

**Total system prompt**: ~10,000 tokens (position 0, always cached).

### Speech Layer (Critical)

The most token-allocated section. Includes:
- Formality register, pronouns, user address pattern
- Sentence endings with context
- Signature phrases with frequency
- Emotional speech anchors per emotion (happy, worried, curious, determined, embarrassed, melancholic)
- Greeting + farewell templates
- Extensive dialogue examples

### Adding a new persona

```bash
cp -r personas/plana personas/izuna
# Edit all .md files
PERSONA=izuna bun start
```

---

## 5. Memory System

### Architecture

```
[System Prompt]          ← Static, ~10K tokens, always cached
[MEMORY BLOCK]            ← Daily + Weekly, ~130 tokens, mostly cached
[Recent Messages]         ← Last ~20-30 messages (~13K token budget)
[Current User Message]    ← With timestamp, ~50 tokens
```

### Tiers in prompt vs FTS5

| Tier | In prompt | In FTS5 |
|---|---|---|
| daily | ✅ (~50 tokens) | ✅ |
| weekly | ✅ (~80 tokens) | ✅ |
| monthly | — | ✅ (on-demand) |
| lifetime | — | ✅ (on-demand) |

### Memory Writer

- **Triggered**: every 15 messages OR 30 minutes of activity
- **Model**: DeepSeek V4 Flash (temperature: 0, maxTokens: 8000)
- **Input**: existing summaries + last 30 messages
- **Output**: updated summaries + extracted facts (with confidence + nature classification planned)
- **Execution**: async, never blocks user response
- **Logging**: verbose diagnostics at debug level

### Pinned Facts

- Extracted by Memory Writer during summarization
- Searchable via `facts_fts` FTS5
- Queried by `recall_knowledge` tool
- 71 facts captured and growing
- **Planned**: deduplication + freshness tracking (see Future Ideas)

---

## 6. Knowledge Retrieval (RAG)

### `recall_knowledge` — Unified RAG Tool

Single tool searches three FTS5 stores:

| Store | Content | Example |
|---|---|---|
| `memories_fts` | Tiered memory summaries | "[weekly] Sensei is working on a game project" |
| `facts_fts` | Pinned facts about Sensei | "Sensei's cat is Mochi (0.9)" |
| `lore_fts` | Blue Archive world lore | "Millennium Science School specializes in..." |

**Strategy**: ≤5 total results → return directly (no API cost). >5 results → LLM reranker picks top 3.

### Lore Authoring

```bash
# Write markdown in docs/lore/*.md
bun run lore:seed   # Clears + re-inserts all entries via FTS5
```

Each markdown file frontmatter: `character`, `category`, `source`. Body split at `##` headings — each becomes a separate FTS5 entry.

### Proactive Recall

System prompt instructs Plana to use `recall_knowledge` whenever unsure — not just when explicitly asked. Covers "do you remember...", "what academy is...", "what did we talk about..."

---

## 7. Tool System

### Active Tools

| Tool | Category | Description |
|---|---|---|
| `get_current_time` | Read | Current date/time in configured timezone |
| `create_reminder` | Mutation | Create one-time or recurring reminder |
| `edit_reminder` | Mutation | Edit existing reminder |
| `delete_reminder` | Mutation | Cancel a reminder |
| `list_reminders` | Read | List all active reminders |
| `add_task` | Mutation | Add task to backlog |
| `list_tasks` | Read | List tasks with optional filters |
| `move_task` | Mutation | Move task between statuses |
| `edit_task` | Mutation | Edit task fields |
| `delete_task` | Mutation | Delete a task |
| `sprint_tasks` | Read | View/set sprint focus |
| `archive_tasks` | Mutation | Archive completed tasks |
| `daily_tasks` | Read | Morning digest of all tasks |
| `web_search` | Read | Tavily web search (conditional on API key) |
| `recall_knowledge` | Read | Unified RAG across memories + facts + lore |
| `add_fact` | Mutation | Explicitly record a fact about Sensei |

### Proactive Mode Restrictions

For autonomous actions (greeting, nudge), only read-only tools are available:

```
get_current_time, list_tasks, list_reminders, daily_tasks,
recall_knowledge, web_search
```

All mutation tools (create/delete reminders, edit tasks, add facts) are blocked.

### Vision Support

When a message contains image attachments, the bot:
1. Switches to `VISION_MODEL` (MiMo-V2.5)
2. Builds multimodal content: `[{ image_url }, { text }]`
3. No changes to conversation history required

---

## 8. Proactive Messaging

### Architecture

Leverages the reminder engine's action dispatcher. Each proactive action is a **full conversational turn** — saved to history, counted for memory summarization.

### Action Handlers

| Action | Trigger | Behavior |
|---|---|---|
| `remind` | User-set reminder due | Send @mention with reminder text |
| `greeting` | `GREETING_TIME` daily | Full persona LLM call with restricted tools: check time, tasks, reminders, deadlines. Warm morning message. Skipped if user was active. |
| `nudge` | 30 min after greeting (once) | Gentle check-in if user hasn't replied. Max 2 nudges. |

### Configuration

```ini
GREETING_TIME=08:00          # 24h format, Jakarta time
GREETING_CHANNEL_ID=...      # Channel to send morning greeting
```

Auto-seeded on startup. Greeting + nudge created as recurring+once reminders.

### Guardrails

- Read-only tools only (no state changes without user initiation)
- Skips entirely if user was active that day
- Saved to conversation history → visible in context → counted for memory

---

## 9. Discord Integration

### Slash Commands

| Command | Purpose |
|---|---|
| `/reset` | Clear conversation history |
| `/status` | Show model, persona, endpoint |
| `/persona info` | Show persona traits + speech details |
| `/memory show` | Display current memory block + pinned facts |
| `/memory write` | Manually trigger Memory Writer |

### Debugging

```bash
bun run inspect                  # DB overview + conversations
bun run inspect show <id>        # Show conversation messages
bun run inspect clean <id>       # Clear conversation
bun run inspect reminders [id]   # List/inspect reminders
bun run inspect db               # Table sizes + schemas
```

### Logging

```
LOG_LEVEL=debug bun start   # Full trace: LLM requests, tool calls, memory writer
LOG_LEVEL=info               # Default: key events only
```

---

## 10. Cost Profile

### Per-Message Estimate (DeepSeek V4 Flash)

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| System prompt (cached) | ~10000 | $0.028/1M | $0.00028 |
| Memory block (cached) | ~130 | $0.028/1M | $0.000004 |
| History ~25 msgs (cached) | ~5000 | $0.028/1M | $0.00014 |
| New user msg (fresh) | ~50 | $0.14/1M | $0.000007 |
| Response output (fresh) | ~250 | $0.28/1M | $0.00007 |
| **Total** | | | **~$0.00050** |

### Capacity at Go $10/month ($60/mo limit)

~**120,000 messages/month** — effectively unlimited for personal use.

### Optimization Rules

1. System prompt static → always cached (position 0)
2. Memory block slow-changing → mostly cached
3. Append-only history → preserves prefix cache
4. Atomic tool chains → no orphaned messages
5. Lore + facts in FTS5 → 0 tokens until queried
6. Memory Writer uses cheap model, separate call → no persona overhead
7. Greeting checks recent activity → skips if not needed

---

## 11. Implementation Status

### ✅ Completed

- Core bot with 6-round tool call loop
- Character card system (markdown-based personas)
- Reminders engine with recurring support + action dispatcher
- Task/backlog management with sprint + archive
- Memory Writer with tiered summaries + facts extraction
- Unified knowledge retrieval (RAG) across memories + facts + lore
- Web search (Tavily)
- Vision support (MiMo-V2.5 via Go)
- Proactive greeting + nudge system
- Debug logging + inspector CLI
- Message timestamp injection
- Tool result bundling + orphaned tool protection
- Response chunking for >2000 char messages
- Timestamp stripping middleware

### 🔜 Next: Phase 4 — Polish & Expansion

- Per-channel conversation contexts
- `/persona reload` (hot-swap persona without restart)
- Response streaming
- Optional DM support
- YouTube/social media link preview

### 💡 Future Ideas

- **Fact quality management** — deduplication, LLM-classified nature (persistent vs temporal), selective decay
- **Postgres migration** — better FTS capabilities, vector search
- **Planner subagent** — multi-step task decomposition
- **External service hooks** — calendar, weather, RSS
- **Voice channel integration** — Join VC, TTS
- **Web dashboard** — conversation monitoring, memory inspection
- **Custom tool plugin system** — user-defined tools
- **Multi-persona switching** — runtime persona swap

---

## 12. Key Dependencies

```json
{
  "dependencies": {
    "discord.js": "^14.26.4",
    "openai": "^6.44.0",
    "zod": "^4.4.3",
    "dotenv": "^17.4.2",
    "chrono-node": "^2.9.1"
  }
}
```

### Scripts

```bash
bun start           # Run the bot
bun dev             # Watch mode (auto-reload)
bun run inspect     # DB inspection CLI
bun run lore:seed   # Seed Blue Archive lore from markdown
```

### Environment

```ini
DISCORD_TOKEN=
OPENCODE_API_KEY=
OPENCODE_BASE_URL=https://opencode.ai/zen/go/v1
DEFAULT_MODEL=deepseek-v4-flash
VISION_MODEL=mimo-v2.5
GUILD_ID=
DEFAULT_TIMEZONE=Asia/Jakarta
TAVILY_API_KEY=
PERSONA=plana
GREETING_TIME=08:00
GREETING_CHANNEL_ID=
LOG_LEVEL=info
```
