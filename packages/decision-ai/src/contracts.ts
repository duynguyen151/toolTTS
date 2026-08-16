import {
  BaDecisionReasonCodeSchema,
  BaDecisionSchema,
  AiDecisionContextSchema,
  DecisionCoverageSnapshotSchema,
  DecisionFinanceSnapshotSchema,
  DecisionMetricsSnapshotSchema,
  DecisionRiskSnapshotSchema,
  DecisionRuleResultSchema,
  DecisionRuleTriggerSchema,
} from "@shop-health/domain";
import { z } from "zod";

const UniqueReasonCodesSchema = z
  .array(BaDecisionReasonCodeSchema)
  .min(1)
  .max(5)
  .refine((values) => new Set(values).size === values.length, {
    message: "AI reason codes must not contain duplicates",
  });

const UniqueRuleTriggersSchema = z
  .array(DecisionRuleTriggerSchema)
  .refine((values) => new Set(values).size === values.length, {
    message: "Rule triggers must not contain duplicates",
  });

const FactorSchema = z.string().trim().min(1).max(240);
const FactorsSchema = z.array(FactorSchema).max(5);

export const BaselineAiInputSchema = z
  .object({
    metricsSnapshot: DecisionMetricsSnapshotSchema,
    financeSnapshot: DecisionFinanceSnapshotSchema,
    coverageSnapshot: DecisionCoverageSnapshotSchema,
    riskSnapshot: DecisionRiskSnapshotSchema,
    ruleDecision: DecisionRuleResultSchema,
    ruleTriggers: UniqueRuleTriggersSchema,
    decisionContextSnapshot: AiDecisionContextSchema.nullable().optional(),
  })
  .strict();

export const BaselineAiOutputSchema = z
  .object({
    recommendation: BaDecisionSchema,
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
    confidence: z.number().min(0).max(1),
    reasonCodes: UniqueReasonCodesSchema,
    supportingFactors: FactorsSchema,
    riskFactors: FactorsSchema,
    whatWouldChangeDecision: FactorsSchema,
    reason: z.string().trim().min(1).max(500),
    humanReviewRequired: z.boolean(),
  })
  .strict();

export const AiUnavailableErrorCodeSchema = z.enum([
  "FEATURE_DISABLED",
  "CONFIG_MISSING",
  "TIMEOUT",
  "NETWORK_ERROR",
  "HTTP_ERROR",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "MODEL_NOT_ALLOWED",
  "INVALID_RESPONSE",
]);

export type BaselineAiInput = z.infer<typeof BaselineAiInputSchema>;
export type BaselineAiOutput = z.infer<typeof BaselineAiOutputSchema>;
export type AiUnavailableErrorCode = z.infer<typeof AiUnavailableErrorCodeSchema>;
export type AiRiskLevel = BaselineAiOutput["riskLevel"];

export interface AiProvenance {
  readonly provider: "9router";
  readonly requestedModel: string;
  readonly reportedModel: string | null;
  readonly actualModelUsed: string | null;
  readonly authMode: "LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING";
  readonly outputSchemaVersion: "decision-ai-output.v1";
  readonly promptVersion: "decision-ai-prompt.v2";
  readonly aiPolicyVersion: "decision-ai-policy.v1";
  readonly rulePolicyVersion: string;
  readonly generatedAt: string;
}

export type BaselineAiAvailable = Readonly<{
  status: "AVAILABLE";
  reportedModel: string;
  actualModelUsed: string;
  ruleResult: z.infer<typeof DecisionRuleResultSchema>;
  ruleOverride: boolean;
} & BaselineAiOutput & Omit<AiProvenance, "reportedModel" | "actualModelUsed">>;

export type BaselineAiUnavailable = Readonly<{
  status: "UNAVAILABLE";
  reportedModel: null;
  actualModelUsed: null;
  errorCode: AiUnavailableErrorCode;
  humanReviewRequired: true;
} & Omit<AiProvenance, "reportedModel" | "actualModelUsed">>;

export type BaselineAiResult = BaselineAiAvailable | BaselineAiUnavailable;

export interface BaselineAiClient {
  recommend(input: BaselineAiInput): Promise<BaselineAiResult>;
}
