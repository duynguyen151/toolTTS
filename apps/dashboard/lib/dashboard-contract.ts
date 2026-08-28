import type { FinanceHealthSnapshot } from "@shop-health/domain";

export type DashboardDataOrigin = "LIVE" | "DEMO_SANITIZED" | "UNAVAILABLE";
export type DashboardSyncState = "IDLE" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PAUSED_LAYOUT" | "DISABLED";
export type DashboardProfileState = "OPEN" | "CLOSED" | "ERROR" | "NOT_VERIFIED";

export interface DashboardShopSource {
  id: string;
  profileNo: string;
  displayName: string;
  currency: string;
  dataOrigin: DashboardDataOrigin;
  enabled: boolean;
  syncState: DashboardSyncState;
  pauseReason: string | null;
  lastOrdersSyncedAt: Date | null;
  lastFinanceSyncedAt: Date | null;
}

export interface DashboardSource {
  generatedAt: Date;
  shops: DashboardShopSource[];
  selected: {
    shopId: string;
    orders: {
      total: number | null;
      awaitingShipment: number | null;
      delivered: number | null;
      canceled: number | null;
    };
    finance: {
      officialOnHoldAmount: string | null;
      currency: string;
      capturedAt: Date | null;
    };
    deliveryRate:
      | { status: "AVAILABLE"; value: number; coverage: number }
      | { status: "UNAVAILABLE"; reason: string };
    grossValidSales:
      | { status: "AVAILABLE"; amount: string; currency: string }
      | { status: "UNAVAILABLE"; reason: string };
    dataCoverage: {
      status: "READY" | "PARTIAL" | "STALE" | "UNAVAILABLE";
      label: string;
      reason: string | null;
    };
    latestSync: {
      status: DashboardSyncState;
      startedAt: Date | null;
      sourceComplete: boolean | null;
      failureType?: string | null;
    };
    profileState: DashboardProfileState;
    rule: { status: "READY" | "NOT_VERIFIED" | "UNAVAILABLE"; detail?: string | null };
    ai: { status: "READY" | "UNAVAILABLE"; detail?: string | null };
    ba: { status: "REVIEWED" | "NOT_REVIEWED" | "UNAVAILABLE"; detail?: string | null };
    execution: { status: "EXECUTED" | "NOT_REQUESTED" | "UNAVAILABLE"; detail?: string | null };
    decisionCenter?: DashboardDecisionCenter;
  };
}

export interface DashboardDecisionCenter {
  status: "AVAILABLE" | "UNAVAILABLE";
  message: string;
  caseId: string | null;
  profileNo: string | null;
  reviewSnapshot?: DashboardReadSection & { owner: "IMMUTABLE_DECISION_CASE"; source: "DECISION_CASE" };
  effectivePolicy?: {
    owner: "IMMUTABLE_DECISION_CASE";
    policyVersion: string;
    effectiveAt: string;
    stopOnHoldValueAt: string;
    stopOnHoldValueAtSource: string;
    stopDeliveryRateBelow: string;
    stopDeliveryRateBelowSource: string;
  } & DashboardEvidenceMetadata;
  metrics: Array<DashboardValueWithEvidence>;
  comparisons: Array<DashboardComparisonWithEvidence>;
  trends: Array<DashboardTrendWithEvidence>;
  rule: DashboardRuleEvidence;
  ai: DashboardAiEvidence;
  ba: DashboardBaEvidence;
  execution: DashboardExecutionEvidence;
  reviewQueue: Array<{ profileNo: string; displayName: string; reasons: string[]; evidence: DashboardEvidenceMetadata }>;
  financeHealth: FinanceHealthSnapshot | null;
  coverage: {
    status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    source: string;
    provenWindow: string;
    sourceReconciled: string;
    freshness: string;
    financeCapturedAt: string | null;
    financeAgeMs: number | null;
    staleDisclosure: string | null;
    completeWithinWindow: string;
    lifetimeHistory: string;
    evidence: DashboardEvidenceMetadata;
  };
}

export interface DashboardEvidenceMetadata {
  owner: "CURRENT_OPERATIONAL_FACTS" | "IMMUTABLE_DECISION_CASE" | "AI_DECISION" | "BA_DECISION_REVISION" | "DRY_RUN_EXECUTION";
  source: string;
  observedAt: string;
}

export interface DashboardValueWithEvidence {
  label: string;
  value: string;
  detail: string;
  evidence: DashboardEvidenceMetadata;
}

