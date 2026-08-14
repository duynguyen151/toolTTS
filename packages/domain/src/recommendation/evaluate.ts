import { z } from "zod";

import {
  EvaluationStatusSchema,
  type EvaluationStatus,
} from "../contracts/common.js";
import type {
  MetricsResult,
  MoneyRateMetric,
  RateMetric,
} from "../metrics/types.js";
import {
  SCORE_POLICY_V1,
  type ScorePolicy,
} from "./policy.js";

export const RecommendationSchema = z.enum([
  "SCALE",
  "CONTINUE",
  "WATCH",
  "PAUSE",
]);

export type Recommendation = z.infer<typeof RecommendationSchema>;

export const HealthWarningSchema = z.enum([
  "LOW_SAMPLE_SIZE",
  "LOW_DATA_COVERAGE",
  "DELIVERY_DECREASING",
  "CANCELLATION_INCREASING",
  "REFUND_INCREASING",
  "ON_HOLD_INCREASING",
  "CRITICAL_DELIVERY_RATE",
  "CRITICAL_CANCELLATION_RATE",
  "CRITICAL_REFUND_RATE",
  "CRITICAL_ON_HOLD_ORDER_RATE",
  "CRITICAL_ON_HOLD_MONEY_RATE",
  "CRITICAL_SETTLEMENT_RATE",
]);

export type HealthWarning = z.infer<typeof HealthWarningSchema>;

export const HealthEvaluationSchema = z.object({
  policyVersion: z.string().min(1),
  evaluationStatus: EvaluationStatusSchema,
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  recommendation: RecommendationSchema.nullable(),
  warnings: z.array(HealthWarningSchema),
  sampleSize: z.number().int().nonnegative(),
  scoredWeight: z.number().nonnegative(),
  totalWeight: z.number().positive(),
});

export type HealthEvaluation = z.infer<typeof HealthEvaluationSchema>;

export interface HealthEvaluationInput {
  metrics: MetricsResult;
  dataStatus?: EvaluationStatus;
  policy?: ScorePolicy;
}

function componentScore(
  value: number,
  component: ScorePolicy["components"][keyof ScorePolicy["components"]],
): number {
  if (component.direction === "HIGH_IS_GOOD") {
    if (value >= component.good) return 100;
    if (value <= component.critical) return 0;
    return ((value - component.critical) / (component.good - component.critical)) * 100;
  }

  if (value <= component.good) return 100;
  if (value >= component.critical) return 0;
  return ((component.critical - value) / (component.critical - component.good)) * 100;
}

function isCritical(
  value: number | null,
  component: ScorePolicy["components"][keyof ScorePolicy["components"]],
): boolean {
  if (value === null) return false;
  return component.direction === "HIGH_IS_GOOD"
    ? value <= component.critical
    : value >= component.critical;
}

