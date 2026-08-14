import {
  BanknotesIcon,
  CheckBadgeIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ShoppingBagIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

import type { DashboardKpi } from "../../lib/dashboard-contract";
import styles from "./dashboard-overview.module.css";

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

const icons: Record<DashboardKpi["id"], HeroIcon> = {
  "on-hold": BanknotesIcon,
  orders: ShoppingBagIcon,
  awaiting: ClockIcon,
  delivery: CheckBadgeIcon,
  sales: CurrencyDollarIcon,
};

export function KpiBand({ kpis }: { kpis: DashboardKpi[] }) {
  return (
    <section className={styles.kpiSection} aria-labelledby="kpi-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.sectionEyebrow}>Current read model</p>
          <h2 id="kpi-heading">Shop snapshot</h2>
        </div>
        <span>{kpis.length} operational fields</span>
      </div>

      <ul className={styles.kpiGrid}>
        {kpis.map((kpi) => {
          const Icon = icons[kpi.id];

          return (
            <li
              className={styles.kpiItem}
              data-kpi-id={kpi.id}
              data-tone={kpi.tone}
              key={kpi.id}
            >
              <article aria-label={`${kpi.label}: ${kpi.value}`}>
                {kpi.id === "on-hold" ? (
                  <>
                    <div className={styles.financeHeading}>
                      <Icon aria-hidden="true" />
                      <div>
                        <span>Official finance</span>
                        <h3>{kpi.label}</h3>
                      </div>
                    </div>
                    <p className={styles.financeValue}>{kpi.value}</p>
                    <p className={styles.kpiDetail}>{kpi.detail}</p>
                  </>
                ) : kpi.id === "orders" ? (
                  <>
                    <div className={styles.numberHeading}>
                      <h3>{kpi.label}</h3>
                      <Icon aria-hidden="true" />
                    </div>
                    <p className={styles.numberValue}>{kpi.value}</p>
                    <p className={styles.kpiDetail}>{kpi.detail}</p>
                  </>
                ) : kpi.id === "awaiting" ? (
                  <>
                    <div className={styles.attentionLabel}>
                      <Icon aria-hidden="true" />
                      <span>Fulfilment attention</span>
                    </div>
                    <div className={styles.attentionValue}>
                      <p>{kpi.value}</p>
                      <h3>{kpi.label}</h3>
                    </div>
                    <p className={styles.kpiDetail}>{kpi.detail}</p>
                  </>
                ) : kpi.id === "delivery" ? (
                  <>
                    <div className={styles.rateHeading}>
                      <div>
                        <h3>{kpi.label}</h3>
                        <span>Verified coverage</span>
                      </div>
                      <Icon aria-hidden="true" />
                    </div>
                    <p className={styles.rateValue}>{kpi.value}</p>
                    <p className={styles.kpiDetail}>{kpi.detail}</p>
                  </>
                ) : (
                  <>
                    <div className={styles.salesHeading}>
                      <Icon aria-hidden="true" />
                      <span>Persisted value</span>
                    </div>
                    <h3>{kpi.label}</h3>
                    <p className={styles.salesValue}>{kpi.value}</p>
                    <p className={styles.kpiDetail}>{kpi.detail}</p>
                  </>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
