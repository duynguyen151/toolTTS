import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import { orders, type OrderRow } from "../schema.js";

type DbExecutor = Database | DatabaseTransaction;

export interface OrderUpsertInput {
  shopId: string;
  sourceOrderId: string;
  createdAt: Date | null;
  paidAt: Date | null;
  sourceUpdatedAt: Date | null;
  readyToShipAt?: Date | null;
  latestDeliveryAt: Date | null;
  sourceStatus: string;
  sourceSubStatus: string | null;
  canonicalStatus: OrderRow["canonicalStatus"];
  grandTotal: string;
  currency: string;
  trackingNumber: string | null;
  carrier: string | null;
  refundAmount: string | null;
  refundStatus: string | null;
  deliveryEligible: boolean | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sourceHash: string;
  sourceSchemaVersion: string;
  rawData: Record<string, unknown>;
}

export interface UpsertBatchResult {
  rowsRead: number;
  rowsWritten: number;
}

export async function upsertOrderBatch(
  executor: DbExecutor,
  batch: readonly OrderUpsertInput[]
): Promise<UpsertBatchResult> {
  if (batch.length === 0) {
    return { rowsRead: 0, rowsWritten: 0 };
  }

  const uniqueBatch = [
    ...new Map(batch.map((order) => [`${order.shopId}\u0000${order.sourceOrderId}`, order])).values()
  ];
  const values = uniqueBatch.map((order) => ({
    shopId: order.shopId,
    sourceOrderId: order.sourceOrderId,
    orderCreatedAt: order.createdAt,
    paidAt: order.paidAt,
    sourceUpdatedAt: order.sourceUpdatedAt,
    readyToShipAt: order.readyToShipAt ?? null,
    latestDeliveryAt: order.latestDeliveryAt,
    sourceStatus: order.sourceStatus,
    sourceSubStatus: order.sourceSubStatus,
    canonicalStatus: order.canonicalStatus,
    grandTotal: order.grandTotal,
    currency: order.currency,
    trackingNumber: order.trackingNumber,
    carrier: order.carrier,
    refundAmount: order.refundAmount,
    refundStatus: order.refundStatus,
    deliveryEligible: order.deliveryEligible,
    firstSeenAt: order.firstSeenAt,
    lastSeenAt: order.lastSeenAt,
    sourceHash: order.sourceHash,
    sourceSchemaVersion: order.sourceSchemaVersion,
    rawData: order.rawData
  }));

  const written = await executor
    .insert(orders)
    .values(values)
    .onConflictDoUpdate({
      target: [orders.shopId, orders.sourceOrderId],
      set: {
        orderCreatedAt: sql`excluded.order_created_at`,
        paidAt: sql`excluded.paid_at`,
        sourceUpdatedAt: sql`excluded.source_updated_at`,
        readyToShipAt: sql`excluded.ready_to_ship_at`,
        latestDeliveryAt: sql`excluded.latest_delivery_at`,
        sourceStatus: sql`excluded.source_status`,
        sourceSubStatus: sql`excluded.source_sub_status`,
        canonicalStatus: sql`excluded.canonical_status`,
        grandTotal: sql`excluded.grand_total`,
        currency: sql`excluded.currency`,
        trackingNumber: sql`excluded.tracking_number`,
        carrier: sql`excluded.carrier`,
        refundAmount: sql`excluded.refund_amount`,
        refundStatus: sql`excluded.refund_status`,
        deliveryEligible: sql`excluded.delivery_eligible`,
        sourceHash: sql`excluded.source_hash`,
        sourceSchemaVersion: sql`excluded.source_schema_version`,
        rawData: sql`excluded.raw_data`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: new Date()
      },
      setWhere: sql`
        (
          excluded.source_updated_at is null
          or ${orders.sourceUpdatedAt} is null
          or excluded.source_updated_at >= ${orders.sourceUpdatedAt}
        )
        and (
          ${orders.lastSeenAt} < excluded.last_seen_at
          or ${orders.sourceHash} is distinct from excluded.source_hash
        )
      `
    })
    .returning({ id: orders.id });

  return { rowsRead: batch.length, rowsWritten: written.length };
}

export interface ListOrdersInput {
  shopId: string;
  start?: Date;
  end?: Date;
  limit?: number;
  offset?: number;
  oldestFirst?: boolean;
}

export async function listOrders(db: Database, input: ListOrdersInput): Promise<OrderRow[]> {
  const conditions = [eq(orders.shopId, input.shopId)];
  if (input.start) {
    conditions.push(gte(orders.paidAt, input.start));
  }
  if (input.end) {
    conditions.push(lt(orders.paidAt, input.end));
  }

  return db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(input.oldestFirst ? asc(orders.paidAt) : desc(orders.paidAt))
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 1000))
    .offset(Math.max(input.offset ?? 0, 0));
}

export async function listOrdersForMetrics(
  db: Database,
  shopId: string,
  start: Date,
  end: Date
): Promise<OrderRow[]> {
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.shopId, shopId), gte(orders.paidAt, start), lt(orders.paidAt, end)))
    .orderBy(orders.paidAt);
}

export async function listOrdersForRisk(db: DbExecutor, shopId: string): Promise<OrderRow[]> {
  return db
    .select()
    .from(orders)
    .where(eq(orders.shopId, shopId))
    .orderBy(orders.sourceOrderId);
}

export interface RiskOrderFactRow {
  canonicalStatus: OrderRow["canonicalStatus"];
  currency: string;
  orderCount: number;
  totalValue: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
}

/**
 * Returns the complete persisted order population as compact facts. Business
 * status sets remain in the domain evaluator rather than being duplicated in SQL.
 */
export async function getFullPersistedRiskOrderFacts(
  db: DbExecutor,
  shopId: string
): Promise<RiskOrderFactRow[]> {
  return db
    .select({
      canonicalStatus: orders.canonicalStatus,
      currency: orders.currency,
      orderCount: sql<number>`count(*)::integer`,
      totalValue: sql<string>`sum(${orders.grandTotal})::text`,
      firstObservedAt: sql`min(${orders.firstSeenAt})`.mapWith(orders.firstSeenAt),
      lastObservedAt: sql`max(${orders.lastSeenAt})`.mapWith(orders.lastSeenAt)
    })
    .from(orders)
    .where(eq(orders.shopId, shopId))
    .groupBy(orders.canonicalStatus, orders.currency)
    .orderBy(orders.canonicalStatus, orders.currency);
}
