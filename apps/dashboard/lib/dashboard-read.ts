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
  DashboardDecisionCenter,
  DashboardPresentation,
  DashboardShopSource,
  DashboardSource,
  DashboardSyncState,
} from "./dashboard-contract.js";
import { buildDashboardPresentation } from "./dashboard-model.js";

type JsonRecord = Record<string, unknown>;

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "Unavailable";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "Unavailable";
  if (typeof value === "string") return value;
  return "Unavailable";
}

function displayTimestamp(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
    timeZoneName: "short",
  }).format(timestamp);
}

function decisionQueueReasons(review: DecisionReviewRecord): string[] {
  const reasons: string[] = [];
  if (review.rule.decision === "PAUSE") reasons.push("RULE_PAUSE");
  if (review.ai?.status === "AVAILABLE" && review.ai.recommendation === "PAUSE") reasons.push("AI_PAUSE");
  if (review.ai?.status === "AVAILABLE" && review.ai.recommendation === "WATCH") reasons.push("AI_WATCH");
  const healthyAiRecommendation = review.ai?.recommendation === "CONTINUE" || review.ai?.recommendation === "SCALE";
  if (
    review.ai?.status === "AVAILABLE"
    && review.ai.recommendation !== review.rule.decision
    && !(review.rule.decision === "CONTINUE" && healthyAiRecommendation)
  ) reasons.push("RULE_AI_DISAGREEMENT");
  if (review.ai === null || review.ai.status === "UNAVAILABLE") reasons.push("AI_UNAVAILABLE");
  if (review.ai?.humanReviewRequired === true) reasons.push("HUMAN_REVIEW_REQUIRED");
  if (!hasCompleteProvenSourceWindow(review)) reasons.push("DATA_INCOMPLETE");
  return reasons;
}

