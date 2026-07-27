import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import { createDb, closeDb } from "../db";
import * as schema from "../database";
import { createStore } from "../conversation/store";
import { createMemoryStore } from "../memory/store";
import { createTaskStore } from "../tasks/store";
import { createReminderStore } from "../reminders/store";
import { createLoreStore } from "../lore/store";
import { nowIso } from "./time";

const TEST_DB_URL = "postgres://plana:plana_dev@localhost:5432/plana_test";
let pg: ReturnType<typeof createDb>;

beforeEach(async () => {
  pg = createDb(TEST_DB_URL);
  await pg.execute(
    "TRUNCATE conversations, messages, memories, pinned_facts, lore_entries, reminders, tasks RESTART IDENTITY CASCADE",
  );
});

afterAll(async () => {
  await closeDb();
});

describe("PG stores", () => {
  test("ISO timestamps on messages", async () => {
    const store = createStore(pg);
    await store.saveMessage("g", "c", "user", "hello");
    const msgs = await store.getMessages("g", "c");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(msgs[0]!.content).toBe("hello");
  });

  test("task priority validation", async () => {
    const tasks = createTaskStore(pg);
    await expect(
      tasks.create({ userId: "u", title: "t", priority: "nope" as never }),
    ).rejects.toThrow();
    const row = await tasks.create({ userId: "u", title: "ok", priority: "high" });
    expect(row.priority).toBe("high");
  });

  test("reminder due uses ISO compare", async () => {
    const reminders = createReminderStore(pg);
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    await reminders.create({
      guildId: "g",
      channelId: "c",
      userId: "u",
      message: "past",
      type: "once",
      dueAt: past,
    });
    await reminders.create({
      guildId: "g",
      channelId: "c",
      userId: "u",
      message: "future",
      type: "once",
      dueAt: future,
    });
    const due = await reminders.getDue();
    expect(due.map((r) => r.message)).toEqual(["past"]);
  });

  test("FTS after fact insert", async () => {
    const mem = createMemoryStore(pg);
    await mem.insertFact("Sensei drinks coffee every morning", {
      confidence: 0.9,
      nature: "persistent",
    });
    const hits = await mem.searchFacts("coffee");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.fact.toLowerCase()).toContain("coffee");
  });

  test("lore FTS", async () => {
    const lore = createLoreStore(pg);
    await lore.insert({
      characterName: "Arona",
      category: "personality",
      title: "Cheerful",
      content: "Arona is an energetic AI companion in Kivotos.",
    });
    const hits = await lore.search("Kivotos");
    expect(hits.length).toBeGreaterThan(0);
  });

  test("nowIso is lexicographically comparable", () => {
    const a = nowIso();
    const b = new Date(Date.now() + 1000).toISOString();
    expect(a < b).toBe(true);
  });
});
