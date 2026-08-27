import { desc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { kpiSnapshots, type KpiSnapshotRow } from "../schema.js";

export interface KpiSnapshotInput {
  shopId: string;
  profileId?: string | null;
  profileNo?: string | null;
  window: string;
  periodStart: Date;
  periodEnd: Date;
  policyVersion: string;
  metricsHash: string;
  metrics: Record<string, unknown>;
  trends: Record<string, unknown>;
  providerProvenance?: Record<string, unknown> | null;
  policyProvenance?: Record<string, unknown> | null;
  score: number | null;
  confidence: number | null;
  recommendation: KpiSnapshotRow["recommendation"];
  evaluationStatus: KpiSnapshotRow["evaluationStatus"];
  warnings: string[];
}

export async function insertKpiSnapshot(
  db: Database,
  input: KpiSnapshotInput
): Promise<{ inserted: boolean; row: KpiSnapshotRow | null }> {
  const [row] = await db
    .insert(kpiSnapshots)
    .values({
      ...input,
      confidence: input.confidence === null ? null : String(input.confidence)
    })
    .onConflictDoNothing({
      target: [
        kpiSnapshots.shopId,
        kpiSnapshots.window,
        kpiSnapshots.policyVersion,
        kpiSnapshots.metricsHash
      ]
    })
    .returning();

  return { inserted: row !== undefined, row: row ?? null };
}

export async function getLatestKpiSnapshot(
  db: Database,
  shopId: string
): Promise<KpiSnapshotRow | null> {
  const [row] = await db
    .select()
    .from(kpiSnapshots)
    .where(eq(kpiSnapshots.shopId, shopId))
    .orderBy(desc(kpiSnapshots.calculatedAt))
    .limit(1);
  return row ?? null;
}

export async function listKpiSnapshots(
  db: Database,
  shopId: string,
  limit = 100,
): Promise<KpiSnapshotRow[]> {
  return db
    .select()
    .from(kpiSnapshots)
    .where(eq(kpiSnapshots.shopId, shopId))
    .orderBy(desc(kpiSnapshots.calculatedAt))
    .limit(Math.min(Math.max(limit, 1), 1000));
}
