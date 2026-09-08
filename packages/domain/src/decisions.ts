import { Decimal } from "decimal.js";
import { z, type RefinementCtx } from "zod";

import {
  CurrencyCodeSchema,
  DecimalStringSchema,
  NonNegativeDecimalStringSchema,
} from "./contracts/common.js";
import { FinanceHealthSnapshotSchema } from "./finance-health.js";
import { SourceProviderSchema } from "./contracts/source.js";
import { ResolvedRiskPolicySnapshotSchema } from "./risk-policy.js";
import type { RiskControlDecision } from "./risk-control.js";

export const BaDecisionSchema = z.enum([
  "SCALE",
  "CONTINUE",
  "WATCH",
  "PAUSE",
  "SLOW_SELL",
]);

export const BaPlannedMethodSchema = z.enum([
  "DISABLE_FLASH_SALE",
  "INCREASE_PRICE",
  "OTHER",
]);

export const DecisionDataOriginSchema = z.enum(["LIVE", "DEMO_SANITIZED"]);

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
const OptionalSignedMoneySchema = DecimalStringSchema.nullable();

export const DecisionMetricsSnapshotSchema = z
  .object({
    window: z.string().trim().min(1),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    totalOrders: z.number().int().nonnegative(),
    totalPersistedOrders: z.number().int().nonnegative().optional(),
    operationalOrderCount: z.number().int().nonnegative().nullable().optional(),
    onHoldOrderCount: z.number().int().nonnegative().nullable(),
    deliveredCount: z.number().int().nonnegative().nullable(),
    deliveryRate: OptionalRateSchema,
    cancellationRate: OptionalRateSchema,
    refundRate: OptionalRateSchema,
    onHoldValue: OptionalMoneySchema,
    currency: CurrencyCodeSchema,
  })
  .strict()
  .refine(
    ({ periodStart, periodEnd, totalOrders }) => periodStart < periodEnd
      || (totalOrders === 0 && periodStart === periodEnd),
    {
      path: ["periodEnd"],
      message: "Metrics period must have duration unless no orders were observed",
    },
  );

export const DecisionRiskSnapshotSchema = z
  .object({
    policyVersion: z.string().trim().min(1),
    evaluatedAt: z.string().datetime(),
    onHoldValue: OptionalMoneySchema,
    deliveryRate: OptionalRateSchema,
    stopByOnHoldValue: z.boolean(),
    stopByDeliveryRate: z.boolean(),
    dataSufficient: z.boolean(),
    stopOnHoldValueAt: NonNegativeDecimalStringSchema,
    stopDeliveryRateBelow: z.number().min(0).max(1),
    minimumOrdersForRateRule: z.number().int().nonnegative(),
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
    officialOnHoldAmount: OptionalMoneySchema,
    waitingForPackageDeliveryAmount: OptionalSignedMoneySchema.optional(),
    deliveredAwaitingSettlementAmount: OptionalSignedMoneySchema.optional(),
    waitingForCompletedRefundReturnAmount: OptionalSignedMoneySchema.optional(),
    reasonTotalsReconcileToOfficialOnHold: z.boolean().nullable().optional(),
    missingOnHoldExpectedAmountCount: z.number().int().nonnegative().optional(),
    settlementCount: z.number().int().nonnegative(),
    onHoldSettlementCount: z.number().int().nonnegative(),
  })
  .strict();

