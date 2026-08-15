"use client";

import { ComputerDesktopIcon } from "@heroicons/react/24/outline";

import type { DashboardPresentation } from "../../lib/dashboard-contract.js";
import dashboardStyles from "../dashboard/dashboard-overview.module.css";
import { StatusBadge, type StatusTone } from "../ui/status-badge.js";
import { useDashboardOperations } from "./operations-provider.js";

function stateTone(state: "OPEN" | "CLOSED" | "ERROR" | undefined): StatusTone {
  if (state === "OPEN") return "success";
  if (state === "ERROR") return "danger";
  return "warning";
}

function fallbackTone(tone: DashboardPresentation["profile"]["tone"]): StatusTone {
  if (tone === "success" || tone === "warning" || tone === "danger") return tone;
  if (tone === "primary" || tone === "lilac") return "primary";
  if (tone === "sky") return "info";
  return "neutral";
}

export function ProfileOperationState({
  fallbackProfile,
}: {
  fallbackProfile?: DashboardPresentation["profile"];
}) {
  const { selectedProfile } = useDashboardOperations();
  const fallback = selectedProfile === null ? fallbackProfile : undefined;
  const state = selectedProfile?.state ?? fallback?.status ?? "ERROR";
  const linked = selectedProfile?.linkState === "LINKED";
  const detail = fallback?.detail ?? (selectedProfile === null
    ? "AdsPower profiles are currently unavailable."
    : selectedProfile.state === "ERROR" && linked
      ? `AdsPower profile listing could not be verified. Linked to ${selectedProfile.linkedShop?.displayName ?? `shop ${selectedProfile.profileNo}`}; Open Profile can launch it.`
      : linked
      ? `Linked to ${selectedProfile.linkedShop?.displayName ?? `shop ${selectedProfile.profileNo}`}.`
      : selectedProfile.linkState === "UNKNOWN"
        ? "Tool_TTS link state could not be verified."
        : "Not linked to a Tool_TTS shop. Open is available; data update is disabled.");
  const tone = fallback === undefined ? stateTone(selectedProfile?.state) : fallbackTone(fallback.tone);

  return (
    <article className={dashboardStyles.stateBlock}>
      <div className={dashboardStyles.stateIcon} data-tone={tone}>
        <ComputerDesktopIcon aria-hidden="true" />
      </div>
      <div>
        <p className={dashboardStyles.stateLabel}>AdsPower profile</p>
        <h3>{fallback?.label ?? (selectedProfile === null ? "Profile unavailable" : `Profile ${selectedProfile.profileNo}`)}</h3>
        <p>{detail}</p>
      </div>
      <div className={dashboardStyles.stateMeta}>
        <StatusBadge tone={tone}>{state}</StatusBadge>
        {selectedProfile !== null ? (
          <span>{linked ? "Linked" : selectedProfile.linkState === "UNKNOWN" ? "Link unknown" : "Unlinked"}</span>
        ) : null}
      </div>
    </article>
  );
}
