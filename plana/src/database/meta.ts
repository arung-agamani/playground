// Workflow overview for the Drizzle ORM setup
//
// 1. Edit schema files in src/database/schema/*.ts
// 2. Run `bun run db:generate` — generates migration SQL in src/database/migrations/
// 3. Review the generated SQL
// 4. Run `bun run db:migrate` — lists pending migrations
// 5. Apply migrations manually or via your database admin tool
//
// When switching between SQLite and Postgres:
//   - SQLite schemas live in schema/*.ts (using drizzle-orm/sqlite-core)
//   - Postgres will get parallel schema files (using drizzle-orm/pg-core)
//   - drizzle.config.ts selects the dialect
//   - Sets `dialect: "sqlite"` for dev, swap to `"postgresql"` for prod
//
// Database setup for each environment:
//   Dev (SQLite):  bun run db:generate → review → apply manually
//   Prod (Postgres): swap dialect in drizzle.config.ts → bun run db:generate
//                    → connect and apply via `psql plana < migration.sql`
export const SCHEMA_VERSION = "2026-06-21:initial";
