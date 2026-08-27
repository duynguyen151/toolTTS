import { Decimal } from "decimal.js";
import { z } from "zod";

import { CurrencyCodeSchema, NonNegativeDecimalStringSchema } from "./contracts/common.js";
import { CanonicalOrderStatusSchema } from "./contracts/orders.js";
import { SourceProviderSchema } from "./contracts/source.js";
import {
  calculateAuthoritativeDeliveryRateFromCounts,
  type DeliveryStatusCount,
} from "./delivery-rate.js";
import {
  FinanceCompletenessSchema,
  FinanceHealthSnapshotSchema,
  FinanceReconciliationSchema,
  FinanceRefreshStateSchema,
} from "./finance-health.js";
import { ResolvedRiskPolicySnapshotSchema } from "./risk-policy.js";

export const TargetRuleConditionStateSchema = z.enum([
  "TRIGGERED",
  "CLEAR",
  "NOT_EVALUATED",
]);
export const TargetRuleDataQualitySchema = z.enum([
  "FRESH",
  "STALE",
  "UNKNOWN",
  "INCOMPLETE",
  "RECONCILIATION_FAILED",
]);
export const TargetRuleTriggerSchema = z.enum([
  "OFFICIAL_ON_HOLD",
  "DELIVERY_RATE",
]);
export const TargetRuleDecisionSchema = z.enum([
  "PAUSE",
  "CONTINUE",
  "INSUFFICIENT_DATA",
]);

const TimestampSchema = z.string().datetime();
const DeliveryCountSchema = z.strictObject({
  canonicalStatus: CanonicalOrderStatusSchema,
  count: z.number().int().nonnegative(),
});

export const OfficialOnHoldConditionEvidenceSchema = z.strictObject({
  state: TargetRuleConditionStateSchema,
  source: SourceProviderSchema.nullable(),
  observedValue: NonNegativeDecimalStringSchema.nullable(),
  observedAt: TimestampSchema.nullable(),
  ageMs: z.number().int().nonnegative().nullable(),
  quality: TargetRuleDataQualitySchema,
  completeness: FinanceCompletenessSchema.nullable(),
  reconciliation: FinanceReconciliationSchema.nullable(),
  refreshState: FinanceRefreshStateSchema.nullable(),
  threshold: NonNegativeDecimalStringSchema,
});

export const DeliveryRateConditionEvidenceSchema = z.strictObject({
  state: TargetRuleConditionStateSchema,
  source: SourceProviderSchema.nullable(),
  observedValue: z.number().min(0).max(1).nullable(),
  observedAt: TimestampSchema.nullable(),
  ageMs: z.number().int().nonnegative().nullable(),
  quality: TargetRuleDataQualitySchema,
  deliveredCount: z.number().int().nonnegative().nullable(),
  totalCount: z.number().int().nonnegative().nullable(),
  threshold: z.number().min(0).max(1),
  unavailableReasons: z.array(z.enum([
    "UNKNOWN_STATUS_PRESENT",
    "NO_OPERATIONAL_ORDERS",
    "SAMPLE_TOO_SMALL",
    "SOURCE_NOT_AUTHORITATIVE",
    "SOURCE_QUALITY_UNAVAILABLE",
  ])),
});

export const OfficialOnHoldRuleEvidenceSchema = z.strictObject({
  schemaVersion: z.literal("official-on-hold-rule.v1"),
  policyVersion: z.string().trim().min(1),
  evaluatedAt: TimestampSchema,
  decision: TargetRuleDecisionSchema,
  triggers: z.array(TargetRuleTriggerSchema),
  expression: z.string().trim().min(1),
  officialOnHold: OfficialOnHoldConditionEvidenceSchema,
  deliveryRate: DeliveryRateConditionEvidenceSchema,
});

export type TargetRuleConditionState = z.infer<typeof TargetRuleConditionStateSchema>;
export type TargetRuleDataQuality = z.infer<typeof TargetRuleDataQualitySchema>;
export type TargetRuleTrigger = z.infer<typeof TargetRuleTriggerSchema>;
export type TargetRuleDecision = z.infer<typeof TargetRuleDecisionSchema>;
export type OfficialOnHoldRuleEvidence = z.infer<typeof OfficialOnHoldRuleEvidenceSchema>;

export const OfficialOnHoldRuleInputSchema = z.strictObject({
  evaluatedAt: z.date(),
  policy: ResolvedRiskPolicySnapshotSchema,
  officialOnHold: z.strictObject({
    amount: NonNegativeDecimalStringSchema.nullable(),
    currency: CurrencyCodeSchema,
    capturedAt: z.date().nullable(),
    health: FinanceHealthSnapshotSchema,
  }),
  delivery: z.strictObject({
    counts: z.array(DeliveryCountSchema),
    observedAt: z.date().nullable(),
    source: SourceProviderSchema,
    quality: TargetRuleDataQualitySchema,
  }),
});

export type OfficialOnHoldRuleInput = z.input<typeof OfficialOnHoldRuleInputSchema>;

