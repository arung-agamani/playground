import { eq, sql, and, or, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../database";
import { nowIso } from "../database/time";
import { encrypt, decrypt } from "../database/crypto";
import {
  memoryUpsertSchema,
  factInsertSchema,
  parseOrError,
} from "../database/validation";

export type MemoryTier = "lifetime" | "monthly" | "weekly" | "daily";

export interface MemoryRow {
  id: number;
  tier: MemoryTier;
  content: string;
  updated_at: string;
}

export interface FactRow {
  id: number;
  fact: string;
  source: string | null;
  confidence: number;
  nature: "persistent" | "temporal";
  freshness: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

function rowToStr(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") return d;
  return d.toISOString();
}

function tsToStr(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") return d;
  return d.toISOString();
}

export function createMemoryStore(db: PostgresJsDatabase<typeof schema>) {
  function decodeMemory(row: MemoryRow): MemoryRow {
    return { ...row, content: decrypt(row.content) ?? row.content };
  }

  function decodeFact(row: FactRow): FactRow {
    return { ...row, fact: decrypt(row.fact) ?? row.fact };
  }

  function toMemoryRow(r: Record<string, unknown>): MemoryRow {
    return {
      id: r.id as number,
      tier: r.tier as MemoryTier,
      content: r.content as string,
      updated_at: tsToStr(r.updated_at as Date | string),
    };
  }

  function toFactRow(r: Record<string, unknown>): FactRow {
    return {
      id: r.id as number,
      fact: r.fact as string,
      source: r.source as string | null,
      confidence: r.confidence as number,
      nature: r.nature as "persistent" | "temporal",
      freshness: r.freshness as number,
      revision: r.revision as number,
      created_at: tsToStr(r.created_at as Date | string),
      updated_at: tsToStr(r.updated_at as Date | string),
    };
  }

  async function upsertMemory(tier: MemoryTier, content: string): Promise<void> {
    const parsed = parseOrError(
      memoryUpsertSchema,
      { tier, content },
      "upsertMemory",
    );
    if (!parsed.ok) throw new Error(parsed.error);

    const ts = nowIso();
    await db.insert(schema.memories).values({
      tier: parsed.data.tier,
      content: encrypt(parsed.data.content) ?? parsed.data.content,
      updated_at: sql`${ts}::timestamp`,
    }).onConflictDoUpdate({
      target: schema.memories.tier,
      set: {
        content: encrypt(parsed.data.content) ?? parsed.data.content,
        updated_at: sql`${ts}::timestamp`,
      },
    });
  }

  async function getMemory(tier: MemoryTier): Promise<string> {
    const [row] = await db.select().from(schema.memories)
      .where(eq(schema.memories.tier, tier)).limit(1);
    if (!row) return "";
    const r = row as unknown as MemoryRow;
    return decrypt(r.content) ?? r.content;
  }

  async function getAllMemories(): Promise<MemoryRow[]> {
    const rows = await db.select().from(schema.memories)
      .orderBy(schema.memories.tier);
    return (rows as unknown as MemoryRow[]).map(decodeMemory);
  }

  async function buildMemoryBlock(): Promise<string> {
    const rows = await getAllMemories();
    const recentFacts = await db.select({
      fact: schema.pinnedFacts.fact,
    }).from(schema.pinnedFacts)
      .where(or(
        eq(schema.pinnedFacts.nature, "persistent"),
        and(
          eq(schema.pinnedFacts.nature, "temporal"),
          sql`${schema.pinnedFacts.freshness} > 0.6`,
        ),
      ))
      .orderBy(
        sql`CASE WHEN ${schema.pinnedFacts.nature} = 'persistent' THEN 0 ELSE 1 END`,
        desc(schema.pinnedFacts.freshness),
        desc(schema.pinnedFacts.created_at),
      )
      .limit(100);

    const parts: string[] = [];
    const include: MemoryTier[] = ["daily", "weekly"];
    for (const tier of include) {
      const r = rows.find((r) => r.tier === tier);
      if (r && r.content.length > 0) {
        parts.push(`[${tier}]: ${r.content}`);
      }
    }

    if (recentFacts.length > 0) {
      parts.push("");
      parts.push("Recent facts about Sensei:");
      for (const f of recentFacts) {
        const decrypted = decrypt(f.fact) ?? f.fact;
        parts.push(`- ${decrypted}`);
      }
    }

    return parts.join("\n");
  }

  async function insertFact(
    fact: string,
    options?: {
      source?: string;
      confidence?: number;
      nature?: "persistent" | "temporal";
    },
  ): Promise<{ id: number; merged: boolean }> {
    const parsed = parseOrError(
      factInsertSchema,
      {
        fact,
        source: options?.source,
        confidence: options?.confidence,
        nature: options?.nature,
      },
      "insertFact",
    );
    if (!parsed.ok) throw new Error(parsed.error);

    const nature = parsed.data.nature ?? "temporal";
    const confidence = parsed.data.confidence ?? 0.8;
    const plainFact = parsed.data.fact;
    const storedFact = encrypt(plainFact) ?? plainFact;

    const existing = await db.execute(sql`
      SELECT pf.id, pf.fact, pf.confidence, pf.nature, pf.freshness, pf.revision,
        ts_rank(
          to_tsvector('english', pf.fact),
          plainto_tsquery('english', ${plainFact})
        ) as rank
      FROM ${schema.pinnedFacts} pf
      WHERE to_tsvector('english', pf.fact) @@ plainto_tsquery('english', ${plainFact})
      ORDER BY rank DESC
      LIMIT 1
    `) as unknown as Array<{
      id: number; fact: string; confidence: number;
      nature: string; freshness: number; revision: number; rank: number;
    }>;

    if (existing.length > 0 && existing[0]!.rank > 0.3) {
      const newConfidence = Math.max(existing[0]!.confidence, confidence);
      await db.update(schema.pinnedFacts)
        .set({
          fact: storedFact,
          confidence: newConfidence,
          nature,
          freshness: 1.0,
          revision: existing[0]!.revision + 1,
          updated_at: sql`${nowIso()}::timestamp`,
        })
        .where(eq(schema.pinnedFacts.id, existing[0]!.id));
      return { id: existing[0]!.id, merged: true };
    }

    const ts = nowIso();
    const [row] = await db.insert(schema.pinnedFacts).values({
      fact: storedFact,
      source: parsed.data.source ?? null,
      confidence,
      nature,
      freshness: 1.0,
      revision: 1,
      created_at: sql`${ts}::timestamp`,
      updated_at: sql`${ts}::timestamp`,
    }).returning();
    return { id: (row as unknown as { id: number }).id, merged: false };
  }

  async function getAllFacts(): Promise<FactRow[]> {
    const rows = await db.select().from(schema.pinnedFacts)
      .orderBy(
        desc(schema.pinnedFacts.freshness),
        desc(schema.pinnedFacts.confidence),
        desc(schema.pinnedFacts.created_at),
      );
    return (rows as unknown as FactRow[]).map(decodeFact);
  }

  async function searchMemories(query: string): Promise<Array<MemoryRow & { rank: number }>> {
    const rows = await db.execute(sql`
      SELECT m.id, m.tier, m.content,
        ts_rank(
          to_tsvector('english', m.content),
          websearch_to_tsquery('english', ${query})
        ) as rank
      FROM ${schema.memories} m
      WHERE to_tsvector('english', m.content) @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT 5
    `);
    return (rows as Array<{ id: number; tier: string; content: string; rank: number }>).map(
      (r) => ({ ...r, tier: r.tier as MemoryTier, content: decrypt(r.content) ?? r.content }),
    );
  }

  async function searchFacts(
    query: string,
  ): Promise<Array<{ id: number; fact: string; confidence: number; rank: number }>> {
    const rows = await db.execute(sql`
      SELECT pf.id, pf.fact, pf.confidence,
        ts_rank(
          to_tsvector('english', pf.fact),
          websearch_to_tsquery('english', ${query})
        ) as rank
      FROM ${schema.pinnedFacts} pf
      WHERE to_tsvector('english', pf.fact) @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT 5
    `);
    const results = (rows as Array<{ id: number; fact: string; confidence: number; rank: number }>).map(
      (r) => ({ ...r, fact: decrypt(r.fact) ?? r.fact }),
    );

    if (results.length < 2 && query.trim().length > 2) {
      const terms = query.trim().split(/\s+/).filter(Boolean);
      const ilikeClauses = terms.map((t) => sql`pf.fact ILIKE ${`%${t}%`}`);
      const fuzzy = await db.execute(sql`
        SELECT pf.id, pf.fact, pf.confidence,
          word_similarity(pf.fact, ${query}) as rank
        FROM ${schema.pinnedFacts} pf
        WHERE ${sql.join(ilikeClauses, sql` OR `)}
          OR word_similarity(pf.fact, ${query}) > 0.1
        ORDER BY rank DESC
        LIMIT 5
      `);
      const fuzzyResults = (fuzzy as Array<{ id: number; fact: string; confidence: number; rank: number }>).map(
        (r) => ({ ...r, fact: decrypt(r.fact) ?? r.fact }),
      );
      if (fuzzyResults.length > results.length) return fuzzyResults;
    }

    return results;
  }

  async function decayAndCleanup(): Promise<{ decayed: number; cleaned: number }> {
    const decayResult = await db.update(schema.pinnedFacts)
      .set({
        freshness: sql`GREATEST(0, ${schema.pinnedFacts.freshness} - 0.1)`,
        updated_at: sql`${nowIso()}::timestamp`,
      })
      .where(and(
        eq(schema.pinnedFacts.nature, "temporal"),
        sql`${schema.pinnedFacts.freshness} > 0`,
      ));
    const cleanedResult = await db.delete(schema.pinnedFacts)
      .where(and(
        eq(schema.pinnedFacts.nature, "temporal"),
        sql`${schema.pinnedFacts.freshness} <= 0`,
      ));
    return { decayed: decayResult.length, cleaned: cleanedResult.length };
  }

  function close(): void {}

  return {
    upsertMemory,
    getMemory,
    getAllMemories,
    buildMemoryBlock,
    insertFact,
    getAllFacts,
    searchMemories,
    searchFacts,
    decayAndCleanup,
    close,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
