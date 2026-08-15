import {
  closeDatabase,
  createDatabase,
  getFinanceSummary,
  getFullPersistedRiskOrderFacts,
  getLatestKpiSnapshot,
  listDecisionHistory,
  listShops,
  listSyncRuns,
  type DecisionReviewRecord,
  type KpiSnapshotRow,
  type RiskOrderFactRow,
  type ShopRow,
  type SyncRunRow,
} from "@shop-health/db";

import type {
  DashboardPresentation,
  DashboardShopSource,
  DashboardSource,
  DashboardSyncState,
} from "./dashboard-contract.js";
import { buildDashboardPresentation } from "./dashboard-model.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function currentMetrics(snapshot: KpiSnapshotRow | null): JsonRecord | null {
  if (!isRecord(snapshot?.metrics)) return null;
  return isRecord(snapshot.metrics.current) ? snapshot.metrics.current : null;
}

function metricRecord(metrics: JsonRecord | null, key: string): JsonRecord | null {
  const value = metrics?.[key];
  return isRecord(value) ? value : null;
}

function latestTimestamp(left: Date | null, right: Date | null): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

function currentSyncState(shop: ShopRow, run: SyncRunRow | null): DashboardSyncState {
  if (shop.syncState === "PAUSED_LAYOUT") return "PAUSED_LAYOUT";
  if (shop.syncState === "DISABLED") return "DISABLED";
  if (shop.syncState !== "ACTIVE") return "FAILED";
  if (run === null) return "IDLE";
  if (run.status === "SUCCEEDED" && run.sourceComplete !== true) return "FAILED";
  if (run.status === "RUNNING" || run.status === "SUCCEEDED" || run.status === "FAILED") {
    return run.status;
  }
  return "FAILED";
}

function shopSource(shop: ShopRow, run: SyncRunRow | null = null): DashboardShopSource {
  return {
    id: shop.id,
    profileNo: shop.profileNo,
    displayName: shop.displayName ?? shop.profileNo,
    currency: shop.currency,
    dataOrigin: shop.dataOrigin,
    enabled: shop.enabled,
    syncState: currentSyncState(shop, run),
    pauseReason: shop.pauseReason,
    lastOrdersSyncedAt: shop.lastOrdersSyncedAt,
    lastFinanceSyncedAt: shop.lastFinanceSyncedAt,
  };
}

function countFacts(facts: readonly RiskOrderFactRow[], statuses?: ReadonlySet<string>): number {
  return facts.reduce(
    (total, fact) => statuses === undefined || statuses.has(fact.canonicalStatus) ? total + fact.orderCount : total,
    0,
  );
}

