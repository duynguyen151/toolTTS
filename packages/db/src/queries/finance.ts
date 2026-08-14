import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  financialSnapshots,
  settlementRecords,
  type FinancialSnapshotRow,
  type SettlementRecordRow
} from "../schema.js";
import type { UpsertBatchResult } from "./orders.js";

type DbExecutor = Database | DatabaseTransaction;

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
  batch: readonly SettlementUpsertInput[]
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
  const written = await executor
    .insert(settlementRecords)
    .values(uniqueBatch.map((record) => ({ ...record, firstSeenAt: now, lastSeenAt: now })))
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
        lastSeenAt: now,
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
}

export async function getFinanceSummary(db: Database, shopId: string): Promise<FinanceSummary> {
  const [latestSnapshot, [summary]] = await Promise.all([
    getLatestFinancialSnapshot(db, shopId),
    db
      .select({
        statementCount: sql<number>`count(*)::int`,
        onHoldCount: sql<number>`count(*) filter (where ${settlementRecords.settlementState} = 'ON_HOLD')::int`,
        expectedSettlementAmount: sql<string | null>`sum(${settlementRecords.expectedSettlementAmount})`,
        onHoldExpectedAmount: sql<string | null>`sum(${settlementRecords.expectedSettlementAmount}) filter (where ${settlementRecords.settlementState} = 'ON_HOLD')`,
        settledAmount: sql<string | null>`sum(${settlementRecords.settledAmount})`
      })
      .from(settlementRecords)
      .where(eq(settlementRecords.shopId, shopId))
  ]);

  return {
    latestSnapshot,
    statementCount: summary?.statementCount ?? 0,
    onHoldCount: summary?.onHoldCount ?? 0,
    expectedSettlementAmount: summary?.expectedSettlementAmount ?? null,
    onHoldExpectedAmount: summary?.onHoldExpectedAmount ?? null,
    settledAmount: summary?.settledAmount ?? null
  };
}
