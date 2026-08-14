import {
  CalendarDaysIcon,
  CircleStackIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

import type { DashboardPresentation } from "../../lib/dashboard-contract";
import { StatusBadge, type StatusTone } from "../ui/status-badge";
import styles from "./dashboard-overview.module.css";

type DataQualityPanelProps = Pick<DashboardPresentation, "coverage" | "freshness">;

function coverageTone(status: DashboardPresentation["coverage"]["status"]): StatusTone {
  if (status === "READY") return "success";
  if (status === "UNAVAILABLE") return "danger";
  return "warning";
}

export function DataQualityPanel({ coverage, freshness }: DataQualityPanelProps) {
  return (
    <section className={styles.qualityPanel} aria-labelledby="coverage-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.sectionEyebrow}>Data confidence</p>
          <h2 id="coverage-heading">Data coverage</h2>
        </div>
        <CircleStackIcon className={styles.headingIcon} aria-hidden="true" />
      </div>

      <article className={styles.coverageWarning} data-status={coverage.status}>
        <ExclamationTriangleIcon aria-hidden="true" />
        <div>
          <div className={styles.warningTitle}>
            <h3>{coverage.label}</h3>
            <StatusBadge tone={coverageTone(coverage.status)}>{coverage.status}</StatusBadge>
          </div>
          <p>{coverage.detail}</p>
        </div>
      </article>

      <div className={styles.freshnessBlock}>
        <div className={styles.freshnessTitle}>
          <CalendarDaysIcon aria-hidden="true" />
          <div>
            <h3>{freshness.label}</h3>
            <p>{freshness.detail}</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Orders</dt>
            <dd>{freshness.ordersUpdatedAt}</dd>
          </div>
          <div>
            <dt>Finance</dt>
            <dd>{freshness.financeUpdatedAt}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
