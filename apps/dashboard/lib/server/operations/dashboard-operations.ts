import {
  type AdsPowerProfileSummary,
} from "@shop-health/seller-center/adspower";
import { SellerCenterError } from "@shop-health/seller-center/errors";
import type { SyncResult } from "@shop-health/sync";
import type { SourceHealth } from "@shop-health/domain";

import {
  isTerminalUpdateState,
  type DashboardProfile,
  type OpenProfileResult,
  type OperationError,
  type ProfileOperationsPresentation,
  type UpdateDataEvent,
  type UpdateDataState,
} from "../../operations-contract.js";

export interface DashboardOperationsShop {
  readonly id: string;
  readonly profileId: string;
  readonly profileNo: string;
  readonly displayName: string;
}

export interface DashboardOperationsAdapters {
  listAdsPowerProfiles(): Promise<readonly AdsPowerProfileSummary[]>;
  listShops(): Promise<readonly DashboardOperationsShop[]>;
  ensureAdsPowerReady(): Promise<void>;
  openReady(profileId: string): Promise<void>;
  checkSellerCenterHealth(shop: DashboardOperationsShop): Promise<SourceHealth>;
  runSync(
    profileNo: string,
    kind: "orders" | "finance",
  ): Promise<Pick<SyncResult, "status" | "complete" | "sourceCoverage">>;
  evaluateRisk(profileNo: string): Promise<void>;
}

export type UpdateDataEmitter = (event: UpdateDataEvent) => void | Promise<void>;

export interface DashboardOperations {
  listProfiles(selectedProfileNo?: string): Promise<ProfileOperationsPresentation>;
  openProfile(profileNo: string): Promise<OpenProfileResult>;
  updateData(profileNo: string, emit: UpdateDataEmitter): Promise<void>;
}

function error(code: OperationError["code"], message: string): OperationError {
  return { code, message };
}

function profileOperationError(cause: unknown, wasOpen = false): OperationError {
  if (typeof cause === "object" && cause !== null && "failureType" in cause) {
    const failureType = (cause as { failureType?: unknown }).failureType;
    if (failureType === "ADSPOWER_NOT_RUNNING") {
      return error("ADSPOWER_NOT_RUNNING", "AdsPower is not running. Start the application and retry.");
    }
    if (failureType === "ADSPOWER_LAUNCH_TIMEOUT") {
      return error("ADSPOWER_LAUNCH_TIMEOUT", "AdsPower did not become ready before the launch deadline.");
    }
  }
  if (cause instanceof SellerCenterError) {
    if (cause.failureType === "ADSPOWER_UNAVAILABLE") {
      return error("ADSPOWER_NOT_RUNNING", "AdsPower is not running. Start the application and retry.");
    }
    if (cause.failureType === "PROFILE_START_FAILED") {
      return error("PROFILE_OPEN_FAILED", "AdsPower could not open the selected profile.");
    }
    if (cause.failureType === "SOURCE_TIMEOUT") {
      return wasOpen
        ? error("CDP_UNAVAILABLE", "The selected profile could not provide a browser connection.")
        : error("PROFILE_NOT_READY", "The selected profile did not become ready before the deadline.");
    }
    if (cause.failureType === "BROWSER_DISCONNECTED") {
      return wasOpen
        ? error("CDP_UNAVAILABLE", "The selected profile could not provide a browser connection.")
        : error("PROFILE_NOT_READY", "The selected profile did not become ready before the deadline.");
    }
  }
  return error("UNEXPECTED_ERROR", "The profile operation could not be completed.");
}

function applicationReadinessError(cause: unknown): OperationError {
  return profileOperationError(cause).code === "ADSPOWER_LAUNCH_TIMEOUT"
    ? error("ADSPOWER_LAUNCH_TIMEOUT", "AdsPower did not become ready before the launch deadline.")
    : error("ADSPOWER_NOT_RUNNING", "AdsPower is not available from the dashboard.");
}

function syncFailure(cause: unknown): { state: UpdateDataState; error: OperationError; message: string } {
  if (cause instanceof SellerCenterError) {
    if (cause.failureType === "LOGIN_REQUIRED") {
      return {
        state: "HUMAN_ACTION_REQUIRED",
        error: error("LOGIN_REQUIRED", "Seller Center login is required."),
        message: "Open the profile and complete Seller Center login, then retry Update Data.",
      };
    }
    if (cause.failureType === "CHALLENGE_REQUIRED") {
      return {
        state: "HUMAN_ACTION_REQUIRED",
        error: error("SECURITY_CHALLENGE_REQUIRED", "Seller Center requires a security check."),
        message: "Open the profile and complete the security check, then retry Update Data.",
      };
    }
    if (cause.failureType === "LAYOUT_CHANGED") {
      return {
        state: "ERROR",
        error: error("LAYOUT_CHANGED", "Seller Center layout verification failed."),
        message: "Collection paused because the Seller Center layout could not be verified.",
      };
    }
  }
  return {
    state: "ERROR",
    error: error("SYNC_FAILED", "Seller Center synchronization failed."),
    message: "Update Data could not complete the current synchronization stage.",
  };
}