export const DecisionCoverageSnapshotSchema = z
  .object({
    coverageState: DecisionDataCoverageSchema,
    persistedMetricsWindow: z.string().trim().min(1),
    source: SourceProviderSchema.nullable().optional(),
    provenSourceWindow: z.enum(["ROLLING_12_MONTHS"]).nullable(),
    completeWithinSourceWindow: z.boolean().nullable(),
    lifetimeHistoryComplete: z.boolean().nullable(),
    ordersSourceComplete: z.boolean().nullable().optional(),
    financeRequiredSourceComplete: z.boolean().nullable().optional(),
    sourceReconciled: z.boolean().nullable().optional(),
    latestSuccessfulSyncAt: z.string().datetime().nullable().optional(),
    financeCapturedAt: z.string().datetime().nullable().optional(),
    deliverySourceComplete: z.boolean().nullable().optional(),
    deliveryObservedAt: z.string().datetime().nullable().optional(),
    deliveryFreshness: z.enum(["FRESH", "STALE", "UNKNOWN"]).optional(),
    freshness: z.enum(["FRESH", "STALE", "UNKNOWN"]).optional(),
    financeHealth: FinanceHealthSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      coverage.provenSourceWindow === "ROLLING_12_MONTHS" &&
      coverage.completeWithinSourceWindow === true &&
      coverage.lifetimeHistoryComplete !== false
    ) {
      context.addIssue({
        code: "custom",
        path: ["lifetimeHistoryComplete"],
        message: "A complete rolling 12-month source window does not prove lifetime history",
      });
    }
    if (
      coverage.freshness === "FRESH" &&
      (coverage.ordersSourceComplete !== true ||
        coverage.financeRequiredSourceComplete !== true ||
        coverage.sourceReconciled !== true ||
        coverage.latestSuccessfulSyncAt == null ||
        coverage.financeCapturedAt == null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["freshness"],
        message: "FRESH requires complete, reconciled source facts and timestamps",
      });
    }
  });

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
    coverageSnapshot: DecisionCoverageSnapshotSchema,
    ruleDecision: DecisionRuleResultSchema,
    ruleTriggers: UniqueRuleTriggersSchema,
    dataCoverage: DecisionDataCoverageSchema,
    sourceSyncRunId: z.string().uuid().nullable(),
    // Optional for backward compatibility; new cases can freeze the exact
    // resolved revision/value/provenance state used by their rule.
    resolvedPolicySnapshot: ResolvedRiskPolicySnapshotSchema.optional(),
    // Parsed by the persistence boundary to avoid a contract-module cycle.
    decisionContextSnapshot: z.unknown().nullable().optional(),
  })
  .superRefine(({
    ruleDecision,
    ruleTriggers,
    coverageSnapshot,
    dataCoverage,
    metricsSnapshot,
    riskSnapshot,
    financeSnapshot,
    resolvedPolicySnapshot,
  }, context) => {
    if (coverageSnapshot.coverageState !== dataCoverage) {
      context.addIssue({
        code: "custom",
        path: ["coverageSnapshot", "coverageState"],
        message: "Coverage snapshot state must match decision data coverage",
      });
    }
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
    if (resolvedPolicySnapshot !== undefined) {
      const matchingEvidence = [
        ["policyVersion", resolvedPolicySnapshot.policyVersion, riskSnapshot.policyVersion],
        ["effectiveAt", resolvedPolicySnapshot.effectiveAt, riskSnapshot.evaluatedAt],
        [
          "thresholds.stopOnHoldValueAt",
          resolvedPolicySnapshot.thresholds.stopOnHoldValueAt,
          riskSnapshot.stopOnHoldValueAt,
        ],
        [
          "thresholds.stopDeliveryRateBelow",
          resolvedPolicySnapshot.thresholds.stopDeliveryRateBelow,
          riskSnapshot.stopDeliveryRateBelow,
        ],
        [
          "thresholds.minimumOrdersForRateRule",
          resolvedPolicySnapshot.thresholds.minimumOrdersForRateRule,
          riskSnapshot.minimumOrdersForRateRule,
        ],
        ["currency", resolvedPolicySnapshot.currency, metricsSnapshot.currency],
        ["currency", resolvedPolicySnapshot.currency, financeSnapshot.currency],
      ] as const;
      for (const [path, actual, expected] of matchingEvidence) {
        const matches = path === "thresholds.stopOnHoldValueAt"
          ? new Decimal(actual).eq(new Decimal(expected))
          : actual === expected;
        if (!matches) {
          context.addIssue({
            code: "custom",
            path: ["resolvedPolicySnapshot", ...path.split(".")],
            message: `Resolved policy ${path} must match Decision Case evidence`,
          });
        }
      }
    }
  });

const BaReasonCodesInputSchema = z
  .array(BaDecisionReasonCodeSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "BA reason codes must not contain duplicates",
  });

export const UniqueBaPlannedMethodsSchema = z
  .array(BaPlannedMethodSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "BA planned methods must not contain duplicates",
  });

export const MeaningfulBaNotesSchema = z.string().trim().refine(
  (value) => /[^\s\p{Cc}\p{Cf}]/u.test(value),
  { message: "BA notes must contain meaningful text" },
);

