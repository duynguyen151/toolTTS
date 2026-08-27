import { and, asc, eq, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  cotikSupplementaryPayments,
  cotikSupplementaryStatements,
  type CotikSupplementaryPaymentRow,
  type CotikSupplementaryStatementRow,
} from "../schema.js";
import type { UpsertBatchResult } from "./orders.js";

type DbExecutor = Database | DatabaseTransaction;

/** Input for the isolated COTIK statement store; it has no Official-On-Hold fields. */
export interface CotikSupplementaryStatementUpsertInput {
  readonly shopId: string;
  readonly providerStatementId: string;
  readonly providerPaymentId: string | null;
  readonly providerShopId: string;
  readonly statementAt: Date;
  readonly currency: string;
  readonly revenueAmount: string;
  readonly feeAmount: string;
  readonly adjustmentAmount: string;
  readonly shippingCostAmount: string;
  readonly netSalesAmount: string;
  readonly settlementAmount: string;
  readonly paymentStatus: string;
  readonly orderIds: readonly string[];
  readonly observedAt: Date;
  readonly sourceHash: string;
  readonly sourceSchemaVersion: string;
  readonly rawData: Record<string, unknown>;
}

/** Input for the isolated COTIK payout store; it joins statements by provider payment ID. */
export interface CotikSupplementaryPaymentUpsertInput {
  readonly shopId: string;
  readonly providerPaymentId: string;
  readonly providerShopId: string;
  readonly paymentStatus: string;
  readonly currency: string;
  readonly amount: string;
  readonly settlementAmount: string;
  readonly reserveAmount: string;
  readonly paymentAmountBeforeExchange: string;
  readonly createdAt: Date;
  readonly paidAt: Date;
  readonly observedAt: Date;
  readonly sourceHash: string;
  readonly sourceSchemaVersion: string;
  readonly rawData: Record<string, unknown>;
}

/**
 * Replays COTIK statement pages by the provider identity unique key. The upsert
 * is deliberately isolated from authoritative Finance tables and Rule inputs.
 */
export async function upsertCotikSupplementaryStatementBatch(
  executor: DbExecutor,
  batch: readonly CotikSupplementaryStatementUpsertInput[],
): Promise<UpsertBatchResult> {
  if (batch.length === 0) return { rowsRead: 0, rowsWritten: 0 };
  const uniqueBatch = [...new Map(batch.map((record) => [
    `${record.shopId}\u0000${record.providerStatementId}`,
    record,
  ])).values()];
  const now = new Date();
  const written = await executor
    .insert(cotikSupplementaryStatements)
    .values(uniqueBatch.map((record) => ({
      ...record,
      orderIds: [...record.orderIds],
      firstSeenAt: now,
      lastSeenAt: record.observedAt,
    })))
    .onConflictDoUpdate({
      target: [cotikSupplementaryStatements.shopId, cotikSupplementaryStatements.providerStatementId],
      set: {
        providerPaymentId: sql`excluded.provider_payment_id`,
        providerShopId: sql`excluded.provider_shop_id`,
        statementAt: sql`excluded.statement_at`,
        currency: sql`excluded.currency`,
        revenueAmount: sql`excluded.revenue_amount`,
        feeAmount: sql`excluded.fee_amount`,
        adjustmentAmount: sql`excluded.adjustment_amount`,
        shippingCostAmount: sql`excluded.shipping_cost_amount`,
        netSalesAmount: sql`excluded.net_sales_amount`,
        settlementAmount: sql`excluded.settlement_amount`,
        paymentStatus: sql`excluded.payment_status`,
        orderIds: sql`excluded.order_ids`,
        observedAt: sql`excluded.observed_at`,
        sourceHash: sql`excluded.source_hash`,
        sourceSchemaVersion: sql`excluded.source_schema_version`,
        rawData: sql`excluded.raw_data`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: now,
      },
      setWhere: sql`
        ${cotikSupplementaryStatements.lastSeenAt} < excluded.last_seen_at
        or ${cotikSupplementaryStatements.sourceHash} is distinct from excluded.source_hash
      `,
    })
    .returning({ id: cotikSupplementaryStatements.id });
  return { rowsRead: batch.length, rowsWritten: written.length };
}

