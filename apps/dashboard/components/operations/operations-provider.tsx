"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  DashboardProfile,
  OpenProfileResult,
  ProfileOperationsPresentation,
  UpdateDataEvent,
  UpdateDataState,
} from "../../lib/operations-contract.js";
import type { DashboardDataOrigin } from "../../lib/dashboard-contract.js";
import { isTerminalUpdateState } from "../../lib/operations-contract.js";
import { readUpdateDataEvents } from "../../lib/read-update-stream.js";
import {
  appendOperationLog,
  createOperationLogEntry,
  type OperationLogEntry,
} from "./operation-log.js";

type OperationsContextValue = {
  presentationStatus: ProfileOperationsPresentation["status"];
  liveOperationsEnabled: boolean;
  profiles: readonly DashboardProfile[];
  selectedProfile: DashboardProfile | null;
  selectedProfileNo: string | null;
  profileSelectionAligned: boolean;
  operationState: UpdateDataState;
  operationMessage: string;
  operationLogs: readonly OperationLogEntry[];
  logOpen: boolean;
  isBusy: boolean;
  clearOperationLogs(): void;
  toggleLog(): void;
  selectProfile(profileNo: string): void;
  openProfile(): Promise<void>;
  verifyProfile(): Promise<void>;
  updateData(): Promise<void>;
  syncSelected(): Promise<void>;
  syncAllEligible(): Promise<void>;
};

const OperationsContext = createContext<OperationsContextValue | null>(null);

type PersistedDashboardShop = {
  readonly profileNo: string;
  readonly displayName: string;
  readonly dataOrigin: DashboardDataOrigin;
};

export function dashboardShopHref(profileNo: string): string {
  return `/dashboard?shop=${encodeURIComponent(profileNo)}`;
}

export function dashboardProfileHref(profileNo: string): string {
  return `/dashboard?profile=${encodeURIComponent(profileNo)}`;
}

export function isProfileSelectionAligned(
  renderedShopProfileNo: string | undefined,
  selectedProfileNo: string | null,
): boolean {
  // No persisted shop is expected before the selected profile has completed VERIFY.
  return renderedShopProfileNo === undefined || renderedShopProfileNo === "UNAVAILABLE" || renderedShopProfileNo === selectedProfileNo;
}

function failedMessage(status: number): string {
  return status === 403
    ? "This operation is available only from the local dashboard."
    : "The operation could not be completed.";
}

export function preflightUpdateState(
  profileState: DashboardProfile["state"] | undefined,
): "OPENING_PROFILE" | "CONNECTING" {
  return profileState === "OPEN" ? "CONNECTING" : "OPENING_PROFILE";
}

