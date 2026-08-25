import type {
  BaDecision,
  BaDecisionReasonCode,
  BaPlannedMethod,
  DecisionCoverageSnapshot,
  DecisionDataCoverage,
  DecisionRuleResult,
  DecisionRuleTrigger,
  ResolvedRiskPolicySnapshot,
} from "@shop-health/domain";

export type DataOrigin = "LIVE" | "DEMO_SANITIZED";

export type MetricValue<T> =
  | { readonly status: "AVAILABLE"; readonly value: T }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface PersistedDecisionReview {
  readonly case: {
    readonly id: string;
    readonly origin: DataOrigin;
    readonly observedAt: Date;
    readonly createdAt: Date;
  };
  readonly shop: {
    readonly id: string;
    readonly profileNo: string;
    readonly displayName: string;
    readonly currency: string;
    readonly dataOrigin: DataOrigin;
    readonly dataCoverage: DecisionDataCoverage;
    readonly lastSyncAt: Date | null;
  };
  readonly coverageSnapshot: DecisionCoverageSnapshot;
  readonly resolvedPolicySnapshot: ResolvedRiskPolicySnapshot | null;
  readonly metrics: {
    readonly totalOrders: number;
    readonly onHoldValue: string | null;
    readonly deliveredCount: number | null;
    readonly deliveryRate: number | null;
    readonly cancellationRate: number | null;
    readonly refundRate: number | null;
    readonly currency: string;
    readonly unavailableReasons: Readonly<{
      onHoldValue: string;
      deliveredCount: string;
      deliveryRate: string;
      cancellationRate: string;
      refundRate: string;
    }>;
  };
  readonly rule: {
    readonly decision: DecisionRuleResult;
    readonly triggers: readonly DecisionRuleTrigger[];
    readonly expression: string;
    readonly policyVersion: string;
    readonly thresholds: {
      readonly stopOnHoldValueAt: string;
      readonly stopDeliveryRateBelow: number;
      readonly minimumOrdersForRateRule: number;
    };
  };
  readonly ai:
    | {
        readonly status: "AVAILABLE";
        readonly recommendation: BaDecision;
        readonly riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
        readonly confidence: number;
        readonly ruleOverride: boolean | null;
        readonly reasonCodes: readonly BaDecisionReasonCode[];
        readonly supportingFactors: readonly string[] | null;
        readonly riskFactors: readonly string[] | null;
        readonly whatWouldChangeDecision: readonly string[] | null;
        readonly reason: string;
        readonly humanReviewRequired: boolean;
        readonly provider: string;
        readonly model: string | null;
        readonly requestedModel: string | null;
        readonly reportedModel: string | null;
        readonly actualModelUsed: string | null;
        readonly authMode: "LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING" | null;
        readonly outputSchemaVersion: string | null;
        readonly promptVersion: string;
        readonly policyVersion: string;
        readonly aiPolicyVersion: string | null;
        readonly createdAt: Date;
      }
    | {
      readonly status: "UNAVAILABLE";
        readonly recommendation: null;
        readonly riskLevel: null;
        readonly confidence: null;
        readonly ruleOverride: null;
        readonly reasonCodes: null;
        readonly supportingFactors: null;
        readonly riskFactors: null;
        readonly whatWouldChangeDecision: null;
        readonly reason: null;
        readonly failureCode: string;
        readonly humanReviewRequired: true;
        readonly provider: string;
        readonly model: string | null;
        readonly requestedModel: string | null;
        readonly reportedModel: string | null;
        readonly actualModelUsed: string | null;
        readonly authMode: "LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING" | null;
        readonly outputSchemaVersion: string | null;
        readonly promptVersion: string;
        readonly policyVersion: string;
        readonly aiPolicyVersion: string | null;
        readonly createdAt: Date;
      }
    | null;
  readonly ba: {
    readonly id: string;
    readonly decision: BaDecision;
    readonly confidence: number | null;
    readonly reasonCodes: readonly BaDecisionReasonCode[];
    readonly plannedMethods: readonly BaPlannedMethod[] | null;
    readonly note: string | null;
    readonly decidedAt: Date;
  } | null;
  readonly execution: {
    readonly requestedAction: "HOLIDAY_MODE_ON";
    readonly mode: "DRY_RUN";
    readonly status: "SIMULATED";
    readonly sellerCenterCalled: false;
    readonly executedAt: Date;
  } | null;
  readonly events: ReadonlyArray<{
    readonly type: "CASE_STARTED" | "AI_RECORDED" | "BA_DECIDED" | "DRY_RUN_EXECUTED";
    readonly occurredAt: Date;
  }>;
}

