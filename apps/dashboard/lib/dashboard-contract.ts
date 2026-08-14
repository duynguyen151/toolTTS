export type DashboardDataOrigin = "LIVE" | "DEMO_SANITIZED";
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
      total: number;
      awaitingShipment: number;
      delivered: number;
      canceled: number;
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
      failureType?: string | null;
    };
    profileState: DashboardProfileState;
    rule: { status: "READY" | "NOT_VERIFIED" | "UNAVAILABLE" };
    ai: { status: "READY" | "UNAVAILABLE"; detail?: string | null };
    ba: { status: "REVIEWED" | "NOT_REVIEWED" | "UNAVAILABLE" };
    execution: { status: "EXECUTED" | "NOT_REQUESTED" | "UNAVAILABLE" };
  };
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
}
