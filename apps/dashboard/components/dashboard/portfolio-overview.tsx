import Link from "next/link";
import {
  BanknotesIcon,
  BuildingStorefrontIcon,
  ExclamationCircleIcon,
  ScaleIcon,
  ShieldExclamationIcon,
  ShoppingBagIcon,
  TruckIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "../ui/status-badge";
import { TriadBadgeGroup } from "./triad-badge-group";
import type { DashboardPortfolioOverview } from "../../lib/dashboard-contract";
import { OperationalCharts } from "../charts/operational-charts";
import type { CotikPortfolioMetrics } from "../../lib/cotik-accounts";
import styles from "./portfolio-overview.module.css";

interface PortfolioOverviewProps {
  portfolio: DashboardPortfolioOverview;
  cotikMetrics?: CotikPortfolioMetrics | undefined;
}

export function PortfolioOverview({ portfolio, cotikMetrics }: PortfolioOverviewProps) {
  const primaryOnHold = portfolio.officialOnHoldByCurrency.find((item) => item.currency === "USD")
    ?? portfolio.officialOnHoldByCurrency[0];

  return (
    <div className={styles.container}>
      {/* Portfolio Top KPI Band */}
      <section className={styles.kpiGrid} aria-label="Chỉ số tổng quan danh mục shop">
        <div className={`${styles.kpiCard} ${styles.kpiPrimary}`}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiEyebrow}>Quy mô danh mục</span>
            <BuildingStorefrontIcon className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <strong className={styles.kpiValue}>
            {portfolio.activeShops} <span className={styles.kpiUnit}>/ {portfolio.totalShops} Active</span>
          </strong>
          <p className={styles.kpiDetail}>Cửa hàng đang hoạt động</p>
        </div>

        <div className={`${styles.kpiCard} ${styles.kpiRose}`}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiEyebrow}>OH COTIK (Delivered + 31d)</span>
            <BanknotesIcon className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <strong className={styles.kpiValue}>{primaryOnHold?.formatted ?? "—"}</strong>
          <p className={styles.kpiDetail}>
            {portfolio.officialOnHoldByCurrency.map((item) => `${item.currency}: ${item.formatted} (${item.shopCount} shop)`).join(" · ") || "Ước tính quyết toán COTIK"}
          </p>
        </div>

        <div className={`${styles.kpiCard} ${styles.kpiMint}`}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiEyebrow}>Delivery Rate chuẩn danh mục</span>
            <TruckIcon className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <strong className={styles.kpiValue}>{portfolio.portfolioDeliveryRate.formatted}</strong>
          <p className={styles.kpiDetail}>
            {portfolio.portfolioDeliveryRate.numerator} / {portfolio.portfolioDeliveryRate.denominator} đơn thành công
          </p>
        </div>

        <div className={`${styles.kpiCard} ${styles.kpiSky}`}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiEyebrow}>Tổng đơn hàng</span>
            <ShoppingBagIcon className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <strong className={styles.kpiValue}>{portfolio.totalPortfolioOrders.toLocaleString("vi-VN")}</strong>
          <p className={styles.kpiDetail}>Đơn hàng đã ghi nhận</p>
        </div>
      </section>

      {/* Attention Alert Cards */}
      <section className={styles.attentionGrid} aria-label="Khu vực cảnh báo và thẩm định">
        <div className={`${styles.attentionCard} ${portfolio.attention.needsBaReviewCount > 0 ? styles.attentionActive : ""}`}>
          <div className={styles.attentionIconWrap}>
            <ScaleIcon className={styles.attentionIcon} aria-hidden="true" />
          </div>
          <div>
            <span className={styles.attentionLabel}>Cần BA Thẩm Định</span>
            <strong className={styles.attentionCount}>{portfolio.attention.needsBaReviewCount}</strong>
          </div>
        </div>

        <div className={`${styles.attentionCard} ${portfolio.attention.rulePauseCount > 0 ? styles.attentionDanger : ""}`}>
          <div className={styles.attentionIconWrap}>
            <ShieldExclamationIcon className={styles.attentionIcon} aria-hidden="true" />
          </div>
          <div>
            <span className={styles.attentionLabel}>Rule yêu cầu PAUSE</span>
            <strong className={styles.attentionCount}>{portfolio.attention.rulePauseCount}</strong>
          </div>
        </div>

        <div className={`${styles.attentionCard} ${portfolio.attention.disagreementCount > 0 ? styles.attentionWarning : ""}`}>
          <div className={styles.attentionIconWrap}>
            <ExclamationCircleIcon className={styles.attentionIcon} aria-hidden="true" />
          </div>
          <div>
            <span className={styles.attentionLabel}>Lệch Rule vs AI</span>
            <strong className={styles.attentionCount}>{portfolio.attention.disagreementCount}</strong>
          </div>
        </div>

      </section>

      {/* Replaced table with interactive Operational Charts as requested */}
      <OperationalCharts portfolio={portfolio} cotikMetrics={cotikMetrics} />
    </div>
  );
}