export interface DashboardComparisonWithEvidence {
  metric: string;
  current: string;
  previous: string;
  absoluteDelta: string;
  relativeDelta: string;
  direction: string;
  evidence: DashboardEvidenceMetadata;
}

export interface DashboardTrendWithEvidence {
  signal: string;
  status: string;
  reason: string;
  evidence: DashboardEvidenceMetadata;
  comparisons: DashboardComparisonWithEvidence[];
}

export interface DashboardRuleConditionEvidence {
  state: "TRIGGERED" | "CLEAR" | "NOT_EVALUATED";
  source: string | null;
  observedValue: string;
  observedAt: string;
  ageMs: number | null;
  quality: string;
  threshold: string;
  evidence: DashboardEvidenceMetadata;
}

export interface DashboardRuleEvidence {
  result: string;
  policyVersion: string;
  expression: string;
  evaluatedAt: string;
  triggers: string[];
  checks: Array<{ metric: string; observed: string; threshold: string; operator: string; result: string; reason: string; evidence: DashboardEvidenceMetadata }>;
  conditions: {
    officialOnHold: DashboardRuleConditionEvidence;
    deliveryRate: DashboardRuleConditionEvidence;
  };
  evidence: DashboardEvidenceMetadata;
}

export interface DashboardAiEvidence {
  status: "AVAILABLE" | "UNAVAILABLE";
  recommendation: string;
  riskLevel: string;
  confidence: string;
  ruleAgreement: string;
  humanReviewRequired: string;
  reasonCodes: string[];
  supportingFactors: string[];
  riskFactors: string[];
  whatWouldChange: string[];
  reason: string;
  policyVersion: string;
  provider: string;
  requestedModel: string;
  reportedModel: string;
  actualModel: string;
  authMode: string;
  promptVersion: string;
  outputSchemaVersion: string;
  failureCode: string;
  evidence: DashboardEvidenceMetadata;
}

export interface DashboardBaEvidence {
  current: string;
  currentDetail: string;
  evidence: DashboardEvidenceMetadata;
  history: Array<{ decision: string; reason: string; actor: string; decidedAt: string; notes: string; evidence: DashboardEvidenceMetadata }>;
}

export interface DashboardExecutionEvidence {
  status: string;
  requestedAction: string;
  mode: string;
  sellerCenterCalled: string;
  executedAt: string;
  evidence: DashboardEvidenceMetadata;
}

export type DashboardTone = "neutral" | "primary" | "rose" | "amber" | "mint" | "lilac" | "sky" | "success" | "warning" | "danger";

export interface DashboardKpi {
  id: "on-hold" | "orders" | "awaiting" | "delivery" | "sales";
  label: string;
  value: string;
  detail: string;
  tone: DashboardTone;
}

export interface DashboardStatusView {
  label: string;
  detail: string;
  tone: DashboardTone;
}

export interface DashboardReadSection {
  owner: "CURRENT_OPERATIONAL_FACTS" | "IMMUTABLE_DECISION_CASE";
  source: "PERSISTED_SHOP_READ_MODEL" | "DECISION_CASE";
  businessTimeZone: "Asia/Bangkok";
  observedAt: string;
}

export interface DashboardPresentation {
  schemaVersion?: "dashboard-read.v2";
  generatedAt: string;
  dataOrigin: DashboardDataOrigin;
  currentOperational?: DashboardReadSection & { owner: "CURRENT_OPERATIONAL_FACTS"; source: "PERSISTED_SHOP_READ_MODEL" };
  shops: Array<{
    id: string;
    profileNo: string;
    displayName: string;
    selected: boolean;
  }>;
  selectedShop: {
    id: string;
    profileNo: string;
    displayName: string;
    currency: string;
  };
  kpis: DashboardKpi[];
  coverage: DashboardStatusView & { status: DashboardSource["selected"]["dataCoverage"]["status"] };
  freshness: DashboardStatusView & { ordersUpdatedAt: string; financeUpdatedAt: string };
  sync: DashboardStatusView & { status: DashboardSyncState; updatedAt: string };
  profile: DashboardStatusView & { status: DashboardProfileState };
  orderHealth: {
    total: string;
    awaiting: string;
    delivered: string;
    canceled: string;
  };
  decisionTrace: Array<{
    id: "rule" | "ai" | "ba" | "execution";
    label: string;
    value: string;
    detail: string;
    tone: DashboardTone;
  }>;
  decisionCenter?: DashboardDecisionCenter;
}
