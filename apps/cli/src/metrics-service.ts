import { createHash } from "node:crypto";

import {
  getMetricsSourceRows,
  getObjectiveMetricsSourceRows,
  getEffectiveRiskPolicy,
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
  calculateAuthoritativeDeliveryRate,
  resolveObjectiveAnalyticalPeriods,
  unconfiguredCategoricalTrends,
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

function determineDataStatus(shop: ShopRow, now: Date): EvaluationStatus {
  if (shop.syncState !== "ACTIVE") return "ERROR";
  if (shop.lastOrdersSyncedAt === null) return "INSUFFICIENT_DATA";
  const staleAfterMs = 2 * 60 * 1000;
  return now.getTime() - shop.lastOrdersSyncedAt.getTime() > staleAfterMs ? "STALE" : "FRESH";
}

function sourceFromVersions(versions: readonly string[]): "SELLER_CENTER" | "COTIK" | "MIXED" | "UNKNOWN" {
  if (versions.length === 0) return "UNKNOWN";
  const sources = new Set(versions.map((version) => version.startsWith("seller-center-")
    ? "SELLER_CENTER"
    : version.startsWith("cotik-")
      ? "COTIK"
      : "UNKNOWN"));
  return sources.size === 1
    ? [...sources][0]!
    : sources.has("UNKNOWN")
      ? "UNKNOWN"
      : "MIXED";
}

function earliestAvailableAt(
  rows: Awaited<ReturnType<typeof getObjectiveMetricsSourceRows>>,
): Date | null {
  return [...rows.orders.map((row) => row.paidAt), ...rows.settlements.map((row) => row.placedAt)]
    .filter((value): value is Date => value !== null)
    .reduce<Date | null>((earliest, value) => earliest === null || value < earliest ? value : earliest, null);
}

async function buildObjectiveHistory(
  db: Database,
  shop: ShopRow,
  generatedAt: Date,
): Promise<{ readonly metrics: Record<string, unknown>; readonly providerProvenance: Record<string, unknown>; readonly policyProvenance: Record<string, unknown> }> {
  const [rows, resolvedRiskPolicy] = await Promise.all([
    getObjectiveMetricsSourceRows(db, shop.id),
    getEffectiveRiskPolicy(db, { shopId: shop.id, effectiveAt: generatedAt }),
  ]);
  const periods = resolveObjectiveAnalyticalPeriods({
    now: generatedAt,
    firstAvailableAt: earliestAvailableAt(rows),
  });
  const providerProvenance = {
    orders: {
      source: sourceFromVersions(rows.orders.map((row) => row.sourceSchemaVersion)),
      sourceSchemaVersions: [...new Set(rows.orders.map((row) => row.sourceSchemaVersion))].sort(),
    },
    officialFinanceOnHold: rows.financialSnapshots.length === 0
      ? { source: null, capturedAt: null }
      : {
          source: "SELLER_CENTER",
          capturedAt: rows.financialSnapshots[0]!.capturedAt.toISOString(),
          sourceSchemaVersion: rows.financialSnapshots[0]!.sourceSchemaVersion,
        },
  };
  const categoricalTrends = unconfiguredCategoricalTrends();
  const analytical = periods.map((period) => {
    if (period.start === null) {
      return { ...period, values: null, deltas: null, categoricalTrends };
    }
    const metrics = calculateMetrics({
      currency: shop.currency,
      currentRange: { start: period.start, end: period.end },
      // All Available has no truthful prior baseline; deltas are omitted below.
      previousRange: period.comparison ?? { start: period.start, end: period.start },
      orders: rows.orders.map(orderFromRow),
      settlements: rows.settlements.map(settlementFromRow),
      financialSnapshots: rows.financialSnapshots.map(snapshotFromRow),
    });
    return {
      ...period,
      values: metrics.current,
      deltas: period.deltaStatus === "EVALUATED" ? metrics.trends : null,
      categoricalTrends,
    };
  });
  const authoritativeDelivery = calculateAuthoritativeDeliveryRate(rows.orders.map((row) => row.canonicalStatus));
  const { effectiveAt: _effectiveAt, ...riskPolicyRevision } = resolvedRiskPolicy;
  return {
    metrics: {
      schemaVersion: "objective-shop-health-history.v1",
      observedAt: generatedAt.toISOString(),
      authoritativeFacts: {
        deliveryRate: authoritativeDelivery,
        officialFinanceOnHold: rows.financialSnapshots[0]
          ? {
              amount: rows.financialSnapshots[0].officialOnHoldAmount,
              currency: rows.financialSnapshots[0].currency,
              capturedAt: rows.financialSnapshots[0].capturedAt.toISOString(),
              source: "SELLER_CENTER",
            }
          : null,
      },
      analytical,
    },
    providerProvenance,
    policyProvenance: {
      scorePolicyVersion: "score-policy.v1",
      categoricalTrendPolicyVersion: null,
      riskPolicyRevision,
    },
  };
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
  const objectiveHistory = await buildObjectiveHistory(db, shop, generatedAt);
  const persistedMetrics = JsonObjectSchema.parse({
    ...metrics,
    objectiveHistory: objectiveHistory.metrics,
  });
  await insertKpiSnapshot(db, {
    shopId: shop.id,
    profileId: shop.profileId,
    profileNo: shop.profileNo,
    window: period.label,
    periodStart: period.currentStart,
    periodEnd: period.currentEnd,
    policyVersion: health.policyVersion,
    // `calculatedAt` records observation time; excluding it from the content
    // hash makes repeated runs in one unchanged Bangkok cadence idempotent.
    metricsHash: createHash("sha256")
      .update(JSON.stringify({
        objectiveHistory: {
          ...objectiveHistory,
          metrics: { ...objectiveHistory.metrics, observedAt: undefined },
        },
      }))
      .digest("hex"),
    metrics: persistedMetrics,
    trends: JsonObjectSchema.parse(metrics.trends),
    providerProvenance: JsonObjectSchema.parse(objectiveHistory.providerProvenance),
    policyProvenance: JsonObjectSchema.parse(objectiveHistory.policyProvenance),
    score: health.score === null ? null : Math.round(health.score),
    confidence: health.confidence,
    recommendation: health.recommendation,
    evaluationStatus: health.evaluationStatus,
    warnings: health.warnings
  });
  return report;
}
