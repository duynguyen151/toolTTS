import { AiTaskConfigInputSchema, PersistedAiTaskConfigSchema, type PersistedAiTaskConfig } from "@shop-health/decision-ai";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DatabaseTransaction } from "../client.js";
import { aiTaskConfigs, type AiTaskConfigRow } from "../schema.js";

const ValidDateSchema = z.date().refine((value) => Number.isFinite(value.getTime()), {
  message: "Date must be finite",
});
const CurrentInputSchema = z.strictObject({
  taskId: z.enum(["SHOP_HEALTH_REVIEWER", "FINANCE_SPECIALIST", "ORDER_ANOMALY_REVIEWER", "BA_ASSISTANT"]),
  effectiveAt: ValidDateSchema,
});

export type AppendAiTaskConfigRevisionInput = z.input<typeof AiTaskConfigInputSchema>;
export type GetCurrentAiTaskConfigInput = z.input<typeof CurrentInputSchema>;

function toPersisted(row: AiTaskConfigRow): PersistedAiTaskConfig {
  return PersistedAiTaskConfigSchema.parse(row);
}

async function lockTask(transaction: DatabaseTransaction, taskId: string): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ai-task-config:${taskId}`}, 0))`,
  );
}

/** Appends one immutable task revision; no secret value is accepted or resolved here. */
export async function appendAiTaskConfigRevision(
  db: Database,
  input: AppendAiTaskConfigRevisionInput,
): Promise<AiTaskConfigRow> {
  const parsed = AiTaskConfigInputSchema.parse(input);
  const effectiveFrom = parsed.effectiveFrom ?? new Date();
  const createdAt = new Date();
  return db.transaction(async (transaction) => {
    await lockTask(transaction, parsed.taskId);
    const [created] = await transaction.insert(aiTaskConfigs).values({
      taskId: parsed.taskId,
      provider: parsed.provider,
      baseUrl: parsed.baseUrl.replace(/\/$/, ""),
      model: parsed.model,
      parameters: parsed.parameters,
      secretRef: parsed.secretRef,
      enabled: parsed.enabled,
      status: parsed.status,
      effectiveFrom,
    }).returning();
    if (created === undefined) throw new Error("Failed to append AI task configuration revision");
    return created;
  });
}

/** Deterministic current/effective selection: latest effective timestamp, then immutable sequence. */
export async function getCurrentAiTaskConfig(
  db: Database,
  input: GetCurrentAiTaskConfigInput,
): Promise<PersistedAiTaskConfig | null> {
  const parsed = CurrentInputSchema.parse(input);
  const [row] = await db.select().from(aiTaskConfigs).where(and(
    eq(aiTaskConfigs.taskId, parsed.taskId),
    lte(aiTaskConfigs.effectiveFrom, parsed.effectiveAt),
  )).orderBy(desc(aiTaskConfigs.effectiveFrom), desc(aiTaskConfigs.sequence)).limit(1);
  return row === undefined ? null : toPersisted(row);
}

export async function getAiTaskConfigByRevision(
  db: Database,
  revisionId: string,
): Promise<PersistedAiTaskConfig | null> {
  const id = z.string().uuid().parse(revisionId);
  const [row] = await db.select().from(aiTaskConfigs).where(eq(aiTaskConfigs.revisionId, id)).limit(1);
  return row === undefined ? null : toPersisted(row);
}