function financeQuality(health: z.infer<typeof FinanceHealthSnapshotSchema>): TargetRuleDataQuality {
  switch (health.health) {
    case "FRESH":
    case "STALE":
    case "INCOMPLETE":
    case "RECONCILIATION_FAILED":
      return health.health;
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

function conditionResult(
  triggered: boolean,
  evaluated: boolean,
): TargetRuleConditionState {
  return !evaluated ? "NOT_EVALUATED" : triggered ? "TRIGGERED" : "CLEAR";
}

/**
 * Locked V1 target Rule. It is deliberately separate from the legacy
 * Operational Exposure evaluator retained for historical cases.
 */
export function evaluateOfficialOnHoldRule(
  input: OfficialOnHoldRuleInput,
): OfficialOnHoldRuleEvidence {
  const parsed = OfficialOnHoldRuleInputSchema.parse(input);
  const { policy, officialOnHold, delivery } = parsed;
  const health = officialOnHold.health;
  const capturedAt = officialOnHold.capturedAt;
  const validOfficialObservation =
    officialOnHold.amount !== null &&
    capturedAt !== null &&
    officialOnHold.currency === policy.currency &&
    health.capability === "OFFICIAL_ON_HOLD" &&
    health.officialOnHoldAvailability === "AVAILABLE" &&
    health.completeness === "COMPLETE" &&
    health.reconciliation === "RECONCILED" &&
    (health.health === "FRESH" || health.health === "STALE") &&
    health.collectedAt === capturedAt?.toISOString();
  const officialTriggered = officialOnHold.amount !== null &&
    validOfficialObservation &&
    new Decimal(officialOnHold.amount).gte(policy.thresholds.stopOnHoldValueAt);
  const officialState = conditionResult(officialTriggered, validOfficialObservation);

  const authoritative = calculateAuthoritativeDeliveryRateFromCounts(
    delivery.counts as DeliveryStatusCount[],
  );
  const tooSmall = authoritative.totalCount !== null &&
    authoritative.totalCount < policy.thresholds.minimumOrdersForRateRule;
  const deliveryQualityAvailable = delivery.quality === "FRESH" || delivery.quality === "STALE";
  const deliveryEvaluated =
    delivery.source === "SELLER_CENTER" &&
    deliveryQualityAvailable &&
    !tooSmall &&
    authoritative.rate !== null;
  const deliveryTriggered = deliveryEvaluated &&
    authoritative.rate! < policy.thresholds.stopDeliveryRateBelow;
  const deliveryState = conditionResult(deliveryTriggered, deliveryEvaluated);
  const deliveryReasons = [
    ...authoritative.dataIssues,
    ...(tooSmall ? ["SAMPLE_TOO_SMALL" as const] : []),
    ...(delivery.source !== "SELLER_CENTER" ? ["SOURCE_NOT_AUTHORITATIVE" as const] : []),
    ...(!deliveryQualityAvailable ? ["SOURCE_QUALITY_UNAVAILABLE" as const] : []),
  ];

  const triggers: TargetRuleTrigger[] = [
    ...(officialState === "TRIGGERED" ? ["OFFICIAL_ON_HOLD" as const] : []),
    ...(deliveryState === "TRIGGERED" ? ["DELIVERY_RATE" as const] : []),
  ];
  const decision: TargetRuleDecision = triggers.length > 0
    ? "PAUSE"
    : officialState === "NOT_EVALUATED" || deliveryState === "NOT_EVALUATED"
      ? "INSUFFICIENT_DATA"
      : "CONTINUE";
  const ageMs = delivery.observedAt === null
    ? null
    : Math.max(0, parsed.evaluatedAt.getTime() - delivery.observedAt.getTime());

  return OfficialOnHoldRuleEvidenceSchema.parse({
    schemaVersion: "official-on-hold-rule.v1",
    policyVersion: policy.policyVersion,
    evaluatedAt: parsed.evaluatedAt.toISOString(),
    decision,
    triggers,
    expression: `officialFinanceOnHold >= ${new Decimal(policy.thresholds.stopOnHoldValueAt).toString()} ${policy.currency} OR deliveryRate < ${new Decimal(policy.thresholds.stopDeliveryRateBelow).times(100).toString()}%`,
    officialOnHold: {
      state: officialState,
      source: health.provider,
      observedValue: officialOnHold.amount,
      observedAt: capturedAt?.toISOString() ?? null,
      ageMs: health.ageMs,
      quality: financeQuality(health),
      completeness: health.completeness,
      reconciliation: health.reconciliation,
      refreshState: health.refreshState,
      threshold: policy.thresholds.stopOnHoldValueAt,
    },
    deliveryRate: {
      state: deliveryState,
      source: delivery.source,
      observedValue: authoritative.rate,
      observedAt: delivery.observedAt?.toISOString() ?? null,
      ageMs,
      quality: delivery.quality,
      deliveredCount: authoritative.deliveredCount,
      totalCount: authoritative.totalCount,
      threshold: policy.thresholds.stopDeliveryRateBelow,
      unavailableReasons: deliveryReasons,
    },
  });
}
