import { z } from "zod";

import { DecimalStringSchema } from "./common.js";
import {
  AiDecisionInputSchema,
  BaDecisionInputSchema,
  BaDecisionReasonCodeSchema,
  BaDecisionSchema,
  DecisionCoverageSnapshotSchema,
  DecisionDataCoverageSchema,
  DecisionFinanceSnapshotSchema,
  DecisionMetricsSnapshotSchema,
  DecisionRiskSnapshotSchema,
  DecisionRuleResultSchema,
  DecisionRuleTriggerSchema,
  DryRunExecutionSchema,
} from "../decisions.js";
import { PeriodMetricsSchema } from "../metrics/types.js";

const TimestampSchema = z.string().datetime();
const IdentifierSchema = z.string().trim().min(1);

export const ProfileVerificationStateSchema = z.enum([
  "UNVERIFIED",
  "LOGIN_REQUIRED",
  "HUMAN_ACTION_REQUIRED",
  "NOT_TIKTOK_SELLER",
  "UNSUPPORTED_REGION",
  "SHOP_SELECTION_REQUIRED",
  "SHOP_IDENTITY_CHANGED",
  "READY",
]);

export const ShopIdentitySummarySchema = z.object({
  shopId: IdentifierSchema,
  tiktokShopId: IdentifierSchema.nullable(),
  displayName: z.string().trim().min(1).nullable(),
  region: z.literal("US"),
  locale: z.literal("en-US"),
  currency: z.literal("USD"),
}).strict();

export const ProfileSummarySchema = z.object({
  profileId: IdentifierSchema,
  profileNo: IdentifierSchema,
  groupName: z.string().trim().min(1).nullable(),
  browserState: z.enum(["OPEN", "CLOSED", "ERROR", "NOT_VERIFIED"]),
  verificationState: ProfileVerificationStateSchema,
  eligibilityStatus: z.enum(["ELIGIBLE", "INELIGIBLE", "UNSUPPORTED_REGION"]),
  linkedShop: ShopIdentitySummarySchema.nullable(),
  lastVerifiedAt: TimestampSchema.nullable(),
  sync: z.object({
    state: z.enum([
      "ACTIVE",
      "PAUSED_LOGIN",
      "PAUSED_CHALLENGE",
      "PAUSED_LAYOUT",
      "PAUSED_MANUAL",
      "DISABLED",
    ]),
    lastSuccessfulSyncAt: TimestampSchema.nullable(),
    pauseReason: z.string().trim().min(1).nullable(),
  }).strict(),
}).strict();

export const DataQualitySummarySchema = z.object({
  coverage: DecisionDataCoverageSchema,
  source: z.literal("SELLER_CENTER").nullable(),
  provenSourceWindow: z.enum(["ROLLING_12_MONTHS"]).nullable(),
  completeWithinSourceWindow: z.boolean().nullable(),
  lifetimeHistoryComplete: z.boolean().nullable(),
  ordersSourceComplete: z.boolean().nullable(),
  financeRequiredSourceComplete: z.boolean().nullable(),
  sourceReconciled: z.boolean().nullable(),
  freshness: z.enum(["FRESH", "STALE", "UNKNOWN"]),
  latestSuccessfulSyncAt: TimestampSchema.nullable(),
  financeCapturedAt: TimestampSchema.nullable(),
  blockers: z.array(z.string().trim().min(1)),
}).strict();

// This composition contains only deterministic, verified source and metric facts.
export const MetricSnapshotSchema = z.object({
  observedAt: TimestampSchema,
  decision: DecisionMetricsSnapshotSchema,
  finance: DecisionFinanceSnapshotSchema,
  period: PeriodMetricsSchema.optional(),
}).strict();

const MetricObservedValueSchema = z.union([z.number(), DecimalStringSchema, z.null()]);

export const MetricComparisonSchema = z.object({
  metric: z.string().trim().min(1),
  current: MetricObservedValueSchema,
  previous: MetricObservedValueSchema,
  absoluteDelta: MetricObservedValueSchema,
  relativeChange: z.number().nullable(),
  currency: z.literal("USD").nullable(),
}).strict();

export const TrendSignalSchema = z.object({
  metric: z.string().trim().min(1),
  comparison: MetricComparisonSchema,
  direction: z.enum(["IMPROVING", "STABLE", "WORSENING", "UNKNOWN"]),
  status: z.enum(["AVAILABLE", "INSUFFICIENT_DATA"]),
  reasonCodes: z.array(z.string().trim().min(1)),
}).strict();

