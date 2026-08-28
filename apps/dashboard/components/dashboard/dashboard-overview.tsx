import type { DashboardPresentation } from "../../lib/dashboard-contract";
import Link from "next/link";
import { OperationsControls } from "../operations/operations-controls";
import { StatusBadge } from "../ui/status-badge";
import { DataQualityPanel } from "./data-quality-panel";
import { DecisionTrace } from "./decision-trace";
import { KpiBand } from "./kpi-band";
import { LiveDecisionCenter } from "./live-decision-center";
import { OperationalPanel } from "./operational-panel";
import { OrderHealth } from "./order-health";
import styles from "./dashboard-overview.module.css";

type DashboardOverviewProps = {
  presentation: DashboardPresentation;
  operatorProfileNo?: string;
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

export function DashboardOverview({ presentation, operatorProfileNo }: DashboardOverviewProps) {
  const generatedAtLabel = formatGeneratedAt(presentation.generatedAt);
  const operatorProfileDiffers = operatorProfileNo !== undefined && operatorProfileNo !== presentation.selectedShop.profileNo;

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader} id="shops">
        <div className={styles.pageIntro}>
          <div className={styles.eyebrowLine}>
            <span>Shop operations</span>
            {presentation.dataOrigin === "LIVE" ? (
              <StatusBadge tone="success">Live data</StatusBadge>
            ) : presentation.dataOrigin === "DEMO_SANITIZED" ? (
              <StatusBadge tone="info">DEMO_SANITIZED</StatusBadge>
            ) : (
              <StatusBadge tone="danger">Live data unavailable</StatusBadge>
            )}
          </div>
          <h1>Operational overview</h1>
          <p>Current operational facts · persisted shop read model · GMT+07</p>
          <p>
            {presentation.selectedShop.displayName}
            <span aria-hidden="true"> · </span>
            <span>AdsPower profile {presentation.selectedShop.profileNo}</span>
          </p>
          {operatorProfileDiffers ? (
            <p>
              Operator profile {operatorProfileNo} selected. Decision Center data below belongs to profile {presentation.selectedShop.profileNo} until Verify completes.
            </p>
          ) : null}
        </div>

        <OperationsControls generatedAtLabel={generatedAtLabel} />
      </header>

      <div className={styles.primaryGrid}>
        <KpiBand kpis={presentation.kpis} />
        <OperationalPanel profile={presentation.profile} sync={presentation.sync} />
      </div>

      <nav aria-label="Linked LIVE shops">
        <p>Decision Center shop</p>
        <ul>
          {presentation.shops.map((shop) => (
            <li key={shop.id}>
              <Link href={`/dashboard?shop=${encodeURIComponent(shop.profileNo)}`} aria-current={shop.selected ? "page" : undefined}>
                {shop.displayName} · Profile {shop.profileNo}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.secondaryGrid}>
        <OrderHealth health={presentation.orderHealth} profileNo={presentation.selectedShop.profileNo} />
        <DataQualityPanel coverage={presentation.coverage} freshness={presentation.freshness} />
        <DecisionTrace stages={presentation.decisionTrace} />
      </div>

      <LiveDecisionCenter dataOrigin={presentation.dataOrigin} center={presentation.decisionCenter} />
    </div>
  );
}
