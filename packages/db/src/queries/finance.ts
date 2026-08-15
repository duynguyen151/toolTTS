import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { DecisionFinanceSnapshot } from "@shop-health/domain";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  financialSnapshots,
  settlementRecords,
  type FinancialSnapshotRow,
  type SettlementRecordRow
} from "../schema.js";
import type { UpsertBatchResult } from "./orders.js";

type DbExecutor = Database | DatabaseTransaction;

export interface DecisionFinanceSnapshotInput {
  capturedAt: Date | null;
  currency: string;
  availableBalance: string | null;
  frozenBalance: string | null;
  totalBalance: string | null;
  toSettleBalance: string | null;
  onHoldBalance: string | null;
  officialOnHoldAmount: string | null;
  settlements: ReadonlyArray<Pick<SettlementRecordRow, "settlementState" | "onHoldReason" | "expectedSettlementAmount">>;
  reasonSummary?: DecisionFinanceReasonSummary;
}

export interface DecisionFinanceReasonSummary {
  readonly statementCount: number;
  readonly onHoldCount: number;
  readonly waitingForPackageDeliveryAmount: string | null;
  readonly deliveredAwaitingSettlementAmount: string | null;
  readonly waitingForCompletedRefundReturnAmount: string | null;
  readonly unknownOnHoldReasonCount: number;
  readonly missingOnHoldExpectedAmountCount: number;
}

export function normalizeFinanceReasonSummary(
  summary: DecisionFinanceReasonSummary,
  currentPopulationCapturedAt?: Date | null,
): DecisionFinanceReasonSummary {
  if (currentPopulationCapturedAt === undefined || currentPopulationCapturedAt === null ||
      summary.unknownOnHoldReasonCount !== 0 || summary.missingOnHoldExpectedAmountCount !== 0) {
    return summary;
  }
  return {
    ...summary,
    waitingForPackageDeliveryAmount: summary.waitingForPackageDeliveryAmount ?? "0.0000",
    deliveredAwaitingSettlementAmount: summary.deliveredAwaitingSettlementAmount ?? "0.0000",
    waitingForCompletedRefundReturnAmount: summary.waitingForCompletedRefundReturnAmount ?? "0.0000",
  };
}

function scaledMoney(value: string | null): bigint {
  if (value === null) return 0n;
  const negative = value.startsWith("-");
  const unsigned = negative || value.startsWith("+") ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  const decimal = fraction ?? "";
  const magnitude = BigInt(whole ?? "0") * 10_000n + BigInt(decimal.padEnd(4, "0").slice(0, 4));
  return negative ? -magnitude : magnitude;
}

