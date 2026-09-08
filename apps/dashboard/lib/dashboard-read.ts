import {
  closeDatabase,
  createDatabase,
  getFinanceSummary,
  getFullPersistedRiskOrderFacts,
  getLatestKpiSnapshot,
  listDecisionHistory,
  listEnabledShopProviderBindings,
  listAdsPowerProfiles,
  listShops,
  listSyncRuns,
  type AdsPowerProfileRow,
  type Database,
  type FinanceSummary,
  type DecisionReviewRecord,
  type KpiSnapshotRow,
  type RiskOrderFactRow,
  type ShopRow,
  type SyncRunRow,
} from "@shop-health/db";

import { calculateAuthoritativeDeliveryRateFromCounts } from "@shop-health/domain";

import type {
  DashboardDecisionCenter,
  DashboardEvidenceMetadata,
  DashboardPortfolioOverview,
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

function evidence(owner: DashboardEvidenceMetadata["owner"], source: string, observedAt: Date | string | null | undefined): DashboardEvidenceMetadata {
  return { owner, source, observedAt: displayTimestamp(observedAt) };
}

function unavailableCondition(owner: DashboardEvidenceMetadata["owner"], observedAt: Date | string | null | undefined) {
  return {
    state: "NOT_EVALUATED" as const,
    source: null,
    observedValue: "Unavailable",
    observedAt: "Unavailable",
    ageMs: null,
    quality: "UNKNOWN",
    threshold: "Unavailable",
    evidence: evidence(owner, "DECISION_CASE", observedAt),
  };
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
      reviewSnapshot: {
        owner: "IMMUTABLE_DECISION_CASE",
        source: "DECISION_CASE",
        businessTimeZone: "Asia/Bangkok",
        observedAt: "Unavailable",
      },
      effectivePolicy: {
        owner: "IMMUTABLE_DECISION_CASE",
        source: "DECISION_CASE",
        observedAt: "Unavailable",
        policyVersion: "Unavailable",
        effectiveAt: "Unavailable",
        stopOnHoldValueAt: "Unavailable",
        stopOnHoldValueAtSource: "Unavailable",
        stopDeliveryRateBelow: "Unavailable",
        stopDeliveryRateBelowSource: "Unavailable",
      },
      financeHealth: null,
      coverage: {
        status: "UNAVAILABLE",
        source: "Unavailable",
        provenWindow: "Unavailable",
        sourceReconciled: "Unavailable",
        freshness: "Unavailable",
        financeCapturedAt: null,
        financeAgeMs: null,
        staleDisclosure: null,
        completeWithinWindow: "Unavailable",
        lifetimeHistory: "Not verified",
        evidence: evidence("IMMUTABLE_DECISION_CASE", "DECISION_CASE", null),
      },
      metrics: [],
      comparisons: [],
      trends: [],
      rule: {
        result: "UNAVAILABLE", policyVersion: "Unavailable", expression: "Unavailable", evaluatedAt: "Unavailable", triggers: [], checks: [],
        conditions: { officialOnHold: unavailableCondition("IMMUTABLE_DECISION_CASE", null), deliveryRate: unavailableCondition("IMMUTABLE_DECISION_CASE", null) },
        evidence: evidence("IMMUTABLE_DECISION_CASE", "DECISION_CASE", null),
      },
      ai: {
        status: "UNAVAILABLE",
        recommendation: "Unavailable",
        riskLevel: "Unavailable",
        confidence: "Unavailable",
        ruleAgreement: "Unavailable",
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
      evidence: evidence("AI_DECISION", "AI_DECISION", null),
    },
      ba: { current: "NOT_REVIEWED", currentDetail: "No BA decision is recorded.", evidence: evidence("BA_DECISION_REVISION", "BA_DECISION", null), history: [] },
      execution: { status: "NOT_REQUESTED", requestedAction: "None", mode: "DRY_RUN only", sellerCenterCalled: "No", executedAt: "Not executed", evidence: evidence("DRY_RUN_EXECUTION", "DECISION_EXECUTION", null) },
      reviewQueue: queueReviews.flatMap((item) => {
        const reasons = decisionQueueReasons(item);
        return reasons.length === 0 ? [] : [{ profileNo: item.shop.profileNo, displayName: item.shop.displayName, reasons, evidence: evidence("IMMUTABLE_DECISION_CASE", "DECISION_CASE", item.case?.observedAt) }];
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
  const caseObservedAt = review.case?.observedAt;
  const caseEvidence = evidence("IMMUTABLE_DECISION_CASE", "DECISION_CASE", caseObservedAt);
  const targetRule = context?.targetRuleEvidence;
  const hasPersistedSourceWindow = coverage.source === "SELLER_CENTER" && coverage.provenSourceWindow !== null;
  const reviewHistory = history.flatMap((item) => (item.baHistory ?? (item.ba === null ? [] : [item.ba])).map((ba) => ({
    decision: ba.decision,
    reason: ba.reasonCode,
    actor: ba.actor,
    decidedAt: displayTimestamp(ba.decidedAt),
    notes: ba.notes ?? ba.note ?? "No note provided.",
    evidence: evidence("BA_DECISION_REVISION", "BA_DECISION", ba.decidedAt),
    plannedMethods: ba.plannedMethods ?? [],
  })));

  return {
    status: "AVAILABLE",
    message: "Live read model from persisted decision history.",
    caseId: review.case?.id ?? null,
    profileNo: review.shop?.profileNo ?? null,
    reviewSnapshot: {
      owner: "IMMUTABLE_DECISION_CASE",
      source: "DECISION_CASE",
      businessTimeZone: "Asia/Bangkok",
      observedAt: displayTimestamp(review.case?.observedAt),
    },
    effectivePolicy: review.resolvedPolicySnapshot == null ? {
      owner: "IMMUTABLE_DECISION_CASE",
      source: "DECISION_CASE",
      observedAt: displayTimestamp(review.case?.observedAt),
      policyVersion: "Unavailable",
      effectiveAt: "Unavailable",
      stopOnHoldValueAt: "Unavailable",
      stopOnHoldValueAtSource: "Unavailable",
      stopDeliveryRateBelow: "Unavailable",
      stopDeliveryRateBelowSource: "Unavailable",
    } : {
      owner: "IMMUTABLE_DECISION_CASE",
      source: "DECISION_CASE",
      observedAt: displayTimestamp(review.case?.observedAt),
      policyVersion: review.resolvedPolicySnapshot.policyVersion,
      effectiveAt: displayTimestamp(review.resolvedPolicySnapshot.effectiveAt),
      stopOnHoldValueAt: `${review.resolvedPolicySnapshot.thresholds.stopOnHoldValueAt} ${review.resolvedPolicySnapshot.currency}`,
      stopOnHoldValueAtSource: review.resolvedPolicySnapshot.sources.thresholds.stopOnHoldValueAt,
      stopDeliveryRateBelow: String(review.resolvedPolicySnapshot.thresholds.stopDeliveryRateBelow),
      stopDeliveryRateBelowSource: review.resolvedPolicySnapshot.sources.thresholds.stopDeliveryRateBelow,
    },
    financeHealth: coverage.financeHealth ?? null,
    coverage: {
      status: hasCompleteProvenSourceWindow(review) ? "COMPLETE" : "PARTIAL",
      source: coverage.source ?? "Unavailable",
      provenWindow: hasPersistedSourceWindow ? coverage.provenSourceWindow ?? "Unavailable" : "Unavailable",
      sourceReconciled: coverage.sourceReconciled ? "Yes" : "No",
      freshness: coverage.freshness ?? "UNKNOWN",
      financeCapturedAt: coverage.financeHealth?.collectedAt ?? coverage.financeCapturedAt ?? null,
      financeAgeMs: coverage.financeHealth?.ageMs ?? null,
      staleDisclosure: coverage.freshness === "STALE"
        ? "STALE: Finance evidence is advisory only and is not current."
        : null,
      completeWithinWindow: coverage.completeWithinSourceWindow ? "Yes" : "No",
      lifetimeHistory: coverage.lifetimeHistoryComplete ? "Complete" : "Not verified",
      evidence: caseEvidence,
    },
    metrics: [
      { label: "Total orders", value: displayValue(review.metrics.totalOrders), detail: "Persisted decision-case snapshot", evidence: caseEvidence },
      { label: "Operational exposure", value: displayValue(review.metrics.onHoldValue), detail: `Currency: ${review.metrics.currency}`, evidence: caseEvidence },
      { label: "Delivered count", value: displayValue(review.metrics.deliveredCount), detail: "Persisted decision-case snapshot", evidence: caseEvidence },
      { label: "Delivery rate", value: displayValue(review.metrics.deliveryRate), detail: "Persisted decision-case snapshot", evidence: caseEvidence },
      { label: "Cancellation rate", value: displayValue(review.metrics.cancellationRate), detail: "Persisted decision-case snapshot", evidence: caseEvidence },
      { label: "Refund rate", value: displayValue(review.metrics.refundRate), detail: "Persisted decision-case snapshot", evidence: caseEvidence },
    ],
    comparisons: (context?.comparisons ?? []).map((comparison) => ({
      metric: comparison.metric,
      current: displayValue(comparison.current),
      previous: displayValue(comparison.previous),
      absoluteDelta: displayValue(comparison.absoluteDelta),
      relativeDelta: displayValue(comparison.relativeDelta),
      direction: comparison.direction,
      evidence: caseEvidence,
    })),
    trends: (context?.trends ?? []).map((trend) => ({
      signal: trend.signal,
      status: trend.status,
      reason: trend.reasonCode ?? "None",
      evidence: caseEvidence,
      comparisons: trend.comparisons.map((comparison) => ({
        metric: comparison.metric,
        current: displayValue(comparison.current),
        previous: displayValue(comparison.previous),
        absoluteDelta: displayValue(comparison.absoluteDelta),
        relativeDelta: displayValue(comparison.relativeDelta),
        direction: comparison.direction,
        evidence: caseEvidence,
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
        evidence: caseEvidence,
      })),
      conditions: targetRule === undefined ? {
        officialOnHold: unavailableCondition("IMMUTABLE_DECISION_CASE", caseObservedAt),
        deliveryRate: unavailableCondition("IMMUTABLE_DECISION_CASE", caseObservedAt),
      } : {
        officialOnHold: {
          state: targetRule.officialOnHold.state,
          source: targetRule.officialOnHold.source,
          observedValue: displayValue(targetRule.officialOnHold.observedValue),
          observedAt: displayTimestamp(targetRule.officialOnHold.observedAt),
          ageMs: targetRule.officialOnHold.ageMs,
          quality: targetRule.officialOnHold.quality,
          threshold: displayValue(targetRule.officialOnHold.threshold),
          evidence: caseEvidence,
        },
        deliveryRate: {
          state: targetRule.deliveryRate.state,
          source: targetRule.deliveryRate.source,
          observedValue: displayValue(targetRule.deliveryRate.observedValue),
          observedAt: displayTimestamp(targetRule.deliveryRate.observedAt),
          ageMs: targetRule.deliveryRate.ageMs,
          quality: targetRule.deliveryRate.quality,
          threshold: displayValue(targetRule.deliveryRate.threshold),
          evidence: caseEvidence,
        },
      },
      evidence: caseEvidence,
    },
    ai: ai === null ? {
      status: "UNAVAILABLE",
      recommendation: "Unavailable",
      riskLevel: "Unavailable",
      confidence: "Unavailable",
      ruleAgreement: "Unavailable",
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
      evidence: evidence("AI_DECISION", "AI_DECISION", null),
    } : {
      status: ai.status,
      recommendation: displayValue(ai.recommendation),
      riskLevel: displayValue(ai.riskLevel),
      confidence: displayValue(ai.confidence),
      ruleAgreement: ai.ruleOverride === null
        ? "Unavailable"
        : ai.ruleOverride
          ? "AI differs from deterministic Rule"
          : "AI agrees with deterministic Rule",
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
      evidence: evidence("AI_DECISION", "AI_DECISION", ai.createdAt),
    },
    ba: {
      current: review.ba?.decision ?? "NOT_REVIEWED",
      currentDetail: review.ba === null ? "Business analyst review has not been completed." : `${review.ba.reasonCode} · ${review.ba.actor}`,
      evidence: review.ba === null ? evidence("BA_DECISION_REVISION", "BA_DECISION", null) : evidence("BA_DECISION_REVISION", "BA_DECISION", review.ba.decidedAt),
      history: reviewHistory,
    },
    execution: review.execution === null ? {
      status: "NOT_REQUESTED",
      requestedAction: "None",
      mode: "DRY_RUN only",
      sellerCenterCalled: "No",
      executedAt: "Not executed",
      evidence: evidence("DRY_RUN_EXECUTION", "DECISION_EXECUTION", null),
    } : {
      status: review.execution.status,
      requestedAction: review.execution.requestedAction,
      mode: review.execution.mode,
      sellerCenterCalled: review.execution.sellerCenterCalled ? "Yes" : "No",
      executedAt: displayTimestamp(review.execution.executedAt),
      evidence: evidence("DRY_RUN_EXECUTION", "DECISION_EXECUTION", review.execution.executedAt),
    },
    reviewQueue: queueReviews
      .filter((item, index, items) => items.findIndex((candidate) => candidate.shop.id === item.shop.id) === index)
      .flatMap((item) => {
        const reasons = decisionQueueReasons(item);
        return reasons.length === 0 ? [] : [{ profileNo: item.shop.profileNo, displayName: item.shop.displayName, reasons, evidence: evidence("IMMUTABLE_DECISION_CASE", "DECISION_CASE", item.case?.observedAt) }];
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

function scaledMoney(value: string): bigint | null {
  const match = /^\d+(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (match === null) return null;
  return BigInt(value.split(".")[0]!) * 10_000n + BigInt((match[1] ?? "").padEnd(4, "0"));
}

function formatScaledMoney(value: bigint): string {
  return `${value / 10_000n}.${(value % 10_000n).toString().padStart(4, "0")}`;
}

function formatCurrency(amount: string, currency: string): string {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
}

function ruleAiDisagreement(review: DecisionReviewRecord | null): boolean {
  if (review?.ai?.status !== "AVAILABLE") return false;
  const healthyAiRecommendation = review.ai.recommendation === "CONTINUE" || review.ai.recommendation === "SCALE";
  return review.ai.recommendation !== review.rule.decision
    && !(review.rule.decision === "CONTINUE" && healthyAiRecommendation);
}

function isAuthAttention(
  shop: ShopRow,
  profile: AdsPowerProfileRow | undefined,
  cotikBinding?: Awaited<ReturnType<typeof listEnabledShopProviderBindings>>[number] | null,
): boolean {
  if (cotikBinding !== undefined) {
    return cotikBinding === null || !cotikBinding.enabled;
  }
  return false;
}

type PortfolioShopRead = {
  shop: ShopRow;
  facts: RiskOrderFactRow[];
  finance: FinanceSummary;
  review: DecisionReviewRecord | null;
  latestRun: SyncRunRow | null;
  cotikBinding: Awaited<ReturnType<typeof listEnabledShopProviderBindings>>[number] | null;
};

function buildPortfolioShopView(
  input: PortfolioShopRead,
  adsPowerProfile: AdsPowerProfileRow | undefined,
): DashboardPortfolioOverview["shops"][number] {
  const { shop, facts, finance, review, latestRun, cotikBinding } = input;
  const delivery = calculateAuthoritativeDeliveryRateFromCounts(
    facts.map(({ canonicalStatus, orderCount }) => ({ canonicalStatus, count: orderCount })),
  );
  const officialOnHoldAmount = finance.latestSnapshot?.officialOnHoldAmount ?? null;
  const hasCotik = Boolean(cotikBinding?.enabled);
  const deliveryPct = delivery.rate !== null
    ? (delivery.rate <= 1 && delivery.rate > 0 ? delivery.rate * 100 : delivery.rate)
    : (review?.metrics.deliveryRate != null ? (review.metrics.deliveryRate <= 1 && review.metrics.deliveryRate > 0 ? review.metrics.deliveryRate * 100 : review.metrics.deliveryRate) : null);
  const isDeliveryLow = deliveryPct !== null && deliveryPct < 70;

  const dataBlocked = !hasCotik || shop.syncState === "DISABLED";
  const atRisk = review?.rule.decision === "PAUSE"
    || (review?.ai?.status === "AVAILABLE" && review.ai.recommendation === "PAUSE")
    || isDeliveryLow
    || shop.syncState === "PAUSED_LAYOUT"
    || shop.syncState === "PAUSED_MANUAL";

  return {
    id: shop.id,
    profileNo: shop.profileNo,
    displayName: shop.displayName ?? shop.profileNo,
    compositeHealth: atRisk ? "AT_RISK" : dataBlocked ? "DATA_BLOCKED" : "HEALTHY",
    officialOnHoldAmount,
    currency: finance.latestSnapshot?.currency ?? shop.currency,
    deliveryRate: { value: delivery.rate },
    totalOrders: facts.length > 0 ? countFacts(facts) : review?.metrics.totalOrders ?? null,
    ruleResult: review?.rule.decision ?? null,
    aiRecommendation: review?.ai?.status === "AVAILABLE" ? review.ai.recommendation : null,
    baDecision: review?.ba?.decision ?? null,
    cotikBinding: cotikBinding === null ? null : {
      enabled: cotikBinding.enabled,
      cotikShopId: cotikBinding.providerShopId ?? "",
      lastOrdersSyncedAt: displayTimestamp(cotikBinding.providerUpdatedAt),
      lastFinanceSyncedAt: displayTimestamp(cotikBinding.providerUpdatedAt),
    },
  };
}

function buildPortfolioOverview(
  reads: readonly PortfolioShopRead[],
  adsPowerProfiles: readonly AdsPowerProfileRow[],
): DashboardPortfolioOverview {
  const profileMap = new Map(adsPowerProfiles.map((profile) => [profile.profileNo, profile]));
  const shops = reads.map((read) => buildPortfolioShopView(read, profileMap.get(read.shop.profileNo)));
  const moneyByCurrency = new Map<string, { amount: bigint; shopCount: number }>();
  let numerator = 0;
  let denominator = 0;

  for (const read of reads) {
    const snapshot = read.finance.latestSnapshot;
    const amount = snapshot === null || snapshot.officialOnHoldAmount === null || snapshot.officialOnHoldAmount === undefined
      ? null
      : scaledMoney(snapshot.officialOnHoldAmount);
    if (amount !== null && snapshot !== null) {
      const currency = snapshot.currency;
      const bucket = moneyByCurrency.get(currency) ?? { amount: 0n, shopCount: 0 };
      bucket.amount += amount;
      bucket.shopCount += 1;
      moneyByCurrency.set(currency, bucket);
    }

    const delivery = calculateAuthoritativeDeliveryRateFromCounts(
      read.facts.map(({ canonicalStatus, orderCount }) => ({ canonicalStatus, count: orderCount })),
    );
    if (delivery.rate !== null && delivery.deliveredCount !== null && delivery.totalCount !== null) {
      numerator += delivery.deliveredCount;
      denominator += delivery.totalCount;
    }
  }

  const hasUnknownStatus = reads.some((read) => calculateAuthoritativeDeliveryRateFromCounts(
    read.facts.map(({ canonicalStatus, orderCount }) => ({ canonicalStatus, count: orderCount })),
  ).dataIssues.includes("UNKNOWN_STATUS_PRESENT"));
  const portfolioRate = hasUnknownStatus || denominator === 0 ? null : numerator / denominator;
  const reviewByShop = reads.filter((read) => read.review !== null).map((read) => read.review!);
  const needsBaReviewCount = reviewByShop.filter((review) => review.ba === null && decisionQueueReasons(review).length > 0).length;

  return {
    totalShops: reads.length,
    activeShops: reads.filter(({ shop }) => shop.enabled && shop.syncState === "ACTIVE").length,
    officialOnHoldByCurrency: [...moneyByCurrency.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, bucket]) => {
        const totalAmount = formatScaledMoney(bucket.amount);
        return { currency, totalAmount, formatted: formatCurrency(totalAmount, currency), shopCount: bucket.shopCount };
      }),
    portfolioDeliveryRate: {
      numerator,
      denominator,
      rate: portfolioRate,
      formatted: portfolioRate === null
        ? "Chưa đủ dữ liệu"
        : new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(portfolioRate),
    },
    totalPortfolioOrders: reads.reduce((total, read) => total + (read.facts.length > 0 ? countFacts(read.facts) : read.review?.metrics.totalOrders ?? 0), 0),
    attention: {
      needsBaReviewCount,
      rulePauseCount: reviewByShop.filter((review) => review.rule.decision === "PAUSE").length,
      disagreementCount: reviewByShop.filter(ruleAiDisagreement).length,
      authAttentionCount: reads.filter((read) => isAuthAttention(read.shop, profileMap.get(read.shop.profileNo), read.cotikBinding)).length,
    },
    shops,
  };
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

    const [adsPowerProfiles, portfolioReads, facts, finance, kpi, runs, decisionPage, decisionHistoryPages] = await Promise.all([
      listAdsPowerProfiles(context.db),
      Promise.all(dashboardShops.map(async (shop): Promise<PortfolioShopRead> => {
        const [shopFacts, shopFinance, shopRuns, shopDecisionPage, bindings] = await Promise.all([
          getFullPersistedRiskOrderFacts(context.db, shop.id),
          getFinanceSummary(context.db, shop.id),
          listSyncRuns(context.db, shop.id, 1),
          listDecisionHistory(context.db, {
            profileNo: shop.profileNo,
            caseOrigin: "LIVE",
            limit: 1,
          }),
          listEnabledShopProviderBindings(context.db, shop.id),
        ]);
        return {
          shop,
          facts: shopFacts,
          finance: shopFinance,
          latestRun: shopRuns[0] ?? null,
          review: shopDecisionPage.items[0] ?? null,
          cotikBinding: bindings.find((binding) => binding.provider === "COTIK") ?? null,
        };
      })),
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
      portfolio: buildPortfolioOverview(portfolioReads, adsPowerProfiles),
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
