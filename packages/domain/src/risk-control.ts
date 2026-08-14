import { Decimal } from "decimal.js";
import { z } from "zod";

import type { NormalizedOrder } from "./contracts/orders.js";

// AWAITING_SHIPMENT is the normalized union of Seller Center's
// "Awaiting Packing" and "Awaiting Collection" states.
const OPERATIONAL_TOTAL_STATUSES = new Set([
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
]);
const OPERATIONAL_DELIVERED_STATUSES = new Set([
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
]);

const DecimalThresholdSchema = z.string().regex(/^\d+(?:\.\d+)?$/);

export const RiskControlPolicySchema = z
  .object({
    version: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    stopOnHoldValueAt: DecimalThresholdSchema,
    stopDeliveryRateBelow: z.number().min(0).max(1),
    minimumOrdersForRateRule: z.number().int().nonnegative(),
    resumeDeliveryRateAt: z.number().min(0).max(1),
    resumeOnHoldValueBelow: DecimalThresholdSchema,
    stableCyclesBeforeResume: z.number().int().positive(),
  })
  .superRefine((policy, context) => {
    if (policy.resumeDeliveryRateAt < policy.stopDeliveryRateBelow) {
      context.addIssue({
        code: "custom",
        path: ["resumeDeliveryRateAt"],
        message: "Resume delivery rate cannot be below the stop threshold",
      });
    }
    if (
      new Decimal(policy.resumeOnHoldValueBelow).greaterThan(
        policy.stopOnHoldValueAt,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["resumeOnHoldValueBelow"],
        message: "Resume Onhold Value cannot exceed the stop threshold",
      });
    }
  });

export type RiskControlPolicy = z.infer<typeof RiskControlPolicySchema>;

// These are the literal BA defaults. The fields remain configurable because
// minimum sample and hysteresis have not been calibrated yet.
export const RISK_CONTROL_POLICY_V1: RiskControlPolicy = {
  version: "risk-control-policy.v1",
  currency: "USD",
  stopOnHoldValueAt: "3500.0000",
  stopDeliveryRateBelow: 0.7,
  minimumOrdersForRateRule: 0,
  resumeDeliveryRateAt: 0.7,
  resumeOnHoldValueBelow: "3500.0000",
  stableCyclesBeforeResume: 1,
};

export const RiskControlReasonSchema = z.enum([
  "ON_HOLD_VALUE_LIMIT_REACHED",
  "DELIVERY_RATE_BELOW_LIMIT",
  "DELIVERY_RATE_SAMPLE_TOO_SMALL",
  "NO_OPERATIONAL_ORDERS",
  "UNKNOWN_STATUS_PRESENT",
  "CURRENCY_MISMATCH",
  "RESUME_THRESHOLDS_NOT_MET",
  "RECOVERY_HYSTERESIS_PENDING",
]);

export type RiskControlReason = z.infer<typeof RiskControlReasonSchema>;

export interface RiskOrderFact {
  readonly canonicalStatus: NormalizedOrder["canonicalStatus"];
  readonly currency: string;
  readonly orderCount: number;
  readonly totalValue: string;
  readonly lastObservedAt?: Date | null;
}

