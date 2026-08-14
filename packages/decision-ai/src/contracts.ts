import {
  BaDecisionReasonCodeSchema,
  BaDecisionSchema,
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

export const BaselineAiInputSchema = z
  .object({
    metricsSnapshot: DecisionMetricsSnapshotSchema,
    riskSnapshot: DecisionRiskSnapshotSchema,
    ruleDecision: DecisionRuleResultSchema,
    ruleTriggers: UniqueRuleTriggersSchema,
  })
  .strict();

export const BaselineAiOutputSchema = z
  .object({
    decision: BaDecisionSchema,
    confidence: z.number().min(0).max(1),
    reasonCodes: UniqueReasonCodesSchema,
    reason: z.string().trim().min(1).max(500),
    humanReviewRequired: z.boolean(),
  })
  .strict();

export const AiUnavailableErrorCodeSchema = z.enum([
  "FEATURE_DISABLED",
  "MISSING_API_KEY",
  "TIMEOUT",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_RESPONSE",
  "INVALID_OUTPUT",
]);

export type BaselineAiInput = z.infer<typeof BaselineAiInputSchema>;
export type BaselineAiOutput = z.infer<typeof BaselineAiOutputSchema>;
export type AiUnavailableErrorCode = z.infer<typeof AiUnavailableErrorCodeSchema>;

export interface AiProvenance {
  readonly provider: "opencode-zen";
  readonly model: string;
  readonly promptVersion: "baseline-ai-prompt.v1";
  readonly policyVersion: string;
  readonly generatedAt: string;
}

export type BaselineAiAvailable = Readonly<
  { status: "AVAILABLE" } & BaselineAiOutput & AiProvenance
>;

export type BaselineAiUnavailable = Readonly<{
  status: "UNAVAILABLE";
  errorCode: AiUnavailableErrorCode;
  humanReviewRequired: true;
} & AiProvenance>;

export type BaselineAiResult = BaselineAiAvailable | BaselineAiUnavailable;

export interface BaselineAiClient {
  recommend(input: BaselineAiInput): Promise<BaselineAiResult>;
}