function decisionStages(review: DecisionReviewRecord | null): Pick<DashboardSource["selected"], "rule" | "ai" | "ba" | "execution"> {
  if (review === null) {
    return {
      rule: { status: "NOT_VERIFIED" },
      ai: { status: "UNAVAILABLE", detail: "NOT_RECORDED" },
      ba: { status: "NOT_REVIEWED" },
      execution: { status: "NOT_REQUESTED" },
    };
  }

  const operationalExposure = review.metrics.onHoldValue === null
    ? "unavailable"
    : `${review.metrics.onHoldValue} ${review.metrics.currency}`;
  const ruleDetail = [
    `Result: ${review.rule.decision}.`,
    `Triggers: ${review.rule.triggers.join(", ") || "none"}.`,
    `Operational order-derived exposure: ${operationalExposure}.`,
    "Official Finance On Hold is shown separately in the KPI.",
    `Policy: ${review.rule.policyVersion}.`,
  ].join(" ");
  const aiDetail = review.ai === null
    ? "NOT_RECORDED"
    : review.ai.status === "AVAILABLE"
      ? [
          `Recommendation: ${review.ai.recommendation}.`,
          `Risk: ${review.ai.riskLevel ?? "not assessed"}.`,
          `Confidence: ${review.ai.confidence}.`,
          `Reasons: ${review.ai.reasonCodes.join(", ") || "none"}.`,
          `Supporting factors: ${review.ai.supportingFactors?.join("; ") || "none"}.`,
          `Risk factors: ${review.ai.riskFactors?.join("; ") || "none"}.`,
          `What would change decision: ${review.ai.whatWouldChangeDecision?.join("; ") || "not provided"}.`,
          `Human review required: ${review.ai.humanReviewRequired ? "yes" : "no"}.`,
          `Provider: ${review.ai.provider}.`,
          `Requested model: ${review.ai.requestedModel ?? "not reported"}.`,
          `Reported model: ${review.ai.reportedModel ?? "not reported"}.`,
          `Actual model: ${review.ai.actualModelUsed ?? review.ai.model ?? "not reported"}.`,
        ].join(" ")
    : `AI unavailable: ${review.ai.failureCode}. Human review required. Provider: ${review.ai.provider}. Requested model: ${review.ai.requestedModel ?? "not reported"}. Reported model: ${review.ai.reportedModel ?? "not reported"}. Actual model: ${review.ai.actualModelUsed ?? review.ai.model ?? "not reported"}.`;

  return {
    rule: { status: "READY", detail: ruleDetail },
    ai: review.ai?.status === "AVAILABLE"
      ? { status: "READY", detail: aiDetail }
      : { status: "UNAVAILABLE", detail: aiDetail },
    ba: review.ba === null
      ? { status: "NOT_REVIEWED" }
      : { status: "REVIEWED", detail: `Decision: ${review.ba.decision}. Confidence: ${review.ba.confidence ?? "not recorded"}. Reasons: ${review.ba.reasonCodes.join(", ") || "none"}.` },
    execution: review.execution === null
      ? { status: "NOT_REQUESTED" }
      : { status: "EXECUTED", detail: `${review.execution.requestedAction} is ${review.execution.status} in ${review.execution.mode}; Seller Center was not called.` },
  };
}

function hasCompleteProvenSourceWindow(review: DecisionReviewRecord | null): boolean {
  const coverage = review?.coverageSnapshot;
  return review?.shop.dataCoverage === "COMPLETE"
    && coverage?.coverageState === "COMPLETE"
    && coverage.source === "SELLER_CENTER"
    && coverage.provenSourceWindow === "ROLLING_12_MONTHS"
    && coverage.completeWithinSourceWindow === true
    && coverage.lifetimeHistoryComplete === false
    && coverage.ordersSourceComplete === true
    && coverage.financeRequiredSourceComplete === true
    && coverage.sourceReconciled === true
    && coverage.freshness === "FRESH";
}

function unavailableSource(now = new Date()): DashboardSource {
  const shop: DashboardShopSource = {
    id: "dashboard-unavailable",
    profileNo: "UNAVAILABLE",
    displayName: "Live data unavailable",
    currency: "USD",
    dataOrigin: "UNAVAILABLE",
    enabled: false,
    syncState: "DISABLED",
    pauseReason: "Live dashboard data is unavailable.",
    lastOrdersSyncedAt: null,
    lastFinanceSyncedAt: null,
  };

  return {
    generatedAt: now,
    shops: [shop],
    selected: {
      shopId: shop.id,
      orders: { total: null, awaitingShipment: null, delivered: null, canceled: null },
      finance: { officialOnHoldAmount: null, currency: "USD", capturedAt: null },
      deliveryRate: { status: "UNAVAILABLE", reason: "DEMO_METRIC_NOT_VERIFIED" },
      grossValidSales: { status: "UNAVAILABLE", reason: "DEMO_METRIC_NOT_VERIFIED" },
      dataCoverage: {
        status: "UNAVAILABLE",
        label: "Live data unavailable",
        reason: "Live dashboard data is unavailable. Configure the database and retry.",
      },
      latestSync: { status: "FAILED", startedAt: null, sourceComplete: null },
      profileState: "NOT_VERIFIED",
      rule: { status: "NOT_VERIFIED" },
      ai: { status: "UNAVAILABLE", detail: "NOT_RECORDED" },
      ba: { status: "NOT_REVIEWED" },
      execution: { status: "NOT_REQUESTED" },
    },
  };
}

