"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowPathIcon,
  BuildingStorefrontIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";

import type { ConsoleShopSummary, PaginatedResult } from "../../lib/operations-console-contract";
import { useGlobalTasks } from "../../components/operations/global-task-context";
import { StatusBadge } from "../../components/ui/status-badge";
import { PageSidePanel } from "../../components/shell/page-side-panel";
import styles from "./shops.module.css";

function formatDeliveryRate(rate: number | null | undefined): { label: string; color: string } {
  if (rate === null || rate === undefined) return { label: "Chưa đủ", color: "#94a3b8" };
  const num = Number(rate);
  if (Number.isNaN(num)) return { label: "Chưa đủ", color: "#94a3b8" };
  const pct = num <= 1 && num > 0 ? num * 100 : num;
  const label = `${pct.toFixed(1)}%`;
  if (pct >= 70) return { label, color: "#34d399" };
  if (pct >= 50) return { label, color: "#fbbf24" };
  return { label, color: "#ff8e88" };
}

function formatSyncTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Chưa sync";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "Chưa sync";
  return d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}


const syncLabels: Record<string, string> = {
  ACTIVE: "Đang đồng bộ",
  SUCCEEDED: "Đã đồng bộ",
  IDLE: "Chưa đồng bộ",
  PAUSED_LOGIN: "Cần đăng nhập",
  PAUSED_CHALLENGE: "Đang thử thách",
  PAUSED_LAYOUT: "Giao diện thay đổi",
  DISABLED: "Đã tắt",
};

const decisionLabels: Record<string, string> = {
  SCALE: "SCALE",
  CONTINUE: "CONTINUE",
  WATCH: "WATCH",
  PAUSE: "PAUSE",
};

interface Props {
  initialResult: PaginatedResult<ConsoleShopSummary>;
  initialParams: {
    query?: string;
    syncState?: string;
    verificationState?: string;
    recommendation?: string;
    page?: string;
    pageSize?: string;
    sortBy?: string;
    sortOrder?: string;
  };
}