export const RuleCheckSchema = z.object({
  metric: z.string().trim().min(1),
  observedValue: MetricObservedValueSchema,
  threshold: MetricObservedValueSchema,
  operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
  result: z.enum(["PASS", "FAIL", "NOT_EVALUATED"]),
  triggeredReason: z.string().trim().min(1).nullable(),
}).strict();

export const RuleEvaluationSchema = z.object({
  result: DecisionRuleResultSchema,
  policyVersion: z.string().trim().min(1),
  checks: z.array(RuleCheckSchema),
  triggers: z.array(DecisionRuleTriggerSchema),
  expression: z.string().trim().min(1),
  evaluatedAt: TimestampSchema,
}).strict();

export const AiDecisionContextSchema = z.object({
  metrics: MetricSnapshotSchema,
  dataQuality: DataQualitySummarySchema,
  risk: DecisionRiskSnapshotSchema,
  rule: RuleEvaluationSchema,
}).strict();

// Existing AI persistence contract already contains availability, advice, and provenance.
export const AiAnalysisSchema = AiDecisionInputSchema;

export const ReviewQueueReasonSchema = z.enum([
  "RULE_PAUSE",
  "AI_PAUSE",
  "AI_WATCH",
  "RULE_AI_DISAGREEMENT",
  "HUMAN_REVIEW_REQUIRED",
  "AI_UNAVAILABLE",
  "DATA_INCOMPLETE",
  "TRUSTWORTHY_DECISION_BLOCKED",
]);

export const ReviewQueueItemSchema = z.object({
  decisionCaseId: z.string().uuid(),
  observedAt: TimestampSchema,
  profile: ProfileSummarySchema,
  shop: ShopIdentitySummarySchema,
  dataQuality: DataQualitySummarySchema,
  rule: RuleEvaluationSchema,
  ai: AiAnalysisSchema.nullable(),
  reasons: z.array(ReviewQueueReasonSchema).min(1),
}).strict();

// Reuses the established BA validation, including the OTHER-notes requirement.
export const BaReviewCommandSchema = BaDecisionInputSchema;

export const BaDecisionRevisionSchema = z.object({
  id: z.string().uuid(),
  decisionCaseId: z.string().uuid(),
  decision: BaDecisionSchema,
  reasonCode: BaDecisionReasonCodeSchema,
  reasonCodes: z.array(BaDecisionReasonCodeSchema).min(1),
  notes: z.string().trim().min(1).nullable(),
  actor: z.string().trim().min(1),
  decidedAt: TimestampSchema,
}).strict();

export const BaDecisionHistorySchema = z.object({
  current: BaDecisionRevisionSchema.nullable(),
  revisions: z.array(BaDecisionRevisionSchema),
}).strict();

export const ExecutionSummarySchema = DryRunExecutionSchema.extend({
  id: z.string().uuid(),
  executedAt: TimestampSchema,
}).strict();

export const ShopHealthSnapshotSchema = z.object({
  schemaVersion: z.literal("shop-health-snapshot.v1"),
  generatedAt: TimestampSchema,
  decisionCaseId: z.string().uuid().nullable(),
  profile: ProfileSummarySchema,
  shop: ShopIdentitySummarySchema,
  dataQuality: DataQualitySummarySchema,
  metrics: MetricSnapshotSchema,
  comparisons: z.array(MetricComparisonSchema),
  trends: z.array(TrendSignalSchema),
  rule: RuleEvaluationSchema,
  ai: AiAnalysisSchema.nullable(),
  currentBaDecision: BaDecisionRevisionSchema.nullable(),
  baHistory: BaDecisionHistorySchema,
  execution: ExecutionSummarySchema.nullable(),
}).strict();

export type ProfileVerificationState = z.infer<typeof ProfileVerificationStateSchema>;
export type ShopIdentitySummary = z.infer<typeof ShopIdentitySummarySchema>;
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;
export type DataQualitySummary = z.infer<typeof DataQualitySummarySchema>;
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;
export type MetricComparison = z.infer<typeof MetricComparisonSchema>;
export type TrendSignal = z.infer<typeof TrendSignalSchema>;
export type RuleCheck = z.infer<typeof RuleCheckSchema>;
export type RuleEvaluation = z.infer<typeof RuleEvaluationSchema>;
export type AiDecisionContext = z.infer<typeof AiDecisionContextSchema>;
export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;
export type ReviewQueueReason = z.infer<typeof ReviewQueueReasonSchema>;
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;
export type BaReviewCommand = z.infer<typeof BaReviewCommandSchema>;
export type BaDecisionRevision = z.infer<typeof BaDecisionRevisionSchema>;
export type BaDecisionHistory = z.infer<typeof BaDecisionHistorySchema>;
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;
export type ShopHealthSnapshot = z.infer<typeof ShopHealthSnapshotSchema>;
