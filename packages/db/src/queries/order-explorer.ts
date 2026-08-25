import { and, asc, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "../client.js";
import { orders, type OrderRow } from "../schema.js";

export interface OrderExplorerRecord {
  readonly sourceOrderId: string;
  readonly sourceStatus: string;
  readonly sourceSubStatus: string | null;
  readonly canonicalStatus: OrderRow["canonicalStatus"];
  readonly orderCreatedAt: Date | null;
  readonly paidAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
  readonly readyToShipAt: Date | null;
  readonly latestDeliveryAt: Date | null;
  readonly grandTotal: string;
  readonly currency: string;
  readonly trackingNumber: string | null;
  readonly carrier: string | null;
  readonly refundAmount: string | null;
  readonly refundStatus: string | null;
  readonly deliveryEligible: boolean | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export interface OrderExplorerListItem {
  readonly sourceOrderId: string;
  readonly canonicalStatus: OrderRow["canonicalStatus"];
  readonly paidAt: Date | null;
  readonly grandTotal: string;
  readonly currency: string;
}

export interface OrderExplorerDetail extends OrderExplorerListItem {
  readonly sourceStatus: string;
  readonly sourceSubStatus: string | null;
  readonly orderCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
  readonly readyToShipAt: Date | null;
  readonly latestDeliveryAt: Date | null;
  readonly trackingNumber: string | null;
  readonly carrier: string | null;
  readonly refundAmount: string | null;
  readonly refundStatus: string | null;
  readonly deliveryEligible: boolean | null;
}

export interface OrderExplorerStatusBucket {
  readonly canonicalStatus: OrderRow["canonicalStatus"];
  readonly count: number;
}

export interface OrderExplorerSummary {
  readonly total: number;
  readonly coverage: { readonly availableFrom: Date | null; readonly availableTo: Date | null };
  readonly statusDistribution: readonly OrderExplorerStatusBucket[];
}

export interface ListOrderExplorerInput {
  readonly shopId: string;
  readonly start?: Date | null;
  readonly end?: Date | null;
  readonly canonicalStatus?: OrderRow["canonicalStatus"];
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

const explorerSelection = {
  sourceOrderId: orders.sourceOrderId,
  sourceStatus: orders.sourceStatus,
  sourceSubStatus: orders.sourceSubStatus,
  canonicalStatus: orders.canonicalStatus,
  orderCreatedAt: orders.orderCreatedAt,
  paidAt: orders.paidAt,
  sourceUpdatedAt: orders.sourceUpdatedAt,
  readyToShipAt: orders.readyToShipAt,
  latestDeliveryAt: orders.latestDeliveryAt,
  grandTotal: orders.grandTotal,
  currency: orders.currency,
  trackingNumber: orders.trackingNumber,
  carrier: orders.carrier,
  refundAmount: orders.refundAmount,
  refundStatus: orders.refundStatus,
  deliveryEligible: orders.deliveryEligible,
  firstSeenAt: orders.firstSeenAt,
  lastSeenAt: orders.lastSeenAt,
} as const;

/** Explicit allowlists keep raw source data and customer PII out of read DTOs. */
export function toOrderExplorerListItem(order: OrderExplorerRecord): OrderExplorerListItem {
  return {
    sourceOrderId: order.sourceOrderId,
    canonicalStatus: order.canonicalStatus,
    paidAt: order.paidAt,
    grandTotal: order.grandTotal,
    currency: order.currency,
  };
}

export function toOrderExplorerDetail(order: OrderExplorerRecord): OrderExplorerDetail {
  return {
    ...toOrderExplorerListItem(order),
    sourceStatus: order.sourceStatus,
    sourceSubStatus: order.sourceSubStatus,
    orderCreatedAt: order.orderCreatedAt,
    sourceUpdatedAt: order.sourceUpdatedAt,
    readyToShipAt: order.readyToShipAt,
    latestDeliveryAt: order.latestDeliveryAt,
    trackingNumber: order.trackingNumber,
    carrier: order.carrier,
    refundAmount: order.refundAmount,
    refundStatus: order.refundStatus,
    deliveryEligible: order.deliveryEligible,
  };
}

export function buildOrderExplorerSummary(records: readonly OrderExplorerRecord[]): OrderExplorerSummary {
  const distribution = new Map<OrderRow["canonicalStatus"], number>();
  let availableFrom: Date | null = null;
  let availableTo: Date | null = null;
  for (const record of records) {
    distribution.set(record.canonicalStatus, (distribution.get(record.canonicalStatus) ?? 0) + 1);
    const timestamp = record.paidAt ?? record.orderCreatedAt ?? record.firstSeenAt;
    if (availableFrom === null || timestamp < availableFrom) availableFrom = timestamp;
    if (availableTo === null || timestamp > availableTo) availableTo = timestamp;
  }
  return {
    total: records.length,
    coverage: { availableFrom, availableTo },
    statusDistribution: [...distribution.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([canonicalStatus, count]) => ({ canonicalStatus, count })),
  };
}

function explorerConditions(input: Omit<ListOrderExplorerInput, "limit" | "offset">): SQL[] {
  const conditions: SQL[] = [eq(orders.shopId, input.shopId)];
  if (input.start) conditions.push(gte(orders.paidAt, input.start));
  if (input.end) conditions.push(lt(orders.paidAt, input.end));
  if (input.canonicalStatus) conditions.push(eq(orders.canonicalStatus, input.canonicalStatus));
  const search = input.search?.trim();
  if (search) {
    const escaped = search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    conditions.push(or(ilike(orders.sourceOrderId, `%${escaped}%`), ilike(orders.trackingNumber, `%${escaped}%`))!);
  }
  return conditions;
}

async function listOrderExplorerRecords(db: Database, input: ListOrderExplorerInput): Promise<OrderExplorerRecord[]> {
  const conditions = explorerConditions(input);

  const rows = await db.select(explorerSelection).from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.paidAt), asc(orders.sourceOrderId))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 1000))
    .offset(Math.max(input.offset ?? 0, 0));
  return rows;
}

