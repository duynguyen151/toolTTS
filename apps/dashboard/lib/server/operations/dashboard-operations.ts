import { AsyncLocalStorage } from "node:async_hooks";

import {
  runSequentialProfileQueue,
  type ProfileQueueResult,
  type ProfileVerificationResult,
} from "@shop-health/sync";
import {
  type AdsPowerProfileSummary,
} from "@shop-health/seller-center/adspower";
import type { SyncResult } from "@shop-health/sync";
import type { DecisionCoverageSnapshot, SourceHealth } from "@shop-health/domain";

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

export interface CotikSyncSummary {
  readonly status: "SUCCEEDED" | "SKIPPED";
  readonly skipReason?: string | null;
  readonly orders?: { status: "SUCCEEDED" | "SKIPPED"; rowsWritten?: number } | null;
  readonly finance?: { status: "SUCCEEDED" | "SKIPPED"; rowsWritten?: number } | null;
}

export interface DashboardOperationsAdapters {
  listAdsPowerProfiles(): Promise<readonly AdsPowerProfileSummary[]>;
  listShops(): Promise<readonly DashboardOperationsShop[]>;
  /** Canonical READY/ELIGIBLE profile-and-shop inventory for all sync gates. */
  listEligibleShops(): Promise<readonly DashboardOperationsShop[]>;
  /** Canonical enabled shops with active COTIK bindings for normal COTIK sync without AdsPower constraints. */
  listCotikEligibleShops?(): Promise<readonly DashboardOperationsShop[]>;
  ensureAdsPowerReady(): Promise<void>;
  openReady(profileId: string): Promise<void>;
  checkSellerCenterHealth(shop: DashboardOperationsShop): Promise<SourceHealth>;
  runSync(
    profileNo: string,
    kind: "orders" | "finance",
  ): Promise<Pick<SyncResult, "status" | "complete" | "sourceCoverage" | "financeProof">>;
  evaluateRisk(profileNo: string): Promise<DecisionCoverageSnapshot | undefined>;
  syncCotik?(profileNo: string): Promise<CotikSyncSummary>;
  /** Verifies one explicitly selected profile; never called for inventory listing. */
  verifyProfile?(profile: AdsPowerProfileSummary): Promise<Pick<ProfileVerificationResult, "verificationState"> & {
    readonly shop: DashboardOperationsShop | null;
  }>;
}

export type UpdateDataEmitter = (event: UpdateDataEvent) => void | Promise<void>;

export interface DashboardOperations {
  listProfiles(selectedProfileNo?: string): Promise<ProfileOperationsPresentation>;
  openProfile(profileNo: string): Promise<OpenProfileResult>;
  verifyProfile(profileNo: string): Promise<VerifyProfileResult>;
  updateData(profileNo: string, emit: UpdateDataEmitter): Promise<void>;
  syncSelected(profileNos: readonly string[]): Promise<ProfileQueueResult[]>;
  syncAllEligible(): Promise<ProfileQueueResult[]>;
}

export type VerifyProfileResult =
  | {
      readonly ok: true;
      readonly profileNo: string;
      readonly verificationState: ProfileVerificationResult["verificationState"];
      readonly shop: DashboardOperationsShop | null;
    }
  | {
      readonly ok: false;
      readonly profileNo: string;
      readonly verificationState: "UNVERIFIED";
      readonly shop: null;
      readonly error: OperationError;
    };

function error(code: OperationError["code"], message: string): OperationError {
  return { code, message };
}

function failureTypeOf(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("failureType" in cause)) return undefined;
  return typeof cause.failureType === "string" ? cause.failureType : undefined;
}

