import {
  ArrowPathRoundedSquareIcon,
} from "@heroicons/react/24/outline";

import type { DashboardPresentation } from "../../lib/dashboard-contract";
import { ProfileOperationState } from "../operations/profile-operation-state";
import { InlineLoader } from "../ui/inline-loader";
import { StatusBadge, type StatusTone } from "../ui/status-badge";
import styles from "./dashboard-overview.module.css";

type OperationalPanelProps = Pick<DashboardPresentation, "sync" | "profile">;

function badgeTone(tone: DashboardPresentation["sync"]["tone"]): StatusTone {
  if (tone === "success" || tone === "warning" || tone === "danger") return tone;
  if (tone === "primary" || tone === "lilac") return "primary";
  if (tone === "sky") return "info";
  return "neutral";
}

export function OperationalPanel({ profile, sync }: OperationalPanelProps) {
  return (
    <section className={styles.operationalPanel} id="sync-state" aria-labelledby="operations-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.sectionEyebrow}>Operator boundary</p>
          <h2 id="operations-heading">Operational state</h2>
        </div>
        {sync.status === "RUNNING" ? <InlineLoader label="Updating" /> : null}
      </div>

      <div className={styles.stateStack}>
        <article className={styles.stateBlock}>
          <div className={styles.stateIcon} data-tone={sync.tone}>
            <ArrowPathRoundedSquareIcon aria-hidden="true" />
          </div>
          <div>
            <p className={styles.stateLabel}>Sync state</p>
            <h3>{sync.label}</h3>
            <p>{sync.detail}</p>
          </div>
          <div className={styles.stateMeta}>
            <StatusBadge tone={badgeTone(sync.tone)}>{sync.status}</StatusBadge>
            <time>{sync.updatedAt}</time>
          </div>
        </article>

        <ProfileOperationState fallbackProfile={profile} />
      </div>

    </section>
  );
}
