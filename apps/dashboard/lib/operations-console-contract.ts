import type {
  AdsPowerProfileState,
  AdsPowerProfileSummary,
  AdsPowerProfileTag,
} from "@shop-health/seller-center/adspower";

export type { AdsPowerProfileTag };
import type {
  DashboardDataOrigin,
  DashboardDecisionCenter,
  DashboardSyncState,
} from "./dashboard-contract.js";
import type { OperationError } from "./operations-contract.js";

export type ShopVerificationState =
  | "UNVERIFIED"
  | "LOGIN_REQUIRED"
  | "HUMAN_ACTION_REQUIRED"
  | "NOT_TIKTOK_SELLER"
  | "UNSUPPORTED_REGION"
  | "SHOP_SELECTION_REQUIRED"
  | "SHOP_IDENTITY_CHANGED"
  | "READY";

export type ShopEligibilityState = "ELIGIBLE" | "INELIGIBLE" | "UNSUPPORTED_REGION";

export type ShopDataCoverageState = "READY" | "PARTIAL" | "STALE" | "UNAVAILABLE";

export interface ConsoleShopSummary {
  readonly id: string;
  readonly profileId: string;
  readonly profileNo: string;
  readonly displayName: string;
  readonly region: string;
  readonly locale: string;
  readonly currency: string;
  readonly enabled: boolean;
  readonly syncState: DashboardSyncState;
  readonly pauseReason: string | null;
  readonly verificationState: ShopVerificationState;
  readonly eligibilityStatus: ShopEligibilityState;
  readonly verifiedTiktokShopId: string | null;
  readonly verifiedShopDisplayName: string | null;
  readonly lastVerifiedAt: string | null;
  readonly lastOrdersSyncedAt: string | null;
  readonly lastFinanceSyncedAt: string | null;
  readonly dataOrigin: DashboardDataOrigin;
  readonly totalOrders: number | null;
  readonly onHoldAmount: string | null;
  readonly deliveryRate: number | null;
  readonly latestRecommendation: string | null;
  readonly latestAiRecommendation?: string | null | undefined;
  readonly latestBaDecision: string | null;
  readonly activeDecisionCaseId: string | null;
  readonly adsPowerState?: AdsPowerProfileState | undefined;
  readonly groupName?: string | null | undefined;
  readonly tags?: readonly AdsPowerProfileTag[] | undefined;
  readonly cotikBinding?: {
    readonly enabled: boolean;
    readonly cotikShopId: string;
    readonly lastOrdersSyncedAt?: string | null | undefined;
    readonly lastFinanceSyncedAt?: string | null | undefined;
  } | null | undefined;
  readonly compositeHealth?: "HEALTHY" | "AT_RISK" | "DATA_BLOCKED" | undefined;
}

export interface ConsoleShopsFilter {
  readonly query?: string | undefined;
  readonly syncState?: string | undefined;
  readonly verificationState?: string | undefined;
  readonly recommendation?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly sortBy?: "profileNo" | "displayName" | "totalOrders" | "lastSyncedAt" | "onHoldAmount" | undefined;
  readonly sortOrder?: "asc" | "desc" | undefined;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly totalItems: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface ConsoleShopDetail {
  readonly shop: ConsoleShopSummary;
  readonly overview: {
    readonly orderHealth: {
      readonly total: string;
      readonly pending?: string;
      readonly awaiting: string;
      readonly inTransit?: string;
      readonly delivered: string;
      readonly canceled: string;
      readonly other?: string;
    };
    readonly finance: {
      /** Raw numeric string (e.g. "102.60") or null. NOT pre-formatted. */
      readonly onHoldAmount: string | null;
      readonly currency: string;
      readonly capturedAt: string | null;
    };
    readonly kpis: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly detail: string;
      readonly tone: "good" | "warning" | "danger" | "neutral";
    }>;
  };
  readonly dataTab: {
    readonly dataCoverage: ShopDataCoverageState;
    readonly coverageReason: string | null;
    readonly provenWindow: string;
    readonly sourceReconciled: string;
    readonly freshness: string;
    readonly lifetimeHistory: string;
    readonly ordersCount: number | null;
    readonly financeCapturedAt: string | null;
    readonly rawSummaryNote: string;
  };
  readonly tagsTab: {
    readonly profileTags: readonly AdsPowerProfileTag[];
    readonly groupName: string | null;
    readonly region: string;
    readonly locale: string;
    readonly currency: string;
    readonly dataNote: string;
  };
  readonly syncTab: {
    readonly syncRuns: ReadonlyArray<{
      readonly id: string;
      readonly mode: string;
      readonly status: string;
      readonly startedAt: string;
      readonly finishedAt: string | null;
      readonly rowsRead: number;
      readonly rowsWritten: number;
      readonly failureType: string | null;
      readonly failureMessage: string | null;
    }>;
    readonly lastOrdersSyncedAt: string | null;
    readonly lastFinanceSyncedAt: string | null;
    readonly syncState: DashboardSyncState;
    readonly pauseReason: string | null;
  };
  readonly statsTab: {
    readonly metrics: ReadonlyArray<{
      readonly label: string;
      readonly value: string;
      readonly detail: string;
    }>;
    readonly comparisons: ReadonlyArray<{
      readonly metric: string;
      readonly current: string;
      readonly previous: string;
      readonly absoluteDelta: string;
      readonly relativeDelta: string;
      readonly direction: string;
    }>;
    readonly trends: ReadonlyArray<{
      readonly signal: string;
      readonly status: string;
      readonly reason: string;
    }>;
  };
  readonly baTab: {
    readonly activeCaseId: string | null;
    readonly currentDecision: string;
    readonly currentDetail: string;
    readonly ruleResult: string;
    readonly aiRecommendation: string;
    readonly aiConfidence: string;
    readonly aiRiskLevel: string;
    readonly aiSummary: string;
    readonly aiReasonCodes: readonly string[];
    readonly history: ReadonlyArray<{
      readonly id: string;
      readonly decision: string;
      readonly reasonCode: string;
      readonly reasonCodes: readonly string[];
      readonly actor: string;
      readonly notes: string | null;
      readonly decidedAt: string;
    }>;
  };
  readonly auditTab: {
    readonly auditLogs: ReadonlyArray<{
      readonly id: string;
      readonly type: "DECISION_CASE" | "BA_SUBMISSION" | "SYNC_RUN" | "PROFILE_VERIFICATION";
      readonly timestamp: string;
      readonly actor: string;
      readonly summary: string;
      readonly payload: Record<string, unknown>;
    }>;
    readonly schemaNotice: string;
  };
  readonly decisionCenter: DashboardDecisionCenter;
}

export type ConsoleTabKey =
  | "overview"
  | "data"
  | "tags"
  | "sync"
  | "stats"
  | "ba"
  | "audit";

export interface UnifiedApiResponse<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: OperationError;
}
