import { z } from "zod";

import { DecimalStringSchema } from "./common.js";
import {
  AiDecisionInputSchema,
  BaDecisionInputSchema,
  BaDecisionReasonCodeSchema,
  BaDecisionSchema,
  UniqueBaPlannedMethodsSchema,
  refineBaDecisionInvariants,
  DecisionCoverageSnapshotSchema,
  DecisionDataCoverageSchema,
  DecisionFinanceSnapshotSchema,
  DecisionMetricsSnapshotSchema,
  DecisionRiskSnapshotSchema,
  DecisionRuleResultSchema,
  DryRunExecutionSchema,
  MeaningfulBaNotesSchema,
} from "../decisions.js";
import { PeriodMetricsSchema } from "../metrics/types.js";
import { OfficialOnHoldRuleEvidenceSchema } from "../target-rule.js";

const TimestampSchema = z.string().datetime();
const IdentifierSchema = z.string().trim().min(1);

export const ProfileVerificationStateSchema = z.enum([
  "UNVERIFIED",
  "LOGIN_REQUIRED",
  "CREDENTIALS_REQUIRED",
  "AUTH_FAILED",
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
  deliverySourceComplete: z.boolean().nullable().optional(),
  deliveryObservedAt: TimestampSchema.nullable().optional(),
  deliveryFreshness: z.enum(["FRESH", "STALE", "UNKNOWN"]).optional(),
  latestSuccessfulSyncAt: TimestampSchema.nullable(),
  financeCapturedAt: TimestampSchema.nullable(),
  blockers: z.array(z.string().trim().min(1)),
}).strict();

const MetricObservedValueSchema = z.union([z.number(), DecimalStringSchema, z.null()]);

const { onHoldValue: _legacyOnHoldValue, ...DecisionMetricsForV1Fields } =
  DecisionMetricsSnapshotSchema.shape;

const DecisionMetricsForV1Schema = z.object({
  ...DecisionMetricsForV1Fields,
  operationalExposure: MetricObservedValueSchema,
}).strict().refine(
  ({ periodStart, periodEnd, totalOrders }) => periodStart < periodEnd
    || (totalOrders === 0 && periodStart === periodEnd),
  {
    path: ["periodEnd"],
    message: "Metrics period must have duration unless no orders were observed",
  },
);

const DecisionFinanceForV1Schema = DecisionFinanceSnapshotSchema
  .omit({ onHoldBalance: true, officialOnHoldAmount: true })
  .extend({ officialFinanceOnHold: MetricObservedValueSchema });

const DecisionRiskForV1Schema = DecisionRiskSnapshotSchema
  .omit({ onHoldValue: true })
  .extend({ operationalExposure: MetricObservedValueSchema });

// This composition contains only deterministic, verified source and metric facts.
export const MetricSnapshotSchema = z.object({
  observedAt: TimestampSchema,
  decision: DecisionMetricsForV1Schema,
  finance: DecisionFinanceForV1Schema,
  period: PeriodMetricsSchema.optional(),
}).strict();

export const MetricComparisonSchema = z.object({
  metric: z.string().trim().min(1),
  current: MetricObservedValueSchema,
  previous: MetricObservedValueSchema,
  absoluteDelta: MetricObservedValueSchema,
  relativeDelta: z.number().nullable(),
  direction: z.enum(["INCREASED", "DECREASED", "UNCHANGED", "UNKNOWN"]),
  currency: z.literal("USD").nullable(),
}).strict();

export const TrendNameSchema = z.enum([
  "RAPID_ONHOLD_GROWTH",
  "DELIVERY_DETERIORATION",
  "REFUND_SPIKE",
  "RECOVERY_TREND",
  "THRESHOLD_FLAPPING",
]);

export const TrendPolicyThresholdSchema = z.object({
  metric: z.string().trim().min(1),
  operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
  value: z.number().finite(),
}).strict();

export const TrendPolicySchema = z.object({
  version: z.string().trim().min(1),
  signals: z.array(z.object({
    signal: TrendNameSchema,
    thresholds: z.array(TrendPolicyThresholdSchema).min(1),
  }).strict()),
}).strict();

export const TrendSignalSchema = z.object({
  signal: TrendNameSchema,
  comparisons: z.array(MetricComparisonSchema),
  status: z.enum(["TRIGGERED", "NOT_TRIGGERED", "NOT_EVALUATED"]),
  reasonCode: z.enum(["POLICY_UNCONFIGURED", "INSUFFICIENT_DATA"]).nullable(),
}).strict();

export const RuleCheckSchema = z.object({
  metric: z.string().trim().min(1),
  observedValue: MetricObservedValueSchema,
  threshold: MetricObservedValueSchema,
  operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
  result: z.enum(["PASS", "FAIL", "NOT_EVALUATED"]),
  triggeredReason: z.string().trim().min(1).nullable(),
}).strict();

