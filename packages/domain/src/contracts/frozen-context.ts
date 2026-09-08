import { Decimal } from "decimal.js";

import type {
  DecisionCoverageSnapshot,
  DecisionFinanceSnapshot,
  DecisionMetricsSnapshot,
  DecisionRiskSnapshot,
  DecisionRuleResult,
  DecisionRuleTrigger,
} from "../decisions.js";
import type {
  AiDecisionContext,
  MetricComparison,
  TrendPolicy,
  TrendSignal,
} from "./v1-freeze.js";
import { AiDecisionContextSchema } from "./v1-freeze.js";

const TREND_NAMES: readonly TrendSignal["signal"][] = [
  "RAPID_ONHOLD_GROWTH",
  "DELIVERY_DETERIORATION",
  "REFUND_SPIKE",
  "RECOVERY_TREND",
  "THRESHOLD_FLAPPING",
];

type MetricValue = string | number | null;

export interface FrozenContextOwner {
  readonly shopId: string;
  readonly profileId?: string;
  readonly profileNo?: string;
}

export interface FrozenContextValidationInput {
  readonly context: unknown;
  readonly metrics: DecisionMetricsSnapshot;
  readonly finance: DecisionFinanceSnapshot;
  readonly coverage: DecisionCoverageSnapshot;
  readonly risk: DecisionRiskSnapshot;
  readonly ruleDecision: DecisionRuleResult;
  readonly ruleTriggers: readonly DecisionRuleTrigger[];
  readonly targetRuleEvidence?: import("../target-rule.js").OfficialOnHoldRuleEvidence;
  readonly owner?: FrozenContextOwner;
  readonly trendPolicy?: TrendPolicy;
}

export type FrozenContextValidationResult =
  | { readonly valid: true; readonly context: AiDecisionContext }
  | { readonly valid: false; readonly issues: readonly string[] };

function equalValue(left: MetricValue, right: MetricValue): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left === "number" && typeof right === "number") return Object.is(left, right);
  if (typeof left === "string" && typeof right === "string") {
    try {
      return new Decimal(left).eq(right);
    } catch {
      return false;
    }
  }
  if ((typeof left === "number" && typeof right === "string") || (typeof left === "string" && typeof right === "number")) {
    try {
      return new Decimal(left).eq(right);
    } catch {
      return false;
    }
  }
  return false;
}

function equalArray<T>(left: readonly T[], right: readonly T[], equal: (a: T, b: T) => boolean): boolean {
  return left.length === right.length && left.every((value, index) => equal(value, right[index]!));
}

