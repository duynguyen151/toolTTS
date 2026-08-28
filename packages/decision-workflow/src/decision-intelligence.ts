import { Decimal } from "decimal.js";
import { AiDecisionContextSchema, assertFrozenDecisionContext } from "@shop-health/domain";
import type {
  AiDecisionContext,
  DecisionCoverageSnapshot,
  DecisionFinanceSnapshot,
  DecisionMetricsSnapshot,
  DecisionRiskSnapshot,
  DecisionRuleResult,
  DecisionRuleTrigger,
  FrozenAiTaskRequest,
  OfficialOnHoldRuleEvidence,
  MetricComparison,
  TrendName,
  TrendPolicy,
} from "@shop-health/domain";

const TREND_NAMES: readonly TrendName[] = [
  "RAPID_ONHOLD_GROWTH",
  "DELIVERY_DETERIORATION",
  "REFUND_SPIKE",
  "RECOVERY_TREND",
  "THRESHOLD_FLAPPING",
];

export interface DecisionIntelligenceInput {
  readonly observedAt: Date;
  readonly profile: { readonly profileId: string; readonly profileNo: string };
  readonly shop: AiDecisionContext["shop"];
  readonly metrics: DecisionMetricsSnapshot;
  readonly finance: DecisionFinanceSnapshot;
  readonly coverage: DecisionCoverageSnapshot;
  readonly risk: DecisionRiskSnapshot;
  readonly ruleDecision: DecisionRuleResult;
  readonly ruleTriggers: readonly DecisionRuleTrigger[];
  readonly targetRuleEvidence?: OfficialOnHoldRuleEvidence;
  readonly requestedAiTask?: FrozenAiTaskRequest;
  readonly previous: AiDecisionContext | null;
  readonly trendPolicy?: TrendPolicy;
}

function decimal(value: string | null): Decimal | null {
  return value === null ? null : new Decimal(value);
}

function comparable(
  metric: string,
  current: string | number | null,
  previous: string | number | null,
  currency: "USD" | null,
): MetricComparison {
  if (current === null || previous === null) {
    return { metric, current, previous, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency };
  }
  if (typeof current === "number" && typeof previous === "number") {
    const difference = Number((current - previous).toFixed(12));
    return {
      metric, current, previous, absoluteDelta: difference,
      relativeDelta: previous === 0 ? null : Number((difference / Math.abs(previous)).toFixed(12)),
      direction: difference > 0 ? "INCREASED" : difference < 0 ? "DECREASED" : "UNCHANGED", currency,
    };
  }
  if (typeof current === "string" && typeof previous === "string") {
    const difference = decimal(current)!.minus(decimal(previous)!);
    return {
      metric, current, previous, absoluteDelta: difference.toString(),
      relativeDelta: decimal(previous)!.isZero() ? null : difference.dividedBy(decimal(previous)!.abs()).toNumber(),
      direction: difference.isPositive() ? "INCREASED" : difference.isNegative() ? "DECREASED" : "UNCHANGED", currency,
    };
  }
  return { metric, current, previous, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency };
}

function compatible(previous: AiDecisionContext | null, input: DecisionIntelligenceInput): boolean {
  return previous !== null
    && previous.profile.profileId === input.profile.profileId
    && previous.profile.profileNo === input.profile.profileNo
    && previous.shop.shopId === input.shop.shopId
    && previous.shop.currency === input.shop.currency
    && previous.policyVersions.metricDefinitionVersion === "decision-metrics.v1";
}

function dataQuality(coverage: DecisionCoverageSnapshot): AiDecisionContext["dataQuality"] {
  const blockers: string[] = [];
  if (coverage.coverageState !== "COMPLETE") blockers.push(`DATA_COVERAGE_${coverage.coverageState}`);
  if (coverage.source !== "SELLER_CENTER") blockers.push("SOURCE_NOT_VERIFIED");
  if (coverage.ordersSourceComplete !== true) blockers.push("ORDERS_SOURCE_INCOMPLETE");
  if (coverage.financeRequiredSourceComplete !== true) blockers.push("FINANCE_SOURCE_INCOMPLETE");
  if (coverage.sourceReconciled !== true) blockers.push("FINANCE_NOT_RECONCILED");
  if ((coverage.freshness ?? "UNKNOWN") !== "FRESH") blockers.push(`FRESHNESS_${coverage.freshness ?? "UNKNOWN"}`);
  return {
    coverage: coverage.coverageState, source: coverage.source ?? null,
    provenSourceWindow: coverage.provenSourceWindow, completeWithinSourceWindow: coverage.completeWithinSourceWindow,
    lifetimeHistoryComplete: coverage.lifetimeHistoryComplete, ordersSourceComplete: coverage.ordersSourceComplete ?? null,
    financeRequiredSourceComplete: coverage.financeRequiredSourceComplete ?? null,
    sourceReconciled: coverage.sourceReconciled ?? null, freshness: coverage.freshness ?? "UNKNOWN",
    latestSuccessfulSyncAt: coverage.latestSuccessfulSyncAt ?? null, financeCapturedAt: coverage.financeCapturedAt ?? null, blockers,
  };
}