function syncResultIsComplete(
  result: Pick<SyncResult, "complete" | "sourceCoverage">,
): boolean {
  return result.complete && result.sourceCoverage?.completeWithinWindow !== false;
}

function updateEvent(
  state: UpdateDataState,
  message: string,
  completedKinds: readonly ("orders" | "finance")[],
  operationError: OperationError | null = null,
): UpdateDataEvent {
  return {
    state,
    message,
    terminal: isTerminalUpdateState(state),
    completedKinds: [...completedKinds],
    error: operationError,
  };
}

function presentProfiles(
  adsPowerProfiles: readonly AdsPowerProfileSummary[],
  shops: readonly DashboardOperationsShop[] | null,
): DashboardProfile[] {
  const shopsByProfileId = new Map(shops?.map((shop) => [shop.profileId, shop]));
  return adsPowerProfiles.map((profile) => {
    const linkedShop = shopsByProfileId.get(profile.profileId);
    return {
      profileNo: profile.profileNo,
      state: profile.state,
      linkState: shops === null ? "UNKNOWN" : linkedShop === undefined ? "UNLINKED" : "LINKED",
      linkedShop: linkedShop === undefined
        ? null
        : { profileNo: linkedShop.profileNo, displayName: linkedShop.displayName },
    };
  });
}

