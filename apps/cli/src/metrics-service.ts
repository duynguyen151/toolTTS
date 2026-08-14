import { createHash } from "node:crypto";

import {
  getMetricsSourceRows,
  insertKpiSnapshot,
  type Database,
  type FinancialSnapshotRow,
  type OrderRow,
  type SettlementRecordRow,
  type ShopRow
} from "@shop-health/db";
import {
  JsonObjectSchema,
  buildShopReport,
  calculateMetrics,
  evaluateShopHealth,
  type EvaluationStatus,
  type NormalizedFinancialSnapshot,
  type NormalizedOrder,
  type NormalizedSettlementRecord,
  type ShopReport
} from "@shop-health/domain";

import type { ComparisonPeriod } from "./period.js";

function orderFromRow(row: OrderRow): NormalizedOrder {
  return {
    shopId: row.shopId,
    sourceOrderId: row.sourceOrderId,
    createdAt: row.orderCreatedAt,
    paidAt: row.paidAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
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

function settlementFromRow(row: SettlementRecordRow): NormalizedSettlementRecord {
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

function snapshotFromRow(row: FinancialSnapshotRow): NormalizedFinancialSnapshot {
  return {
    shopId: row.shopId,
    capturedAt: row.capturedAt,
    currency: row.currency,
    availableBalance: row.availableBalance,
    frozenBalance: row.frozenBalance,
    totalBalance: row.totalBalance,
    toSettleBalance: row.toSettleBalance,
    onHoldBalance: row.onHoldBalance,
    reserveRatio: row.reserveRatio === null ? null : Number(row.reserveRatio),
    reserveDays: row.reserveDays,
    reserveLevel: row.reserveLevel,
    snapshotHash: row.snapshotHash,
    sourceSchemaVersion: row.sourceSchemaVersion,
    rawData: row.rawData
  };
}

function determineDataStatus(shop: ShopRow, now: Date): EvaluationStatus {
  if (shop.syncState !== "ACTIVE") return "ERROR";
  if (shop.lastOrdersSyncedAt === null) return "INSUFFICIENT_DATA";
  const staleAfterMs = 2 * 60 * 1000;
  return now.getTime() - shop.lastOrdersSyncedAt.getTime() > staleAfterMs ? "STALE" : "FRESH";
}

export async function calculateAndStoreReport(
  db: Database,
  shop: ShopRow,
  period: ComparisonPeriod,
  generatedAt = new Date()
): Promise<ShopReport> {
  const rows = await getMetricsSourceRows(
    db,
    shop.id,
    period.previousStart,
    period.currentEnd
  );
  const metrics = calculateMetrics({
    currency: shop.currency,
    currentRange: { start: period.currentStart, end: period.currentEnd },
    previousRange: { start: period.previousStart, end: period.previousEnd },
    orders: rows.orders.map(orderFromRow),
    settlements: rows.settlements.map(settlementFromRow),
    financialSnapshots: rows.financialSnapshots.map(snapshotFromRow)
  });
  const dataStatus = determineDataStatus(shop, generatedAt);
  const health = evaluateShopHealth({ metrics, dataStatus });
  const report = buildShopReport({
    generatedAt,
    shop: {
      id: shop.id,
      profileNo: shop.profileNo,
      displayName: shop.displayName,
      currency: shop.currency
    },
    dataStatus,
    period,
    metrics,
    health
  });
  const metricsHash = createHash("sha256")
    .update(JSON.stringify({ metrics, health }))
    .digest("hex");
  await insertKpiSnapshot(db, {
    shopId: shop.id,
    window: period.label,
    periodStart: period.currentStart,
    periodEnd: period.currentEnd,
    policyVersion: health.policyVersion,
    metricsHash,
    metrics: JsonObjectSchema.parse(metrics),
    trends: JsonObjectSchema.parse(metrics.trends),
    score: health.score === null ? null : Math.round(health.score),
    confidence: health.confidence,
    recommendation: health.recommendation,
    evaluationStatus: health.evaluationStatus,
    warnings: health.warnings
  });
  return report;
}