function valueForThreshold(comparisons: readonly MetricComparison[], name: string): number | null {
  const [metric, field] = name.split(".");
  const comparison = comparisons.find((item) => item.metric === metric);
  if (!comparison || !field) return null;
  const value = comparison[field as keyof MetricComparison];
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Decimal(value).toNumber();
  return null;
}

function test(operator: "GT" | "GTE" | "LT" | "LTE" | "EQ", value: number, threshold: number): boolean {
  switch (operator) {
    case "GT": return value > threshold;
    case "GTE": return value >= threshold;
    case "LT": return value < threshold;
    case "LTE": return value <= threshold;
    case "EQ": return value === threshold;
  }
}

function trendSignals(comparisons: readonly MetricComparison[], policy?: TrendPolicy): AiDecisionContext["trends"] {
  return TREND_NAMES.map((signal) => {
    const rule = policy?.signals.find((item) => item.signal === signal);
    if (!rule) return { signal, comparisons: [], status: "NOT_EVALUATED" as const, reasonCode: "POLICY_UNCONFIGURED" as const };
    const values = rule.thresholds.map((threshold) => valueForThreshold(comparisons, threshold.metric));
    if (values.some((value) => value === null)) {
      return { signal, comparisons: comparisons.filter((comparison) => rule.thresholds.some((threshold) => threshold.metric.startsWith(`${comparison.metric}.`))), status: "NOT_EVALUATED" as const, reasonCode: "INSUFFICIENT_DATA" as const };
    }
    return {
      signal,
      comparisons: comparisons.filter((comparison) => rule.thresholds.some((threshold) => threshold.metric.startsWith(`${comparison.metric}.`))),
      status: rule.thresholds.every((threshold, index) => test(threshold.operator, values[index]!, threshold.value)) ? "TRIGGERED" as const : "NOT_TRIGGERED" as const,
      reasonCode: null,
    };
  });
}