function profileOperationError(cause: unknown, wasOpen = false): OperationError {
  const failureType = failureTypeOf(cause);
  if (failureType === "ADSPOWER_NOT_RUNNING") {
    return error("ADSPOWER_NOT_RUNNING", "AdsPower is not running. Start the application and retry.");
  }
  if (failureType === "ADSPOWER_LAUNCH_TIMEOUT") {
    return error("ADSPOWER_LAUNCH_TIMEOUT", "AdsPower did not become ready before the launch deadline.");
  }
  if (failureType === "ADSPOWER_UNAVAILABLE") {
    return error("ADSPOWER_UNAVAILABLE", "Dashboard could not reach the AdsPower Local API. Retry the operation.");
  }
  if (failureType === "PROFILE_START_FAILED") {
    return error("PROFILE_OPEN_FAILED", "AdsPower could not open the selected profile.");
  }
  if (failureType === "PROXY_TIMEOUT") {
    return error("PROFILE_PROXY_TIMEOUT", "The selected profile proxy did not respond. Check the profile proxy and retry.");
  }
  if (failureType === "SOURCE_TIMEOUT" || failureType === "BROWSER_DISCONNECTED") {
    return wasOpen
      ? error("CDP_UNAVAILABLE", "The selected profile could not provide a browser connection.")
      : error("PROFILE_NOT_READY", "The selected profile did not become ready before the deadline.");
  }
  return error("UNEXPECTED_ERROR", "The profile operation could not be completed.");
}

function applicationReadinessError(cause: unknown): OperationError {
  const operationError = profileOperationError(cause);
  return operationError.code === "ADSPOWER_LAUNCH_TIMEOUT"
    ? error("ADSPOWER_LAUNCH_TIMEOUT", "AdsPower did not become ready before the launch deadline.")
    : operationError;
}

function syncFailure(cause: unknown): { state: UpdateDataState; error: OperationError; message: string } {
  const failureType = failureTypeOf(cause);
  if (failureType === "LOGIN_REQUIRED") {
    return {
      state: "HUMAN_ACTION_REQUIRED",
      error: error("LOGIN_REQUIRED", "Seller Center login is required."),
      message: "Open the profile and complete Seller Center login, then retry Update Data.",
    };
  }
  if (failureType === "CHALLENGE_REQUIRED") {
    return {
      state: "HUMAN_ACTION_REQUIRED",
      error: error("SECURITY_CHALLENGE_REQUIRED", "Seller Center requires a security check."),
      message: "Open the profile and complete the security check, then retry Update Data.",
    };
  }
  if (failureType === "PROXY_TIMEOUT") {
    return {
      state: "ERROR",
      error: error("PROFILE_PROXY_TIMEOUT", "The selected profile proxy did not respond. Check the profile proxy and retry."),
      message: "The selected profile proxy did not respond. Check the profile proxy and retry.",
    };
  }
  if (isSourceContractFailure(failureType)) {
    return {
      state: "ERROR",
      error: error("LAYOUT_CHANGED", "Seller Center layout verification failed."),
      message: "Collection paused because the Seller Center layout could not be verified.",
    };
  }
  return {
    state: "ERROR",
    error: error("SYNC_FAILED", "Seller Center synchronization failed."),
    message: "Update Data could not complete the current synchronization stage.",
  };
}

function syncResultIsComplete(
  kind: "orders" | "finance",
  result: Pick<SyncResult, "complete" | "sourceCoverage" | "financeProof">,
): boolean {
  if (!result.complete) return false;
  if (kind === "finance") return result.financeProof !== undefined;
  return result.sourceCoverage?.source === "SELLER_CENTER" &&
    result.sourceCoverage.window === "ROLLING_12_MONTHS" &&
    result.sourceCoverage.completeWithinSourceWindow === true &&
    result.sourceCoverage.lifetimeHistoryComplete === false;
}

function isSourceContractFailure(failureType: string | undefined): boolean {
  return failureType === "LAYOUT_CHANGED"
    || failureType === "ROUTE_CHANGED"
    || failureType === "ENDPOINT_NOT_OBSERVED"
    || failureType === "API_SCHEMA_CHANGED"
    || failureType === "API_REJECTED"
    || failureType === "INCOMPLETE_RESPONSE";
}