export const RuleTriggerForV1Schema = z.enum([
  "OPERATIONAL_EXPOSURE",
  "OFFICIAL_ON_HOLD",
  "DELIVERY_RATE",
]);

export const RuleEvaluationSchema = z.object({
  result: DecisionRuleResultSchema,
  policyVersion: z.string().trim().min(1),
  checks: z.array(RuleCheckSchema),
  triggers: z.array(RuleTriggerForV1Schema),
  expression: z.string().trim().min(1),
  evaluatedAt: TimestampSchema,
}).strict();

export const FrozenAiTaskRequestSchema = z.object({
  taskId: z.literal("SHOP_HEALTH_REVIEWER"),
  taskConfigRevisionId: z.string().uuid().nullable(),
  taskConfigSource: z.enum(["PERSISTED", "ENVIRONMENT"]),
  provider: z.enum(["9router", "openai-compatible", "huggingface-hosted"]).nullable(),
  requestedModel: z.string().trim().min(1).max(256).nullable(),
  secretRef: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,127}$/).nullable(),
  promptVersion: z.literal("decision-ai-prompt.v2"),
  aiPolicyVersion: z.literal("decision-ai-policy.v1"),
  outputSchemaVersion: z.literal("decision-ai-output.v1"),
}).strict().superRefine((request, context) => {
  if (request.taskConfigSource === "PERSISTED" && request.taskConfigRevisionId === null) {
    context.addIssue({ code: "custom", path: ["taskConfigRevisionId"], message: "persisted AI task requests require a revision ID" });
  }
  if (request.taskConfigSource === "ENVIRONMENT" && request.taskConfigRevisionId !== null) {
    context.addIssue({ code: "custom", path: ["taskConfigRevisionId"], message: "environment AI task requests must not carry a revision ID" });
  }
});

const AiDecisionContextV1Schema = z.object({
  schemaVersion: z.literal("ai-decision-context.v1"),
  targetRuleEvidence: OfficialOnHoldRuleEvidenceSchema.optional(),
  profile: z.object({
    profileId: IdentifierSchema,
    profileNo: IdentifierSchema,
  }).strict(),
  shop: ShopIdentitySummarySchema,
  metrics: MetricSnapshotSchema,
  comparisons: z.array(MetricComparisonSchema),
  trends: z.array(TrendSignalSchema),
  dataQuality: DataQualitySummarySchema,
  risk: DecisionRiskForV1Schema,
  rule: RuleEvaluationSchema,
  previousCompatibleSnapshot: z.object({
    observedAt: TimestampSchema,
    metrics: MetricSnapshotSchema,
    dataQuality: DataQualitySummarySchema,
    provenance: z.object({
      shopId: IdentifierSchema,
      profileId: IdentifierSchema,
      profileNo: IdentifierSchema,
    }).strict(),
  }).strict().nullable(),
  policyVersions: z.object({
    metricDefinitionVersion: z.string().trim().min(1),
    riskPolicyVersion: z.string().trim().min(1),
    trendPolicyVersion: z.string().trim().min(1).nullable(),
  }).strict(),
}).strict();

export const AiDecisionContextSchema = z.union([
  AiDecisionContextV1Schema,
  AiDecisionContextV1Schema.extend({
    schemaVersion: z.literal("ai-decision-context.v2"),
    requestedAiTask: FrozenAiTaskRequestSchema,
  }).strict(),
]);

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
  plannedMethods: UniqueBaPlannedMethodsSchema.nullable().default(null),
  notes: MeaningfulBaNotesSchema.nullable(),
  actor: z.string().trim().min(1),
  decidedAt: TimestampSchema,
}).strict().superRefine(refineBaDecisionInvariants);

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
export type TrendName = z.infer<typeof TrendNameSchema>;
export type TrendPolicyThreshold = z.infer<typeof TrendPolicyThresholdSchema>;
export type TrendPolicy = z.infer<typeof TrendPolicySchema>;
export type TrendSignal = z.infer<typeof TrendSignalSchema>;
export type RuleCheck = z.infer<typeof RuleCheckSchema>;
export type RuleTriggerForV1 = z.infer<typeof RuleTriggerForV1Schema>;
export type RuleEvaluation = z.infer<typeof RuleEvaluationSchema>;
export type FrozenAiTaskRequest = z.infer<typeof FrozenAiTaskRequestSchema>;
export type AiDecisionContext = z.infer<typeof AiDecisionContextSchema>;
export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;
export type ReviewQueueReason = z.infer<typeof ReviewQueueReasonSchema>;
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;
export type BaReviewCommand = z.infer<typeof BaReviewCommandSchema>;
export type BaDecisionRevision = z.infer<typeof BaDecisionRevisionSchema>;
export type BaDecisionHistory = z.infer<typeof BaDecisionHistorySchema>;
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;
export type ShopHealthSnapshot = z.infer<typeof ShopHealthSnapshotSchema>;
