export type DashboardProfileState = "OPEN" | "CLOSED" | "ERROR";

export type DashboardProfileLinkState = "LINKED" | "UNLINKED" | "UNKNOWN";

export type UpdateDataState =
  | "READY"
  | "OPENING_PROFILE"
  | "CONNECTING"
  | "SYNCING_ORDERS"
  | "SYNCING_FINANCE"
  | "RECONCILING"
  | "SUCCESS"
  | "PARTIAL"
  | "ERROR"
  | "LOGIN_REQUIRED"
  | "SECURITY_CHECK_REQUIRED";

export type OperationErrorCode =
  | "ADSPOWER_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "LAYOUT_CHANGED"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_READY_TIMEOUT"
  | "PROFILE_START_FAILED"
  | "SHOP_NOT_LINKED"
  | "SYNC_FAILED"
  | "SYNC_SKIPPED"
  | "UNEXPECTED_ERROR";

export interface OperationError {
  readonly code: OperationErrorCode;
  readonly message: string;
}

export interface DashboardLinkedShop {
  readonly profileNo: string;
  readonly displayName: string;
}

export interface DashboardProfile {
  readonly profileNo: string;
  readonly state: DashboardProfileState;
  readonly linkState: DashboardProfileLinkState;
  readonly linkedShop: DashboardLinkedShop | null;
}

export interface ProfileOperationsPresentation {
  readonly status: "READY" | "ERROR";
  readonly selectedProfileNo: string | null;
  readonly profiles: readonly DashboardProfile[];
  readonly error: OperationError | null;
}

export type OpenProfileResult =
  | {
      readonly ok: true;
      readonly profileNo: string;
      readonly state: "OPEN";
    }
  | {
      readonly ok: false;
      readonly profileNo: string;
      readonly state: "ERROR";
      readonly error: OperationError;
    };

export interface UpdateDataEvent {
  readonly state: UpdateDataState;
  readonly message: string;
  readonly terminal: boolean;
  readonly completedKinds: readonly ("orders" | "finance")[];
  readonly error: OperationError | null;
}

const TERMINAL_UPDATE_STATES = new Set<UpdateDataState>([
  "SUCCESS",
  "PARTIAL",
  "ERROR",
  "LOGIN_REQUIRED",
  "SECURITY_CHECK_REQUIRED",
]);

export function isTerminalUpdateState(state: UpdateDataState): boolean {
  return TERMINAL_UPDATE_STATES.has(state);
}
