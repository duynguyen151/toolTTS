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
import { isTerminalUpdateState } from "../../lib/operations-contract.js";
import { readUpdateDataEvents } from "../../lib/read-update-stream.js";

type OperationsContextValue = {
  presentationStatus: ProfileOperationsPresentation["status"];
  profiles: readonly DashboardProfile[];
  selectedProfile: DashboardProfile | null;
  selectedProfileNo: string | null;
  operationState: UpdateDataState;
  operationMessage: string;
  isBusy: boolean;
  selectProfile(profileNo: string): void;
  openProfile(): Promise<void>;
  updateData(): Promise<void>;
};

const OperationsContext = createContext<OperationsContextValue | null>(null);

function failedMessage(status: number): string {
  return status === 403
    ? "This operation is available only from the local dashboard."
    : "The operation could not be completed.";
}

export function OperationsProvider({
  children,
  initialPresentation,
}: {
  children: ReactNode;
  initialPresentation: ProfileOperationsPresentation;
}) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initialPresentation.profiles);
  const [selectedProfileNo, setSelectedProfileNo] = useState(
    initialPresentation.selectedProfileNo,
  );
  const [operationState, setOperationState] = useState<UpdateDataState>("READY");
  const [operationMessage, setOperationMessage] = useState(
    initialPresentation.error?.message ?? "Ready for operator action",
  );

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.profileNo === selectedProfileNo) ?? null,
    [profiles, selectedProfileNo],
  );
  const isBusy = operationState !== "READY" && !isTerminalUpdateState(operationState);

  const selectProfile = useCallback((profileNo: string) => {
    setSelectedProfileNo(profileNo);
    setOperationState("READY");
    setOperationMessage("Ready for operator action");
  }, []);

  const openProfile = useCallback(async () => {
    if (selectedProfileNo === null) return;
    setOperationState("OPENING_PROFILE");
    setOperationMessage(`Opening AdsPower profile ${selectedProfileNo}`);

    try {
      const response = await fetch("/api/profiles/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileNo: selectedProfileNo }),
      });
      const result = await response.json() as OpenProfileResult;

      if (!response.ok || !result.ok) {
        setOperationState("ERROR");
        setOperationMessage(result.ok ? failedMessage(response.status) : result.error.message);
        return;
      }

      setProfiles((current) => current.map((profile) => profile.profileNo === result.profileNo
        ? { ...profile, state: "OPEN" }
        : profile));
      setOperationState("READY");
      setOperationMessage(`Profile ${result.profileNo} is ready`);
    } catch {
      setOperationState("ERROR");
      setOperationMessage("AdsPower could not be reached from the dashboard.");
    }
  }, [selectedProfileNo]);

  const updateData = useCallback(async () => {
    if (selectedProfileNo === null) return;
    setOperationState("CONNECTING");
    setOperationMessage(`Connecting to profile ${selectedProfileNo}`);

    try {
      const response = await fetch("/api/update-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileNo: selectedProfileNo }),
      });

      if (!response.ok || response.body === null) {
        setOperationState("ERROR");
        setOperationMessage(failedMessage(response.status));
        return;
      }

      for await (const event of readUpdateDataEvents(response.body)) {
        setOperationState(event.state);
        setOperationMessage(event.message);
        if (event.state === "OPENING_PROFILE" || event.state === "CONNECTING") {
          setProfiles((current) => current.map((profile) => profile.profileNo === selectedProfileNo
            ? { ...profile, state: "OPEN" }
            : profile));
        }
        if (event.terminal && (event.state === "SUCCESS" || event.state === "PARTIAL")) {
          router.refresh();
        }
      }
    } catch {
      setOperationState("ERROR");
      setOperationMessage("The update stream ended unexpectedly.");
    }
  }, [router, selectedProfileNo]);

  const value = useMemo<OperationsContextValue>(() => ({
    presentationStatus: initialPresentation.status,
    profiles,
    selectedProfile,
    selectedProfileNo,
    operationState,
    operationMessage,
    isBusy,
    selectProfile,
    openProfile,
    updateData,
  }), [
    initialPresentation.status,
    profiles,
    selectedProfile,
    selectedProfileNo,
    operationState,
    operationMessage,
    isBusy,
    selectProfile,
    openProfile,
    updateData,
  ]);

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useDashboardOperations(): OperationsContextValue {
  const value = useContext(OperationsContext);
  if (value === null) throw new Error("Dashboard operations provider is missing");
  return value;
}