export function buildDecisionIntelligence(input: DecisionIntelligenceInput): { readonly context: AiDecisionContext } {
  const prior = compatible(input.previous, input) ? input.previous : null;
  const exposure = input.metrics.onHoldValue;
  const targetRule = input.targetRuleEvidence;
  const priorMetrics = prior?.metrics.decision;
  const comparisons = [
    comparable("operationalExposure", exposure, priorMetrics?.operationalExposure ?? null, "USD"),
    comparable("deliveryRate", input.metrics.deliveryRate, priorMetrics?.deliveryRate ?? null, null),
    comparable("refundRate", input.metrics.refundRate, priorMetrics?.refundRate ?? null, null),
    comparable("cancellationRate", input.metrics.cancellationRate, priorMetrics?.cancellationRate ?? null, null),
  ];
  const exposureFailed = input.risk.stopByOnHoldValue;
  const rateFailed = input.risk.stopByDeliveryRate;
  const context = AiDecisionContextSchema.parse({
    schemaVersion: input.requestedAiTask === undefined ? "ai-decision-context.v1" : "ai-decision-context.v2",
    ...(input.targetRuleEvidence === undefined ? {} : { targetRuleEvidence: input.targetRuleEvidence }),
    ...(input.requestedAiTask === undefined ? {} : { requestedAiTask: input.requestedAiTask }),
    profile: input.profile,
    shop: input.shop,
    metrics: {
      observedAt: input.observedAt.toISOString(),
      decision: {
        window: input.metrics.window,
        periodStart: input.metrics.periodStart,
        periodEnd: input.metrics.periodEnd,
        totalOrders: input.metrics.totalOrders,
        totalPersistedOrders: input.metrics.totalPersistedOrders,
        operationalOrderCount: input.metrics.operationalOrderCount,
        onHoldOrderCount: input.metrics.onHoldOrderCount,
        deliveredCount: input.metrics.deliveredCount,
        deliveryRate: input.metrics.deliveryRate,
        cancellationRate: input.metrics.cancellationRate,
        refundRate: input.metrics.refundRate,
        currency: input.metrics.currency,
        operationalExposure: exposure,
      },
      finance: {
        capturedAt: input.finance.capturedAt, currency: input.finance.currency,
        availableBalance: input.finance.availableBalance, frozenBalance: input.finance.frozenBalance,
        totalBalance: input.finance.totalBalance, toSettleBalance: input.finance.toSettleBalance,
        officialFinanceOnHold: input.finance.officialOnHoldAmount,
        waitingForPackageDeliveryAmount: input.finance.waitingForPackageDeliveryAmount,
        deliveredAwaitingSettlementAmount: input.finance.deliveredAwaitingSettlementAmount,
        waitingForCompletedRefundReturnAmount: input.finance.waitingForCompletedRefundReturnAmount,
        reasonTotalsReconcileToOfficialOnHold: input.finance.reasonTotalsReconcileToOfficialOnHold,
        missingOnHoldExpectedAmountCount: input.finance.missingOnHoldExpectedAmountCount,
        settlementCount: input.finance.settlementCount, onHoldSettlementCount: input.finance.onHoldSettlementCount,
      },
    },
    comparisons, trends: trendSignals(comparisons, input.trendPolicy), dataQuality: dataQuality(input.coverage),
    risk: {
      policyVersion: input.risk.policyVersion,
      evaluatedAt: input.risk.evaluatedAt,
      deliveryRate: input.risk.deliveryRate,
      stopByOnHoldValue: input.risk.stopByOnHoldValue,
      stopByDeliveryRate: input.risk.stopByDeliveryRate,
      dataSufficient: input.risk.dataSufficient,
      stopOnHoldValueAt: input.risk.stopOnHoldValueAt,
      stopDeliveryRateBelow: input.risk.stopDeliveryRateBelow,
      minimumOrdersForRateRule: input.risk.minimumOrdersForRateRule,
      operationalExposure: input.risk.onHoldValue,
    },
    rule: {
      result: input.ruleDecision, policyVersion: input.risk.policyVersion,
      checks: targetRule === undefined ? [
        { metric: "operationalExposure", observedValue: exposure, threshold: input.risk.stopOnHoldValueAt, operator: "GTE", result: exposure === null ? "NOT_EVALUATED" : exposureFailed ? "FAIL" : "PASS", triggeredReason: exposureFailed ? "OPERATIONAL_EXPOSURE_LIMIT_REACHED" : null },
        { metric: "deliveryRate", observedValue: input.metrics.deliveryRate, threshold: input.risk.stopDeliveryRateBelow, operator: "LT", result: input.metrics.deliveryRate === null || !input.risk.dataSufficient ? "NOT_EVALUATED" : rateFailed ? "FAIL" : "PASS", triggeredReason: rateFailed ? "DELIVERY_RATE_BELOW_LIMIT" : null },
      ] : [
        { metric: "officialFinanceOnHold", observedValue: targetRule.officialOnHold.observedValue, threshold: targetRule.officialOnHold.threshold, operator: "GTE", result: targetRule.officialOnHold.state === "TRIGGERED" ? "FAIL" : targetRule.officialOnHold.state === "CLEAR" ? "PASS" : "NOT_EVALUATED", triggeredReason: targetRule.officialOnHold.state === "TRIGGERED" ? "OFFICIAL_ON_HOLD_LIMIT_REACHED" : null },
        { metric: "deliveryRate", observedValue: targetRule.deliveryRate.observedValue, threshold: targetRule.deliveryRate.threshold, operator: "LT", result: targetRule.deliveryRate.state === "TRIGGERED" ? "FAIL" : targetRule.deliveryRate.state === "CLEAR" ? "PASS" : "NOT_EVALUATED", triggeredReason: targetRule.deliveryRate.state === "TRIGGERED" ? "DELIVERY_RATE_BELOW_LIMIT" : null },
      ],
      triggers: targetRule === undefined
        ? [...(exposureFailed ? ["OPERATIONAL_EXPOSURE" as const] : []), ...(rateFailed ? ["DELIVERY_RATE" as const] : [])]
        : targetRule.triggers.map((trigger) => trigger === "OFFICIAL_ON_HOLD" ? "OFFICIAL_ON_HOLD" as const : "DELIVERY_RATE" as const),
      expression: targetRule?.expression ?? `operationalExposure >= ${new Decimal(input.risk.stopOnHoldValueAt).toString()} ${input.shop.currency} OR deliveryRate < ${new Decimal(input.risk.stopDeliveryRateBelow).times(100).toString()}%`,
      evaluatedAt: input.observedAt.toISOString(),
    },
    previousCompatibleSnapshot: prior === null ? null : {
      observedAt: prior.metrics.observedAt,
      metrics: prior.metrics,
      dataQuality: prior.dataQuality,
      provenance: {
        shopId: prior.shop.shopId,
        profileId: prior.profile.profileId,
        profileNo: prior.profile.profileNo,
      },
    },
    policyVersions: { metricDefinitionVersion: "decision-metrics.v1", riskPolicyVersion: input.risk.policyVersion, trendPolicyVersion: input.trendPolicy?.version ?? null },
  });
  return {
    context: assertFrozenDecisionContext({
      context,
      metrics: input.metrics,
      finance: input.finance,
      coverage: input.coverage,
      risk: input.risk,
      ruleDecision: input.ruleDecision,
      ruleTriggers: input.ruleTriggers,
      ...(input.targetRuleEvidence === undefined ? {} : { targetRuleEvidence: input.targetRuleEvidence }),
      owner: {
        shopId: input.shop.shopId,
        profileId: input.profile.profileId,
        profileNo: input.profile.profileNo,
      },
      ...(input.trendPolicy === undefined ? {} : { trendPolicy: input.trendPolicy }),
    }),
  };
}