export interface BaDecisionInvariantInput {
  readonly decision: BaDecision;
  readonly reasonCode: BaDecisionReasonCode;
  readonly reasonCodes?: readonly BaDecisionReasonCode[] | undefined;
  readonly plannedMethods?: readonly BaPlannedMethod[] | null | undefined;
  readonly notes?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly actor?: string | undefined;
}

export function refineBaDecisionInvariants(
  value: BaDecisionInvariantInput,
  context: RefinementCtx,
): void {
  if (value.reasonCodes !== undefined && value.reasonCodes[0] !== value.reasonCode) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: "BA reasonCode must match the first legacy reason code" });
  }
  const hasNotes = value.notes != null || value.note != null;
  if (value.reasonCode === "OTHER" && !hasNotes && value.actor !== "LEGACY_UNATTRIBUTED") {
    context.addIssue({ code: "custom", path: ["notes"], message: "BA notes are required for OTHER" });
  }
  if (value.decision === "SLOW_SELL" && value.plannedMethods == null) {
    context.addIssue({ code: "custom", path: ["plannedMethods"], message: "SLOW_SELL requires at least one planned method" });
  }
  if (value.decision !== "SLOW_SELL" && value.plannedMethods != null) {
    context.addIssue({ code: "custom", path: ["plannedMethods"], message: "Only SLOW_SELL can have planned methods" });
  }
  if (value.plannedMethods?.includes("OTHER") === true && !hasNotes) {
    context.addIssue({ code: "custom", path: ["notes"], message: "BA notes are required for planned method OTHER" });
  }
  if (value.notes != null && value.note != null && value.notes !== value.note) {
    context.addIssue({ code: "custom", path: ["notes"], message: "BA notes must match note" });
  }
}

export const BaDecisionInputSchema = z
  .object({
    decision: BaDecisionSchema,
    confidence: z.number().min(0).max(1).optional(),
    // reasonCodes/note are retained as a compatibility input for existing V1 callers.
    reasonCode: BaDecisionReasonCodeSchema,
    reasonCodes: BaReasonCodesInputSchema.optional(),
    plannedMethods: UniqueBaPlannedMethodsSchema.optional(),
    notes: MeaningfulBaNotesSchema.optional(),
    note: MeaningfulBaNotesSchema.optional(),
  })
  .strict()
  .superRefine(refineBaDecisionInvariants)

export const CaptureBaDecisionInputSchema = z.object({
  decisionCase: DecisionCaseInputSchema,
  baDecision: BaDecisionInputSchema,
});

const RequestIdSchema = z.string().uuid();

export const CreateDecisionCaseInputSchema = DecisionCaseInputSchema.extend({
  requestId: RequestIdSchema,
  caseOrigin: DecisionDataOriginSchema,
}).superRefine(({ caseOrigin, sourceSyncRunId }, context) => {
  if (caseOrigin === "DEMO_SANITIZED" && sourceSyncRunId !== null) {
    context.addIssue({
      code: "custom",
      path: ["sourceSyncRunId"],
      message: "Sanitized demo cases cannot reference a sync run",
    });
  }
});

export const AiDecisionStatusSchema = z.enum(["AVAILABLE", "UNAVAILABLE"]);

export const AiFailureCodeSchema = z.enum([
  "FEATURE_DISABLED",
  "CONFIG_MISSING",
  "TIMEOUT",
  "NETWORK_ERROR",
  "HTTP_ERROR",
  "RATE_LIMITED",
  "INVALID_RESPONSE",
  "PROVIDER_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "MODEL_NOT_ALLOWED",
]);

const AiProvenanceFields = {
  requestId: RequestIdSchema,
  decisionCaseId: z.string().uuid(),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1).nullable(),
  requestedModel: z.string().trim().min(1),
  reportedModel: z.string().trim().min(1).nullable(),
  actualModelUsed: z.string().trim().min(1).nullable(),
  authMode: z.enum(["LOCAL_NO_AUTH", "BEARER", "CONFIG_MISSING"]),
  outputSchemaVersion: z.literal("decision-ai-output.v1"),
  promptVersion: z.string().trim().min(1),
  policyVersion: z.string().trim().min(1),
  aiPolicyVersion: z.string().trim().min(1),
} as const;

const UniqueAiReasonCodesSchema = z
  .array(BaDecisionReasonCodeSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "AI reason codes must not contain duplicates",
  });

const AiFactorsSchema = z.array(z.string().trim().min(1).max(240)).max(5);

