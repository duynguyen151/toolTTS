"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { CotikPortfolioMetrics } from "../../lib/cotik-account-types";
import styles from "./metric-action-pills.module.css";

interface MetricActionPillsProps {
  metrics: CotikPortfolioMetrics;
}

type PillKey =
  | "acc"
  | "shops"
  | "onhold"
  | "orders"
  | "intransit"
  | "delivered"
  | "completed"
  | "refund"
  | "cancelled"
  | "awaiting_tracking";

interface PillDefinition {
  key: PillKey;
  label: string;
  value: string | number;
  icon: React.ReactNode;
}

export function MetricActionPills({ metrics }: MetricActionPillsProps) {
  const [activePillKey, setActivePillKey] = useState<PillKey | null>(null);
  const [popoverLeft, setPopoverLeft] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const pills: PillDefinition[] = [
    {
      key: "acc",
      label: "Acc Cotik",
      value: metrics.totalAccounts,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      key: "shops",
      label: "Tổng Shop",
      value: metrics.totalShops,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
          <path d="M2 7h20" />
          <path d="M22 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7" />
        </svg>
      ),
    },
    {
      key: "onhold",
      label: "Tổng On Hold",
      value: `$${metrics.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
    {
      key: "orders",
      label: "Tổng Đơn",
      value: metrics.totalOrders,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      ),
    },
    {
      key: "intransit",
      label: "Đang Vận Chuyển",
      value: metrics.inTransitOrders,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      ),
    },
    {
      key: "delivered",
      label: "Đã Giao Hàng",
      value: metrics.deliveredOrders,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ),
    },
    {
      key: "completed",
      label: "Hoàn Thành",
      value: metrics.completedOrders,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
    {
      key: "refund",
      label: "Refund / Return",
      value: metrics.refundOrders,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      ),
    },
    {
      key: "cancelled",
      label: "Đã Hủy",
      value: metrics.cancelledOrders,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
    },
    {
      key: "awaiting_tracking",
      label: "Chờ Tracking",
      value: metrics.awaitingTrackingOrders,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pillIcon}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
  ];

  const handlePillClick = (key: PillKey, event: React.MouseEvent<HTMLButtonElement>) => {
    if (activePillKey === key) {
      setActivePillKey(null);
      return;
    }

    const button = event.currentTarget;
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const popoverWidth = Math.min(460, window.innerWidth - 32);

      // Align with button position
      let left = buttonRect.left - containerRect.left;

      // Ensure popover does not bleed beyond right edge of viewport
      const viewportMaxLeft = window.innerWidth - 16 - containerRect.left - popoverWidth;
      if (left > viewportMaxLeft) {
        left = viewportMaxLeft;
      }

      // Ensure popover does not exceed container width if container is smaller
      const containerMaxLeft = containerRect.width - popoverWidth;
      if (containerMaxLeft > 0 && left > containerMaxLeft) {
        left = containerMaxLeft;
      }

      if (left < 0) left = 0;
      setPopoverLeft(left);
    }
    setActivePillKey(key);
  };

  const handleBackToPill = () => {
    if (activePillKey) {
      const button = document.getElementById(`pill-${activePillKey}`);
      if (button) {
        button.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        button.focus();
      }
    }
    setActivePillKey(null);
  };

  // Close popover on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActivePillKey(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className={styles.pillsContainer} ref={containerRef}>
      <div className={styles.pillsScroll} role="tablist" aria-label="Bộ chỉ số vận hành Cotik">
        {pills.map((pill) => {
          const isActive = activePillKey === pill.key;
          return (
            <button
              key={pill.key}
              id={`pill-${pill.key}`}
              type="button"
              className={`${styles.pillButton} ${isActive ? styles.pillButtonActive : ""}`}
              onClick={(e) => handlePillClick(pill.key, e)}
              aria-expanded={isActive}
              aria-controls={isActive ? `notion-popover-${pill.key}` : undefined}
            >
              {pill.icon}
              <span>{pill.label}</span>
              <span className={styles.pillCount}>{pill.value}</span>
            </button>
          );
        })}
      </div>

      {activePillKey && (
        <>
          <div
            className={styles.notionPopoverBackdrop}
            onClick={() => setActivePillKey(null)}
            aria-hidden="true"
          />
          <div
            id={`notion-popover-${activePillKey}`}
            className={styles.notionPopoverCard}
            style={{ left: `${popoverLeft}px` }}
            role="dialog"
            aria-modal="true"
          >
            {renderPopoverContent(activePillKey, metrics, handleBackToPill, () => setActivePillKey(null))}
          </div>
        </>
      )}
    </div>
  );
}

function renderPopoverContent(
  key: PillKey,
  metrics: CotikPortfolioMetrics,
  onBackToPill: () => void,
  onClose: () => void
) {
  switch (key) {
    case "acc":
      return (
        <>
          <div className={styles.popoverHeader}>
            <div className={styles.popoverTitleRow}>
              <h4 className={styles.popoverTitle}>5 Tài khoản Cotik (AL-Token)</h4>
              <span className={styles.popoverBadge}>5 Active</span>
            </div>
            <button type="button" className={styles.popoverCloseBtn} onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className={styles.notionList}>
            {metrics.accounts.map((acc) => (
              <Link
                key={acc.key}
                href={`/accounts/${acc.key}`}
                className={styles.notionItem}
                onClick={onClose}
              >
                <div className={styles.notionItemLeft}>
                  <div className={styles.notionItemIcon}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <div className={styles.notionItemText}>
                    <div className={styles.notionItemTitle}>{acc.name} ({acc.owner})</div>
                    <div className={styles.notionItemSub}>
                      {acc.shopCount} shops • Deliv: {acc.deliveryRate} • {acc.maskedToken}
                    </div>
                  </div>
                </div>
                <div className={styles.notionItemRight}>
                  <span className={styles.notionItemValue}>
                    ${acc.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  <span className={styles.notionItemArrow}>→</span>
                </div>
              </Link>
            ))}
          </div>
          <div className={styles.popoverFooter}>
            <button type="button" className={styles.backPillBtn} onClick={onBackToPill}>
              ← Quay lại nút này
            </button>
            <span>Bấm vào để mở trang quản trị tài khoản</span>
          </div>
        </>
      );

    case "shops":
      return (
        <>
          <div className={styles.popoverHeader}>
            <div className={styles.popoverTitleRow}>
              <h4 className={styles.popoverTitle}>Danh mục 41 Cửa hàng theo Tài khoản</h4>
              <span className={styles.popoverBadge}>{metrics.totalShops} Shop</span>
            </div>
            <button type="button" className={styles.popoverCloseBtn} onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className={styles.notionList}>
            {metrics.accounts.map((acc) => (
              <Link
                key={acc.key}
                href={`/shops?account=${acc.key}`}
                className={styles.notionItem}
                onClick={onClose}
              >
                <div className={styles.notionItemLeft}>
                  <div className={styles.notionItemIcon}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    </svg>
                  </div>
                  <div className={styles.notionItemText}>
                    <div className={styles.notionItemTitle}>{acc.name}</div>
                    <div className={styles.notionItemSub}>{acc.shopCount} cửa hàng liên kết</div>
                  </div>
                </div>
                <div className={styles.notionItemRight}>
                  <span className={styles.notionItemValue}>{acc.shopCount} Shop</span>
                  <span className={styles.notionItemArrow}>→</span>
                </div>
              </Link>
            ))}
            <Link href="/shops" className={styles.notionItem} onClick={onClose} style={{ borderTop: "1px dashed rgba(255,255,255,0.12)", marginTop: 4 }}>
              <div className={styles.notionItemLeft}>
                <div className={styles.notionItemText}>
                  <div className={styles.notionItemTitle} style={{ color: "#ff8e88" }}>Xem toàn bộ 41 Cửa hàng</div>
                  <div className={styles.notionItemSub}>Bảng tổng hợp tất cả cửa hàng hệ thống</div>
                </div>
              </div>
              <div className={styles.notionItemRight}>
                <span className={styles.notionItemArrow}>→</span>
              </div>
            </Link>
          </div>
          <div className={styles.popoverFooter}>
            <button type="button" className={styles.backPillBtn} onClick={onBackToPill}>
              ← Quay lại nút này
            </button>
            <span>Lọc danh sách theo tài khoản</span>
          </div>
        </>
      );

    case "onhold":
      return (
        <>
          <div className={styles.popoverHeader}>
            <div className={styles.popoverTitleRow}>
              <h4 className={styles.popoverTitle}>Tài chính On Hold theo Tài khoản</h4>
              <span className={styles.popoverBadge}>
                ${metrics.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <button type="button" className={styles.popoverCloseBtn} onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className={styles.notionList}>
            {metrics.accounts.map((acc) => (
              <Link
                key={acc.key}
                href={`/accounts/${acc.key}`}
                className={styles.notionItem}
                onClick={onClose}
              >
                <div className={styles.notionItemLeft}>
                  <div className={styles.notionItemText}>
                    <div className={styles.notionItemTitle}>{acc.name}</div>
                    <div className={styles.notionItemSub}>{acc.shopCount} shop • Deliv: {acc.deliveryRate}</div>
                  </div>
                </div>
                <div className={styles.notionItemRight}>
                  <span className={styles.notionItemValue} style={{ color: "#34d399" }}>
                    ${acc.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  <span className={styles.notionItemArrow}>→</span>
                </div>
              </Link>
            ))}
          </div>
          <div className={styles.popoverFooter}>
            <button type="button" className={styles.backPillBtn} onClick={onBackToPill}>
              ← Quay lại nút này
            </button>
            <span>Dữ liệu On Hold cập nhật từ COTIK</span>
          </div>
        </>
      );

    case "orders":
    case "intransit":
    case "delivered":
    case "completed":
    case "refund":
    case "cancelled":
    case "awaiting_tracking": {
      const titles: Record<string, { title: string; badge: string; getCount: (acc: typeof metrics.accounts[0]) => number }> = {
        orders: { title: "Tổng Đơn hàng theo Tài khoản", badge: `${metrics.totalOrders} Đơn`, getCount: (a) => a.totalOrders },
        intransit: { title: "Đơn Đang Vận Chuyển (In Transit)", badge: `${metrics.inTransitOrders} Đơn`, getCount: (a) => a.inTransitOrders },
        delivered: { title: "Đơn Đã Giao Hàng (Delivered)", badge: `${metrics.deliveredOrders} Đơn`, getCount: (a) => a.deliveredOrders },
        completed: { title: "Đơn Hoàn Thành (Completed)", badge: `${metrics.completedOrders} Đơn`, getCount: (a) => a.completedOrders },
        refund: { title: "Đơn Refund / Trả Hàng (Return)", badge: `${metrics.refundOrders} Đơn`, getCount: (a) => a.refundOrders },
        cancelled: { title: "Đơn Đã Hủy (Cancelled)", badge: `${metrics.cancelledOrders} Đơn`, getCount: (a) => a.cancelledOrders },
        awaiting_tracking: { title: "Đơn Chờ Tracking", badge: `${metrics.awaitingTrackingOrders} Đơn`, getCount: (a) => a.awaitingTrackingOrders },
      };
      const info = titles[key] ?? {
        title: "Chi tiết",
        badge: "0 Đơn",
        getCount: () => 0,
      };
      return (
        <>
          <div className={styles.popoverHeader}>
            <div className={styles.popoverTitleRow}>
              <h4 className={styles.popoverTitle}>{info.title}</h4>
              <span className={styles.popoverBadge}>{info.badge}</span>
            </div>
            <button type="button" className={styles.popoverCloseBtn} onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className={styles.notionList}>
            {metrics.accounts.map((acc) => {
              const count = info.getCount(acc);
              return (
                <Link
                  key={acc.key}
                  href={`/accounts/${acc.key}`}
                  className={styles.notionItem}
                  onClick={onClose}
                >
                  <div className={styles.notionItemLeft}>
                    <div className={styles.notionItemText}>
                      <div className={styles.notionItemTitle}>{acc.name}</div>
                      <div className={styles.notionItemSub}>{acc.shopCount} shop • Chủ sở hữu: {acc.owner}</div>
                    </div>
                  </div>
                  <div className={styles.notionItemRight}>
                    <span className={styles.notionItemValue}>{count} đơn</span>
                    <span className={styles.notionItemArrow}>→</span>
                  </div>
                </Link>
              );
            })}
          </div>
          <div className={styles.popoverFooter}>
            <button type="button" className={styles.backPillBtn} onClick={onBackToPill}>
              ← Quay lại nút này
            </button>
            <span>Bấm vào để xem danh sách chi tiết tài khoản</span>
          </div>
        </>
      );
    }
  }
}
