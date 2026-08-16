import { Decimal } from "decimal.js";
import type {
  AiDecisionContext,
  DecisionCoverageSnapshot,
  DecisionFinanceSnapshot,
  DecisionMetricsSnapshot,
  DecisionRiskSnapshot,
  DecisionRuleResult,
  DecisionRuleTrigger,
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
  if (coverage.freshness !== "FRESH") blockers.push(`FRESHNESS_${coverage.freshness}`);
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
  const priorMetrics = prior?.metrics.decision;
  const comparisons = [
    comparable("operationalExposure", exposure, priorMetrics?.operationalExposure ?? null, "USD"),
    comparable("deliveryRate", input.metrics.deliveryRate, priorMetrics?.deliveryRate ?? null, null),
    comparable("refundRate", input.metrics.refundRate, priorMetrics?.refundRate ?? null, null),
    comparable("cancellationRate", input.metrics.cancellationRate, priorMetrics?.cancellationRate ?? null, null),
  ];
  const exposureFailed = input.risk.stopByOnHoldValue;
  const rateFailed = input.risk.stopByDeliveryRate;
  const context: AiDecisionContext = {
    schemaVersion: "ai-decision-context.v1", profile: input.profile, shop: input.shop,
    metrics: {
      observedAt: input.observedAt.toISOString(),
      decision: { ...input.metrics, operationalExposure: exposure },
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
    risk: { ...input.risk, operationalExposure: input.risk.onHoldValue },
    rule: {
      result: input.ruleDecision, policyVersion: input.risk.policyVersion,
      checks: [
        { metric: "operationalExposure", observedValue: exposure, threshold: input.risk.stopOnHoldValueAt, operator: "GTE", result: exposure === null ? "NOT_EVALUATED" : exposureFailed ? "FAIL" : "PASS", triggeredReason: exposureFailed ? "OPERATIONAL_EXPOSURE_LIMIT_REACHED" : null },
        { metric: "deliveryRate", observedValue: input.metrics.deliveryRate, threshold: input.risk.stopDeliveryRateBelow, operator: "LT", result: input.metrics.deliveryRate === null || !input.risk.dataSufficient ? "NOT_EVALUATED" : rateFailed ? "FAIL" : "PASS", triggeredReason: rateFailed ? "DELIVERY_RATE_BELOW_LIMIT" : null },
      ],
      triggers: [...(exposureFailed ? ["OPERATIONAL_EXPOSURE" as const] : []), ...(rateFailed ? ["DELIVERY_RATE" as const] : [])],
      expression: "operationalExposure >= 3500 USD OR deliveryRate < 70%", evaluatedAt: input.observedAt.toISOString(),
    },
    previousCompatibleSnapshot: prior === null ? null : { observedAt: prior.metrics.observedAt, metrics: prior.metrics, dataQuality: prior.dataQuality },
    policyVersions: { metricDefinitionVersion: "decision-metrics.v1", riskPolicyVersion: input.risk.policyVersion, trendPolicyVersion: input.trendPolicy?.version ?? null },
  };
  return { context };
}
