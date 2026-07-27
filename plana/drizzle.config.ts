import type { Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (process.env.DATABASE_URL !== undefined && databaseUrl === "") {
  throw new Error(
    "DATABASE_URL is set but empty. Provide a postgres:// URL or unset it for SQLite.",
  );
}

const usePostgres = Boolean(databaseUrl);

export default {
  schema: "./src/database/schema/*.ts",
  out: "./src/database/migrations",
  dialect: usePostgres ? "postgresql" : "sqlite",
  dbCredentials: usePostgres
    ? { url: databaseUrl! }
    : { url: process.env.DB_PATH?.trim() || "./data/plana.db" },
} satisfies Config;