export const RiskControlDecisionSchema = z.object({
  policyVersion: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  historyMode: z.literal("FULL_PERSISTED_HISTORY"),
  dataCoverage: z.literal("UNKNOWN"),
  totalPersistedOrderCount: z.number().int().nonnegative(),
  totalPersistedValue: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
  lastSuccessfulObservationAt: z.date().nullable(),
  onHoldValue: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
  onHoldValueKnownPolicyCurrencySubtotal: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/),
  onHoldOrderCount: z.number().int().nonnegative().nullable(),
  onHoldRate: z.null(),
  onHoldRateUnavailableReason: z.literal(
    "OPERATIONAL_ONHOLD_COUNT_AND_TOTAL_COUNT_USE_THE_SAME_STATUS_SET",
  ),
  deliveredCount: z.number().int().nonnegative().nullable(),
  totalCount: z.number().int().nonnegative().nullable(),
  deliveryRate: z.number().min(0).max(1).nullable(),
  rateRuleApplied: z.boolean(),
  sampleSufficient: z.boolean(),
  stopByOnHoldValue: z.boolean(),
  stopByDeliveryRate: z.boolean(),
  stopConditionOperator: z.literal("OR"),
  definitiveStop: z.boolean(),
  trigger: z.enum(["VALUE", "RATE", "BOTH", "NONE"]),
  ruleResult: z.enum(["WARNING", "CLEAR", "INSUFFICIENT_DATA"]),
  ruleExpression: z.string().min(1),
  suggestedOperationalAction: z.enum(["REVIEW_SHOP", "NONE"]),
  executionMode: z.literal("DRY_RUN"),
  executedAction: z.literal("NONE"),
  desiredState: z.enum([
    "HOLIDAY_MODE_ON",
    "HOLIDAY_MODE_OFF",
    "INSUFFICIENT_DATA",
  ]),
  statusCoverage: z.number().min(0).max(1),
  unknownOrderCount: z.number().int().nonnegative(),
  currencyMismatchCount: z.number().int().nonnegative(),
  dataSufficient: z.boolean(),
  holidayModeCurrentlyEnabled: z.boolean().nullable(),
  resumeCriteriaMet: z.boolean(),
  consecutiveSafeCycles: z.number().int().nonnegative(),
  stableCyclesBeforeResume: z.number().int().positive(),
  thresholds: z.object({
    stopOnHoldValueAt: z.string(),
    stopDeliveryRateBelow: z.number(),
    minimumOrdersForRateRule: z.number().int().nonnegative(),
    resumeOnHoldValueBelow: z.string(),
    resumeDeliveryRateAt: z.number(),
  }),
  reasons: z.array(RiskControlReasonSchema),
});

export type RiskControlDecision = z.infer<typeof RiskControlDecisionSchema>;

export interface EvaluateRiskControlInput {
  readonly orders: readonly NormalizedOrder[];
  readonly policy?: RiskControlPolicy;
  readonly holidayModeCurrentlyEnabled?: boolean | null;
  readonly consecutiveSafeCycles?: number;
}

export interface EvaluateRiskControlFactsInput {
  readonly facts: readonly RiskOrderFact[];
  readonly policy?: RiskControlPolicy;
  readonly holidayModeCurrentlyEnabled?: boolean | null;
  readonly consecutiveSafeCycles?: number;
}

function deduplicateOrders(orders: readonly NormalizedOrder[]): NormalizedOrder[] {
  const unique = new Map<string, NormalizedOrder>();
  for (const order of orders) {
    const current = unique.get(order.sourceOrderId);
    const orderVersion = order.sourceUpdatedAt?.getTime() ?? order.lastSeenAt.getTime();
    const currentVersion =
      current?.sourceUpdatedAt?.getTime() ?? current?.lastSeenAt.getTime();
    if (currentVersion === undefined || orderVersion >= currentVersion) {
      unique.set(order.sourceOrderId, order);
    }
  }
  return [...unique.values()];
}

function factsFromOrders(orders: readonly NormalizedOrder[]): RiskOrderFact[] {
  const grouped = new Map<string, RiskOrderFact>();
  for (const order of deduplicateOrders(orders)) {
    const key = `${order.canonicalStatus}\u0000${order.currency}`;
    const current = grouped.get(key);
    grouped.set(key, {
      canonicalStatus: order.canonicalStatus,
      currency: order.currency,
      orderCount: (current?.orderCount ?? 0) + 1,
      totalValue: new Decimal(current?.totalValue ?? 0)
        .plus(order.grandTotal)
        .toFixed(4),
      lastObservedAt:
        current?.lastObservedAt !== undefined && current.lastObservedAt !== null &&
        current.lastObservedAt > order.lastSeenAt
          ? current.lastObservedAt
          : order.lastSeenAt,
    });
  }
  return [...grouped.values()];
}

export function evaluateRiskControl(
  input: EvaluateRiskControlInput,
): RiskControlDecision {
  return evaluateRiskControlFacts({
    facts: factsFromOrders(input.orders),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.holidayModeCurrentlyEnabled === undefined
      ? {}
      : { holidayModeCurrentlyEnabled: input.holidayModeCurrentlyEnabled }),
    ...(input.consecutiveSafeCycles === undefined
      ? {}
      : { consecutiveSafeCycles: input.consecutiveSafeCycles }),
  });
}