export function ShopsListClient({ initialResult, initialParams }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState(initialParams.query ?? "");
  const [syncState, setSyncState] = useState(initialParams.syncState ?? "");
  const [verificationState, setVerificationState] = useState(initialParams.verificationState ?? "");
  const [recommendation, setRecommendation] = useState(initialParams.recommendation ?? "");
  const [sortBy, setSortBy] = useState(initialParams.sortBy ?? "profileNo");
  const [sortOrder, setSortOrder] = useState(initialParams.sortOrder ?? "asc");
  const [pageSize, setPageSize] = useState(String(initialResult.pageSize || 20));

  const { isProfileBusy } = useGlobalTasks();
  const [actionFeedback, setActionFeedback] = useState<{ id: string; msg: string; type: "success" | "error" } | null>(null);
  const [refreshingList, setRefreshingList] = useState(false);

  const applyFilters = (newPage = 1, customPageSize = pageSize) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (syncState) params.set("syncState", syncState);
    if (verificationState) params.set("verificationState", verificationState);
    if (recommendation) params.set("recommendation", recommendation);
    if (sortBy) params.set("sortBy", sortBy);
    if (sortOrder) params.set("sortOrder", sortOrder);
    params.set("page", String(newPage));
    params.set("pageSize", String(customPageSize));

    startTransition(() => {
      router.push(`/shops?${params.toString()}`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters(1);
  };

  const handleRefresh = async () => {
    setActionFeedback(null);
    setRefreshingList(true);
    try {
      const res = await fetch("/api/shops/refresh", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setActionFeedback({
          id: "refresh",
          msg: data.message || `Đã làm mới danh sách: cập nhật ${data.totalProcessed} shop từ 5 tài khoản COTIK.`,
          type: "success",
        });
        startTransition(() => {
          router.refresh();
        });
      } else {
        setActionFeedback({
          id: "refresh",
          msg: `Lỗi làm mới: ${data.error?.message || "Không thể tải danh sách từ COTIK"}`,
          type: "error",
        });
      }
    } catch {
      setActionFeedback({
        id: "refresh",
        msg: "Lỗi kết nối khi gọi API làm mới danh sách COTIK",
        type: "error",
      });
    } finally {
      setRefreshingList(false);
    }
  };

  const handleIngestCotik = async (profileNo: string) => {
    setActionFeedback(null);
    try {
      const res = await fetch("/api/sync/cotik", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileNo }),
      });
      const data = await res.json();
      if (data.ok) {
        const ordersCount = data.cotikOrders?.rowsWritten ?? 0;
        const financeCount = data.cotikFinance?.rowsWritten ?? 0;
        setActionFeedback({
          id: profileNo,
          msg: `Đã nạp COTIK cho #${profileNo}: ${ordersCount} đơn, ${financeCount} tài chính (${data.cotikOrders?.mode || "SYNC"}).`,
          type: "success",
        });
        startTransition(() => {
          router.refresh();
        });
      } else {
        const skipReason = (data.cotikOrders as any)?.skipReason || (data.cotikFinance as any)?.skipReason;
        const rawErr = data.message || skipReason || data.error?.message || data.cotikOrders?.error || data.cotikFinance?.error || "Thất bại";
        let userMsg = typeof rawErr === "string" ? rawErr : JSON.stringify(rawErr);
        if (userMsg.includes("COTIK_BINDING_INACTIVE")) {
          userMsg = "Shop chưa liên kết COTIK. Bấm 'Làm mới danh sách' ở góc trên để cập nhật liên kết.";
        }
        setActionFeedback({ id: profileNo, msg: `Lỗi nạp COTIK: ${userMsg}`, type: "error" });
      }
    } catch {
      setActionFeedback({ id: profileNo, msg: "Lỗi kết nối khi nạp dữ liệu COTIK", type: "error" });
    }
  };

  return (
    <div className={styles.shopsPageLayout}>
      {/* Left Column: Full-height PageSidePanel with matching scenery thumbnail */}
      <PageSidePanel badgeText={`PORTFOLIO · ${initialResult.totalItems} SHOPS`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "9px 12px",
              borderRadius: "8px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.8125rem",
            }}
          >
            <span style={{ color: "var(--color-ink-muted)" }}>Tổng số cửa hàng:</span>
            <strong style={{ color: "var(--color-ink)" }}>{initialResult.totalItems} Shop</strong>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "9px 12px",
              borderRadius: "8px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.8125rem",
            }}
          >
            <span style={{ color: "var(--color-ink-muted)" }}>Tiêu chuẩn Delivery Rate:</span>
            <strong style={{ color: "var(--color-success)" }}>≥ 70% An toàn</strong>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "9px 12px",
              borderRadius: "8px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.8125rem",
            }}
          >
            <span style={{ color: "var(--color-ink-muted)" }}>Đồng bộ dữ liệu:</span>
            <strong style={{ color: "var(--color-info)" }}>COTIK Realtime</strong>
          </div>
        </div>

        <div
          style={{
            marginTop: 4,
            padding: "10px 12px",
            borderRadius: "8px",
            background: "var(--color-primary-soft)",
            border: "1px solid var(--color-primary-soft)",
            fontSize: "0.75rem",
            lineHeight: 1.45,
            color: "var(--color-primary-ink)",
          }}
        >
          💡 Bấm vào từng shop để mở trang thẩm định chuyên sâu với đầy đủ lịch sử phân tích và khuyến nghị AI.
        </div>
      </PageSidePanel>

      {/* Right Column: Existing Shops Container */}
      <div className={styles.shopsContainer} data-layout="fixed-console">
        <header className={styles.pageHeader} data-fixed-region="page-header">
          <div>
            <div className={styles.pageTitleRow}>
              <h1 className={styles.pageTitle}>Danh Sách Cửa Hàng TikTok Shop</h1>
              <span className={styles.totalCounterBadge}>
                <strong>{initialResult.totalItems}</strong> shop
              </span>
            </div>
          </div>
          <button
            type="button"
            className={styles.actionBtnTertiary}
            onClick={handleRefresh}
            disabled={isPending || refreshingList}
            aria-label="Làm mới danh sách cửa hàng từ 5 tài khoản COTIK"
            title="GET tuần tự danh sách cửa hàng từ 5 al-token COTIK"
          >
            <ArrowPathIcon className={`${styles.actionIcon} ${refreshingList ? styles.spinIcon : ""}`} aria-hidden="true" />
            <span>{refreshingList ? "Đang làm mới..." : "Làm mới danh sách"}</span>
          </button>
        </header>

      {/* Filter & Search Bar */}
      <section className={styles.filterSection} data-fixed-region="filters" aria-label="Bộ lọc danh sách cửa hàng">
        <form onSubmit={handleSearchSubmit} className={styles.searchForm}>
          <div className={styles.searchInputWrap}>
            <MagnifyingGlassIcon className={styles.searchIcon} aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo profileNo, tên shop, TikTok Shop ID, nhóm..."
              className={styles.searchInput}
            />
          </div>
          <button type="submit" className={styles.searchButton} disabled={isPending}>
            Tìm kiếm
          </button>
        </form>

        <div className={styles.filterControls}>
          <div className={styles.filterGroup}>
            <label htmlFor="sync-filter">Đồng bộ:</label>
            <select
              id="sync-filter"
              value={syncState}
              onChange={(e) => {
                setSyncState(e.target.value);
                applyFilters(1);
              }}
              className={styles.selectInput}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="ACTIVE">ACTIVE (Hoạt động)</option>
              <option value="IDLE">IDLE (Nghỉ)</option>
              <option value="PAUSED_LOGIN">Tạm dừng (Cần đăng nhập)</option>
              <option value="PAUSED_CHALLENGE">Tạm dừng (Thử thách)</option>
              <option value="PAUSED_LAYOUT">Tạm dừng (Thay đổi giao diện)</option>
              <option value="DISABLED">Vô hiệu hóa</option>
            </select>
          </div>


          <div className={styles.filterGroup}>
            <label htmlFor="sort-filter">Sắp xếp:</label>
            <select
              id="sort-filter"
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split("-");
                if (sb) setSortBy(sb);
                if (so) setSortOrder(so);
                applyFilters(1);
              }}
              className={styles.selectInput}
            >
              <option value="profileNo-asc">Profile No (Tăng dần)</option>
              <option value="profileNo-desc">Profile No (Giảm dần)</option>
              <option value="displayName-asc">Tên Shop (A-Z)</option>
              <option value="totalOrders-desc">Đơn hàng (Nhiều nhất)</option>
              <option value="onHoldAmount-desc">Tiền On Hold (Cao nhất)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Global Action Feedback */}
      {actionFeedback && (
        <div
          className={`${styles.feedbackBanner} ${
            actionFeedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError
          }`}
          data-fixed-region="feedback"
          role="status"
          aria-live="polite"
        >
          <span>{actionFeedback.msg}</span>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className={styles.closeFeedback}
            aria-label="Đóng thông báo"
          >
            &times;
          </button>
        </div>
      )}

      {/* Table Section (Desktop) / Cards (Mobile) */}
      <section className={styles.tableSection} aria-label="Bảng dữ liệu cửa hàng">
        <div className={styles.tableResponsiveWrap} data-scroll-region="profiles">
          <table className={styles.shopsTable}>
            <thead>
              <tr>
                <th scope="col">Profile</th>
                <th scope="col">Cửa Hàng</th>
                <th scope="col">Shop Health</th>
                <th scope="col">Trạng Thái COTIK</th>
                <th scope="col">Đơn Hàng</th>
                <th scope="col">OH COTIK</th>
                <th scope="col">Delivery Rate</th>
                <th scope="col">Đồng Bộ Gần Nhất</th>
                <th scope="col">Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {initialResult.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className={styles.noDataCell}>
                    Không tìm thấy cửa hàng nào khớp với điều kiện lọc.
                  </td>
                </tr>
              ) : (
                initialResult.items.map((shop) => {
                  const isUnlinked = shop.id.startsWith("unlinked-") || shop.displayName.includes("Chưa liên kết");
                  const deliveryInfo = formatDeliveryRate(shop.deliveryRate);

                  return (
                    <tr key={shop.id}>
                      <td>
                        <div className={styles.profileCell}>
                          <span className={styles.profileNo}>#{shop.profileNo}</span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.shopIdentityCell}>
                          {isUnlinked ? (
                            <div className={styles.unlinkedShopWrap}>
                              <span className={styles.unlinkedShopName}>{shop.displayName}</span>
                              <span className={styles.unlinkedBadge}>Chưa liên kết TikTok Shop</span>
                            </div>
                          ) : (
                            <Link href={`/shops/${shop.profileNo}`} className={styles.shopLink}>
                              <strong>{shop.displayName}</strong>
                            </Link>
                          )}
                          <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 2 }}>
                            <span>ShopID: </span>
                            <code style={{ color: "#cbd5e1" }}>
                              {shop.verifiedTiktokShopId || shop.cotikBinding?.cotikShopId || "Chưa có ID"}
                            </code>
                          </div>
                          {shop.groupName && (
                            <span className={styles.groupBadge}>Nhóm: {shop.groupName}</span>
                          )}
                          {shop.cotikBinding?.cotikShopId && (
                            <small className={styles.ttsId}>COTIK ID: {shop.cotikBinding.cotikShopId}</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <StatusBadge
                          tone={
                            shop.compositeHealth === "HEALTHY"
                              ? "success"
                              : shop.compositeHealth === "AT_RISK"
                              ? "danger"
                              : "neutral"
                          }
                        >
                          {shop.compositeHealth === "HEALTHY" ? "An toàn" : shop.compositeHealth === "AT_RISK" ? "Cần chú ý" : "Chưa kết nối"}
                        </StatusBadge>
                      </td>
                      <td>
                        <div className={styles.syncCell}>
                          {shop.cotikBinding?.enabled ? (
                            <StatusBadge tone="success">COTIK: Đã kết nối</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">Chưa kết nối</StatusBadge>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={styles.metricVal}>
                          {shop.totalOrders !== null ? shop.totalOrders.toLocaleString("vi-VN") : "—"}
                        </span>
                      </td>
                      <td>
                        <strong className={styles.prominentMetricGreen}>
                          {shop.onHoldAmount !== null ? `$${Number(shop.onHoldAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
                        </strong>
                      </td>
                      <td>
                        <span style={{ color: deliveryInfo.color, fontWeight: 700, fontSize: "0.8125rem", whiteSpace: "nowrap" }}>
                          {deliveryInfo.label}
                        </span>
                      </td>
                      <td>
                        <div className={styles.syncCell}>
                          <span className={styles.syncBadge} data-state={syncLabels[shop.syncState] ?? shop.syncState}>
                            {syncLabels[shop.syncState] ?? shop.syncState}
                          </span>
                          <small className={styles.syncTime}>
                            {formatSyncTime(shop.lastOrdersSyncedAt || shop.cotikBinding?.lastOrdersSyncedAt || shop.lastFinanceSyncedAt)}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className={styles.actionsGroup}>
                          {(() => {
                            const isBusy = isProfileBusy(shop.profileNo);

                            return (
                              <>
                                <button
                                  type="button"
                                  className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                                  onClick={() => handleIngestCotik(shop.profileNo)}
                                  disabled={isBusy || isPending}
                                  title="GET đồng bộ thông tin từ COTIK"
                                >
                                  <ArrowDownTrayIcon className={styles.actionIcon} aria-hidden="true" />
                                  <span>Sync COTIK</span>
                                </button>
                                <Link
                                  href={`/shops/${shop.profileNo}`}
                                  className={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                                  title="Xem chi tiết cửa hàng"
                                >
                                  <span>Chi tiết →</span>
                                </Link>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination & Page Size */}
        <div className={styles.paginationBar} data-fixed-region="pagination">
          <div className={styles.pageSizeControl}>
            <label htmlFor="page-size-select">Hiển thị:</label>
            <select
              id="page-size-select"
              value={pageSize}
              onChange={(e) => {
                const nextSize = e.target.value;
                setPageSize(nextSize);
                applyFilters(1, nextSize);
              }}
              className={styles.selectInputSmall}
            >
              <option value="20">20 profile / trang</option>
              <option value="50">50 profile / trang</option>
              <option value="100">100 profile / trang</option>
              <option value="200">Tất cả ({initialResult.totalItems} profile)</option>
            </select>
          </div>

          <span className={styles.pageInfo}>
            Trang <strong>{initialResult.page}</strong> / {initialResult.totalPages || 1} (Tổng <strong>{initialResult.totalItems}</strong> profile)
          </span>

          {initialResult.totalPages > 1 && (
            <div className={styles.paginationButtons}>
              <button
                type="button"
                onClick={() => applyFilters(initialResult.page - 1)}
                disabled={initialResult.page <= 1 || isPending}
                className={styles.pageBtn}
              >
                <ChevronLeftIcon className={styles.btnIcon} aria-hidden="true" />
                <span>Trước</span>
              </button>
              <button
                type="button"
                onClick={() => applyFilters(initialResult.page + 1)}
                disabled={initialResult.page >= initialResult.totalPages || isPending}
                className={styles.pageBtn}
              >
                <span>Sau</span>
                <ChevronRightIcon className={styles.btnIcon} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  </div>
  );
}
