import { z } from "zod";

export const memoryTierSchema = z.enum([
  "lifetime",
  "monthly",
  "weekly",
  "daily",
]);

export const factNatureSchema = z.enum(["persistent", "temporal"]);

export const taskStatusSchema = z.enum([
  "backlog",
  "ready",
  "in-progress",
  "done",
]);

export const taskPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const actionTypeSchema = z.enum(["remind", "greeting", "nudge"]);

export const messageRoleSchema = z.enum(["user", "assistant", "tool"]);

const maxText = (n: number) => z.string().max(n);

export const saveMessageSchema = z.object({
  role: messageRoleSchema,
  content: maxText(50_000).nullable().optional(),
  toolCalls: z.unknown().nullable().optional(),
  toolCallId: maxText(128).nullable().optional(),
});

export const reminderCreateSchema = z.object({
  guildId: z.string().min(1).max(64),
  channelId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  message: maxText(2000),
  actionType: actionTypeSchema.optional(),
  actionConfig: z.record(z.string(), z.unknown()).optional(),
  type: z.enum(["once", "recurring"]),
  dueAt: z.string().min(1).max(64),
  recurrence: maxText(64).nullable().optional(),
});

export const taskCreateSchema = z.object({
  userId: z.string().min(1).max(64),
  title: maxText(500).min(1),
  priority: taskPrioritySchema.optional(),
  category: maxText(100).optional(),
  notes: maxText(5000).optional(),
  deadline: maxText(64).optional(),
});

export const taskUpdateSchema = z.object({
  title: maxText(500).optional(),
  priority: taskPrioritySchema.optional(),
  category: maxText(100).optional(),
  notes: maxText(5000).optional(),
  deadline: maxText(64).optional(),
});

export const memoryUpsertSchema = z.object({
  tier: memoryTierSchema,
  content: maxText(20_000),
});

export const factInsertSchema = z.object({
  fact: maxText(2000).min(1),
  source: maxText(64).optional(),
  confidence: z.number().min(0).max(1).optional(),
  nature: factNatureSchema.optional(),
});

export const writerOutputSchema = z.object({
  summaries: z
    .record(z.string(), z.string().max(20_000))
    .optional(),
  facts: z
    .array(
      z.object({
        fact: z.string().min(1).max(2000),
        confidence: z.number().min(0).max(1),
        nature: factNatureSchema.optional(),
      }),
    )
    .max(50)
    .optional(),
});

export function parseOrError<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `${label}: ${msg}` };
  }
  return { ok: true, data: result.data };
}