function equalTargetRuleEvidence(
  left: import("../target-rule.js").OfficialOnHoldRuleEvidence,
  right: import("../target-rule.js").OfficialOnHoldRuleEvidence,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function equalComparison(left: MetricComparison, right: MetricComparison): boolean {
  return left.metric === right.metric
    && equalValue(left.current, right.current)
    && equalValue(left.previous, right.previous)
    && equalValue(left.absoluteDelta, right.absoluteDelta)
    && (left.relativeDelta === right.relativeDelta)
    && left.direction === right.direction
    && left.currency === right.currency;
}

function comparable(metric: string, current: MetricValue, previous: MetricValue, currency: "USD" | null): MetricComparison {
  if (current === null || previous === null || typeof current !== typeof previous) {
    return { metric, current, previous, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency };
  }
  if (typeof current === "number" && typeof previous === "number") {
    const difference = Number((current - previous).toFixed(12));
    return {
      metric,
      current,
      previous,
      absoluteDelta: difference,
      relativeDelta: previous === 0 ? null : Number((difference / Math.abs(previous)).toFixed(12)),
      direction: difference > 0 ? "INCREASED" : difference < 0 ? "DECREASED" : "UNCHANGED",
      currency,
    };
  }
  try {
    const difference = new Decimal(current as string).minus(previous as string);
    return {
      metric,
      current,
      previous,
      absoluteDelta: difference.toString(),
      relativeDelta: new Decimal(previous as string).isZero()
        ? null
        : difference.dividedBy(new Decimal(previous as string).abs()).toNumber(),
      direction: difference.isPositive() ? "INCREASED" : difference.isNegative() ? "DECREASED" : "UNCHANGED",
      currency,
    };
  } catch {
    return { metric, current, previous, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency };
  }
}

function expectedBlockers(coverage: DecisionCoverageSnapshot): string[] {
  const blockers: string[] = [];
  if (coverage.coverageState !== "COMPLETE") blockers.push(`DATA_COVERAGE_${coverage.coverageState}`);
  if (coverage.source !== "SELLER_CENTER" && coverage.source !== "COTIK") blockers.push("SOURCE_NOT_VERIFIED");
  if (coverage.ordersSourceComplete !== true) blockers.push("ORDERS_SOURCE_INCOMPLETE");
  if (coverage.financeRequiredSourceComplete !== true) blockers.push("FINANCE_SOURCE_INCOMPLETE");
  if (coverage.sourceReconciled !== true) blockers.push("FINANCE_NOT_RECONCILED");
  if ((coverage.freshness ?? "UNKNOWN") !== "FRESH") blockers.push(`FRESHNESS_${coverage.freshness ?? "UNKNOWN"}`);
  return blockers;
}

function expectedDataQuality(coverage: DecisionCoverageSnapshot): AiDecisionContext["dataQuality"] {
  return {
    coverage: coverage.coverageState,
    source: coverage.source ?? null,
    provenSourceWindow: coverage.provenSourceWindow,
    completeWithinSourceWindow: coverage.completeWithinSourceWindow,
    lifetimeHistoryComplete: coverage.lifetimeHistoryComplete,
    ordersSourceComplete: coverage.ordersSourceComplete ?? null,
    financeRequiredSourceComplete: coverage.financeRequiredSourceComplete ?? null,
    sourceReconciled: coverage.sourceReconciled ?? null,
    freshness: coverage.freshness ?? "UNKNOWN",
    latestSuccessfulSyncAt: coverage.latestSuccessfulSyncAt ?? null,
    financeCapturedAt: coverage.financeCapturedAt ?? null,
    blockers: expectedBlockers(coverage),
  };
}

function equalDataQuality(actual: AiDecisionContext["dataQuality"], expected: AiDecisionContext["dataQuality"]): boolean {
  return actual.coverage === expected.coverage
    && actual.source === expected.source
    && actual.provenSourceWindow === expected.provenSourceWindow
    && actual.completeWithinSourceWindow === expected.completeWithinSourceWindow
    && actual.lifetimeHistoryComplete === expected.lifetimeHistoryComplete
    && actual.ordersSourceComplete === expected.ordersSourceComplete
    && actual.financeRequiredSourceComplete === expected.financeRequiredSourceComplete
    && actual.sourceReconciled === expected.sourceReconciled
    && actual.freshness === expected.freshness
    && actual.latestSuccessfulSyncAt === expected.latestSuccessfulSyncAt
    && actual.financeCapturedAt === expected.financeCapturedAt
    && equalArray(actual.blockers, expected.blockers, (a, b) => a === b);
}

function expectedTrends(
  comparisons: readonly MetricComparison[],
  policy: TrendPolicy,
): AiDecisionContext["trends"] {
  const valueForThreshold = (name: string): number | null => {
    const [metric, field] = name.split(".");
    const comparison = comparisons.find((item) => item.metric === metric);
    if (!comparison || field === undefined) return null;
    const value = comparison[field as keyof MetricComparison];
    if (typeof value === "number") return value;
    if (typeof value !== "string") return null;
    try {
      return new Decimal(value).toNumber();
    } catch {
      return null;
    }
  };
  const test = (operator: "GT" | "GTE" | "LT" | "LTE" | "EQ", value: number, threshold: number): boolean => {
    const actual = new Decimal(value);
    const expected = new Decimal(threshold);
    switch (operator) {
      case "GT": return actual.gt(expected);
      case "GTE": return actual.gte(expected);
      case "LT": return actual.lt(expected);
      case "LTE": return actual.lte(expected);
      case "EQ": return actual.eq(expected);
    }
  };
  return TREND_NAMES.map((signal) => {
    const rule = policy.signals.find((item) => item.signal === signal);
    if (!rule) return { signal, comparisons: [], status: "NOT_EVALUATED" as const, reasonCode: "POLICY_UNCONFIGURED" as const };
    const selected = comparisons.filter((comparison) => rule.thresholds.some((threshold) => threshold.metric.startsWith(`${comparison.metric}.`)));
    const values = rule.thresholds.map((threshold) => valueForThreshold(threshold.metric));
    if (values.some((value) => value === null)) return { signal, comparisons: selected, status: "NOT_EVALUATED" as const, reasonCode: "INSUFFICIENT_DATA" as const };
    return {
      signal,
      comparisons: selected,
      status: rule.thresholds.every((threshold, index) => test(threshold.operator, values[index]!, threshold.value)) ? "TRIGGERED" as const : "NOT_TRIGGERED" as const,
      reasonCode: null,
    };
  });
}

function equalTrend(left: AiDecisionContext["trends"][number], right: AiDecisionContext["trends"][number]): boolean {
  return left.signal === right.signal
    && left.status === right.status
    && left.reasonCode === right.reasonCode
    && equalArray(left.comparisons, right.comparisons, equalComparison);
}

function validatePrevious(context: AiDecisionContext, issues: string[]): void {
  const previous = context.previousCompatibleSnapshot;
  if (previous === null) return;
  if (previous.provenance.shopId !== context.shop.shopId
    || previous.provenance.profileId !== context.profile.profileId
    || previous.provenance.profileNo !== context.profile.profileNo) {
    issues.push("previous snapshot provenance does not match current profile/shop");
  }
  if (previous.observedAt !== previous.metrics.observedAt) issues.push("previous snapshot timestamp disagrees with metrics");
  if (previous.observedAt > context.metrics.observedAt) issues.push("previous snapshot cannot be from the future");
  if (previous.metrics.decision.currency !== context.shop.currency || previous.metrics.finance.currency !== context.shop.currency) {
    issues.push("previous snapshot currency disagrees with shop identity");
  }
  if (!equalDataQuality(previous.dataQuality, {
    ...previous.dataQuality,
    blockers: expectedBlockers({
      coverageState: previous.dataQuality.coverage,
      persistedMetricsWindow: previous.metrics.decision.window,
      source: previous.dataQuality.source,
      provenSourceWindow: previous.dataQuality.provenSourceWindow,
      completeWithinSourceWindow: previous.dataQuality.completeWithinSourceWindow,
      lifetimeHistoryComplete: previous.dataQuality.lifetimeHistoryComplete,
      ordersSourceComplete: previous.dataQuality.ordersSourceComplete,
      financeRequiredSourceComplete: previous.dataQuality.financeRequiredSourceComplete,
      sourceReconciled: previous.dataQuality.sourceReconciled,
      latestSuccessfulSyncAt: previous.dataQuality.latestSuccessfulSyncAt,
      financeCapturedAt: previous.dataQuality.financeCapturedAt,
      freshness: previous.dataQuality.freshness,
    }),
  })) issues.push("previous snapshot data quality is inconsistent");
}

export function validateFrozenDecisionContext(input: FrozenContextValidationInput): FrozenContextValidationResult {
  const parsed = AiDecisionContextSchema.safeParse(input.context);
  if (!parsed.success) return { valid: false, issues: ["frozen context does not match the v1 schema"] };
  const context = parsed.data;
  const issues: string[] = [];
  const target = input.targetRuleEvidence ?? context.targetRuleEvidence;
  if (target !== undefined) {
    const contextTriggers = target.triggers.map((trigger) =>
      trigger === "OFFICIAL_ON_HOLD" ? "OFFICIAL_ON_HOLD" as const : "DELIVERY_RATE" as const,
    );
    if (context.targetRuleEvidence === undefined || !equalTargetRuleEvidence(context.targetRuleEvidence, target)) {
      issues.push("target Rule evidence is missing or mutated in frozen context");
    }
    if (target.decision !== input.ruleDecision || target.policyVersion !== input.risk.policyVersion || target.evaluatedAt !== input.risk.evaluatedAt) {
      issues.push("target Rule evidence contradicts canonical decision facts");
    }
    if (context.shop.currency !== input.metrics.currency || context.shop.currency !== input.finance.currency) {
      issues.push("target context currency disagrees with canonical snapshots");
    }
    if (context.metrics.observedAt !== input.risk.evaluatedAt || context.rule.evaluatedAt !== input.risk.evaluatedAt) {
      issues.push("target context observation timestamps disagree");
    }
    if (context.rule.result !== target.decision || context.rule.policyVersion !== target.policyVersion || context.rule.expression !== target.expression || !equalArray(context.rule.triggers, contextTriggers, (a, b) => a === b)) {
      issues.push("context rule disagrees with target Rule evidence");
    }
    if (input.owner !== undefined) {
      if (context.shop.shopId !== input.owner.shopId) issues.push("context shop is not owned by the decision case");
      if (input.owner.profileId !== undefined && context.profile.profileId !== input.owner.profileId) issues.push("context profile id is not owned by the decision case");
      if (input.owner.profileNo !== undefined && context.profile.profileNo !== input.owner.profileNo) issues.push("context profile number is not owned by the decision case");
    }
  }
  const contextMetrics = context.metrics.decision;
  const contextFinance = context.metrics.finance;
  const quality = expectedDataQuality(input.coverage);
  const expectedStopByExposure = input.metrics.onHoldValue !== null
    && new Decimal(input.metrics.onHoldValue).gte(input.risk.stopOnHoldValueAt);
  const expectedStopByRate = input.metrics.deliveryRate !== null
    && input.risk.dataSufficient
    && input.metrics.deliveryRate < input.risk.stopDeliveryRateBelow;
  const expectedRuleDecision: DecisionRuleResult = target?.decision ?? (expectedStopByExposure || expectedStopByRate
    ? "PAUSE"
    : input.risk.dataSufficient ? "CONTINUE" : "INSUFFICIENT_DATA");
  const expectedRuleTriggers: DecisionRuleTrigger[] = target === undefined
    ? [
        ...(expectedStopByExposure ? ["ONHOLD_VALUE" as const] : []),
        ...(expectedStopByRate ? ["DELIVERY_RATE" as const] : []),
      ]
    : target.triggers.map((trigger) => trigger === "OFFICIAL_ON_HOLD" ? "ONHOLD_VALUE" as const : "DELIVERY_RATE" as const);
  const expectedChecks = target === undefined ? [
    {
      metric: "operationalExposure",
      observedValue: input.metrics.onHoldValue,
      threshold: input.risk.stopOnHoldValueAt,
      operator: "GTE" as const,
      result: input.metrics.onHoldValue === null ? "NOT_EVALUATED" as const : expectedStopByExposure ? "FAIL" as const : "PASS" as const,
      triggeredReason: expectedStopByExposure ? "OPERATIONAL_EXPOSURE_LIMIT_REACHED" : null,
    },
    {
      metric: "deliveryRate",
      observedValue: input.metrics.deliveryRate,
      threshold: input.risk.stopDeliveryRateBelow,
      operator: "LT" as const,
      result: input.metrics.deliveryRate === null || !input.risk.dataSufficient ? "NOT_EVALUATED" as const : expectedStopByRate ? "FAIL" as const : "PASS" as const,
      triggeredReason: expectedStopByRate ? "DELIVERY_RATE_BELOW_LIMIT" : null,
    },
  ] : [
    {
      metric: "officialFinanceOnHold",
      observedValue: target.officialOnHold.observedValue,
      threshold: target.officialOnHold.threshold,
      operator: "GTE" as const,
      result: target.officialOnHold.state === "TRIGGERED" ? "FAIL" as const : target.officialOnHold.state === "CLEAR" ? "PASS" as const : "NOT_EVALUATED" as const,
      triggeredReason: target.officialOnHold.state === "TRIGGERED" ? "OFFICIAL_ON_HOLD_LIMIT_REACHED" : null,
    },
    {
      metric: "deliveryRate",
      observedValue: target.deliveryRate.observedValue,
      threshold: target.deliveryRate.threshold,
      operator: "LT" as const,
      result: target.deliveryRate.state === "TRIGGERED" ? "FAIL" as const : target.deliveryRate.state === "CLEAR" ? "PASS" as const : "NOT_EVALUATED" as const,
      triggeredReason: target.deliveryRate.state === "TRIGGERED" ? "DELIVERY_RATE_BELOW_LIMIT" : null,
    },
  ];

  if (input.owner !== undefined) {
    if (context.shop.shopId !== input.owner.shopId) issues.push("context shop is not owned by the decision case");
    if (input.owner.profileId !== undefined && context.profile.profileId !== input.owner.profileId) issues.push("context profile id is not owned by the decision case");
    if (input.owner.profileNo !== undefined && context.profile.profileNo !== input.owner.profileNo) issues.push("context profile number is not owned by the decision case");
  }
  if (context.shop.currency !== input.metrics.currency || context.shop.currency !== input.finance.currency || contextMetrics.currency !== input.metrics.currency || contextFinance.currency !== input.finance.currency) issues.push("context currency disagrees with canonical snapshots");
  if (!equalValue(input.metrics.onHoldValue, input.risk.onHoldValue) || !equalValue(input.metrics.deliveryRate, input.risk.deliveryRate) || input.metrics.window !== input.coverage.persistedMetricsWindow || input.risk.evaluatedAt !== context.metrics.observedAt) issues.push("canonical inputs are inconsistent");
  if (context.metrics.observedAt !== input.risk.evaluatedAt || context.rule.evaluatedAt !== input.risk.evaluatedAt) issues.push("context observation timestamps disagree");
  if (contextMetrics.window !== input.metrics.window || contextMetrics.periodStart !== input.metrics.periodStart || contextMetrics.periodEnd !== input.metrics.periodEnd || contextMetrics.totalOrders !== input.metrics.totalOrders || (contextMetrics.totalPersistedOrders ?? null) !== (input.metrics.totalPersistedOrders ?? null) || (contextMetrics.operationalOrderCount ?? null) !== (input.metrics.operationalOrderCount ?? null) || contextMetrics.onHoldOrderCount !== input.metrics.onHoldOrderCount || contextMetrics.deliveredCount !== input.metrics.deliveredCount || !equalValue(contextMetrics.deliveryRate, input.metrics.deliveryRate) || !equalValue(contextMetrics.cancellationRate, input.metrics.cancellationRate) || !equalValue(contextMetrics.refundRate, input.metrics.refundRate) || !equalValue(contextMetrics.operationalExposure, input.metrics.onHoldValue)) issues.push("context metrics disagree with canonical metrics");
  if (contextFinance.capturedAt !== input.finance.capturedAt || !equalValue(contextFinance.availableBalance, input.finance.availableBalance) || !equalValue(contextFinance.frozenBalance, input.finance.frozenBalance) || !equalValue(contextFinance.totalBalance, input.finance.totalBalance) || !equalValue(contextFinance.toSettleBalance, input.finance.toSettleBalance) || !equalValue(contextFinance.officialFinanceOnHold, input.finance.officialOnHoldAmount) || !equalValue(contextFinance.waitingForPackageDeliveryAmount ?? null, input.finance.waitingForPackageDeliveryAmount ?? null) || !equalValue(contextFinance.deliveredAwaitingSettlementAmount ?? null, input.finance.deliveredAwaitingSettlementAmount ?? null) || !equalValue(contextFinance.waitingForCompletedRefundReturnAmount ?? null, input.finance.waitingForCompletedRefundReturnAmount ?? null) || (contextFinance.reasonTotalsReconcileToOfficialOnHold ?? null) !== (input.finance.reasonTotalsReconcileToOfficialOnHold ?? null) || (contextFinance.missingOnHoldExpectedAmountCount ?? null) !== (input.finance.missingOnHoldExpectedAmountCount ?? null) || contextFinance.settlementCount !== input.finance.settlementCount || contextFinance.onHoldSettlementCount !== input.finance.onHoldSettlementCount) issues.push("context finance disagrees with canonical finance");
  if (!equalDataQuality(context.dataQuality, quality)) issues.push("context data quality disagrees with canonical coverage");
  if (context.risk.policyVersion !== input.risk.policyVersion || context.risk.evaluatedAt !== input.risk.evaluatedAt || !equalValue(context.risk.operationalExposure, input.risk.onHoldValue) || !equalValue(context.risk.deliveryRate, input.risk.deliveryRate) || context.risk.stopByOnHoldValue !== expectedStopByExposure || context.risk.stopByDeliveryRate !== expectedStopByRate || context.risk.dataSufficient !== input.risk.dataSufficient || !equalValue(context.risk.stopOnHoldValueAt, input.risk.stopOnHoldValueAt) || context.risk.stopDeliveryRateBelow !== input.risk.stopDeliveryRateBelow || context.risk.minimumOrdersForRateRule !== input.risk.minimumOrdersForRateRule) issues.push("context risk disagrees with canonical risk");
  if (input.ruleDecision !== expectedRuleDecision || context.rule.result !== expectedRuleDecision || !equalArray(input.ruleTriggers, expectedRuleTriggers, (a, b) => a === b)) issues.push("rule result or triggers contradict canonical risk");
  const expectedContextTriggers = target === undefined
    ? expectedRuleTriggers.map((trigger) => trigger === "ONHOLD_VALUE" ? "OPERATIONAL_EXPOSURE" as const : "DELIVERY_RATE" as const)
    : target.triggers;
  if (!equalArray(context.rule.triggers, expectedContextTriggers, (a, b) => a === b)) issues.push("context rule triggers disagree with canonical risk");
  if (!equalArray(context.rule.checks, expectedChecks, (left, right) => left.metric === right.metric && equalValue(left.observedValue, right.observedValue) && equalValue(left.threshold, right.threshold) && left.operator === right.operator && left.result === right.result && left.triggeredReason === right.triggeredReason)) issues.push("context rule checks disagree with canonical thresholds");
  const expectedExpression = target?.expression ?? `operationalExposure >= ${new Decimal(input.risk.stopOnHoldValueAt).toString()} ${input.metrics.currency} OR deliveryRate < ${new Decimal(input.risk.stopDeliveryRateBelow).times(100).toString()}%`;
  if (context.rule.policyVersion !== input.risk.policyVersion || context.rule.expression !== expectedExpression) issues.push("context rule policy or expression disagrees with canonical thresholds");
  if (context.policyVersions.metricDefinitionVersion !== "decision-metrics.v1" || context.policyVersions.riskPolicyVersion !== input.risk.policyVersion || (input.trendPolicy !== undefined && context.policyVersions.trendPolicyVersion !== input.trendPolicy.version)) issues.push("context policy versions disagree with canonical policy");
  if (input.trendPolicy === undefined && context.policyVersions.trendPolicyVersion !== null) issues.push("trend policy version cannot be verified without a canonical trend policy");

  const previousMetrics = context.previousCompatibleSnapshot?.metrics.decision;
  const expectedComparisons = [
    comparable("operationalExposure", input.metrics.onHoldValue, previousMetrics?.operationalExposure ?? null, "USD"),
    comparable("deliveryRate", input.metrics.deliveryRate, previousMetrics?.deliveryRate ?? null, null),
    comparable("refundRate", input.metrics.refundRate, previousMetrics?.refundRate ?? null, null),
    comparable("cancellationRate", input.metrics.cancellationRate, previousMetrics?.cancellationRate ?? null, null),
  ];
  if (context.previousCompatibleSnapshot !== null && context.comparisons.length === 0) issues.push("context comparisons are required when a previous snapshot is present");
  if (context.comparisons.length > 0 && !equalArray(context.comparisons, expectedComparisons, equalComparison)) issues.push("context comparisons disagree with current and previous snapshots");
  if (input.trendPolicy !== undefined) {
    if (!equalArray(context.trends, expectedTrends(expectedComparisons, input.trendPolicy), equalTrend)) issues.push("context trends disagree with the supplied trend policy");
  } else if (context.policyVersions.trendPolicyVersion === null && context.trends.length > 0 && context.trends.some((trend) => trend.status !== "NOT_EVALUATED" || trend.reasonCode !== "POLICY_UNCONFIGURED" || trend.comparisons.length > 0)) {
    issues.push("unconfigured trends must be explicitly not evaluated");
  } else if (context.trends.length > 0 && (context.trends.length !== TREND_NAMES.length || context.trends.some((trend, index) => trend.signal !== TREND_NAMES[index] || (trend.status === "NOT_EVALUATED" ? trend.reasonCode === null : trend.reasonCode !== null)))) {
    issues.push("context trends contain an invalid status or signal");
  }
  validatePrevious(context, issues);
  return issues.length === 0 ? { valid: true, context } : { valid: false, issues };
}

export function assertFrozenDecisionContext(input: FrozenContextValidationInput): AiDecisionContext {
  const result = validateFrozenDecisionContext(input);
  if (!result.valid) throw new Error(`Decision intelligence inputs are inconsistent: ${result.issues.join("; ")}`);
  return result.context;
}
