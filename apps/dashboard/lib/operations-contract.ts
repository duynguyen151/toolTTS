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
  | "SECURITY_CHECK_REQUIRED"
  | "HUMAN_ACTION_REQUIRED";

export const OPERATION_ERROR_CODES = [
  "ADSPOWER_UNAVAILABLE",
  "ADSPOWER_NOT_RUNNING",
  "ADSPOWER_LAUNCH_TIMEOUT",
  "DATABASE_UNAVAILABLE",
  "INVALID_REQUEST",
  "LAYOUT_CHANGED",
  "PROFILE_NOT_FOUND",
  "PROFILE_READY_TIMEOUT",
  "PROFILE_START_FAILED",
  "PROFILE_OPEN_FAILED",
  "PROFILE_NOT_READY",
  "CDP_UNAVAILABLE",
  "SHOP_NOT_LINKED",
  "LOGIN_REQUIRED",
  "SECURITY_CHALLENGE_REQUIRED",
  "SYNC_PARTIAL",
  "SYNC_FAILED",
  "SYNC_SKIPPED",
  "UNEXPECTED_ERROR",
] as const;

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];

export function isOperationErrorCode(value: unknown): value is OperationErrorCode {
  return typeof value === "string" && OPERATION_ERROR_CODES.includes(value as OperationErrorCode);
}

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
  "HUMAN_ACTION_REQUIRED",
]);

export function isTerminalUpdateState(state: UpdateDataState): boolean {
  return TERMINAL_UPDATE_STATES.has(state);
}