function formatMoney(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 10_000n;
  const fraction = (magnitude % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function buildDecisionFinanceSnapshot(
  input: DecisionFinanceSnapshotInput,
): DecisionFinanceSnapshot {
  const onHold = input.settlements.filter((row) => row.settlementState === "ON_HOLD");
  const waiting = onHold
    .filter((row) => row.onHoldReason === "WAITING_FOR_PACKAGE_DELIVERY")
    .reduce((sum, row) => sum + scaledMoney(row.expectedSettlementAmount), 0n);
  const delivered = onHold
    .filter((row) => row.onHoldReason === "DELIVERED_AWAITING_SETTLEMENT")
    .reduce((sum, row) => sum + scaledMoney(row.expectedSettlementAmount), 0n);
  const refundReturn = onHold
    .filter((row) => row.onHoldReason === "WAITING_FOR_COMPLETED_REFUND_RETURN")
    .reduce((sum, row) => sum + scaledMoney(row.expectedSettlementAmount), 0n);
  const reasonSummary = input.reasonSummary;
  const missingExpectedAmountCount = reasonSummary?.missingOnHoldExpectedAmountCount ??
    onHold.filter((row) => row.expectedSettlementAmount === null).length;
  const waitingAmount = missingExpectedAmountCount > 0
    ? null
    : reasonSummary?.waitingForPackageDeliveryAmount === undefined
      ? formatMoney(waiting)
      : reasonSummary.waitingForPackageDeliveryAmount === null
        ? null
        : formatMoney(scaledMoney(reasonSummary.waitingForPackageDeliveryAmount));
  const deliveredAmount = missingExpectedAmountCount > 0
    ? null
    : reasonSummary?.deliveredAwaitingSettlementAmount === undefined
      ? formatMoney(delivered)
      : reasonSummary.deliveredAwaitingSettlementAmount === null
        ? null
        : formatMoney(scaledMoney(reasonSummary.deliveredAwaitingSettlementAmount));
  const refundReturnAmount = missingExpectedAmountCount > 0
    ? null
    : reasonSummary?.waitingForCompletedRefundReturnAmount === undefined
      ? formatMoney(refundReturn)
      : reasonSummary.waitingForCompletedRefundReturnAmount === null
        ? null
        : formatMoney(scaledMoney(reasonSummary.waitingForCompletedRefundReturnAmount));
  const unknownReasonCount = reasonSummary?.unknownOnHoldReasonCount ??
    (onHold.filter((row) => row.onHoldReason !== "WAITING_FOR_PACKAGE_DELIVERY" && row.onHoldReason !== "DELIVERED_AWAITING_SETTLEMENT" && row.onHoldReason !== "WAITING_FOR_COMPLETED_REFUND_RETURN").length);
  const official = input.officialOnHoldAmount === null ? null : formatMoney(scaledMoney(input.officialOnHoldAmount));

  return {
    capturedAt: input.capturedAt?.toISOString() ?? null,
    currency: input.currency,
    availableBalance: input.availableBalance,
    frozenBalance: input.frozenBalance,
    totalBalance: input.totalBalance,
    toSettleBalance: input.toSettleBalance,
    onHoldBalance: input.onHoldBalance,
    officialOnHoldAmount: official,
    waitingForPackageDeliveryAmount: waitingAmount,
    deliveredAwaitingSettlementAmount: deliveredAmount,
    waitingForCompletedRefundReturnAmount: refundReturnAmount,
    reasonTotalsReconcileToOfficialOnHold: official !== null && unknownReasonCount === 0 &&
      missingExpectedAmountCount === 0 && waitingAmount !== null && deliveredAmount !== null && refundReturnAmount !== null &&
      scaledMoney(waitingAmount) + scaledMoney(deliveredAmount) + scaledMoney(refundReturnAmount) === scaledMoney(official),
    missingOnHoldExpectedAmountCount: missingExpectedAmountCount,
    settlementCount: reasonSummary?.statementCount ?? input.settlements.length,
    onHoldSettlementCount: reasonSummary?.onHoldCount ?? onHold.length,
  };
}

export interface SettlementUpsertInput {
  shopId: string;
  sourceStatementDetailId: string;
  tradeOrderId: string | null;
  placedAt: Date | null;
  deliveredAt: Date | null;
  estimatedSettlementAt: Date | null;
  earningAmount: string | null;
  feeAmount: string | null;
  shippingAmount: string | null;
  expectedSettlementAmount: string | null;
  eligibleSettlementAmount: string | null;
  settledAmount: string | null;
  currency: string;
  sourceSettlementStatus: string;
  settlementState: SettlementRecordRow["settlementState"];
  onHoldReason: string | null;
  sourceHash: string;
  sourceSchemaVersion: string;
  rawData: Record<string, unknown>;
}

export async function upsertSettlementBatch(
  executor: DbExecutor,
  batch: readonly SettlementUpsertInput[],
  capturedAt?: Date | null
): Promise<UpsertBatchResult> {
  if (batch.length === 0) {
    return { rowsRead: 0, rowsWritten: 0 };
  }

  const uniqueBatch = [
    ...new Map(
      batch.map((record) => [
        `${record.shopId}\u0000${record.sourceStatementDetailId}`,
        record
      ])
    ).values()
  ];
  const now = new Date();
  const lastSeenAt = capturedAt ?? now;
  const written = await executor
    .insert(settlementRecords)
    .values(uniqueBatch.map((record) => ({ ...record, firstSeenAt: now, lastSeenAt })))
    .onConflictDoUpdate({
      target: [settlementRecords.shopId, settlementRecords.sourceStatementDetailId],
      set: {
        tradeOrderId: sql`excluded.trade_order_id`,
        placedAt: sql`excluded.placed_at`,
        deliveredAt: sql`excluded.delivered_at`,
        estimatedSettlementAt: sql`excluded.estimated_settlement_at`,
        earningAmount: sql`excluded.earning_amount`,
        feeAmount: sql`excluded.fee_amount`,
        shippingAmount: sql`excluded.shipping_amount`,
        expectedSettlementAmount: sql`excluded.expected_settlement_amount`,
        eligibleSettlementAmount: sql`excluded.eligible_settlement_amount`,
        settledAmount: sql`excluded.settled_amount`,
        currency: sql`excluded.currency`,
        sourceSettlementStatus: sql`excluded.source_settlement_status`,
        settlementState: sql`excluded.settlement_state`,
        onHoldReason: sql`excluded.on_hold_reason`,
        sourceHash: sql`excluded.source_hash`,
        sourceSchemaVersion: sql`excluded.source_schema_version`,
        rawData: sql`excluded.raw_data`,
        lastSeenAt,
        updatedAt: now
      },
      setWhere: sql`
        ${settlementRecords.lastSeenAt} < excluded.last_seen_at
        or ${settlementRecords.sourceHash} is distinct from excluded.source_hash
      `
    })
    .returning({ id: settlementRecords.id });

  return { rowsRead: batch.length, rowsWritten: written.length };
}

export interface FinancialSnapshotInput {
  shopId: string;
  capturedAt: Date;
  currency: string;
  availableBalance: string | null;
  frozenBalance: string | null;
  totalBalance: string | null;
  toSettleBalance: string | null;
  onHoldBalance: string | null;
  officialOnHoldAmount?: string | null;
  settlementPeriodDays?: number | null;
  settlementPeriodType?: string | null;
  reserveRatio: number | null;
  reserveDays: number | null;
  reserveLevel: string | null;
  snapshotHash: string;
  sourceSchemaVersion: string;
  rawData: Record<string, unknown>;
}

export async function insertFinancialSnapshot(
  executor: DbExecutor,
  snapshot: FinancialSnapshotInput
): Promise<{ inserted: boolean; row: FinancialSnapshotRow | null }> {
  const [row] = await executor
    .insert(financialSnapshots)
    .values({
      ...snapshot,
      officialOnHoldAmount: snapshot.officialOnHoldAmount ?? null,
      settlementPeriodDays: snapshot.settlementPeriodDays ?? null,
      settlementPeriodType: snapshot.settlementPeriodType ?? null,
      reserveRatio: snapshot.reserveRatio === null ? null : String(snapshot.reserveRatio)
    })
    .onConflictDoNothing({
      target: [financialSnapshots.shopId, financialSnapshots.snapshotHash]
    })
    .returning();

  return { inserted: row !== undefined, row: row ?? null };
}

export async function getLatestFinancialSnapshot(
  db: Database,
  shopId: string
): Promise<FinancialSnapshotRow | null> {
  const [row] = await db
    .select()
    .from(financialSnapshots)
    .where(eq(financialSnapshots.shopId, shopId))
    .orderBy(desc(financialSnapshots.capturedAt))
    .limit(1);
  return row ?? null;
}

export async function getLatestFinancialSnapshotAtOrBefore(
  db: Database,
  shopId: string,
  capturedAt: Date,
): Promise<FinancialSnapshotRow | null> {
  const [row] = await db
    .select()
    .from(financialSnapshots)
    .where(and(
      eq(financialSnapshots.shopId, shopId),
      lte(financialSnapshots.capturedAt, capturedAt),
    ))
    .orderBy(desc(financialSnapshots.capturedAt))
    .limit(1);
  return row ?? null;
}

export async function listOnHoldSettlements(
  db: Database,
  shopId: string,
  limit = 100
): Promise<SettlementRecordRow[]> {
  return db
    .select()
    .from(settlementRecords)
    .where(and(eq(settlementRecords.shopId, shopId), eq(settlementRecords.settlementState, "ON_HOLD")))
    .orderBy(desc(settlementRecords.placedAt))
    .limit(Math.min(Math.max(limit, 1), 1000));
}

export async function listSettlementsForMetrics(
  db: Database,
  shopId: string,
  start: Date,
  end: Date
): Promise<SettlementRecordRow[]> {
  return db
    .select()
    .from(settlementRecords)
    .where(
      and(
        eq(settlementRecords.shopId, shopId),
        gte(settlementRecords.placedAt, start),
        lt(settlementRecords.placedAt, end)
      )
    )
    .orderBy(settlementRecords.placedAt);
}

export interface FinanceSummary {
  latestSnapshot: FinancialSnapshotRow | null;
  statementCount: number;
  onHoldCount: number;
  expectedSettlementAmount: string | null;
  onHoldExpectedAmount: string | null;
  settledAmount: string | null;
  waitingForPackageDeliveryAmount: string | null;
  deliveredAwaitingSettlementAmount: string | null;
  waitingForCompletedRefundReturnAmount: string | null;
  unknownOnHoldReasonCount: number;
  missingOnHoldExpectedAmountCount: number;
}

export async function getFinanceSummary(
  db: Database,
  shopId: string,
  currentPopulationCapturedAt?: Date | null
): Promise<FinanceSummary> {
  // A null capture means no proven current population; keep historical rows out of decisions.
  const settlementPopulation = currentPopulationCapturedAt === null
    ? sql`false`
    : currentPopulationCapturedAt === undefined
      ? eq(settlementRecords.shopId, shopId)
      : and(
          eq(settlementRecords.shopId, shopId),
          eq(settlementRecords.lastSeenAt, currentPopulationCapturedAt)
        );
  const snapshot = currentPopulationCapturedAt === undefined
    ? getLatestFinancialSnapshot(db, shopId)
    : currentPopulationCapturedAt === null
      ? Promise.resolve(null)
      : getLatestFinancialSnapshotAtOrBefore(db, shopId, currentPopulationCapturedAt);
  const [latestSnapshot, [summary]] = await Promise.all([
    snapshot,
    db
      .select({
        statementCount: sql<number>`count(*)::int`,
        onHoldCount: sql<number>`count(*) filter (where ${settlementRecords.settlementState} = 'ON_HOLD')::int`,
        expectedSettlementAmount: sql<string | null>`sum(${settlementRecords.expectedSettlementAmount})`,
        onHoldExpectedAmount: sql<string | null>`sum(${settlementRecords.expectedSettlementAmount}) filter (where ${settlementRecords.settlementState} = 'ON_HOLD')`,
        settledAmount: sql<string | null>`sum(${settlementRecords.settledAmount})`,
        waitingForPackageDeliveryAmount: sql<string | null>`sum(${settlementRecords.expectedSettlementAmount}) filter (where ${settlementRecords.settlementState} = 'ON_HOLD' and ${settlementRecords.onHoldReason} = 'WAITING_FOR_PACKAGE_DELIVERY')`,
        deliveredAwaitingSettlementAmount: sql<string | null>`sum(${settlementRecords.expectedSettlementAmount}) filter (where ${settlementRecords.settlementState} = 'ON_HOLD' and ${settlementRecords.onHoldReason} = 'DELIVERED_AWAITING_SETTLEMENT')`,
        waitingForCompletedRefundReturnAmount: sql<string | null>`sum(${settlementRecords.expectedSettlementAmount}) filter (where ${settlementRecords.settlementState} = 'ON_HOLD' and ${settlementRecords.onHoldReason} = 'WAITING_FOR_COMPLETED_REFUND_RETURN')`,
        unknownOnHoldReasonCount: sql<number>`count(*) filter (where ${settlementRecords.settlementState} = 'ON_HOLD' and (${settlementRecords.onHoldReason} is null or ${settlementRecords.onHoldReason} not in ('WAITING_FOR_PACKAGE_DELIVERY', 'DELIVERED_AWAITING_SETTLEMENT', 'WAITING_FOR_COMPLETED_REFUND_RETURN')))::int`,
        missingOnHoldExpectedAmountCount: sql<number>`count(*) filter (where ${settlementRecords.settlementState} = 'ON_HOLD' and ${settlementRecords.expectedSettlementAmount} is null)::int`
      })
      .from(settlementRecords)
      .where(settlementPopulation)
  ]);

  const normalizedSummary = normalizeFinanceReasonSummary({
    statementCount: summary?.statementCount ?? 0,
    onHoldCount: summary?.onHoldCount ?? 0,
    waitingForPackageDeliveryAmount: summary?.waitingForPackageDeliveryAmount ?? null,
    deliveredAwaitingSettlementAmount: summary?.deliveredAwaitingSettlementAmount ?? null,
    waitingForCompletedRefundReturnAmount: summary?.waitingForCompletedRefundReturnAmount ?? null,
    unknownOnHoldReasonCount: summary?.unknownOnHoldReasonCount ?? 0,
    missingOnHoldExpectedAmountCount: summary?.missingOnHoldExpectedAmountCount ?? 0,
  }, currentPopulationCapturedAt);

  return {
    latestSnapshot,
    statementCount: normalizedSummary.statementCount,
    onHoldCount: normalizedSummary.onHoldCount,
    expectedSettlementAmount: summary?.expectedSettlementAmount ?? null,
    onHoldExpectedAmount: summary?.onHoldExpectedAmount ?? null,
    settledAmount: summary?.settledAmount ?? null,
    waitingForPackageDeliveryAmount: normalizedSummary.waitingForPackageDeliveryAmount,
    deliveredAwaitingSettlementAmount: normalizedSummary.deliveredAwaitingSettlementAmount,
    waitingForCompletedRefundReturnAmount: normalizedSummary.waitingForCompletedRefundReturnAmount,
    unknownOnHoldReasonCount: normalizedSummary.unknownOnHoldReasonCount,
    missingOnHoldExpectedAmountCount: normalizedSummary.missingOnHoldExpectedAmountCount
  };
}
