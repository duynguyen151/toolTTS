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
  PlayIcon,
  ShieldCheckIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";

import type { ConsoleShopSummary, PaginatedResult } from "../../lib/operations-console-contract";
import { useGlobalTasks } from "../../components/operations/global-task-context";
import { StatusBadge } from "../../components/ui/status-badge";
import { TriadBadgeGroup } from "../../components/dashboard/triad-badge-group";
import styles from "./shops.module.css";

const verificationLabels: Record<string, string> = {
  READY: "Sẵn sàng",
  LOGIN_REQUIRED: "Cần đăng nhập",
  UNVERIFIED: "Chưa xác thực",
  HUMAN_ACTION_REQUIRED: "Cần thao tác",
  UNSUPPORTED_REGION: "Khu vực chưa hỗ trợ",
};

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

  const { startSync, startVerify, startOpen, isProfileBusy } = useGlobalTasks();
  const [actionFeedback, setActionFeedback] = useState<{ id: string; msg: string; type: "success" | "error" } | null>(null);

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

  const handleOpenProfile = async (profileNo: string, displayName?: string) => {
    setActionFeedback(null);
    const ok = await startOpen(profileNo, displayName);
    if (ok) {
      setActionFeedback({ id: profileNo, msg: `Đã mở profile #${profileNo} thành công`, type: "success" });
    } else {
      setActionFeedback({ id: profileNo, msg: "Không thể mở profile", type: "error" });
    }
  };

  const handleVerifyProfile = async (profileNo: string, displayName?: string) => {
    setActionFeedback(null);
    const isReady = await startVerify(profileNo, displayName);
    if (isReady) {
      setActionFeedback({ id: profileNo, msg: `Đã xác thực profile #${profileNo}: Sẵn sàng (READY)`, type: "success" });
    } else {
      setActionFeedback({ id: profileNo, msg: "Xác thực cần thao tác hoặc chưa hoàn tất", type: "error" });
    }
  };

  const handleSyncSelected = async (profileNo: string, displayName?: string) => {
    setActionFeedback(null);
    const ok = await startSync(profileNo, displayName);
    if (ok) {
      setActionFeedback({ id: profileNo, msg: `Đã kích hoạt đồng bộ profile #${profileNo}`, type: "success" });
    } else {
      setActionFeedback({ id: profileNo, msg: "Không thể đồng bộ profile", type: "error" });
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
        setActionFeedback({ id: profileNo, msg: `Đã nạp dữ liệu COTIK mới nhất cho profile #${profileNo}`, type: "success" });
        applyFilters(initialResult.page);
      } else {
        setActionFeedback({ id: profileNo, msg: `Lỗi nạp COTIK: ${data.error?.message ?? "Thất bại"}`, type: "error" });
      }
    } catch {
      setActionFeedback({ id: profileNo, msg: "Lỗi kết nối khi nạp dữ liệu COTIK", type: "error" });
    }
  };

  return (
    <div className={styles.shopsContainer}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.titleBadgeRow}>
            <div className={styles.titleBadge}>
              <BuildingStorefrontIcon className={styles.badgeIcon} aria-hidden="true" />
              <span>Quản Lý Vận Hành Tập Trung</span>
            </div>
            <span className={styles.totalCounterBadge}>
              Tổng cộng: <strong>{initialResult.totalItems}</strong> Profile AdsPower
            </span>
          </div>
          <h1 className={styles.pageTitle}>Danh Sách Cửa Hàng TikTok Shop</h1>
          <p className={styles.pageDescription}>
            Hệ thống đồng bộ đầy đủ toàn bộ hồ sơ trình duyệt AdsPower. Tìm kiếm, lọc theo nhóm/thẻ, thực hiện thao tác nhanh (Mở, Xác thực, Đồng bộ) và quản lý chi tiết.
          </p>
        </div>
      </header>

      {/* Filter & Search Bar */}
      <section className={styles.filterSection} aria-label="Bộ lọc danh sách cửa hàng">
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
            <label htmlFor="verify-filter">Xác thực:</label>
            <select
              id="verify-filter"
              value={verificationState}
              onChange={(e) => {
                setVerificationState(e.target.value);
                applyFilters(1);
              }}
              className={styles.selectInput}
            >
              <option value="">Tất cả xác thực</option>
              <option value="READY">READY (Sẵn sàng)</option>
              <option value="UNVERIFIED">UNVERIFIED (Chưa xác thực)</option>
              <option value="LOGIN_REQUIRED">LOGIN_REQUIRED (Cần đăng nhập)</option>
              <option value="HUMAN_ACTION_REQUIRED">HUMAN_ACTION_REQUIRED</option>
              <option value="UNSUPPORTED_REGION">Khu vực không hỗ trợ</option>
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
        <div className={styles.tableResponsiveWrap}>
          <table className={styles.shopsTable}>
            <thead>
              <tr>
                <th scope="col">Profile</th>
                <th scope="col">Cửa Hàng / Nhóm</th>
                <th scope="col">Shop Health</th>
                <th scope="col">Xác Thực & COTIK</th>
                <th scope="col">Đồng Bộ</th>
                <th scope="col">Đơn Hàng</th>
                <th scope="col">On Hold</th>
                <th scope="col">Triad (Rule/AI/BA)</th>
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

                  return (
                    <tr key={shop.id}>
                      <td>
                        <div className={styles.profileCell}>
                          <span className={styles.profileNo}>#{shop.profileNo}</span>
                          {shop.adsPowerState && (
                            <span
                              className={styles.adsStateDot}
                              data-state={shop.adsPowerState}
                              title={`AdsPower: ${shop.adsPowerState}`}
                            />
                          )}
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
                          {shop.groupName && (
                            <span className={styles.groupBadge}>Nhóm: {shop.groupName}</span>
                          )}
                          {shop.tags && shop.tags.length > 0 && (
                            <div className={styles.tagsRow} aria-label="AdsPower tags">
                              {shop.tags.slice(0, 4).map((tag) => {
                                const name = typeof tag === "string" ? tag : tag.name;
                                const color = typeof tag === "string" ? undefined : tag.color;
                                return (
                                  <span key={name} className={styles.tagChip} data-color={color}>
                                    {name}
                                  </span>
                                );
                              })}
                              {shop.tags.length > 4 && <span className={styles.tagsMore}>+{shop.tags.length - 4}</span>}
                            </div>
                          )}
                          {shop.verifiedTiktokShopId && (
                            <small className={styles.ttsId}>TTS ID: {shop.verifiedTiktokShopId}</small>
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
                              : "warning"
                          }
                        >
                          {shop.compositeHealth === "HEALTHY" ? "An toàn" : shop.compositeHealth === "AT_RISK" ? "Cần chú ý" : "Lỗi dữ liệu"}
                        </StatusBadge>
                      </td>
                      <td>
                        <div className={styles.syncCell}>
                          <span
                            className={styles.verificationBadge}
                            data-state={shop.verificationState}
                          >
                            {verificationLabels[shop.verificationState] ?? shop.verificationState}
                          </span>
                          {shop.cotikBinding?.enabled ? (
                            <StatusBadge tone="info">COTIK: Đã nối</StatusBadge>
                          ) : (
                            <small className={styles.mutedText}>COTIK: Chưa nối</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className={styles.syncCell}>
                          <span className={styles.syncBadge} data-state={syncLabels[shop.syncState] ?? shop.syncState}>
                            {syncLabels[shop.syncState] ?? shop.syncState}
                          </span>
                          {shop.lastOrdersSyncedAt && (
                            <small className={styles.syncTime}>
                              {new Date(shop.lastOrdersSyncedAt).toLocaleTimeString("vi-VN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={styles.metricVal}>
                          {shop.totalOrders !== null ? shop.totalOrders.toLocaleString("vi-VN") : "—"}
                        </span>
                      </td>
                      <td>
                        <span className={styles.metricVal}>
                          {shop.onHoldAmount !== null ? `$${Number(shop.onHoldAmount).toLocaleString("vi-VN", { minimumFractionDigits: 2 })}` : "—"}
                        </span>
                      </td>
                      <td>
                        <TriadBadgeGroup
                          ruleResult={shop.latestRecommendation}
                          aiRecommendation={shop.latestAiRecommendation}
                          baDecision={shop.latestBaDecision}
                          compact
                        />
                      </td>
                      <td>
                        <div className={styles.actionsGroup}>
                          {(() => {
                            const isBusy = isProfileBusy(shop.profileNo);

                            return (
                              <>
                                {shop.cotikBinding?.enabled ? (
                                  <button
                                    type="button"
                                    className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                                    onClick={() => handleIngestCotik(shop.profileNo)}
                                    disabled={isBusy || isPending}
                                    title="Nạp dữ liệu từ COTIK API (Nguồn chính)"
                                  >
                                    <ArrowDownTrayIcon className={styles.actionIcon} aria-hidden="true" />
                                    <span>Sync COTIK (Chính)</span>
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={styles.actionBtn}
                                  onClick={() => handleOpenProfile(shop.profileNo, shop.displayName)}
                                  disabled={isBusy || isPending}
                                  title="Mở AdsPower Browser (Khi cần kiểm tra trực tiếp)"
                                >
                                  <PlayIcon className={styles.actionIcon} aria-hidden="true" />
                                  <span>Mở</span>
                                </button>
                                <button
                                  type="button"
                                  className={styles.actionBtn}
                                  onClick={() => handleVerifyProfile(shop.profileNo, shop.displayName)}
                                  disabled={isBusy || isPending}
                                  title="Xác thực danh tính Seller Center"
                                >
                                  <ShieldCheckIcon className={styles.actionIcon} aria-hidden="true" />
                                  <span>Xác thực</span>
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                                  onClick={() => handleSyncSelected(shop.profileNo, shop.displayName)}
                                  disabled={isBusy || isPending}
                                  title="Đồng bộ qua AdsPower / Seller Center (Chế độ dự phòng Fallback)"
                                >
                                  <ArrowPathIcon className={styles.actionIcon} aria-hidden="true" />
                                  <span>Sync SC (Fallback)</span>
                                </button>
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
        <div className={styles.paginationBar}>
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
  );
}
