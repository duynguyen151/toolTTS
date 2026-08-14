import type {
  DateRange,
  MetricsInput,
  NormalizedFinancialSnapshot,
  NormalizedOrder,
  NormalizedSettlementRecord
} from "@shop-health/domain";

import type { Database } from "../client.js";
import type { FinancialSnapshotRow, OrderRow, SettlementRecordRow } from "../schema.js";
import { getLatestFinancialSnapshot, listSettlementsForMetrics } from "./finance.js";
import { listOrdersForMetrics } from "./orders.js";

export interface MetricsSourceRows {
  orders: OrderRow[];
  settlements: SettlementRecordRow[];
  financialSnapshots: FinancialSnapshotRow[];
}

export async function getMetricsSourceRows(
  db: Database,
  shopId: string,
  start: Date,
  end: Date
): Promise<MetricsSourceRows> {
  const [orderRows, settlementRows, financialSnapshot] = await Promise.all([
    listOrdersForMetrics(db, shopId, start, end),
    listSettlementsForMetrics(db, shopId, start, end),
    getLatestFinancialSnapshot(db, shopId)
  ]);

  return {
    orders: orderRows,
    settlements: settlementRows,
    financialSnapshots: financialSnapshot ? [financialSnapshot] : []
  };
}

function toNormalizedOrder(row: OrderRow): NormalizedOrder {
  return {
    shopId: row.shopId,
    sourceOrderId: row.sourceOrderId,
    createdAt: row.orderCreatedAt,
    paidAt: row.paidAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    readyToShipAt: row.readyToShipAt,
    latestDeliveryAt: row.latestDeliveryAt,
    sourceStatus: row.sourceStatus,
    sourceSubStatus: row.sourceSubStatus,
    canonicalStatus: row.canonicalStatus,
    grandTotal: row.grandTotal,
    currency: row.currency,
    trackingNumber: row.trackingNumber,
    carrier: row.carrier,
    refundAmount: row.refundAmount,
    refundStatus: row.refundStatus,
    deliveryEligible: row.deliveryEligible,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    sourceHash: row.sourceHash,
    sourceSchemaVersion: row.sourceSchemaVersion,
    rawData: row.rawData
  };
}

function toNormalizedSettlement(row: SettlementRecordRow): NormalizedSettlementRecord {
  return {
    shopId: row.shopId,
    sourceStatementDetailId: row.sourceStatementDetailId,
    tradeOrderId: row.tradeOrderId,
    placedAt: row.placedAt,
    deliveredAt: row.deliveredAt,
    estimatedSettlementAt: row.estimatedSettlementAt,
    earningAmount: row.earningAmount,
    feeAmount: row.feeAmount,
    shippingAmount: row.shippingAmount,
    expectedSettlementAmount: row.expectedSettlementAmount,
    eligibleSettlementAmount: row.eligibleSettlementAmount,
    settledAmount: row.settledAmount,
    currency: row.currency,
    sourceSettlementStatus: row.sourceSettlementStatus,
    settlementState: row.settlementState,
    onHoldReason: row.onHoldReason,
    sourceHash: row.sourceHash,
    sourceSchemaVersion: row.sourceSchemaVersion,
    rawData: row.rawData
  };
}

function toNormalizedFinancialSnapshot(row: FinancialSnapshotRow): NormalizedFinancialSnapshot {
  return {
    shopId: row.shopId,
    capturedAt: row.capturedAt,
    currency: row.currency,
    availableBalance: row.availableBalance,
    frozenBalance: row.frozenBalance,
    totalBalance: row.totalBalance,
    toSettleBalance: row.toSettleBalance,
    onHoldBalance: row.onHoldBalance,
    officialOnHoldAmount: row.officialOnHoldAmount,
    settlementPeriodDays: row.settlementPeriodDays,
    settlementPeriodType: row.settlementPeriodType,
    reserveRatio: row.reserveRatio === null ? null : Number(row.reserveRatio),
    reserveDays: row.reserveDays,
    reserveLevel: row.reserveLevel,
    snapshotHash: row.snapshotHash,
    sourceSchemaVersion: row.sourceSchemaVersion,
    rawData: row.rawData
  };
}

export async function getMetricsInput(
  db: Database,
  shopId: string,
  currency: string,
  currentRange: DateRange,
  previousRange: DateRange
): Promise<MetricsInput> {
  const sourceRows = await getMetricsSourceRows(db, shopId, previousRange.start, currentRange.end);
  return {
    currency,
    currentRange,
    previousRange,
    orders: sourceRows.orders.map(toNormalizedOrder),
    settlements: sourceRows.settlements.map(toNormalizedSettlement),
    financialSnapshots: sourceRows.financialSnapshots.map(toNormalizedFinancialSnapshot)
  };
}