export function createDashboardOperations(adapters: DashboardOperationsAdapters): DashboardOperations {
  return {
    async listProfiles(selectedProfileNo) {
      let adsPowerProfiles: readonly AdsPowerProfileSummary[];
      try {
        adsPowerProfiles = await adapters.listAdsPowerProfiles();
      } catch (cause) {
        return {
          status: "ERROR",
          selectedProfileNo: null,
          profiles: [],
          error: profileOperationError(cause),
        };
      }

      let shops: readonly DashboardOperationsShop[] | null;
      let presentationError: OperationError | null = null;
      try {
        shops = await adapters.listShops();
      } catch {
        shops = null;
        presentationError = error("DATABASE_UNAVAILABLE", "Tool_TTS shop links are temporarily unavailable.");
      }

      const presentedProfiles = presentProfiles(adsPowerProfiles, shops);
      const requestedSelection = presentedProfiles.find((profile) => profile.profileNo === selectedProfileNo);
      const defaultSelection = presentedProfiles.find((profile) => profile.linkState === "LINKED") ?? presentedProfiles[0];
      return {
        status: "READY",
        selectedProfileNo: requestedSelection?.profileNo ?? defaultSelection?.profileNo ?? null,
        profiles: presentedProfiles,
        error: presentationError,
      };
    },

    async openProfile(profileNo) {
      try {
        await adapters.ensureAdsPowerReady();
      } catch (cause) {
        return { ok: false, profileNo, state: "ERROR", error: applicationReadinessError(cause) };
      }
      let adsPowerProfiles: readonly AdsPowerProfileSummary[];
      try {
        adsPowerProfiles = await adapters.listAdsPowerProfiles();
      } catch (cause) {
        return { ok: false, profileNo, state: "ERROR", error: profileOperationError(cause) };
      }
      const profile = adsPowerProfiles.find((candidate) => candidate.profileNo === profileNo);
      if (profile === undefined) {
        return {
          ok: false,
          profileNo,
          state: "ERROR",
          error: error("PROFILE_NOT_FOUND", "The selected AdsPower profile was not found."),
        };
      }
      try {
        await adapters.openReady(profile.profileId);
        return { ok: true, profileNo, state: "OPEN" };
      } catch (cause) {
        return {
          ok: false,
          profileNo,
          state: "ERROR",
          error: profileOperationError(cause, profile.state === "OPEN"),
        };
      }
    },

    async updateData(profileNo, emit) {
      const completedKinds: ("orders" | "finance")[] = [];

      try {
        await adapters.ensureAdsPowerReady();
      } catch (cause) {
        const operationError = applicationReadinessError(cause);
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }

      let adsPowerProfiles: readonly AdsPowerProfileSummary[];
      try {
        adsPowerProfiles = await adapters.listAdsPowerProfiles();
      } catch (cause) {
        const operationError = profileOperationError(cause);
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }
      const profile = adsPowerProfiles.find((candidate) => candidate.profileNo === profileNo);
      if (profile === undefined) {
        const operationError = error("PROFILE_NOT_FOUND", "The selected AdsPower profile was not found.");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }

      let linkedShop: DashboardOperationsShop | undefined;
      try {
        linkedShop = (await adapters.listShops()).find((shop) => shop.profileId === profile.profileId);
      } catch {
        const operationError = error("DATABASE_UNAVAILABLE", "Tool_TTS shop links are temporarily unavailable.");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }
      if (linkedShop === undefined) {
        const operationError = error("SHOP_NOT_LINKED", "Update Data requires a linked Tool_TTS shop.");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }

      if (profile.state !== "OPEN") {
        await emit(updateEvent("OPENING_PROFILE", "Ensuring the selected AdsPower profile is ready.", completedKinds));
      }
      try {
        await adapters.openReady(profile.profileId);
      } catch (cause) {
        const operationError = profileOperationError(cause, profile.state === "OPEN");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }

      await emit(updateEvent("CONNECTING", "Connecting to Seller Center through the ready profile.", completedKinds));
      let health: SourceHealth;
      try {
        health = await adapters.checkSellerCenterHealth(linkedShop);
      } catch {
        const operationError = error("CDP_UNAVAILABLE", "Seller Center could not be reached through the ready profile.");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }
      if (health.status === "LOGIN_REQUIRED") {
        const operationError = error("LOGIN_REQUIRED", "Seller Center login is required.");
        await emit(updateEvent(
          "HUMAN_ACTION_REQUIRED",
          "Open the profile and complete Seller Center login, then retry Update Data.",
          completedKinds,
          operationError,
        ));
        return;
      }
      if (health.status === "CHALLENGE_REQUIRED") {
        const operationError = error("SECURITY_CHALLENGE_REQUIRED", "Seller Center requires a security check.");
        await emit(updateEvent(
          "HUMAN_ACTION_REQUIRED",
          "Open the profile and complete the security check, then retry Update Data.",
          completedKinds,
          operationError,
        ));
        return;
      }
      if (health.status !== "HEALTHY") {
        const operationError = health.status === "LAYOUT_CHANGED"
          ? error("LAYOUT_CHANGED", "Seller Center layout verification failed.")
          : error("CDP_UNAVAILABLE", "Seller Center could not be verified through the ready profile.");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }
      for (const kind of ["orders", "finance"] as const) {
        await emit(updateEvent(
          kind === "orders" ? "SYNCING_ORDERS" : "SYNCING_FINANCE",
          kind === "orders" ? "Synchronizing persisted order data." : "Synchronizing Finance On Hold data.",
          completedKinds,
        ));
        try {
          const result = await adapters.runSync(linkedShop.profileNo, kind);
          if (result.status === "SKIPPED") {
            const operationError = error("SYNC_SKIPPED", "Another synchronization already owns this shop lock.");
            await emit(updateEvent(
              completedKinds.length > 0 ? "PARTIAL" : "ERROR",
              operationError.message,
              completedKinds,
              operationError,
            ));
            return;
          }
          if (!syncResultIsComplete(result)) {
            const operationError = error("SYNC_PARTIAL", "Synchronization completed with incomplete source coverage; risk reconciliation was skipped.");
            await emit(updateEvent(
              "PARTIAL",
              operationError.message,
              completedKinds,
              operationError,
            ));
            return;
          }
          completedKinds.push(kind);
        } catch (cause) {
          const failure = syncFailure(cause);
          const state = failure.state === "ERROR" && completedKinds.length > 0 ? "PARTIAL" : failure.state;
          await emit(updateEvent(state, failure.message, completedKinds, failure.error));
          return;
        }
      }

      await emit(updateEvent("RECONCILING", "Re-evaluating deterministic risk from persisted data.", completedKinds));
      try {
        await adapters.evaluateRisk(linkedShop.profileNo);
      } catch {
        const operationError = error("UNEXPECTED_ERROR", "Data synchronized, but risk reconciliation did not complete.");
        await emit(updateEvent("PARTIAL", operationError.message, completedKinds, operationError));
        return;
      }

      await emit(updateEvent("SUCCESS", "Orders, finance, and deterministic risk data are up to date.", completedKinds));
    },
  };
}