async function readLiveSource(databaseUrl: string): Promise<DashboardSource | null> {
  const context = createDatabase(databaseUrl);
  try {
    const shops = await listShops(context.db);
    const liveShops = shops.filter((shop) => shop.dataOrigin === "LIVE");
    const dashboardShops = liveShops;
    const selectedShop = dashboardShops.find((shop) => shop.profileNo === "957")
      ?? dashboardShops.find((shop) => shop.enabled)
      ?? dashboardShops[0]
      ?? null;
    if (selectedShop === null) return null;

    const [facts, finance, kpi, runs, decisionPage] = await Promise.all([
      getFullPersistedRiskOrderFacts(context.db, selectedShop.id),
      getFinanceSummary(context.db, selectedShop.id),
      getLatestKpiSnapshot(context.db, selectedShop.id),
      listSyncRuns(context.db, selectedShop.id, 1),
      listDecisionHistory(context.db, {
        profileNo: selectedShop.profileNo,
        caseOrigin: "LIVE",
        limit: 1,
      }),
    ]);
    const latestRun = runs[0] ?? null;
    const metrics = currentMetrics(kpi);
    const orderMetrics = metricRecord(metrics, "orders");
    const deliveryMetric = metricRecord(metrics, "deliveryRate");
    const salesMetric = metricRecord(metrics, "grossValidSales");
    const total = numberField(orderMetrics, "total") ?? countFacts(facts);
    const awaitingShipment = numberField(orderMetrics, "awaitingShipment")
      ?? countFacts(facts, new Set(["AWAITING_SHIPMENT"]));
    const delivered = numberField(orderMetrics, "deliveredOrCompleted")
      ?? countFacts(facts, new Set(["DELIVERED", "COMPLETED"]));
    const canceled = numberField(orderMetrics, "canceled")
      ?? countFacts(facts, new Set(["CANCELED"]));
    const deliveryValue = numberField(deliveryMetric, "value");
    const deliveryCoverage = numberField(deliveryMetric, "coverage");
    const salesAmount = stringField(salesMetric, "value");
    const salesCurrency = stringField(salesMetric, "currency") ?? selectedShop.currency;
    const latestReview = decisionPage.items[0] ?? null;
    const coverageComplete = hasCompleteProvenSourceWindow(latestReview);

    return {
      generatedAt: new Date(),
      shops: dashboardShops.map((shop) => shopSource(shop, shop.id === selectedShop.id ? latestRun : null)),
      selected: {
        shopId: selectedShop.id,
        orders: { total, awaitingShipment, delivered, canceled },
        finance: {
          officialOnHoldAmount: finance.latestSnapshot?.officialOnHoldAmount ?? null,
          currency: finance.latestSnapshot?.currency ?? selectedShop.currency,
          capturedAt: finance.latestSnapshot?.capturedAt ?? null,
        },
        deliveryRate: deliveryValue === null || deliveryCoverage === null
          ? { status: "UNAVAILABLE", reason: "DELIVERY_METRIC_NOT_CAPTURED" }
          : { status: "AVAILABLE", value: deliveryValue, coverage: deliveryCoverage },
        grossValidSales: salesAmount === null
          ? { status: "UNAVAILABLE", reason: "SALES_METRIC_NOT_CAPTURED" }
          : { status: "AVAILABLE", amount: salesAmount, currency: salesCurrency },
        dataCoverage: {
          status: coverageComplete ? "READY" : "PARTIAL",
          label: coverageComplete ? "Complete within proven source window" : "Last 12 months",
          reason: coverageComplete
            ? "History window: Last 12 months. Lifetime history: not proven."
            : "Seller Center collection is bounded to its rolling source window; lifetime history is not verified.",
        },
        latestSync: {
          status: currentSyncState(selectedShop, latestRun),
          startedAt: latestRun?.startedAt
            ?? latestTimestamp(selectedShop.lastOrdersSyncedAt, selectedShop.lastFinanceSyncedAt),
          sourceComplete: latestRun?.sourceComplete ?? null,
          failureType: latestRun?.failureType ?? selectedShop.syncState,
        },
        profileState: "NOT_VERIFIED",
        ...decisionStages(latestReview),
      },
    };
  } finally {
    await closeDatabase(context);
  }
}

export async function loadDashboardPresentation(): Promise<DashboardPresentation> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return buildDashboardPresentation(unavailableSource());

  try {
    const source = await readLiveSource(databaseUrl);
    return buildDashboardPresentation(source ?? unavailableSource());
  } catch {
    return buildDashboardPresentation(unavailableSource());
  }
}
