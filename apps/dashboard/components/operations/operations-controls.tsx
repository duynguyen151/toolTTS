"use client";

import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronUpDownIcon,
} from "@heroicons/react/24/outline";

import { PrimaryButton, SecondaryButton } from "../ui/buttons.js";
import { OperationLogPanel } from "./operation-log-panel.js";
import styles from "./operations.module.css";
import { useDashboardOperations } from "./operations-provider.js";

const updateLabels = {
  READY: "Update data (Seller Center)",
  OPENING_PROFILE: "Opening profile",
  CONNECTING: "Connecting",
  SYNCING_ORDERS: "Syncing orders",
  SYNCING_FINANCE: "Syncing finance",
  RECONCILING: "Reconciling",
  SUCCESS: "Update data (Seller Center)",
  PARTIAL: "Update data (Seller Center)",
  ERROR: "Update data (Seller Center)",
  LOGIN_REQUIRED: "Update data (Seller Center)",
  SECURITY_CHECK_REQUIRED: "Update data (Seller Center)",
  HUMAN_ACTION_REQUIRED: "Retry update (Seller Center)",
} as const;

export function OperationsControls({ generatedAtLabel }: { generatedAtLabel: string }) {
  const operations = useDashboardOperations();
  const canOpen = operations.liveOperationsEnabled
    && operations.profileSelectionAligned
    && operations.selectedProfile !== null
    && !operations.isBusy;
  const canUpdate = canOpen && operations.selectedProfile?.linkState === "LINKED";
  const canSyncSelected = canOpen;

  return (
    <>
      <div className={styles.controls} data-operation-state={operations.operationState}>
      <div className={styles.metaLine}>
        <span className={styles.generatedAt}>Generated {generatedAtLabel}</span>
        <span
          className={styles.operationMessage}
          aria-live="polite"
          aria-atomic="true"
          role="status"
          title={operations.operationMessage}
        >
          {operations.operationMessage}
        </span>
      </div>
      <div className={styles.actionRow}>
        <label className={styles.profileSelect}>
          <span className="sr-only">AdsPower profile</span>
          <select
            aria-label="AdsPower profile"
            disabled={!operations.liveOperationsEnabled || operations.isBusy}
            onChange={(event) => operations.selectProfile(event.target.value)}
            value={operations.selectedProfileNo ?? ""}
          >
            {operations.profiles.length === 0 ? <option value="">No profiles available</option> : null}
            {operations.profiles.map((profile) => (
              <option key={profile.profileNo} value={profile.profileNo}>
                Profile {profile.profileNo} · {profile.state} · {profile.linkState === "LINKED" ? "linked" : profile.linkState === "UNLINKED" ? "unlinked" : "link unknown"}
              </option>
            ))}
          </select>
          <ChevronUpDownIcon aria-hidden="true" />
        </label>
        <SecondaryButton
          disabled={!canOpen}
          leadingIcon={<ArrowTopRightOnSquareIcon />}
          loading={operations.operationState === "OPENING_PROFILE"}
          onClick={() => void operations.openProfile()}
        >
          {operations.operationState === "HUMAN_ACTION_REQUIRED" ? "Open profile to continue" : "Open profile"}
        </SecondaryButton>
        <SecondaryButton disabled={!canOpen} onClick={() => void operations.verifyProfile()}>
          Verify profile
        </SecondaryButton>
        <PrimaryButton
          disabled={!canUpdate}
          leadingIcon={<ArrowPathIcon />}
          loading={operations.isBusy && operations.operationState !== "OPENING_PROFILE"}
          onClick={() => void operations.updateData()}
        >
          {updateLabels[operations.operationState]}
        </PrimaryButton>
        <SecondaryButton disabled={!canSyncSelected} onClick={() => void operations.syncSelected()}>
          Sync selected (COTIK)
        </SecondaryButton>
        <SecondaryButton disabled={!operations.liveOperationsEnabled || operations.isBusy} onClick={() => void operations.syncAllEligible()}>
          Sync all eligible (COTIK)
        </SecondaryButton>
        <SecondaryButton
          aria-controls="operation-realtime-log"
          aria-expanded={operations.logOpen}
          onClick={operations.toggleLog}
        >
          Log
        </SecondaryButton>
      </div>
      </div>
      <OperationLogPanel
        entries={operations.operationLogs}
        onClear={operations.clearOperationLogs}
        onClose={operations.toggleLog}
        open={operations.logOpen}
      />
    </>
  );
}
