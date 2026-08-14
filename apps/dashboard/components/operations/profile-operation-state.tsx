"use client";

import { ComputerDesktopIcon } from "@heroicons/react/24/outline";

import dashboardStyles from "../dashboard/dashboard-overview.module.css";
import { StatusBadge, type StatusTone } from "../ui/status-badge.js";
import { useDashboardOperations } from "./operations-provider.js";

function stateTone(state: "OPEN" | "CLOSED" | "ERROR" | undefined): StatusTone {
  if (state === "OPEN") return "success";
  if (state === "ERROR") return "danger";
  return "warning";
}

export function ProfileOperationState() {
  const { selectedProfile } = useDashboardOperations();
  const state = selectedProfile?.state ?? "ERROR";
  const linked = selectedProfile?.linkState === "LINKED";
  const detail = selectedProfile === null
    ? "AdsPower profiles are currently unavailable."
    : linked
      ? `Linked to ${selectedProfile.linkedShop?.displayName ?? `shop ${selectedProfile.profileNo}`}.`
      : selectedProfile.linkState === "UNKNOWN"
        ? "Tool_TTS link state could not be verified."
        : "Not linked to a Tool_TTS shop. Open is available; data update is disabled.";

  return (
    <article className={dashboardStyles.stateBlock}>
      <div className={dashboardStyles.stateIcon} data-tone={state === "OPEN" ? "success" : state === "ERROR" ? "danger" : "warning"}>
        <ComputerDesktopIcon aria-hidden="true" />
      </div>
      <div>
        <p className={dashboardStyles.stateLabel}>AdsPower profile</p>
        <h3>{selectedProfile === null ? "Profile unavailable" : `Profile ${selectedProfile.profileNo}`}</h3>
        <p>{detail}</p>
      </div>
      <div className={dashboardStyles.stateMeta}>
        <StatusBadge tone={stateTone(selectedProfile?.state)}>{state}</StatusBadge>
        {selectedProfile !== null ? (
          <span>{linked ? "Linked" : selectedProfile.linkState === "UNKNOWN" ? "Link unknown" : "Unlinked"}</span>
        ) : null}
      </div>
    </article>
  );
}