/** Replays COTIK payout pages by provider identity without Official-On-Hold projection. */
export async function upsertCotikSupplementaryPaymentBatch(
  executor: DbExecutor,
  batch: readonly CotikSupplementaryPaymentUpsertInput[],
): Promise<UpsertBatchResult> {
  if (batch.length === 0) return { rowsRead: 0, rowsWritten: 0 };
  const uniqueBatch = [...new Map(batch.map((record) => [
    `${record.shopId}\u0000${record.providerPaymentId}`,
    record,
  ])).values()];
  const now = new Date();
  const written = await executor
    .insert(cotikSupplementaryPayments)
    .values(uniqueBatch.map((record) => ({
      shopId: record.shopId,
      providerPaymentId: record.providerPaymentId,
      providerShopId: record.providerShopId,
      paymentStatus: record.paymentStatus,
      currency: record.currency,
      amount: record.amount,
      settlementAmount: record.settlementAmount,
      reserveAmount: record.reserveAmount,
      paymentAmountBeforeExchange: record.paymentAmountBeforeExchange,
      createdAtProvider: record.createdAt,
      paidAt: record.paidAt,
      observedAt: record.observedAt,
      sourceHash: record.sourceHash,
      sourceSchemaVersion: record.sourceSchemaVersion,
      rawData: record.rawData,
      firstSeenAt: now,
      lastSeenAt: record.observedAt,
    })))
    .onConflictDoUpdate({
      target: [cotikSupplementaryPayments.shopId, cotikSupplementaryPayments.providerPaymentId],
      set: {
        providerShopId: sql`excluded.provider_shop_id`,
        paymentStatus: sql`excluded.payment_status`,
        currency: sql`excluded.currency`,
        amount: sql`excluded.amount`,
        settlementAmount: sql`excluded.settlement_amount`,
        reserveAmount: sql`excluded.reserve_amount`,
        paymentAmountBeforeExchange: sql`excluded.payment_amount_before_exchange`,
        createdAtProvider: sql`excluded.created_at_provider`,
        paidAt: sql`excluded.paid_at`,
        observedAt: sql`excluded.observed_at`,
        sourceHash: sql`excluded.source_hash`,
        sourceSchemaVersion: sql`excluded.source_schema_version`,
        rawData: sql`excluded.raw_data`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: now,
      },
      setWhere: sql`
        ${cotikSupplementaryPayments.lastSeenAt} < excluded.last_seen_at
        or ${cotikSupplementaryPayments.sourceHash} is distinct from excluded.source_hash
      `,
    })
    .returning({ id: cotikSupplementaryPayments.id });
  return { rowsRead: batch.length, rowsWritten: written.length };
}

export interface CotikSupplementaryStatementWithPayment {
  readonly statement: CotikSupplementaryStatementRow;
  readonly payment: CotikSupplementaryPaymentRow | null;
}

/** Lists stored supplementary statement/payout joins; no authoritative Finance row is read. */
export async function listCotikSupplementaryStatementsWithPayments(
  db: Database,
  shopId: string,
): Promise<CotikSupplementaryStatementWithPayment[]> {
  const rows = await db
    .select({ statement: cotikSupplementaryStatements, payment: cotikSupplementaryPayments })
    .from(cotikSupplementaryStatements)
    .leftJoin(cotikSupplementaryPayments, and(
      eq(cotikSupplementaryPayments.shopId, cotikSupplementaryStatements.shopId),
      eq(cotikSupplementaryPayments.providerPaymentId, cotikSupplementaryStatements.providerPaymentId),
    ))
    .where(eq(cotikSupplementaryStatements.shopId, shopId))
    .orderBy(asc(cotikSupplementaryStatements.statementAt), asc(cotikSupplementaryStatements.providerStatementId));
  return rows;
}
