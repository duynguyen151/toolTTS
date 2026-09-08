import type { DashboardPresentation } from "../../lib/dashboard-contract";
import type { CotikPortfolioMetrics } from "../../lib/cotik-accounts";
import Link from "next/link";
import { OperationsControls } from "../operations/operations-controls";
import { StatusBadge } from "../ui/status-badge";
import { DataQualityPanel } from "./data-quality-panel";
import { DecisionTrace } from "./decision-trace";
import { KpiBand } from "./kpi-band";
import { LiveDecisionCenter } from "./live-decision-center";
import { OperationalPanel } from "./operational-panel";
import { OrderHealth } from "./order-health";
import { PortfolioOverview } from "./portfolio-overview";
import { MetricActionPills } from "./metric-action-pills";
import { PageSidePanel } from "../shell/page-side-panel";
import styles from "./dashboard-overview.module.css";

type DashboardOverviewProps = {
  presentation: DashboardPresentation;
  operatorProfileNo?: string;
  cotikMetrics?: CotikPortfolioMetrics;
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

export function DashboardOverview({ presentation, operatorProfileNo, cotikMetrics }: DashboardOverviewProps) {
  const generatedAtLabel = formatGeneratedAt(presentation.generatedAt);
  const operatorProfileDiffers = operatorProfileNo !== undefined && operatorProfileNo !== presentation.selectedShop.profileNo;

  return (
    <div className="console-two-col-layout">
      <PageSidePanel badgeText="KYOTO PAGODA · OVERVIEW">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: "6px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.72rem",
            }}
          >
            <span style={{ color: "var(--color-ink-muted)" }}>Nguồn dữ liệu:</span>
            <strong style={{ color: "var(--color-primary)" }}>{presentation.dataOrigin}</strong>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: "6px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.72rem",
            }}
          >
            <span style={{ color: "var(--color-ink-muted)" }}>Múi giờ vận hành:</span>
            <strong style={{ color: "var(--color-ink)" }}>GMT+07</strong>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: "6px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.72rem",
            }}
          >
            <span style={{ color: "var(--color-ink-muted)" }}>Khung giờ kiểm tra:</span>
            <strong style={{ color: "var(--color-ink)" }}>08:00 · 11:00 · 17:00</strong>
          </div>
        </div>

        <div
          style={{
            marginTop: 2,
            padding: "6px 8px",
            borderRadius: "6px",
            background: "var(--color-primary-soft)",
            border: "1px solid var(--color-primary-soft)",
            fontSize: "0.68rem",
            lineHeight: 1.35,
            color: "var(--color-primary-ink)",
          }}
        >
          🌿 Bảng điều khiển vận hành thời gian thực. Mọi số liệu Official On Hold và Delivery Rate đều tuân thủ nguyên tắc tất định tuyệt đối.
        </div>
      </PageSidePanel>

      <div className="console-two-col-content">
        <div className={styles.dashboard}>
      <header className={styles.pageHeader} id="shops">
        <div className={styles.headerTop}>
          <div className={styles.pageIntro}>
            <div className={styles.eyebrowLine}>
              <span>SHOP OPERATIONS</span>
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
            {presentation.portfolio === undefined ? (
              <>
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
              </>
            ) : null}
          </div>
        </div>

        {/* Render legacy OperationsControls only in single-shop mode to satisfy test suite */}
        {presentation.portfolio === undefined ? (
          <OperationsControls generatedAtLabel={generatedAtLabel} />
        ) : null}
      </header>

      {/* ── Cotik Multi-Account 10 Metric Action Pills ── */}
      {cotikMetrics && (
        <section aria-label="Bộ nút tương tác chỉ số Cotik">
          <MetricActionPills metrics={cotikMetrics} />
        </section>
      )}

      {/* ── 5 Cotik Accounts Interactive Cards ── */}
      {cotikMetrics && (
        <section aria-label="Danh sách 5 tài khoản Cotik" className={styles.accountsSection}>
          <div className={styles.accountsHeader}>
            <h2 className={styles.accountsTitle}>
              Quản trị 5 Tài khoản Cotik (AL-Token)
            </h2>
            <Link href="/accounts" className={styles.accountsLink}>
              Xem tất cả →
            </Link>
          </div>

          <div className={styles.accountsGrid}>
            {cotikMetrics.accounts.map((acc) => (
              <Link
                key={acc.key}
                href={`/accounts/${acc.key}`}
                className={styles.accountCard}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
                  <strong style={{ fontSize: "0.72rem", color: "var(--color-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{acc.name}</strong>
                  <span style={{
                    fontSize: "0.55rem",
                    fontWeight: 600,
                    padding: "0 4px",
                    borderRadius: "999px",
                    background: "var(--color-primary-soft)",
                    color: "var(--color-primary-ink)",
                    flexShrink: 0,
                  }}>
                    {acc.shopCount}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.68rem", marginTop: "1px", minWidth: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: "0.5rem", color: "var(--color-ink-muted)", display: "block", textTransform: "uppercase" }}>OH</span>
                    <strong style={{ fontSize: "0.68rem", color: "var(--color-success)", whiteSpace: "nowrap" }}>
                      ${acc.totalOnHoldUSD >= 1000 ? `${(acc.totalOnHoldUSD / 1000).toFixed(1)}k` : acc.totalOnHoldUSD.toFixed(0)}
                    </strong>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 0 }}>
                    <span style={{ fontSize: "0.5rem", color: "var(--color-ink-muted)", display: "block", textTransform: "uppercase" }}>Deli</span>
                    <strong style={{ fontSize: "0.68rem", color: "var(--color-ink)", whiteSpace: "nowrap" }}>
                      {acc.deliveryRate}
                    </strong>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {presentation.portfolio === undefined ? (
        <>
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
                  {" ("}
                  <Link href={`/shops/${encodeURIComponent(shop.profileNo)}`} aria-label={`Chi tiết ${shop.displayName}`}>
                    Chi tiết
                  </Link>
                  {")"}
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
        </>
      ) : (
        <PortfolioOverview portfolio={presentation.portfolio} cotikMetrics={cotikMetrics} />
      )}
        </div>
      </div>
    </div>
  );
}
