---
name: codemap
description: Hierarchical repository maps. Use when exploring a codebase to build a structured map of directories, key files, entry points, and dependencies. Useful for Aris (Explorer) and Yuzu (Orchestrator) for initial reconnaissance.
---

# Codebase Mapping

Build a hierarchical "dungeon map" of the repository to understand its structure at a glance.

## When to Use

- First time exploring an unfamiliar codebase
- Before planning a large feature or refactor
- When you need to understand how directories, packages, and entry points relate

## How to Build a Codemap

1. **Scan the top level**: List root directories and config files (`package.json`, `tsconfig.json`, etc.).
2. **Identify entry points**: Find main source directories, build tooling configs, and package entry points.
3. **Map each top-level directory**: For each major directory, list key subdirectories, important files, and describe what the directory is responsible for.
4. **Trace dependencies**: Identify package dependencies (from `package.json`), internal import patterns, and cross-directory relationships.
5. **Note conventions**: File naming patterns, test file conventions, style patterns.

## Output Format

```
📦 Project Name
├── 📁 src/              — Main source directory
│   ├── 📁 components/   — Reusable UI components
│   ├── 📁 utils/        — Utility functions and helpers
│   ├── 📁 api/          — API client and endpoint definitions
│   └── 📄 index.ts      — Application entry point
├── 📁 tests/            — Test files (mirrors src/ structure)
├── 📄 package.json      — Node.js package manifest
└── 📄 tsconfig.json     — TypeScript configuration
```

Include a brief summary: entry points, key dependencies, notable conventions.