export function evaluateShopHealth(
  input: HealthEvaluationInput,
): HealthEvaluation {
  const policy = input.policy ?? SCORE_POLICY_V1;
  const dataStatus = input.dataStatus ?? "FRESH";
  const metrics = input.metrics.current;
  const componentEntries: ReadonlyArray<{
    metric: RateMetric | MoneyRateMetric;
    policy: ScorePolicy["components"][keyof ScorePolicy["components"]];
    criticalWarning: HealthWarning;
  }> = [
    {
      metric: metrics.deliveryRate,
      policy: policy.components.deliveryRate,
      criticalWarning: "CRITICAL_DELIVERY_RATE",
    },
    {
      metric: metrics.cancellationRate,
      policy: policy.components.cancellationRate,
      criticalWarning: "CRITICAL_CANCELLATION_RATE",
    },
    {
      metric: metrics.refundRate,
      policy: policy.components.refundRate,
      criticalWarning: "CRITICAL_REFUND_RATE",
    },
    {
      metric: metrics.onHoldOrderRate,
      policy: policy.components.onHoldOrderRate,
      criticalWarning: "CRITICAL_ON_HOLD_ORDER_RATE",
    },
    {
      metric: metrics.onHoldMoneyRate,
      policy: policy.components.onHoldMoneyRate,
      criticalWarning: "CRITICAL_ON_HOLD_MONEY_RATE",
    },
    {
      metric: metrics.settlementRate,
      policy: policy.components.settlementRate,
      criticalWarning: "CRITICAL_SETTLEMENT_RATE",
    },
  ];
  const totalWeight = componentEntries.reduce(
    (sum, entry) => sum + entry.policy.weight,
    0,
  );
  let scoredWeight = 0;
  let weightedScore = 0;
  let weightedCoverage = 0;
  const warnings: HealthWarning[] = [];

  for (const entry of componentEntries) {
    weightedCoverage += entry.metric.coverage * entry.policy.weight;
    if (entry.metric.value === null) continue;
    scoredWeight += entry.policy.weight;
    weightedScore += componentScore(entry.metric.value, entry.policy) *
      entry.policy.weight;
    if (isCritical(entry.metric.value, entry.policy)) {
      warnings.push(entry.criticalWarning);
    }
  }

  const sampleSize = metrics.orders.total;
  const volumeFactor = Math.min(sampleSize / policy.minimumReliableOrders, 1);
  const confidence = Number(
    ((weightedCoverage / totalWeight) * volumeFactor).toFixed(4),
  );
  const score = scoredWeight === 0
    ? null
    : Number((weightedScore / scoredWeight).toFixed(2));

  if (sampleSize < policy.minimumReliableOrders) warnings.push("LOW_SAMPLE_SIZE");
  if (weightedCoverage / totalWeight <= 0.9) warnings.push("LOW_DATA_COVERAGE");

  const trends = input.metrics.trends;
  if (
    trends.deliveryRate.percentagePointDelta !== null &&
    trends.deliveryRate.percentagePointDelta <= -policy.badTrendDelta
  ) warnings.push("DELIVERY_DECREASING");
  if (
    trends.cancellationRate.percentagePointDelta !== null &&
    trends.cancellationRate.percentagePointDelta >= policy.badTrendDelta
  ) warnings.push("CANCELLATION_INCREASING");
  if (
    trends.refundRate.percentagePointDelta !== null &&
    trends.refundRate.percentagePointDelta >= policy.badTrendDelta
  ) warnings.push("REFUND_INCREASING");
  if (
    (trends.onHoldOrderRate.percentagePointDelta !== null &&
      trends.onHoldOrderRate.percentagePointDelta >= policy.badTrendDelta) ||
    (trends.onHoldMoneyRate.percentagePointDelta !== null &&
      trends.onHoldMoneyRate.percentagePointDelta >= policy.badTrendDelta)
  ) warnings.push("ON_HOLD_INCREASING");

  let evaluationStatus = dataStatus;
  if (dataStatus === "FRESH" && (score === null || sampleSize === 0)) {
    evaluationStatus = "INSUFFICIENT_DATA";
  }

  if (evaluationStatus !== "FRESH" || score === null) {
    return {
      policyVersion: policy.version,
      evaluationStatus,
      score,
      confidence,
      recommendation: null,
      warnings: [...new Set(warnings)],
      sampleSize,
      scoredWeight,
      totalWeight,
    };
  }

  const hasCriticalRisk = warnings.some((warning) =>
    warning.startsWith("CRITICAL_")
  );
  const reliableSample = sampleSize >= policy.minimumReliableOrders;
  const badTrend = warnings.some((warning) =>
    warning.endsWith("_INCREASING") || warning === "DELIVERY_DECREASING"
  );
  let recommendation: Recommendation;

  if (reliableSample && (hasCriticalRisk || score < policy.pauseBelowScore)) {
    recommendation = "PAUSE";
  } else {
    const canScale =
      score >= policy.scaleMinimumScore &&
      confidence >= policy.scaleMinimumConfidence &&
      sampleSize >= policy.minimumScaleOrders &&
      trends.orders.relativeChange !== null &&
      trends.orders.relativeChange > policy.scaleMinimumGrowth &&
      trends.grossValidSales.relativeChange !== null &&
      trends.grossValidSales.relativeChange > policy.scaleMinimumGrowth &&
      metrics.settlementRate.value !== null &&
      metrics.settlementRate.value >= policy.scaleMinimumSettlementRate &&
      scoredWeight === totalWeight &&
      !hasCriticalRisk &&
      !badTrend;

    if (canScale) recommendation = "SCALE";
    else if (
      score < policy.continueMinimumScore ||
      confidence < policy.scaleMinimumConfidence ||
      scoredWeight < totalWeight ||
      badTrend ||
      hasCriticalRisk
    ) recommendation = "WATCH";
    else recommendation = "CONTINUE";
  }

  return {
    policyVersion: policy.version,
    evaluationStatus,
    score,
    confidence,
    recommendation,
    warnings: [...new Set(warnings)],
    sampleSize,
    scoredWeight,
    totalWeight,
  };
}
