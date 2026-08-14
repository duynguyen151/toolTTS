import type { DashboardPresentation } from "../../lib/dashboard-contract";
import styles from "./dashboard-overview.module.css";

const orderStates = [
  { key: "awaiting", label: "Awaiting shipment", tone: "amber" },
  { key: "delivered", label: "Delivered", tone: "mint" },
  { key: "canceled", label: "Canceled", tone: "rose" },
] as const;

export function OrderHealth({ health }: { health: DashboardPresentation["orderHealth"] }) {
  return (
    <section className={styles.orderPanel} aria-labelledby="order-health-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.sectionEyebrow}>Order read</p>
          <h2 id="order-health-heading">Order health</h2>
        </div>
        <div className={styles.totalOrders}>
          <strong>{health.total}</strong>
          <span>Total orders</span>
        </div>
      </div>

      <dl className={styles.orderList}>
        {orderStates.map((state) => (
          <div className={styles.orderRow} data-tone={state.tone} key={state.key}>
            <dt>
              <span aria-hidden="true" />
              {state.label}
            </dt>
            <dd>{health[state.key]}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.panelFootnote}>
        Counts reflect the latest available synchronization window; no trend is inferred.
      </p>
    </section>
  );
}