export const AvailableAiDecisionInputSchema = z
  .object({
    ...AiProvenanceFields,
    status: z.literal("AVAILABLE"),
    model: z.string().trim().min(1),
    reportedModel: z.string().trim().min(1),
    actualModelUsed: z.string().trim().min(1),
    recommendation: BaDecisionSchema,
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
    confidence: z.number().min(0).max(1),
    ruleOverride: z.boolean(),
    reasonCodes: UniqueAiReasonCodesSchema,
    supportingFactors: AiFactorsSchema,
    riskFactors: AiFactorsSchema,
    whatWouldChangeDecision: AiFactorsSchema,
    reason: z.string().trim().min(1),
    humanReviewRequired: z.boolean(),
    failureCode: z.null(),
  })
  .strict();

export const UnavailableAiDecisionInputSchema = z
  .object({
    ...AiProvenanceFields,
    status: z.literal("UNAVAILABLE"),
    model: z.null(),
    reportedModel: z.null(),
    actualModelUsed: z.null(),
    recommendation: z.null(),
    riskLevel: z.null(),
    confidence: z.null(),
    ruleOverride: z.null(),
    reasonCodes: z.null(),
    supportingFactors: z.null(),
    riskFactors: z.null(),
    whatWouldChangeDecision: z.null(),
    reason: z.null(),
    humanReviewRequired: z.literal(true),
    failureCode: AiFailureCodeSchema,
  })
  .strict();

export const AiDecisionInputSchema = z.discriminatedUnion("status", [
  AvailableAiDecisionInputSchema,
  UnavailableAiDecisionInputSchema,
]);

export const RecordBaDecisionForCaseInputSchema = z
  .object({
    requestId: RequestIdSchema,
    decisionCaseId: z.string().uuid(),
    baDecision: BaDecisionInputSchema,
  })
  .strict();

export const RecordDryRunExecutionInputSchema = z
  .object({
    requestId: RequestIdSchema,
    decisionCaseId: z.string().uuid(),
    baDecisionId: z.string().uuid(),
    requestedAction: z.literal("HOLIDAY_MODE_ON"),
    executionMode: z.literal("DRY_RUN"),
  })
  .strict();

export const DryRunExecutionSchema = RecordDryRunExecutionInputSchema.extend({
  executionStatus: z.literal("SIMULATED"),
  sellerCenterCalled: z.literal(false),
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
export type BaPlannedMethod = z.infer<typeof BaPlannedMethodSchema>;
export type BaDecisionReasonCode = z.infer<typeof BaDecisionReasonCodeSchema>;
export type DecisionDataOrigin = z.infer<typeof DecisionDataOriginSchema>;
export type DecisionDataCoverage = z.infer<typeof DecisionDataCoverageSchema>;
export type DecisionRuleResult = z.infer<typeof DecisionRuleResultSchema>;
export type DecisionRuleTrigger = z.infer<typeof DecisionRuleTriggerSchema>;
export type DecisionMetricsSnapshot = z.infer<typeof DecisionMetricsSnapshotSchema>;
export type DecisionRiskSnapshot = z.infer<typeof DecisionRiskSnapshotSchema>;
export type DecisionFinanceSnapshot = z.infer<typeof DecisionFinanceSnapshotSchema>;
export type DecisionCoverageSnapshot = z.infer<typeof DecisionCoverageSnapshotSchema>;
export type DecisionCaseInput = z.infer<typeof DecisionCaseInputSchema>;
export type BaDecisionInput = z.infer<typeof BaDecisionInputSchema>;
export type CaptureBaDecisionInput = z.infer<typeof CaptureBaDecisionInputSchema>;
export type CreateDecisionCaseInput = z.infer<typeof CreateDecisionCaseInputSchema>;
export type AiDecisionStatus = z.infer<typeof AiDecisionStatusSchema>;
export type AiFailureCode = z.infer<typeof AiFailureCodeSchema>;
export type AiDecisionInput = z.infer<typeof AiDecisionInputSchema>;
export type RecordBaDecisionForCaseInput = z.infer<
  typeof RecordBaDecisionForCaseInputSchema
>;
export type RecordDryRunExecutionInput = z.infer<
  typeof RecordDryRunExecutionInputSchema
>;
export type DryRunExecution = z.infer<typeof DryRunExecutionSchema>;
