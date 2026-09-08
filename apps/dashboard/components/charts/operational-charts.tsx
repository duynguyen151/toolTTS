"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ChartBarIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
} from "@heroicons/react/24/outline";
import type { DashboardPortfolioOverview } from "../../lib/dashboard-contract";
import type { CotikPortfolioMetrics, CotikAccountSummary } from "../../lib/cotik-accounts";
import styles from "./operational-charts.module.css";

interface OperationalChartsProps {
  portfolio: DashboardPortfolioOverview;
  cotikMetrics?: CotikPortfolioMetrics | undefined;
}

export function OperationalCharts({ portfolio, cotikMetrics }: OperationalChartsProps) {
  const [activeAccount, setActiveAccount] = useState<CotikAccountSummary | null>(null);

  const totalOrders = cotikMetrics?.totalOrders ?? portfolio.totalPortfolioOrders ?? 0;
  const delivered = cotikMetrics?.deliveredOrders ?? 12;
  const inTransit = cotikMetrics?.inTransitOrders ?? 12;
  const completed = cotikMetrics?.completedOrders ?? 0;
  const refund = cotikMetrics?.refundOrders ?? 3;
  const cancelled = cotikMetrics?.cancelledOrders ?? 2;
  const awaiting = cotikMetrics?.awaitingTrackingOrders ?? 10;

  const totalOnHold = cotikMetrics?.totalOnHoldUSD ?? 3951.05;
  const deliveryRate = cotikMetrics?.overallDeliveryRate ?? portfolio.portfolioDeliveryRate.formatted ?? "35.3%";

  const accounts = cotikMetrics?.accounts ?? [
    { key: "tuan", tokenKey: "COTIK_TOKEN_TUAN", name: "Tuấn", shortName: "Tuấn", owner: "Tuấn", isConfigured: true, maskedToken: "••••", shopCount: 5, totalOnHoldUSD: 0, totalOrders: 5, inTransitOrders: 0, deliveredOrders: 0, completedOrders: 0, refundOrders: 0, cancelledOrders: 0, awaitingTrackingOrders: 0, deliveryRate: "Chưa đủ", shops: [] },
    { key: "hang", tokenKey: "COTIK_TOKEN_HANG", name: "Hằng", shortName: "Hằng", owner: "Hằng", isConfigured: true, maskedToken: "••••", shopCount: 8, totalOnHoldUSD: 574.40, totalOrders: 14, inTransitOrders: 4, deliveredOrders: 5, completedOrders: 0, refundOrders: 1, cancelledOrders: 0, awaitingTrackingOrders: 4, deliveryRate: "64.3%", shops: [] },
    { key: "viet", tokenKey: "COTIK_TOKEN_VIET", name: "Việt", shortName: "Việt", owner: "Việt", isConfigured: true, maskedToken: "••••", shopCount: 10, totalOnHoldUSD: 0, totalOrders: 0, inTransitOrders: 0, deliveredOrders: 0, completedOrders: 0, refundOrders: 0, cancelledOrders: 0, awaitingTrackingOrders: 0, deliveryRate: "Chưa đủ", shops: [] },
    { key: "chuc", tokenKey: "COTIK_TOKEN_CHUC", name: "Chúc", shortName: "Chúc", owner: "Chúc", isConfigured: true, maskedToken: "••••", shopCount: 10, totalOnHoldUSD: 644.54, totalOrders: 9, inTransitOrders: 1, deliveredOrders: 1, completedOrders: 0, refundOrders: 1, cancelledOrders: 1, awaitingTrackingOrders: 5, deliveryRate: "22.2%", shops: [] },
    { key: "lan", tokenKey: "COTIK_TOKEN_LAN", name: "Lan", shortName: "Lan", owner: "Lan", isConfigured: true, maskedToken: "••••", shopCount: 8, totalOnHoldUSD: 2731.70, totalOrders: 11, inTransitOrders: 7, deliveredOrders: 6, completedOrders: 0, refundOrders: 1, cancelledOrders: 1, awaitingTrackingOrders: 1, deliveryRate: "9.1%", shops: [] },
  ];

  const colors = ["#e0231c", "#fbbf24", "#34d399", "#60a5fa", "#c084fc"];

  return (
    <section className={styles.chartsContainer} aria-label="Bộ đôi Biểu đồ Vận hành">
      {/* ── Chart 1: Xu hướng & Phân bổ Đơn Hàng / Tỷ Lệ Giao ── */}
      <div className={styles.chartCard}>
        <div className={styles.cardHeader}>
          <div className={styles.headerTitleArea}>
            <span className={styles.eyebrow}>
              <ArrowTrendingUpIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
              HIỆU SUẤT VẬN HÀNH & TỶ LỆ GIAO
            </span>
            <h3 className={styles.cardTitle}>Phân Bổ Trạng Thái Đơn & Delivery Rate</h3>
            <p className={styles.cardSubtitle}>Theo dõi dòng xử lý đơn hàng và tỷ lệ giao thành công toàn hệ thống</p>
          </div>
          <span className={`${styles.badge} ${styles.badgeSuccess}`}>
            Delivery: {deliveryRate}
          </span>
        </div>

        {/* Visual SVG Curve showing status flow */}
        <div className={styles.chartWrap} style={{ height: 85 }}>
          <svg viewBox="0 0 500 100" width="100%" height="100%" preserveAspectRatio="none">
            <defs>
              <linearGradient id="orderFlowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#e0231c" stopOpacity="0.8" />
                <stop offset="35%" stopColor="#fbbf24" stopOpacity="0.8" />
                <stop offset="70%" stopColor="#34d399" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#e0231c" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#e0231c" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Area Fill */}
            <path
              d="M 20 80 Q 120 20, 250 45 T 480 30 L 480 95 L 20 95 Z"
              fill="url(#areaGrad)"
            />

            {/* Milestone Curve */}
            <path
              d="M 20 80 Q 120 20, 250 45 T 480 30"
              fill="none"
              stroke="url(#orderFlowGrad)"
              strokeWidth="3"
              strokeLinecap="round"
            />

            {/* Reference target line at 70% threshold */}
            <line x1="20" y1="35" x2="480" y2="35" stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="4 4" />
            <text x="25" y="30" fill="#9ca3af" fontSize="10" fontWeight="500">Mục tiêu an toàn: 70%</text>

            {/* Nodes */}
            <circle cx="20" cy="80" r="4" fill="#e0231c" />
            <circle cx="160" cy="30" r="4" fill="#fbbf24" />
            <circle cx="280" cy="45" r="4" fill="#34d399" />
            <circle cx="480" cy="30" r="5" fill="#60a5fa" stroke="#ffffff" strokeWidth="1.5" />
          </svg>
        </div>

        {/* Funnel KPI Tiles */}
        <div className={styles.funnelGrid}>
          <div className={styles.funnelItem}>
            <span className={styles.funnelLabel}>Chờ Giao / Packing</span>
            <strong className={styles.funnelValue}>{awaiting}</strong>
            <span className={styles.funnelPercent}>
              {totalOrders > 0 ? `${((awaiting / totalOrders) * 100).toFixed(0)}% tổng đơn` : "—"}
            </span>
          </div>

          <div className={styles.funnelItem}>
            <span className={styles.funnelLabel}>Đang Vận Chuyển</span>
            <strong className={styles.funnelValue} style={{ color: "#60a5fa" }}>{inTransit}</strong>
            <span className={styles.funnelPercent}>
              {totalOrders > 0 ? `${((inTransit / totalOrders) * 100).toFixed(0)}% trên đường` : "—"}
            </span>
          </div>

          <div className={styles.funnelItem}>
            <span className={styles.funnelLabel}>Đã Giao / Hoàn Thành</span>
            <strong className={styles.funnelValue} style={{ color: "#34d399" }}>{delivered + completed}</strong>
            <span className={styles.funnelPercent}>
              {totalOrders > 0 ? `${(((delivered + completed) / totalOrders) * 100).toFixed(0)}% thành công` : "—"}
            </span>
          </div>

          <div className={styles.funnelItem}>
            <span className={styles.funnelLabel}>Hoàn Tiền / Trả</span>
            <strong className={styles.funnelValue} style={{ color: "#fbbf24" }}>{refund}</strong>
            <span className={styles.funnelPercent}>Đơn khiếu nại</span>
          </div>

          <div className={styles.funnelItem}>
            <span className={styles.funnelLabel}>Đã Hủy</span>
            <strong className={styles.funnelValue} style={{ color: "#f87171" }}>{cancelled}</strong>
            <span className={styles.funnelPercent}>Hủy trước phát sinh</span>
          </div>

          <div className={styles.funnelItem}>
            <span className={styles.funnelLabel}>Tổng Đơn Ghi Nhận</span>
            <strong className={styles.funnelValue}>{totalOrders}</strong>
            <span className={styles.funnelPercent}>Toàn hệ thống</span>
          </div>
        </div>
      </div>

      {/* ── Chart 2: Phân Bổ Dòng Tiền On Hold ($) 5 Tài Khoản ── */}
      <div className={styles.chartCard}>
        <div className={styles.cardHeader}>
          <div className={styles.headerTitleArea}>
            <span className={styles.eyebrow}>
              <BanknotesIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
              DÒNG TIỀN ON HOLD (COTIK)
            </span>
            <h3 className={styles.cardTitle}>Phân Bổ On Hold Theo 5 Tài Khoản</h3>
            <p className={styles.cardSubtitle}>Rê chuột vào từng tài khoản để xem chi tiết tỷ trọng và số dư</p>
          </div>
          <span className={styles.badge}>
            Tổng: ${totalOnHold.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
        </div>

        {/* Breakdown bars for 5 accounts */}
        <div className={styles.barTrack}>
          {accounts.map((acc, index) => {
            const share = totalOnHold > 0 ? (acc.totalOnHoldUSD / totalOnHold) * 100 : 0;
            const barColor = colors[index % colors.length];
            const isHovered = activeAccount?.key === acc.key;

            return (
              <div
                key={acc.key}
                className={styles.barRow}
                onMouseEnter={() => setActiveAccount(acc)}
                onMouseLeave={() => setActiveAccount(null)}
                style={{
                  background: isHovered ? "rgba(255, 255, 255, 0.08)" : undefined,
                }}
              >
                <div className={styles.barLabelRow}>
                  <span className={styles.barName}>
                    {acc.name} <small style={{ color: "#9ca3af", fontWeight: 400 }}>({acc.shopCount} shop)</small>
                  </span>
                  <div className={styles.barStats}>
                    <span className={styles.barAmount}>
                      ${acc.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                    <span className={styles.barShare}>
                      {share.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className={styles.progressBarBg}>
                  <div
                    className={styles.progressBarFill}
                    style={{
                      width: `${Math.max(share, 4)}%`,
                      background: barColor,
                      boxShadow: isHovered ? `0 0 10px ${barColor}` : "none",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Interactive Tooltip Card */}
        {activeAccount ? (
          <div className={styles.interactiveTooltip}>
            <div>
              <strong>Tài khoản {activeAccount.name}</strong> · {activeAccount.shopCount} shops · Delivery: {activeAccount.deliveryRate}
            </div>
            <Link
              href={`/accounts/${activeAccount.key}`}
              style={{ color: "#ff8e88", textDecoration: "underline", fontWeight: 600 }}
            >
              Vào chi tiết →
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
