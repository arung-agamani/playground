# G-Bible

> *"The Game Development Department's secret weapon — a multi-agent orchestration system that turns software development into a team-based RPG."*

**G-Bible** is a reusable, character-themed agent orchestrator pack for [opencode](https://opencode.ai). It brings Millennium Science School's finest students into your terminal, each powered by DeepSeek V4, each with a specialized role, all coordinated by the GDD's own President Yuzu.

---

## Lore — Blue Archive Volume 2

Millennium Science School. A city of glass and steel where logic reigns supreme. Among its many clubs, the **Game Development Department** (GDD) fights a losing battle against irrelevance. Their president, Hanabusa Yuzu, struggles to keep the club alive with only three members and a mysterious AI girl they found in an ancient ruin.

But the GDD has something no other club has: **teamwork**. Momoi's creativity, Midori's precision, Aris's boundless curiosity, and Yuzu's quiet leadership — together, they build games that reach people's hearts.

This agent pack captures that spirit. Each agent embodies a Millennium student, with personality, quirks, and a role that matches their character. Together, they form an orchestration system that tackles software engineering tasks as a coordinated team.

> *"We're not just making games. We're making something that matters." — Yuzu*

---

## The Team (Agents)

| Agent | Character | Club | Role | Write? |
|-------|-----------|------|------|:---:|
| `yuzu` | **Hanabusa Yuzu** | GDD (President) | **Orchestrator** — Plans, delegates, reconciles | Yes |
| `aris` | **Tendou Aris (Alice)** | GDD | **Explorer** — Codebase discovery, search, mapping | No |
| `yuuka` | **Hayase Yuuka** | Seminar (Treasurer) | **Oracle** — Architecture, debugging, cost analysis | No |
| `midori` | **Saiba Midori** | GDD | **Fixer** — Implementation, backend, logic | **Yes** |
| `momoi` | **Saiba Momoi** | GDD | **Designer** — UI/UX, frontend, visual polish | **Yes** |
| `noa` | **Ushio Noa** | Seminar (Secretary) | **Librarian** — Docs, web search, knowledge retrieval | No |
| `chihiro` | **Kagami Chihiro** | Veritas (President) | **Observer** — Visual analysis, screenshots (hidden) | No |

---

## Installation

### Prerequisites
- [opencode](https://opencode.ai) installed and configured
- A DeepSeek V4 provider configured in your opencode setup

### Option 1 — Copy Agents + Reference Skills (Project-local)

```bash
# Copy agents into your project (opencode auto-discovers .md files here)
cp -r g-bible/agents .opencode/agents/g-bible

# Reference skills in your project's .opencode/opencode.json:
```

```json
{
  "skills": {
    "paths": ["g-bible/skills"]
  }
}
```

Then restart opencode. The agents (`@yuzu`, `@aris`, etc.) will be available.

### Option 2 — Symlink (recommended for development)

```bash
# Symlink to global config — available in all projects
ln -s "$(pwd)/g-bible/agents" ~/.config/opencode/agents/g-bible
ln -s "$(pwd)/g-bible/skills" ~/.config/opencode/skills/g-bible
```

### Option 3 — npm (future)

```bash
npx @awoo/g-bible init
```

*(Coming soon)*

---

## Usage

### Start with Yuzu

The orchestrator is your entry point. Invoke her directly or set her as your default agent:

```
@yuzu We need to add a user registration flow with email verification
```

Yuzu will:
1. Understand the task
2. Plan the dependency graph
3. Dispatch specialists (Aris to explore, Noa to research, Midori to implement, Momoi to design)
4. Reconcile results
5. Verify completion
6. Report back

### Call Specialists Directly

You can also invoke agents individually:

```
@aris Find all authentication-related code in this project
@yuuka Review the architecture of src/api/ — is there any unnecessary complexity?
@midori Implement the password reset endpoint following the pattern in auth.ts
@momoi Build a settings page with the same design language as the dashboard
@noa Look up the latest API for drizzle-orm migrations
```

### Orchestration Pattern

The recommended workflow for complex tasks:

1. **@yuzu** for the overall task — she'll orchestrate
2. If you need specific help, call specialists directly
3. For multi-agent debugging: `@yuzu @yuuka investigate this bug`

---

## Architecture

```
User asks Yuzu
        │
        ▼
    Yuzu (Orchestrator)
    ┌─────────────────────────┐
    │ 1. UNDERSTAND the task  │
    │ 2. PLAN dependency graph│
    │ 3. DISPATCH specialists │
    └──────┬──────────────────┘
           │
    ┌──────┼──────┬──────┬──────┐
    ▼      ▼      ▼      ▼      ▼
  Aris   Noa   Yuuka  Midori Momoi
(Explore)(Research)(Advise)(Build)(Design)
    │      │      │      │      │
    └──────┴──────┴──────┴──────┘
           │ results
           ▼
    Yuzu (Reconcile)
    ┌─────────────────────────┐
    │ 4. RECONCILE results    │
    │ 5. VERIFY completion    │
    │ 6. REPORT to user       │
    └─────────────────────────┘
```

**Key rules**:
- Only one writer per file at a time (Midori and Momoi coordinate)
- Read-only agents (Aris, Yuuka, Noa, Chihiro) can always run in parallel
- Independent exploration and research can happen simultaneously
- Yuzu CAN write code herself for small/simple tasks

---

## Skills

The pack includes three reusable skills:

| Skill | Description | Used By |
|-------|-------------|---------|
| `codemap` | Build hierarchical repository maps | Aris, Yuzu |
| `simplify` | Behavior-preserving code simplification | Yuuka |
| `verification-planning` | Define verification paths before implementing | Yuzu |

Skills are loaded from `g-bible/skills/`. They can be used by any agent granted access.

---

## Customization

### Changing the model

Edit the agent's `.md` frontmatter or override in your `opencode.json`:

```json
{
  "agent": {
    "yuzu": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

### Modifying agent behavior

Each agent's `.md` file in `g-bible/agents/` is the full system prompt — frontmatter for config, body for behavior. Edit to customize:
- Tone and personality
- Role boundaries
- Delegation rules
- Tool permissions (in frontmatter)

Restart opencode for changes to take effect.

### Adding new agents

Create a new `.md` file in `g-bible/agents/` with the proper frontmatter. The agent will be available as `@agentname` after restart.

---

## Credits

- Characters from **Blue Archive** by NEXON Games
- Agent architecture inspired by **oh-my-opencode-slim** by alvinunreal
- Powered by **DeepSeek V4** via opencode

---

*"Sensei, the Game Development Department is ready. What shall we build today?" — Yuzu*