export function evaluateRiskControlFacts(
  input: EvaluateRiskControlFactsInput,
): RiskControlDecision {
  const policy = RiskControlPolicySchema.parse(
    input.policy ?? RISK_CONTROL_POLICY_V1,
  );
  const holidayModeCurrentlyEnabled =
    input.holidayModeCurrentlyEnabled === undefined
      ? null
      : input.holidayModeCurrentlyEnabled;
  const previousSafeCycles = input.consecutiveSafeCycles ?? 0;
  if (!Number.isInteger(previousSafeCycles) || previousSafeCycles < 0) {
    throw new Error("consecutiveSafeCycles must be a non-negative integer");
  }

  const operationalFacts = input.facts.filter((fact) =>
    OPERATIONAL_TOTAL_STATUSES.has(fact.canonicalStatus)
  );
  const deliveredFacts = input.facts.filter((fact) =>
    OPERATIONAL_DELIVERED_STATUSES.has(fact.canonicalStatus)
  );
  const totalPersistedOrderCount = input.facts.reduce(
    (sum, fact) => sum + fact.orderCount,
    0,
  );
  const unknownOrderCount = input.facts
    .filter((fact) => fact.canonicalStatus === "UNKNOWN")
    .reduce((sum, fact) => sum + fact.orderCount, 0);
  const currencyMismatchCount = operationalFacts
    .filter((fact) => fact.currency !== policy.currency)
    .reduce((sum, fact) => sum + fact.orderCount, 0);
  const allCurrencyMismatchCount = input.facts
    .filter((fact) => fact.currency !== policy.currency)
    .reduce((sum, fact) => sum + fact.orderCount, 0);
  const totalPersistedValue =
    allCurrencyMismatchCount === 0
      ? input.facts
          .reduce(
            (sum, fact) => sum.plus(fact.totalValue),
            new Decimal(0),
          )
          .toDecimalPlaces(4)
          .toFixed(4)
      : null;
  const onHoldValueKnownPolicyCurrencySubtotal = operationalFacts
    .filter((fact) => fact.currency === policy.currency)
    .reduce(
    (sum, fact) => sum.plus(fact.totalValue),
    new Decimal(0),
  );
  const knownDeliveredCount = deliveredFacts.reduce(
    (sum, fact) => sum + fact.orderCount,
    0,
  );
  const knownTotalCount = operationalFacts.reduce(
    (sum, fact) => sum + fact.orderCount,
    0,
  );
  const statusMetricsAvailable = unknownOrderCount === 0;
  const onHoldOrderCount = statusMetricsAvailable ? knownTotalCount : null;
  const deliveredCount = statusMetricsAvailable ? knownDeliveredCount : null;
  const totalCount = statusMetricsAvailable ? knownTotalCount : null;
  const deliveryRate =
    !statusMetricsAvailable || knownTotalCount === 0
      ? null
      : knownDeliveredCount / knownTotalCount;
  const sampleSufficient =
    statusMetricsAvailable &&
    knownTotalCount > 0 &&
    knownTotalCount >= policy.minimumOrdersForRateRule;
  const rateRuleApplied =
    statusMetricsAvailable && sampleSufficient && deliveryRate !== null;
  const stopByOnHoldValue =
    onHoldValueKnownPolicyCurrencySubtotal.greaterThanOrEqualTo(
    policy.stopOnHoldValueAt,
  );
  const stopByDeliveryRate =
    rateRuleApplied && deliveryRate < policy.stopDeliveryRateBelow;
  const definitiveStop = stopByOnHoldValue || stopByDeliveryRate;
  const dataSufficient =
    deliveryRate !== null &&
    sampleSufficient &&
    unknownOrderCount === 0 &&
    currencyMismatchCount === 0;
  const resumeCriteriaMet =
    dataSufficient &&
    onHoldValueKnownPolicyCurrencySubtotal.lessThan(
      policy.resumeOnHoldValueBelow,
    ) &&
    deliveryRate >= policy.resumeDeliveryRateAt;

  const reasons: RiskControlReason[] = [];
  if (currencyMismatchCount > 0) reasons.push("CURRENCY_MISMATCH");
  if (unknownOrderCount > 0) reasons.push("UNKNOWN_STATUS_PRESENT");
  if (statusMetricsAvailable && knownTotalCount === 0) {
    reasons.push("NO_OPERATIONAL_ORDERS");
  }
  if (deliveryRate !== null && !sampleSufficient) {
    reasons.push("DELIVERY_RATE_SAMPLE_TOO_SMALL");
  }
  if (stopByOnHoldValue) reasons.push("ON_HOLD_VALUE_LIMIT_REACHED");
  if (stopByDeliveryRate) reasons.push("DELIVERY_RATE_BELOW_LIMIT");

  let desiredState: RiskControlDecision["desiredState"];
  let consecutiveSafeCycles = 0;
  if (definitiveStop) {
    desiredState = "HOLIDAY_MODE_ON";
  } else if (!dataSufficient) {
    desiredState = "INSUFFICIENT_DATA";
  } else if (holidayModeCurrentlyEnabled !== true) {
    desiredState = "HOLIDAY_MODE_OFF";
  } else if (!resumeCriteriaMet) {
    desiredState = "HOLIDAY_MODE_ON";
    reasons.push("RESUME_THRESHOLDS_NOT_MET");
  } else {
    consecutiveSafeCycles = previousSafeCycles + 1;
    if (consecutiveSafeCycles >= policy.stableCyclesBeforeResume) {
      desiredState = "HOLIDAY_MODE_OFF";
    } else {
      desiredState = "HOLIDAY_MODE_ON";
      reasons.push("RECOVERY_HYSTERESIS_PENDING");
    }
  }

  const trigger = stopByOnHoldValue
    ? stopByDeliveryRate
      ? "BOTH"
      : "VALUE"
    : stopByDeliveryRate
      ? "RATE"
      : "NONE";
  const ruleResult = definitiveStop
    ? "WARNING"
    : dataSufficient
      ? "CLEAR"
      : "INSUFFICIENT_DATA";
  const lastSuccessfulObservationAt = input.facts.reduce<Date | null>(
    (latest, fact) => {
      if (fact.lastObservedAt === undefined || fact.lastObservedAt === null) {
        return latest;
      }
      return latest === null || fact.lastObservedAt > latest
        ? fact.lastObservedAt
        : latest;
    },
    null,
  );
  const ruleExpression = `VALUE >= ${new Decimal(
    policy.stopOnHoldValueAt,
  ).toString()} ${policy.currency} OR DELIVERY_RATE < ${new Decimal(
    policy.stopDeliveryRateBelow,
  )
    .times(100)
    .toString()}%`;

  return RiskControlDecisionSchema.parse({
    policyVersion: policy.version,
    currency: policy.currency,
    historyMode: "FULL_PERSISTED_HISTORY",
    dataCoverage: "UNKNOWN",
    totalPersistedOrderCount,
    totalPersistedValue,
    lastSuccessfulObservationAt,
    onHoldValue:
      statusMetricsAvailable && currencyMismatchCount === 0
        ? onHoldValueKnownPolicyCurrencySubtotal
            .toDecimalPlaces(4)
            .toFixed(4)
        : null,
    onHoldValueKnownPolicyCurrencySubtotal:
      onHoldValueKnownPolicyCurrencySubtotal.toDecimalPlaces(4).toFixed(4),
    onHoldOrderCount,
    onHoldRate: null,
    onHoldRateUnavailableReason:
      "OPERATIONAL_ONHOLD_COUNT_AND_TOTAL_COUNT_USE_THE_SAME_STATUS_SET",
    deliveredCount,
    totalCount,
    deliveryRate,
    rateRuleApplied,
    sampleSufficient,
    stopByOnHoldValue,
    stopByDeliveryRate,
    stopConditionOperator: "OR",
    definitiveStop,
    trigger,
    ruleResult,
    ruleExpression,
    suggestedOperationalAction:
      ruleResult === "WARNING" ? "REVIEW_SHOP" : "NONE",
    executionMode: "DRY_RUN",
    executedAction: "NONE",
    desiredState,
    statusCoverage:
      totalPersistedOrderCount === 0
        ? 0
        : (totalPersistedOrderCount - unknownOrderCount) /
          totalPersistedOrderCount,
    unknownOrderCount,
    currencyMismatchCount,
    dataSufficient,
    holidayModeCurrentlyEnabled,
    resumeCriteriaMet,
    consecutiveSafeCycles,
    stableCyclesBeforeResume: policy.stableCyclesBeforeResume,
    thresholds: {
      stopOnHoldValueAt: policy.stopOnHoldValueAt,
      stopDeliveryRateBelow: policy.stopDeliveryRateBelow,
      minimumOrdersForRateRule: policy.minimumOrdersForRateRule,
      resumeOnHoldValueBelow: policy.resumeOnHoldValueBelow,
      resumeDeliveryRateAt: policy.resumeDeliveryRateAt,
    },
    reasons,
  });
}
