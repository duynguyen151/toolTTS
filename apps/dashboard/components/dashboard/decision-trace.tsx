import {
  BoltIcon,
  CpuChipIcon,
  ScaleIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

import type { DashboardPresentation } from "../../lib/dashboard-contract";
import styles from "./dashboard-overview.module.css";

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;
type Stage = DashboardPresentation["decisionTrace"][number];

const icons: Record<Stage["id"], HeroIcon> = {
  rule: ScaleIcon,
  ai: CpuChipIcon,
  ba: UserIcon,
  execution: BoltIcon,
};

const stageRoles: Record<Stage["id"], string> = {
  rule: "Deterministic policy",
  ai: "Advisory recommendation",
  ba: "Human decision",
  execution: "Audited action",
};

export function DecisionTrace({ stages }: { stages: DashboardPresentation["decisionTrace"] }) {
  return (
    <section className={styles.decisionPanel} id="decision-trace" aria-labelledby="decision-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.sectionEyebrow}>Auditable sequence</p>
          <h2 id="decision-heading">Decision trace</h2>
        </div>
        <span>Read only</span>
      </div>

      <p className={styles.tracePath}>Rule → AI → BA → Execution</p>

      <ol className={styles.traceList} aria-label="Decision trace">
        {stages.map((stage, index) => {
          const Icon = icons[stage.id];
          return (
            <li aria-label={`Stage ${index + 1} of ${stages.length}: ${stage.label}`} key={stage.id}>
              <div className={styles.traceRail} aria-hidden="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Icon data-tone={stage.tone} />
              </div>
              <div className={styles.traceCopy}>
                <p className={styles.traceRole}>{stageRoles[stage.id]}</p>
                <div className={styles.traceTitle}>
                  <h3>{stage.label}</h3>
                  <span className={styles.traceStatus} data-tone={stage.tone}>
                    {stage.value}
                  </span>
                </div>
                <p>{stage.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
