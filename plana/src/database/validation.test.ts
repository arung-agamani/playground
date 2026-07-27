import { describe, expect, test } from "bun:test";
import {
  taskCreateSchema,
  taskPrioritySchema,
  memoryTierSchema,
  factInsertSchema,
  writerOutputSchema,
  parseOrError,
} from "./validation";

describe("DB write validation", () => {
  test("rejects invalid task priority", () => {
    const r = parseOrError(taskPrioritySchema, "urgent", "priority");
    expect(r.ok).toBe(false);
  });

  test("accepts valid task create", () => {
    const r = parseOrError(
      taskCreateSchema,
      { userId: "u1", title: "Ship feature", priority: "high" },
      "create",
    );
    expect(r.ok).toBe(true);
  });

  test("rejects oversized fact", () => {
    const r = parseOrError(
      factInsertSchema,
      { fact: "x".repeat(2001) },
      "fact",
    );
    expect(r.ok).toBe(false);
  });

  test("whitelist memory tiers", () => {
    expect(parseOrError(memoryTierSchema, "daily", "t").ok).toBe(true);
    expect(parseOrError(memoryTierSchema, "hourly", "t").ok).toBe(false);
  });

  test("writer output schema clamps structure", () => {
    const r = parseOrError(
      writerOutputSchema,
      {
        summaries: { daily: "hello" },
        facts: [{ fact: "likes tea", confidence: 0.9, nature: "persistent" }],
      },
      "writer",
    );
    expect(r.ok).toBe(true);
  });

  test("writer rejects bad confidence", () => {
    const r = parseOrError(
      writerOutputSchema,
      { facts: [{ fact: "x", confidence: 2 }] },
      "writer",
    );
    expect(r.ok).toBe(false);
  });
});