function decisionCenterFromReviews(
  review: DecisionReviewRecord | null,
  history: readonly DecisionReviewRecord[],
  queueReviews: readonly DecisionReviewRecord[] = history,
): DashboardDecisionCenter {
  if (review === null) {
    return {
      status: "UNAVAILABLE",
      message: "No persisted LIVE decision case is available for this shop.",
      caseId: null,
      profileNo: null,
      coverage: {
        status: "UNAVAILABLE",
        source: "Unavailable",
        provenWindow: "Unavailable",
        sourceReconciled: "Unavailable",
        freshness: "Unavailable",
        completeWithinWindow: "Unavailable",
        lifetimeHistory: "Not verified",
      },
      metrics: [],
      comparisons: [],
      trends: [],
      rule: { result: "UNAVAILABLE", policyVersion: "Unavailable", expression: "Unavailable", evaluatedAt: "Unavailable", triggers: [], checks: [] },
      ai: {
        status: "UNAVAILABLE",
        recommendation: "Unavailable",
        riskLevel: "Unavailable",
        confidence: "Unavailable",
        humanReviewRequired: "Yes",
        reasonCodes: [],
        supportingFactors: [],
        riskFactors: [],
        whatWouldChange: [],
        reason: "Unavailable",
        policyVersion: "Unavailable",
        provider: "Unavailable",
        requestedModel: "Unavailable",
        reportedModel: "Unavailable",
        actualModel: "Unavailable",
        authMode: "Unavailable",
        promptVersion: "Unavailable",
        outputSchemaVersion: "Unavailable",
        failureCode: "NOT_RECORDED",
      },
      ba: { current: "NOT_REVIEWED", currentDetail: "No BA decision is recorded.", history: [] },
      execution: { status: "NOT_REQUESTED", requestedAction: "None", mode: "DRY_RUN only", sellerCenterCalled: "No", executedAt: "Not executed" },
      reviewQueue: queueReviews.flatMap((item) => {
        const reasons = decisionQueueReasons(item);
        return reasons.length === 0 ? [] : [{ profileNo: item.shop.profileNo, displayName: item.shop.displayName, reasons }];
      }),
    };
  }

  const context = review.decisionContextSnapshot;
  const coverage = review.coverageSnapshot ?? {
    coverageState: "PARTIAL",
    provenSourceWindow: null,
    completeWithinSourceWindow: false,
    lifetimeHistoryComplete: false,
    sourceReconciled: false,
    freshness: "UNKNOWN",
  };
  const ai = review.ai;
  const hasPersistedSourceWindow = coverage.source === "SELLER_CENTER" && coverage.provenSourceWindow !== null;
  const reviewHistory = history.flatMap((item) => (item.baHistory ?? (item.ba === null ? [] : [item.ba])).map((ba) => ({
    decision: ba.decision,
    reason: ba.reasonCode,
    actor: ba.actor,
    decidedAt: displayTimestamp(ba.decidedAt),
    notes: ba.notes ?? ba.note ?? "No note provided.",
  })));

  return {
    status: "AVAILABLE",
    message: "Live read model from persisted decision history.",
    caseId: review.case?.id ?? null,
    profileNo: review.shop?.profileNo ?? null,
    coverage: {
      status: hasCompleteProvenSourceWindow(review) ? "COMPLETE" : "PARTIAL",
      source: coverage.source ?? "Unavailable",
      provenWindow: hasPersistedSourceWindow ? coverage.provenSourceWindow ?? "Unavailable" : "Unavailable",
      sourceReconciled: coverage.sourceReconciled ? "Yes" : "No",
      freshness: coverage.freshness ?? "UNKNOWN",
      completeWithinWindow: coverage.completeWithinSourceWindow ? "Yes" : "No",
      lifetimeHistory: coverage.lifetimeHistoryComplete ? "Complete" : "Not verified",
    },
    metrics: [
      { label: "Total orders", value: displayValue(review.metrics.totalOrders), detail: "Persisted decision-case snapshot" },
      { label: "Operational exposure", value: displayValue(review.metrics.onHoldValue), detail: `Currency: ${review.metrics.currency}` },
      { label: "Delivered count", value: displayValue(review.metrics.deliveredCount), detail: "Persisted decision-case snapshot" },
      { label: "Delivery rate", value: displayValue(review.metrics.deliveryRate), detail: "Persisted decision-case snapshot" },
      { label: "Cancellation rate", value: displayValue(review.metrics.cancellationRate), detail: "Persisted decision-case snapshot" },
      { label: "Refund rate", value: displayValue(review.metrics.refundRate), detail: "Persisted decision-case snapshot" },
    ],
    comparisons: (context?.comparisons ?? []).map((comparison) => ({
      metric: comparison.metric,
      current: displayValue(comparison.current),
      previous: displayValue(comparison.previous),
      absoluteDelta: displayValue(comparison.absoluteDelta),
      relativeDelta: displayValue(comparison.relativeDelta),
      direction: comparison.direction,
    })),
    trends: (context?.trends ?? []).map((trend) => ({
      signal: trend.signal,
      status: trend.status,
      reason: trend.reasonCode ?? "None",
      comparisons: trend.comparisons.map((comparison) => ({
        metric: comparison.metric,
        current: displayValue(comparison.current),
        previous: displayValue(comparison.previous),
        absoluteDelta: displayValue(comparison.absoluteDelta),
        relativeDelta: displayValue(comparison.relativeDelta),
        direction: comparison.direction,
      })),
    })),
    rule: {
      result: review.rule.decision,
      policyVersion: review.rule.policyVersion,
      expression: context?.rule.expression ?? "Unavailable: frozen rule context was not recorded.",
      evaluatedAt: displayTimestamp(context?.rule.evaluatedAt ?? review.case?.observedAt),
      triggers: review.rule.triggers,
      checks: (context?.rule.checks ?? []).map((check) => ({
        metric: check.metric,
        observed: displayValue(check.observedValue),
        threshold: displayValue(check.threshold),
        operator: check.operator,
        result: check.result,
        reason: check.triggeredReason ?? "None",
      })),
    },
    ai: ai === null ? {
      status: "UNAVAILABLE",
      recommendation: "Unavailable",
      riskLevel: "Unavailable",
      confidence: "Unavailable",
      humanReviewRequired: "Yes",
      reasonCodes: [],
      supportingFactors: [],
      riskFactors: [],
      whatWouldChange: [],
      reason: "Unavailable",
      policyVersion: "Unavailable",
      provider: "Unavailable",
      requestedModel: "Unavailable",
      reportedModel: "Unavailable",
      actualModel: "Unavailable",
      authMode: "Unavailable",
      promptVersion: "Unavailable",
      outputSchemaVersion: "Unavailable",
      failureCode: "NOT_RECORDED",
    } : {
      status: ai.status,
      recommendation: displayValue(ai.recommendation),
      riskLevel: displayValue(ai.riskLevel),
      confidence: displayValue(ai.confidence),
      humanReviewRequired: ai.humanReviewRequired ? "Yes" : "No",
      reasonCodes: ai.reasonCodes ?? [],
      supportingFactors: ai.supportingFactors ?? [],
      riskFactors: ai.riskFactors ?? [],
      whatWouldChange: ai.whatWouldChangeDecision ?? [],
      reason: ai.reason ?? "Unavailable",
      policyVersion: ai.policyVersion ?? "Unavailable",
      provider: ai.provider,
      requestedModel: ai.requestedModel ?? "Not reported",
      reportedModel: ai.reportedModel ?? "Not reported",
      actualModel: ai.actualModelUsed ?? ai.model ?? "Not reported",
      authMode: ai.authMode ?? "Not reported",
      promptVersion: ai.promptVersion,
      outputSchemaVersion: ai.outputSchemaVersion ?? "Not reported",
      failureCode: ai.status === "UNAVAILABLE" ? ai.failureCode : "None",
    },
    ba: {
      current: review.ba?.decision ?? "NOT_REVIEWED",
      currentDetail: review.ba === null ? "Business analyst review has not been completed." : `${review.ba.reasonCode} · ${review.ba.actor}`,
      history: reviewHistory,
    },
    execution: review.execution === null ? {
      status: "NOT_REQUESTED",
      requestedAction: "None",
      mode: "DRY_RUN only",
      sellerCenterCalled: "No",
      executedAt: "Not executed",
    } : {
      status: review.execution.status,
      requestedAction: review.execution.requestedAction,
      mode: review.execution.mode,
      sellerCenterCalled: review.execution.sellerCenterCalled ? "Yes" : "No",
      executedAt: displayTimestamp(review.execution.executedAt),
    },
    reviewQueue: queueReviews
      .filter((item, index, items) => items.findIndex((candidate) => candidate.shop.id === item.shop.id) === index)
      .flatMap((item) => {
        const reasons = decisionQueueReasons(item);
        return reasons.length === 0 ? [] : [{ profileNo: item.shop.profileNo, displayName: item.shop.displayName, reasons }];
      }),
  };
}

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