export async function listOrderExplorerItems(db: Database, input: ListOrderExplorerInput): Promise<OrderExplorerListItem[]> {
  return (await listOrderExplorerRecords(db, input)).map(toOrderExplorerListItem);
}

export async function getOrderExplorerDetail(db: Database, shopId: string, sourceOrderId: string): Promise<OrderExplorerDetail | null> {
  const [row] = await db.select(explorerSelection).from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.sourceOrderId, sourceOrderId)))
    .limit(1);
  return row ? toOrderExplorerDetail(row) : null;
}

export async function summarizeOrderExplorerRecords(db: Database, input: Omit<ListOrderExplorerInput, "limit" | "offset">): Promise<OrderExplorerSummary> {
  const conditions = explorerConditions(input);
  const rows = await db.select({
    canonicalStatus: orders.canonicalStatus,
    count: sql<number>`count(*)::integer`,
    availableFrom: sql<Date | null>`min(coalesce(${orders.paidAt}, ${orders.orderCreatedAt}, ${orders.firstSeenAt}))`.mapWith(orders.firstSeenAt),
    availableTo: sql<Date | null>`max(coalesce(${orders.paidAt}, ${orders.orderCreatedAt}, ${orders.firstSeenAt}))`.mapWith(orders.firstSeenAt),
  }).from(orders).where(and(...conditions)).groupBy(orders.canonicalStatus);
  return {
    total: rows.reduce((total, row) => total + row.count, 0),
    coverage: {
      availableFrom: rows.reduce<Date | null>((earliest, row) => earliest === null || (row.availableFrom !== null && row.availableFrom < earliest) ? row.availableFrom : earliest, null),
      availableTo: rows.reduce<Date | null>((latest, row) => latest === null || (row.availableTo !== null && row.availableTo > latest) ? row.availableTo : latest, null),
    },
    statusDistribution: rows.map(({ canonicalStatus, count }) => ({ canonicalStatus, count })).sort((left, right) => left.canonicalStatus.localeCompare(right.canonicalStatus)),
  };
}
