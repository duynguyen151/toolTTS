import { and, eq, lt, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import { riskControlStates, type RiskControlStateRow } from "../schema.js";

type DbExecutor = Database | DatabaseTransaction;

export interface SaveRiskControlEvaluationInput {
  shopId: string;
  desiredState: RiskControlStateRow["desiredState"];
  consecutiveSafeCycles: number;
  decision: Record<string, unknown>;
  policyVersion: string;
  evaluatedAt: Date;
}

export async function saveRiskControlEvaluation(
  db: DbExecutor,
  input: SaveRiskControlEvaluationInput
): Promise<RiskControlStateRow> {
  const [state] = await db
    .insert(riskControlStates)
    .values({
      shopId: input.shopId,
      desiredState: input.desiredState,
      consecutiveSafeCycles: input.consecutiveSafeCycles,
      decision: input.decision,
      policyVersion: input.policyVersion,
      lastEvaluatedAt: input.evaluatedAt,
      updatedAt: input.evaluatedAt
    })
    .onConflictDoUpdate({
      target: riskControlStates.shopId,
      set: {
        desiredState: input.desiredState,
        consecutiveSafeCycles: input.consecutiveSafeCycles,
        decision: input.decision,
        policyVersion: input.policyVersion,
        lastEvaluatedAt: input.evaluatedAt,
        updatedAt: sql`greatest(${riskControlStates.updatedAt}, ${input.evaluatedAt.toISOString()})`
      },
      setWhere: lt(riskControlStates.lastEvaluatedAt, input.evaluatedAt)
    })
    .returning();

  if (state) return state;
  const current = await getRiskControlState(db, input.shopId);
  if (current) return current;
  throw new Error(`Failed to save risk-control evaluation for shop: ${input.shopId}`);
}

export async function getRiskControlState(
  db: DbExecutor,
  shopId: string
): Promise<RiskControlStateRow | null> {
  const [state] = await db
    .select()
    .from(riskControlStates)
    .where(eq(riskControlStates.shopId, shopId))
    .limit(1);
  return state ?? null;
}

export interface RecordHolidayModeObservationInput {
  shopId: string;
  observedHolidayModeEnabled: boolean | null;
  observedAt: Date;
}

export async function recordHolidayModeObservation(
  db: DbExecutor,
  input: RecordHolidayModeObservationInput
): Promise<RiskControlStateRow> {
  const [state] = await db
    .update(riskControlStates)
    .set({
      observedHolidayModeEnabled: input.observedHolidayModeEnabled,
      lastObservedAt: input.observedAt,
      // Observing an enabled mode never claims ownership. Observing it disabled
      // clears stale ownership after a manual override or external change.
      automationOwned:
        input.observedHolidayModeEnabled === false
          ? false
          : sql`${riskControlStates.automationOwned}`,
      updatedAt: sql`greatest(${riskControlStates.updatedAt}, ${input.observedAt.toISOString()})`
    })
    .where(
      and(
        eq(riskControlStates.shopId, input.shopId),
        sql`${riskControlStates.lastObservedAt} is null or ${riskControlStates.lastObservedAt} < ${input.observedAt.toISOString()}`
      )
    )
    .returning();

  if (state) return state;
  const current = await getRiskControlState(db, input.shopId);
  if (current) return current;
  throw new Error(`Risk-control state not found for shop: ${input.shopId}`);
}

export interface RecordRiskControlActionInput {
  shopId: string;
  actionAt: Date;
  actionStatus: NonNullable<RiskControlStateRow["lastActionStatus"]>;
  actionError: string | null;
  observedHolidayModeEnabled: boolean | null;
  automationOwned: boolean;
}

export async function recordRiskControlAction(
  db: DbExecutor,
  input: RecordRiskControlActionInput
): Promise<RiskControlStateRow> {
  const [state] = await db
    .update(riskControlStates)
    .set({
      lastActionAt: input.actionAt,
      lastActionStatus: input.actionStatus,
      lastActionError: input.actionError,
      observedHolidayModeEnabled: input.observedHolidayModeEnabled,
      lastObservedAt: input.actionAt,
      automationOwned: input.automationOwned,
      updatedAt: sql`greatest(${riskControlStates.updatedAt}, ${input.actionAt.toISOString()})`
    })
    .where(
      and(
        eq(riskControlStates.shopId, input.shopId),
        sql`${riskControlStates.lastActionAt} is null or ${riskControlStates.lastActionAt} < ${input.actionAt.toISOString()}`,
        sql`${riskControlStates.lastObservedAt} is null or ${riskControlStates.lastObservedAt} <= ${input.actionAt.toISOString()}`
      )
    )
    .returning();

  if (state) return state;
  const current = await getRiskControlState(db, input.shopId);
  if (current) return current;
  throw new Error(`Risk-control state not found for shop: ${input.shopId}`);
}
