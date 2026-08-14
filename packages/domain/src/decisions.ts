import { z } from "zod";

import {
  CurrencyCodeSchema,
  NonNegativeDecimalStringSchema,
} from "./contracts/common.js";
import type { RiskControlDecision } from "./risk-control.js";

export const BaDecisionSchema = z.enum([
  "SCALE",
  "CONTINUE",
  "WATCH",
  "PAUSE",
]);

export const BaDecisionReasonCodeSchema = z.enum([
  "HIGH_ABSOLUTE_EXPOSURE",
  "LOW_DELIVERY_RATE",
  "HIGH_VOLUME_HEALTHY",
  "LOW_SAMPLE_SIZE",
  "CARRIER_SYSTEMIC_DELAY",
  "RAPID_ONHOLD_GROWTH",
  "DELIVERY_DETERIORATION",
  "REFUND_SPIKE",
  "DATA_INCOMPLETE",
  "RECOVERY_TREND",
  "THRESHOLD_FLAPPING",
  "OTHER",
]);

export const DecisionDataCoverageSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "UNKNOWN",
]);

export const DecisionRuleResultSchema = z.enum([
  "PAUSE",
  "CONTINUE",
  "INSUFFICIENT_DATA",
]);

export const DecisionRuleTriggerSchema = z.enum([
  "ONHOLD_VALUE",
  "DELIVERY_RATE",
]);

const OptionalRateSchema = z.number().min(0).max(1).nullable();
const OptionalMoneySchema = NonNegativeDecimalStringSchema.nullable();

export const DecisionMetricsSnapshotSchema = z
  .object({
    window: z.string().trim().min(1),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    totalOrders: z.number().int().nonnegative(),
    onHoldOrderCount: z.number().int().nonnegative().nullable(),
    deliveredCount: z.number().int().nonnegative().nullable(),
    deliveryRate: OptionalRateSchema,
    cancellationRate: OptionalRateSchema,
    refundRate: OptionalRateSchema,
    onHoldValue: OptionalMoneySchema,
    currency: CurrencyCodeSchema,
  })
  .strict()
  .refine(({ periodStart, periodEnd }) => periodStart < periodEnd, {
    path: ["periodEnd"],
    message: "Metrics period start must be before period end",
  });

export const DecisionRiskSnapshotSchema = z
  .object({
    policyVersion: z.string().trim().min(1),
    evaluatedAt: z.string().datetime(),
    onHoldValue: OptionalMoneySchema,
    deliveryRate: OptionalRateSchema,
    stopByOnHoldValue: z.boolean(),
    stopByDeliveryRate: z.boolean(),
    dataSufficient: z.boolean(),
    stopOnHoldValueAt: NonNegativeDecimalStringSchema.optional(),
    stopDeliveryRateBelow: z.number().min(0).max(1).optional(),
    minimumOrdersForRateRule: z.number().int().nonnegative().optional(),
  })
  .strict();

export const DecisionFinanceSnapshotSchema = z
  .object({
    capturedAt: z.string().datetime().nullable(),
    currency: CurrencyCodeSchema,
    availableBalance: OptionalMoneySchema,
    frozenBalance: OptionalMoneySchema,
    totalBalance: OptionalMoneySchema,
    toSettleBalance: OptionalMoneySchema,
    onHoldBalance: OptionalMoneySchema,
    settlementCount: z.number().int().nonnegative(),
    onHoldSettlementCount: z.number().int().nonnegative(),
  })
  .strict();

const UniqueRuleTriggersSchema = z
  .array(DecisionRuleTriggerSchema)
  .refine((values) => new Set(values).size === values.length, {
    message: "Rule triggers must not contain duplicates",
  });

export const DecisionCaseInputSchema = z
  .object({
    shopId: z.string().uuid(),
    observedAt: z.date(),
    metricsSnapshot: DecisionMetricsSnapshotSchema,
    riskSnapshot: DecisionRiskSnapshotSchema,
    financeSnapshot: DecisionFinanceSnapshotSchema,
    ruleDecision: DecisionRuleResultSchema,
    ruleTriggers: UniqueRuleTriggersSchema,
    dataCoverage: DecisionDataCoverageSchema,
    sourceSyncRunId: z.string().uuid().nullable(),
  })
  .superRefine(({ ruleDecision, ruleTriggers }, context) => {
    if (ruleDecision === "PAUSE" && ruleTriggers.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["ruleTriggers"],
        message: "PAUSE requires at least one rule trigger",
      });
    }
    if (ruleDecision === "CONTINUE" && ruleTriggers.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["ruleTriggers"],
        message: "CONTINUE cannot have rule triggers",
      });
    }
  });

export const BaDecisionInputSchema = z.object({
  decision: BaDecisionSchema,
  confidence: z.number().min(0).max(1).optional(),
  reasonCodes: z
    .array(BaDecisionReasonCodeSchema)
    .min(1)
    .refine((values) => new Set(values).size === values.length, {
      message: "BA reason codes must not contain duplicates",
    }),
  note: z.string().trim().min(1).optional(),
});

export const CaptureBaDecisionInputSchema = z.object({
  decisionCase: DecisionCaseInputSchema,
  baDecision: BaDecisionInputSchema,
});

export function mapRiskResultToRuleDecision(
  riskResult: RiskControlDecision["ruleResult"],
): DecisionRuleResult {
  switch (riskResult) {
    case "WARNING":
      return "PAUSE";
    case "CLEAR":
      return "CONTINUE";
    case "INSUFFICIENT_DATA":
      return "INSUFFICIENT_DATA";
  }
}

export type BaDecision = z.infer<typeof BaDecisionSchema>;
export type BaDecisionReasonCode = z.infer<typeof BaDecisionReasonCodeSchema>;
export type DecisionDataCoverage = z.infer<typeof DecisionDataCoverageSchema>;
export type DecisionRuleResult = z.infer<typeof DecisionRuleResultSchema>;
export type DecisionRuleTrigger = z.infer<typeof DecisionRuleTriggerSchema>;
export type DecisionMetricsSnapshot = z.infer<typeof DecisionMetricsSnapshotSchema>;
export type DecisionRiskSnapshot = z.infer<typeof DecisionRiskSnapshotSchema>;
export type DecisionFinanceSnapshot = z.infer<typeof DecisionFinanceSnapshotSchema>;
export type DecisionCaseInput = z.infer<typeof DecisionCaseInputSchema>;
export type BaDecisionInput = z.infer<typeof BaDecisionInputSchema>;
export type CaptureBaDecisionInput = z.infer<typeof CaptureBaDecisionInputSchema>;
