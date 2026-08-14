import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

import type { DashboardPresentation } from "../../lib/dashboard-contract";
import { PrimaryButton, SecondaryButton } from "../ui/buttons";
import { StatusBadge } from "../ui/status-badge";
import { DataQualityPanel } from "./data-quality-panel";
import { DecisionTrace } from "./decision-trace";
import { KpiBand } from "./kpi-band";
import { OperationalPanel } from "./operational-panel";
import { OrderHealth } from "./order-health";
import styles from "./dashboard-overview.module.css";

type DashboardOverviewProps = {
  presentation: DashboardPresentation;
};

function formatGeneratedAt(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
    timeZoneName: "short",
  }).format(timestamp);
}

export function DashboardOverview({ presentation }: DashboardOverviewProps) {
  const isSyncing = presentation.sync.status === "RUNNING";

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader} id="shops">
        <div className={styles.pageIntro}>
          <div className={styles.eyebrowLine}>
            <span>Shop operations</span>
            {presentation.dataOrigin === "DEMO_SANITIZED" ? (
              <StatusBadge tone="info">DEMO_SANITIZED</StatusBadge>
            ) : (
              <StatusBadge tone="success">Live data</StatusBadge>
            )}
          </div>
          <h1>Operational overview</h1>
          <p>
            {presentation.selectedShop.displayName}
            <span aria-hidden="true"> · </span>
            <span>AdsPower profile {presentation.selectedShop.profileNo}</span>
          </p>
        </div>

        <div className={styles.headerActions}>
          <time className={styles.generatedAt} dateTime={presentation.generatedAt}>
            Generated {formatGeneratedAt(presentation.generatedAt)}
          </time>
          <div className={styles.actionRow} aria-describedby="action-boundary-note">
            <SecondaryButton
              className={styles.compactAction}
              disabled
              leadingIcon={<ArrowTopRightOnSquareIcon />}
              title="Profile actions are not connected in Phase 1"
            >
              Open profile
            </SecondaryButton>
            <PrimaryButton
              className={styles.compactAction}
              disabled
              leadingIcon={<ArrowPathIcon />}
              loading={isSyncing}
              title="Data updates remain read-only in Phase 1"
            >
              Update data
            </PrimaryButton>
          </div>
          <p className="sr-only" id="action-boundary-note">
            Phase 1 presents existing read states. Profile and update actions are not connected.
          </p>
        </div>
      </header>

      <div className={styles.primaryGrid}>
        <KpiBand kpis={presentation.kpis} />
        <OperationalPanel profile={presentation.profile} sync={presentation.sync} />
      </div>

      <div className={styles.secondaryGrid}>
        <OrderHealth health={presentation.orderHealth} />
        <DataQualityPanel coverage={presentation.coverage} freshness={presentation.freshness} />
        <DecisionTrace stages={presentation.decisionTrace} />
      </div>
    </div>
  );
}