function unavailableSource(
  now = new Date(),
  reason = "Live dashboard data is unavailable. Configure the database and retry.",
): DashboardSource {
  const shop: DashboardShopSource = {
    id: "dashboard-unavailable",
    profileNo: "UNAVAILABLE",
    displayName: "Live data unavailable",
    currency: "USD",
    dataOrigin: "UNAVAILABLE",
    enabled: false,
    syncState: "DISABLED",
    pauseReason: reason,
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
        reason,
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

async function readLiveSource(databaseUrl: string, requestedProfileNo?: string): Promise<DashboardSource | null> {
  const context = createDatabase(databaseUrl);
  try {
    const shops = await listShops(context.db);
    const liveShops = shops.filter((shop) => shop.dataOrigin === "LIVE");
    const dashboardShops = liveShops;
    const selectedShop = requestedProfileNo === undefined
      ? dashboardShops.find((shop) => shop.enabled) ?? dashboardShops[0] ?? null
      : dashboardShops.find((shop) => shop.profileNo === requestedProfileNo) ?? null;
    if (requestedProfileNo !== undefined && selectedShop === null) {
      return unavailableSource(new Date(), `Requested LIVE shop ${requestedProfileNo} was not found.`);
    }
    if (selectedShop === null) return null;

    const [facts, finance, kpi, runs, decisionPage, decisionHistoryPages] = await Promise.all([
      getFullPersistedRiskOrderFacts(context.db, selectedShop.id),
      getFinanceSummary(context.db, selectedShop.id),
      getLatestKpiSnapshot(context.db, selectedShop.id),
      listSyncRuns(context.db, selectedShop.id, 1),
      listDecisionHistory(context.db, {
        profileNo: selectedShop.profileNo,
        caseOrigin: "LIVE",
        limit: 1,
      }),
      Promise.all(dashboardShops.map((shop) => listDecisionHistory(context.db, {
        profileNo: shop.profileNo,
        caseOrigin: "LIVE",
        limit: 25,
      }))),
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
    const selectedHistory = latestReview === null ? [] : [latestReview];
    const queueReviews = decisionHistoryPages.map((page) => page.items[0]).filter((item): item is DecisionReviewRecord => item !== undefined);
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
          label: coverageComplete
            ? "Complete within proven source window"
            : latestReview?.coverageSnapshot?.source === "SELLER_CENTER"
              && latestReview.coverageSnapshot.provenSourceWindow !== null
              ? "Coverage incomplete"
              : "Coverage unavailable",
          reason: coverageComplete
            ? "History window: Last 12 months. Lifetime history: not proven."
            : latestReview?.coverageSnapshot?.source === "SELLER_CENTER"
              && latestReview.coverageSnapshot.provenSourceWindow !== null
              ? "Persisted source-window evidence is incomplete; coverage is not verified."
              : "No complete persisted source-window proof is recorded.",
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
        decisionCenter: decisionCenterFromReviews(latestReview, selectedHistory, queueReviews),
      },
    };
  } finally {
    await closeDatabase(context);
  }
}

export async function loadDashboardPresentation(requestedProfileNo?: string): Promise<DashboardPresentation> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return buildDashboardPresentation(unavailableSource());

  try {
    const source = await readLiveSource(databaseUrl, requestedProfileNo);
    return buildDashboardPresentation(source ?? unavailableSource());
  } catch {
    return buildDashboardPresentation(unavailableSource());
  }
}
