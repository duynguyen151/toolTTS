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
  coverage: {
    status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    source: string;
    provenWindow: string;
    sourceReconciled: string;
    freshness: string;
    completeWithinWindow: string;
    lifetimeHistory: string;
  };
  metrics: Array<{ label: string; value: string; detail: string }>;
  comparisons: Array<{
    metric: string;
    current: string;
    previous: string;
    absoluteDelta: string;
    relativeDelta: string;
    direction: string;
  }>;
  trends: Array<{
    signal: string;
    status: string;
    reason: string;
    comparisons: Array<{
      metric: string;
      current: string;
      previous: string;
      absoluteDelta: string;
      relativeDelta: string;
      direction: string;
    }>;
  }>;
  rule: {
    result: string;
    policyVersion: string;
    expression: string;
    evaluatedAt: string;
    triggers: string[];
    checks: Array<{ metric: string; observed: string; threshold: string; operator: string; result: string; reason: string }>;
  };
  ai: {
    status: "AVAILABLE" | "UNAVAILABLE";
    recommendation: string;
    riskLevel: string;
    confidence: string;
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
  };
  ba: {
    current: string;
    currentDetail: string;
    history: Array<{ decision: string; reason: string; actor: string; decidedAt: string; notes: string }>;
  };
  execution: {
    status: string;
    requestedAction: string;
    mode: string;
    sellerCenterCalled: string;
    executedAt: string;
  };
  reviewQueue: Array<{ profileNo: string; displayName: string; reasons: string[] }>;
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

export interface DashboardPresentation {
  generatedAt: string;
  dataOrigin: DashboardDataOrigin;
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