function decisionCoverageIsComplete(coverage: DecisionCoverageSnapshot | undefined): boolean {
  return coverage?.coverageState === "COMPLETE" &&
    coverage.source === "SELLER_CENTER" &&
    coverage.provenSourceWindow === "ROLLING_12_MONTHS" &&
    coverage.completeWithinSourceWindow === true &&
    coverage.lifetimeHistoryComplete === false &&
    coverage.ordersSourceComplete === true &&
    coverage.financeRequiredSourceComplete === true &&
    coverage.sourceReconciled === true &&
    coverage.latestSuccessfulSyncAt !== null &&
    coverage.financeCapturedAt !== null &&
    coverage.freshness === "FRESH";
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
  let syncRunning = false;
  const syncWaiters: (() => void)[] = [];
  const syncContext = new AsyncLocalStorage<{ adsPowerProfiles?: readonly AdsPowerProfileSummary[] }>();
  const serializeSync = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (syncContext.getStore() !== undefined) return operation();
    if (syncRunning) {
      await new Promise<void>((resolve) => { syncWaiters.push(resolve); });
    }
    syncRunning = true;
    try {
      return await operation();
    } finally {
      syncRunning = false;
      syncWaiters.shift()?.();
    }
  };
  const loadAdsPowerProfiles = async (): Promise<readonly AdsPowerProfileSummary[]> => {
    const context = syncContext.getStore();
    if (context?.adsPowerProfiles !== undefined) return context.adsPowerProfiles;
    const profiles = await adapters.listAdsPowerProfiles();
    if (context !== undefined) context.adsPowerProfiles = profiles;
    return profiles;
  };

  const operations: DashboardOperations = {
    async listProfiles(selectedProfileNo) {
      let adsPowerProfiles: readonly AdsPowerProfileSummary[];
      try {
        adsPowerProfiles = await loadAdsPowerProfiles();
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
        adsPowerProfiles = await loadAdsPowerProfiles();
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

    async verifyProfile(profileNo) {
      try {
        await adapters.ensureAdsPowerReady();
      } catch (cause) {
        return {
          ok: false,
          profileNo,
          verificationState: "UNVERIFIED",
          shop: null,
          error: applicationReadinessError(cause),
        };
      }
      let adsPowerProfiles: readonly AdsPowerProfileSummary[];
      try {
        adsPowerProfiles = await loadAdsPowerProfiles();
      } catch (cause) {
        return {
          ok: false,
          profileNo,
          verificationState: "UNVERIFIED",
          shop: null,
          error: profileOperationError(cause),
        };
      }
      const profile = adsPowerProfiles.find((candidate) => candidate.profileNo === profileNo);
      if (profile === undefined) {
        return {
          ok: false,
          profileNo,
          verificationState: "UNVERIFIED",
          shop: null,
          error: error("PROFILE_NOT_FOUND", "The selected AdsPower profile was not found."),
        };
      }
      if (adapters.verifyProfile === undefined) {
        return {
          ok: false,
          profileNo,
          verificationState: "UNVERIFIED",
          shop: null,
          error: error("UNEXPECTED_ERROR", "Profile verification is not available."),
        };
      }
      try {
        const result = await adapters.verifyProfile(profile);
        return { ok: true, profileNo, verificationState: result.verificationState, shop: result.shop };
      } catch (cause) {
        return {
          ok: false,
          profileNo,
          verificationState: "UNVERIFIED",
          shop: null,
          error: profileOperationError(cause),
        };
      }
    },

    async updateData(profileNo, emit) {
      return serializeSync(async () => {
      const completedKinds: ("orders" | "finance")[] = [];

      let adsPowerProfiles: readonly AdsPowerProfileSummary[];
      try {
        adsPowerProfiles = await loadAdsPowerProfiles();
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

      let eligibleShop: DashboardOperationsShop | undefined;
      try {
        eligibleShop = (await adapters.listEligibleShops())
          .find((shop) => shop.profileId === profile.profileId);
      } catch {
        const operationError = error("DATABASE_UNAVAILABLE", "Profile eligibility could not be verified.");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }
      if (eligibleShop === undefined) {
        const operationError = error("PROFILE_NOT_ELIGIBLE", "The selected profile is not READY and ELIGIBLE.");
        await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
        return;
      }
      linkedShop = eligibleShop;

      if (profile.state !== "OPEN") {
        await emit(updateEvent("OPENING_PROFILE", "Ensuring the selected AdsPower profile is ready.", completedKinds));
        try {
          await adapters.ensureAdsPowerReady();
        } catch (cause) {
          const operationError = applicationReadinessError(cause);
          await emit(updateEvent("ERROR", operationError.message, completedKinds, operationError));
          return;
        }
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
          : health.status === "PROXY_TIMEOUT"
            ? error("PROFILE_PROXY_TIMEOUT", "The selected profile proxy did not respond. Check the profile proxy and retry.")
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
          if (!syncResultIsComplete(kind, result)) {
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
      let decisionCoverage: DecisionCoverageSnapshot | undefined;
      try {
        decisionCoverage = await adapters.evaluateRisk(linkedShop.profileNo);
      } catch {
        const operationError = error("UNEXPECTED_ERROR", "Data synchronized, but risk reconciliation did not complete.");
        await emit(updateEvent("PARTIAL", operationError.message, completedKinds, operationError));
        return;
      }

      if (!decisionCoverageIsComplete(decisionCoverage)) {
        const operationError = error(
          "SYNC_PARTIAL",
          "Persisted decision coverage is incomplete or stale; Update Data cannot report success.",
        );
        await emit(updateEvent("PARTIAL", operationError.message, completedKinds, operationError));
        return;
      }

      await emit(updateEvent("SUCCESS", "Orders, finance, and deterministic risk data are up to date.", completedKinds));
      });
    },

    async syncSelected(profileNos) {
      return serializeSync(() => syncContext.run({}, () =>
        runSequentialProfileQueue(profileNos, async (profileNo) => {
          if (adapters.syncCotik !== undefined) {
            const cotikResult = await adapters.syncCotik(profileNo);
            if (cotikResult.status === "SKIPPED") {
              throw new Error(
                cotikResult.skipReason
                  ? `COTIK synchronization skipped: ${cotikResult.skipReason}`
                  : "COTIK synchronization skipped: no enabled binding or lock busy",
              );
            }
            if (cotikResult.status !== "SUCCEEDED") {
              throw new Error("COTIK synchronization failed");
            }
            return;
          }

          const profilePresentation = await operations.listProfiles(profileNo);
          const profile = profilePresentation.profiles.find((candidate) => candidate.profileNo === profileNo);
          if (profile === undefined) throw new Error("The selected AdsPower profile was not found.");
          if (profile.linkState === "UNLINKED") {
            const verification = await operations.verifyProfile(profileNo);
            if (!verification.ok) throw new Error(verification.error.message);
            if (verification.verificationState !== "READY" || verification.shop === null) {
              throw new Error(`Profile ${profileNo} requires attention: ${verification.verificationState}.`);
            }
          }
          let terminal: UpdateDataEvent | undefined;
          await operations.updateData(profileNo, (event) => {
            if (event.terminal) terminal = event;
          });
          if (terminal?.state !== "SUCCESS") {
            throw new Error(terminal?.error?.message ?? terminal?.message ?? "Profile synchronization failed");
          }
        }),
      ));
    },

    async syncAllEligible() {
      if (adapters.syncCotik !== undefined && adapters.listCotikEligibleShops !== undefined) {
        const profileNos = (await adapters.listCotikEligibleShops()).map((shop) => shop.profileNo);
        return operations.syncSelected(profileNos);
      }
      const profileNos = (await adapters.listEligibleShops()).map((shop) => shop.profileNo);
      return operations.syncSelected(profileNos);
    },
  };
  return operations;
}