export interface DecisionReviewView {
  readonly schemaVersion: "decision-review.v1";
  readonly case: {
    readonly id: string;
    readonly origin: DataOrigin;
    readonly observedAt: string;
    readonly createdAt: string;
  };
  readonly shop: {
    readonly id: string;
    readonly profileNo: string;
    readonly displayName: string;
    readonly currency: string;
    readonly dataOrigin: DataOrigin;
    readonly dataCoverage: DecisionDataCoverage;
    readonly lastSyncAt: string | null;
  };
  readonly coverageSnapshot?: DecisionCoverageSnapshot;
  readonly metrics: {
    readonly totalOrders: MetricValue<number>;
    readonly onHoldValue: MetricValue<{ readonly amount: string; readonly currency: string }>;
    readonly deliveredCount: MetricValue<number>;
    readonly deliveryRate: MetricValue<number>;
    readonly cancellationRate: MetricValue<number>;
    readonly refundRate: MetricValue<number>;
  };
  readonly rule: PersistedDecisionReview["rule"];
  readonly ai:
    | (Omit<Extract<NonNullable<PersistedDecisionReview["ai"]>, { status: "AVAILABLE" }>, "createdAt"> & {
        readonly createdAt: string;
      })
    | (Omit<Extract<NonNullable<PersistedDecisionReview["ai"]>, { status: "UNAVAILABLE" }>, "createdAt"> & {
        readonly createdAt: string;
      })
    | {
        readonly status: "UNAVAILABLE";
        readonly recommendation: null;
        readonly riskLevel: null;
        readonly confidence: null;
        readonly ruleOverride: null;
        readonly reasonCodes: null;
        readonly supportingFactors: null;
        readonly riskFactors: null;
        readonly whatWouldChangeDecision: null;
        readonly reason: null;
        readonly failureCode: "NOT_RECORDED";
        readonly humanReviewRequired: true;
      };
  readonly ba:
    | {
        readonly status: "DECIDED";
        readonly decision: BaDecision;
        readonly confidence: number | null;
        readonly reasonCodes: readonly BaDecisionReasonCode[];
        readonly plannedMethods: readonly BaPlannedMethod[] | null;
        readonly note: string | null;
        readonly decidedAt: string;
      }
    | { readonly status: "NOT_DECIDED" };
  readonly execution:
    | ({ readonly status: "SIMULATED"; readonly executedAt: string } & Omit<NonNullable<PersistedDecisionReview["execution"]>, "status" | "executedAt">)
    | { readonly status: "NOT_REQUESTED" };
  readonly events: ReadonlyArray<{ readonly type: PersistedDecisionReview["events"][number]["type"]; readonly occurredAt: string }>;
}

export interface DecisionHistoryPage {
  readonly schemaVersion: "decision-history.v1";
  readonly items: readonly DecisionReviewView[];
  readonly nextCursor: string | null;
}

function metric<T>(value: T | null, reason: string): MetricValue<T> {
  return value === null ? { status: "UNAVAILABLE", reason } : { status: "AVAILABLE", value };
}

export function toDecisionReviewView(review: PersistedDecisionReview): DecisionReviewView {
  const { metrics } = review;
  return {
    schemaVersion: "decision-review.v1",
    case: {
      ...review.case,
      observedAt: review.case.observedAt.toISOString(),
      createdAt: review.case.createdAt.toISOString(),
    },
    shop: {
      ...review.shop,
      lastSyncAt: review.shop.lastSyncAt?.toISOString() ?? null,
    },
    coverageSnapshot: review.coverageSnapshot,
    metrics: {
      totalOrders: { status: "AVAILABLE", value: metrics.totalOrders },
      onHoldValue: metric(
        metrics.onHoldValue === null
          ? null
          : { amount: metrics.onHoldValue, currency: metrics.currency },
        metrics.unavailableReasons.onHoldValue,
      ),
      deliveredCount: metric(metrics.deliveredCount, metrics.unavailableReasons.deliveredCount),
      deliveryRate: metric(metrics.deliveryRate, metrics.unavailableReasons.deliveryRate),
      cancellationRate: metric(metrics.cancellationRate, metrics.unavailableReasons.cancellationRate),
      refundRate: metric(metrics.refundRate, metrics.unavailableReasons.refundRate),
    },
    rule: review.rule,
    ai: review.ai === null
      ? {
          status: "UNAVAILABLE",
          recommendation: null,
          riskLevel: null,
          confidence: null,
          ruleOverride: null,
          reasonCodes: null,
          supportingFactors: null,
          riskFactors: null,
          whatWouldChangeDecision: null,
          reason: null,
          failureCode: "NOT_RECORDED",
          humanReviewRequired: true,
        }
      : { ...review.ai, createdAt: review.ai.createdAt.toISOString() },
    ba: review.ba === null
      ? { status: "NOT_DECIDED" }
      : {
          status: "DECIDED",
          decision: review.ba.decision,
          confidence: review.ba.confidence,
          reasonCodes: review.ba.reasonCodes,
          plannedMethods: review.ba.plannedMethods,
          note: review.ba.note,
          decidedAt: review.ba.decidedAt.toISOString(),
        },
    execution: review.execution === null
      ? { status: "NOT_REQUESTED" }
      : {
          requestedAction: review.execution.requestedAction,
          mode: review.execution.mode,
          status: review.execution.status,
          sellerCenterCalled: review.execution.sellerCenterCalled,
          executedAt: review.execution.executedAt.toISOString(),
        },
    events: review.events.map((event) => ({
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}

export function toDecisionHistoryPage(input: {
  readonly items: readonly PersistedDecisionReview[];
  readonly nextCursor: string | null;
}): DecisionHistoryPage {
  return {
    schemaVersion: "decision-history.v1",
    items: input.items.map(toDecisionReviewView),
    nextCursor: input.nextCursor,
  };
}