export function OperationsProvider({
  children,
  initialPresentation,
  preferredProfileNo,
  persistedShop,
}: {
  children: ReactNode;
  initialPresentation: ProfileOperationsPresentation;
  preferredProfileNo?: string;
  persistedShop?: PersistedDashboardShop;
}) {
  const router = useRouter();
  const liveOperationsEnabled = persistedShop === undefined || persistedShop.dataOrigin !== "DEMO_SANITIZED";
  const initialProfiles = !liveOperationsEnabled
    ? []
    : initialPresentation.status === "ERROR" && initialPresentation.profiles.length === 0 && persistedShop?.dataOrigin === "LIVE"
      ? [{
          profileNo: persistedShop.profileNo,
          state: "ERROR" as const,
          linkState: "LINKED" as const,
          linkedShop: { profileNo: persistedShop.profileNo, displayName: persistedShop.displayName },
        }]
      : initialPresentation.profiles;
  const [profiles, setProfiles] = useState(initialProfiles);
  const [selectedProfileNo] = useState(
    initialProfiles.some((profile) => profile.profileNo === (preferredProfileNo ?? persistedShop?.profileNo))
      ? preferredProfileNo ?? persistedShop?.profileNo ?? null
      : persistedShop === undefined ? initialPresentation.selectedProfileNo : null,
  );
  const renderedShopProfileNo = persistedShop?.profileNo;
  const profileSelectionAligned = isProfileSelectionAligned(renderedShopProfileNo, selectedProfileNo);
  const [operationState, setOperationState] = useState<UpdateDataState>("READY");
  const [operationMessage, setOperationMessage] = useState(
    !liveOperationsEnabled
      ? "Live operations are disabled for sanitized demo data."
      : initialPresentation.error?.message ?? "Ready for operator action",
  );
  const [operationLogs, setOperationLogs] = useState<readonly OperationLogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);

  const reportOperation = useCallback((state: UpdateDataState, message: string): void => {
    setOperationState(state);
    setOperationMessage(message);
    setOperationLogs((current) => appendOperationLog(current, createOperationLogEntry({
      state,
      message,
      timestamp: new Date().toISOString(),
    })));
  }, []);
  const clearOperationLogs = useCallback(() => setOperationLogs([]), []);
  const toggleLog = useCallback(() => setLogOpen((open) => !open), []);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.profileNo === selectedProfileNo) ?? null,
    [profiles, selectedProfileNo],
  );
  const isBusy = operationState !== "READY" && !isTerminalUpdateState(operationState);

  const selectProfile = useCallback((profileNo: string) => {
    if (!liveOperationsEnabled || !profiles.some((profile) => profile.profileNo === profileNo)) return;
    reportOperation("CONNECTING", `Loading dashboard for profile ${profileNo}`);
    router.push(dashboardProfileHref(profileNo));
  }, [liveOperationsEnabled, profiles, reportOperation, router]);

  const openProfile = useCallback(async () => {
    if (!liveOperationsEnabled || !profileSelectionAligned || selectedProfileNo === null) return;
    reportOperation("OPENING_PROFILE", `Opening AdsPower profile ${selectedProfileNo}`);

    try {
      const response = await fetch("/api/profiles/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileNo: selectedProfileNo }),
      });
      const result = await response.json() as OpenProfileResult;

      if (!response.ok || !result.ok) {
        reportOperation("ERROR", result.ok ? failedMessage(response.status) : result.error.message);
        return;
      }

      setProfiles((current) => current.map((profile) => profile.profileNo === result.profileNo
        ? { ...profile, state: "OPEN" }
        : profile));
      reportOperation("READY", `Profile ${result.profileNo} is ready`);
    } catch {
      reportOperation("ERROR", "AdsPower could not be reached from the dashboard.");
    }
  }, [liveOperationsEnabled, profileSelectionAligned, reportOperation, selectedProfileNo]);

  const updateData = useCallback(async () => {
    if (!liveOperationsEnabled || !profileSelectionAligned || selectedProfileNo === null) return;
    const initialState = preflightUpdateState(selectedProfile?.state);
    reportOperation(initialState, initialState === "OPENING_PROFILE"
      ? `Opening AdsPower profile ${selectedProfileNo}`
      : `Connecting to profile ${selectedProfileNo}`);

    try {
      const response = await fetch("/api/update-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileNo: selectedProfileNo }),
      });

      if (!response.ok || response.body === null) {
        reportOperation("ERROR", failedMessage(response.status));
        return;
      }

      for await (const event of readUpdateDataEvents(response.body)) {
        reportOperation(event.state, event.message);
        if (event.state === "CONNECTING") {
          setProfiles((current) => current.map((profile) => profile.profileNo === selectedProfileNo
            ? { ...profile, state: "OPEN" }
            : profile));
        }
        if (event.terminal && (event.state === "SUCCESS" || event.state === "PARTIAL")) {
          router.refresh();
        }
      }
    } catch {
      reportOperation("ERROR", "The update stream ended unexpectedly.");
    }
  }, [liveOperationsEnabled, profileSelectionAligned, reportOperation, router, selectedProfile, selectedProfileNo]);

  const verifyProfile = useCallback(async () => {
    if (!liveOperationsEnabled || !profileSelectionAligned || selectedProfileNo === null) return;
    reportOperation("CONNECTING", `Verifying profile ${selectedProfileNo}.`);
    try {
      const response = await fetch("/api/profiles/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileNo: selectedProfileNo }) });
      const result = await response.json() as { ok?: boolean; verificationState?: string; error?: { message: string } };
      const ready = result.ok === true && result.verificationState === "READY";
      reportOperation(ready ? "READY" : "ERROR", ready ? `Profile ${selectedProfileNo} is READY and eligible.` : result.ok ? `Profile ${selectedProfileNo} requires attention: ${result.verificationState}.` : result.error?.message ?? failedMessage(response.status));
      if (ready) router.push(dashboardShopHref(selectedProfileNo));
    } catch { reportOperation("ERROR", "Profile verification could not be completed."); }
  }, [liveOperationsEnabled, profileSelectionAligned, reportOperation, router, selectedProfileNo]);

  const syncAllEligible = useCallback(async () => {
    if (!liveOperationsEnabled) return;
    reportOperation("CONNECTING", "Synchronizing all eligible shops via COTIK API.");
    try {
      const response = await fetch("/api/sync/all-eligible", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileNo: "all" }) });
      const result = await response.json() as readonly { status: string }[];
      const failed = result.filter((item) => item.status === "FAILED").length;
      reportOperation(failed === 0 ? "READY" : "PARTIAL", `COTIK sync completed: ${result.length - failed} succeeded, ${failed} failed.`);
      router.refresh();
    } catch { reportOperation("ERROR", "COTIK sync could not be completed."); }
  }, [liveOperationsEnabled, reportOperation, router]);

  const syncSelected = useCallback(async () => {
    if (!liveOperationsEnabled || !profileSelectionAligned || selectedProfileNo === null) return;
    reportOperation("CONNECTING", `Synchronizing profile ${selectedProfileNo} via COTIK API.`);
    try {
      const response = await fetch("/api/sync/selected", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileNo: selectedProfileNo }) });
      const result = await response.json() as readonly { status: string; error: string | null }[];
      const failed = result.filter((item) => item.status === "FAILED").length;
      reportOperation(failed === 0 ? "READY" : "ERROR", failed === 0 ? `Profile ${selectedProfileNo} COTIK sync completed.` : result.find((item) => item.error !== null)?.error ?? "Profile COTIK sync failed.");
      if (failed === 0) router.refresh();
    } catch { reportOperation("ERROR", "Selected profile COTIK sync could not be completed."); }
  }, [liveOperationsEnabled, profileSelectionAligned, reportOperation, router, selectedProfileNo]);

  const value = useMemo<OperationsContextValue>(() => ({
    presentationStatus: initialPresentation.status,
    liveOperationsEnabled,
    profiles,
    selectedProfile,
    selectedProfileNo,
    profileSelectionAligned,
    operationState,
    operationMessage,
    operationLogs,
    logOpen,
    isBusy,
    clearOperationLogs,
    toggleLog,
    selectProfile,
    openProfile,
    verifyProfile,
    updateData,
    syncSelected,
    syncAllEligible,
  }), [
    initialPresentation.status,
    liveOperationsEnabled,
    profiles,
    selectedProfile,
    selectedProfileNo,
    profileSelectionAligned,
    operationState,
    operationMessage,
    operationLogs,
    logOpen,
    isBusy,
    clearOperationLogs,
    toggleLog,
    selectProfile,
    openProfile,
    verifyProfile,
    updateData,
    syncSelected,
    syncAllEligible,
  ]);

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useDashboardOperations(): OperationsContextValue {
  const value = useContext(OperationsContext);
  if (value === null) throw new Error("Dashboard operations provider is missing");
  return value;
}
