"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ChartBarIcon,
  CircleStackIcon,
  ClipboardDocumentCheckIcon,
  DocumentMagnifyingGlassIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  TagIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import type { ConsoleShopDetail, ConsoleTabKey } from "../../../lib/operations-console-contract";
import { useGlobalTasks } from "../../../components/operations/global-task-context";
import { LiveBaForm } from "../../../components/dashboard/live-ba-form";
import styles from "./shop-detail.module.css";

const SIGNAL_LABELS: Record<string, string> = {
  RAPID_ONHOLD_GROWTH: "Tăng nhanh On Hold",
  DELIVERY_DETERIORATION: "Suy giảm tỷ lệ giao hàng",
  REFUND_SPIKE: "Đột biến hoàn tiền",
  RECOVERY_TREND: "Xu hướng phục hồi",
  THRESHOLD_FLAPPING: "Dao động quanh ngưỡng",
};
const STATUS_LABELS: Record<string, string> = {
  TRIGGERED: "Đã kích hoạt",
  NOT_TRIGGERED: "Không kích hoạt",
  NOT_EVALUATED: "Chưa đánh giá",
};
const REASON_LABELS: Record<string, string> = {
  POLICY_UNCONFIGURED: "Chưa cấu hình chính sách rủi ro",
  DATA_INSUFFICIENT: "Dữ liệu chưa đủ để đánh giá",
};

function friendlyReason(reason: string): string {
  return REASON_LABELS[reason] ?? reason.toLowerCase().replaceAll("_", " ").replace(/^\\w/, (c) => c.toUpperCase());
}

function metricValue(label: string, value: string): string {
  if (!value || value === "null" || value === "undefined") return "Chưa đủ dữ liệu";
  const lower = label.toLowerCase();
  if (lower.includes("rate") || lower.includes("tỷ lệ") || lower.includes("delivery") || lower.includes("cancel") || lower.includes("refund")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${(numeric <= 1 ? numeric * 100 : numeric).toFixed(1)}%` : value;
  }
  if (lower.includes("exposure") || lower.includes("rủi ro") || lower.includes("hold")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `$${numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value;
  }
  return value;
}

interface Props {
  initialDetail: ConsoleShopDetail;
  initialTab: ConsoleTabKey;
}

export function ShopDetailClient({ initialDetail, initialTab }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ConsoleTabKey>(initialTab);
  const { isProfileBusy } = useGlobalTasks();
  const isBusy = isProfileBusy(initialDetail.shop.profileNo);
  const [actionFeedback, setActionFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Edit Modal State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(initialDetail.shop.displayName || "");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete / Unlink Modal State
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { shop, overview, dataTab, tagsTab, syncTab, statsTab, baTab, auditTab } = initialDetail;

  const handleTabChange = (tab: ConsoleTabKey) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `/shops/${shop.profileNo}?tab=${tab}`);
  };


  const handleIngestCotik = async () => {
    setActionFeedback(null);
    try {
      const res = await fetch("/api/sync/cotik", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileNo: shop.profileNo }),
      });
      const data = await res.json();
      if (data.ok) {
        const ordersCount = data.cotikOrders?.rowsWritten ?? 0;
        const financeCount = data.cotikFinance?.rowsWritten ?? 0;
        setActionFeedback({
          msg: `Đã nạp COTIK thành công: ${ordersCount} đơn hàng, ${financeCount} bản ghi tài chính (${data.cotikOrders?.mode || "SYNC"}).`,
          type: "success",
        });
        router.refresh();
      } else {
        const skipReason = (data.cotikOrders as any)?.skipReason || (data.cotikFinance as any)?.skipReason;
        const rawErr = data.message || skipReason || data.error?.message || data.cotikOrders?.error || data.cotikFinance?.error || "Thất bại";
        let userMsg = typeof rawErr === "string" ? rawErr : JSON.stringify(rawErr);
        if (userMsg.includes("COTIK_BINDING_INACTIVE")) {
          userMsg = "Shop chưa liên kết COTIK. Vui lòng vào danh sách Shop bấm 'Làm mới danh sách' để cập nhật liên kết.";
        }
        setActionFeedback({ msg: `Lỗi nạp COTIK: ${userMsg}`, type: "error" });
      }
    } catch {
      setActionFeedback({ msg: "Lỗi kết nối khi nạp dữ liệu COTIK", type: "error" });
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/shops/${shop.profileNo}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editDisplayName }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setIsEditOpen(false);
        setActionFeedback({ msg: "Cập nhật tên hiển thị cửa hàng thành công", type: "success" });
        router.refresh();
      } else {
        setEditError(data.error?.message || "Không thể cập nhật tên hiển thị");
      }
    } catch {
      setEditError("Lỗi kết nối khi cập nhật thông tin");
    } finally {
      setEditSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/shops/${shop.profileNo}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setIsDeleteOpen(false);
        router.push("/shops");
      } else {
        setDeleteError(data.error?.message || "Không thể gỡ liên kết cửa hàng");
      }
    } catch {
      setDeleteError("Lỗi kết nối khi gỡ liên kết");
    } finally {
      setDeleteSaving(false);
    }
  };

  return (
    <div className={styles.detailContainer}>
      {/* Top Navigation & Breadcrumb */}
      <div className={styles.topNav}>
        <Link href="/shops" className={styles.backLink}>
          <ArrowLeftIcon className={styles.navIcon} aria-hidden="true" />
          <span>Quay lại danh sách cửa hàng</span>
        </Link>
      </div>

      {/* Main Header / Shop Identity */}
      <header className={styles.shopHeader}>
        <div className={styles.headerIdentity}>
          <div className={styles.headerMainLine}>
            <h1 className={styles.shopTitle}>Profile #{shop.profileNo}</h1>
            <span className={styles.divider}>|</span>
            <span className={styles.groupInfo}>
              <strong>Nhóm:</strong> {shop.groupName || "Chưa phân nhóm"}
            </span>
            {shop.tags && shop.tags.length > 0 && (
              <>
                <span className={styles.divider}>|</span>
                <div className={styles.tagsRow}>
                  <span className={styles.tagsLabel}>Thẻ:</span>
                  {shop.tags.map((t) => {
                    const name = typeof t === "string" ? t : t.name;
                    const color = typeof t === "string" ? undefined : t.color;
                    return (
                      <span
                        key={name}
                        className={styles.tagChip}
                        data-color={color}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <p className={styles.shopSub}>
            Tên hiển thị: <strong>{shop.displayName}</strong> &bull; TTS ID:{" "}
            <strong>{shop.verifiedTiktokShopId || "Chưa liên kết"}</strong> &bull; Trạng thái:{" "}
            <span className={styles.verificationBadge} data-state={shop.verificationState}>
              {shop.verificationState === "READY" ? "Sẵn sàng (READY)" : shop.verificationState}
            </span>{" "}
            &bull; Đồng bộ:{" "}
            <span className={styles.syncBadge} data-state={shop.syncState}>
              {shop.syncState}
            </span>
          </p>
        </div>

        {/* Quick Operations Actions */}
        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={handleIngestCotik}
            disabled={isBusy}
            className={styles.primaryBtn}
            title="Nạp dữ liệu từ COTIK API (Nguồn chính)"
          >
            <ArrowDownTrayIcon className={styles.btnIcon} aria-hidden="true" />
            <span>Sync COTIK</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditDisplayName(shop.displayName || "");
              setEditError(null);
              setIsEditOpen(true);
            }}
            className={styles.secondaryBtn}
          >
            <PencilSquareIcon className={styles.btnIcon} aria-hidden="true" />
            <span>Chỉnh sửa</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setIsDeleteOpen(true);
            }}
            className={styles.dangerBtn}
          >
            <TrashIcon className={styles.btnIcon} aria-hidden="true" />
            <span>Xóa khỏi giám sát</span>
          </button>
        </div>
      </header>

      {/* Edit Profile Modal */}
      {isEditOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 id="edit-profile-title" className={styles.modalTitle}>Chỉnh sửa thông tin Profile #{shop.profileNo}</h2>
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className={styles.modalCloseBtn}
                aria-label="Đóng"
              >
                <XMarkIcon className={styles.btnIcon} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit}>
              <div className={styles.modalBody}>
                {editError && (
                  <div className={`${styles.feedbackBanner} ${styles.feedbackError}`} role="alert">
                    <span>{editError}</span>
                  </div>
                )}
                <div className={styles.formGroup}>
                  <label htmlFor="edit-display-name" className={styles.formLabel}>
                    Tên hiển thị cửa hàng (DisplayName)
                  </label>
                  <input
                    id="edit-display-name"
                    type="text"
                    className={styles.formInput}
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    placeholder="Nhập tên hiển thị..."
                    required
                  />
                  <span className={styles.formHint}>
                    Lưu ý: Tên nhóm và Thẻ (tags) được đồng bộ trực tiếp từ AdsPower và không chỉnh sửa tại đây.
                  </span>
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  disabled={editSaving}
                  className={styles.secondaryBtn}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className={styles.primaryBtn}
                >
                  {editSaving ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / Unlink Confirmation Modal */}
      {isDeleteOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-profile-title">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleRow}>
                <ExclamationTriangleIcon className={styles.warningIcon} aria-hidden="true" />
                <h2 id="delete-profile-title" className={styles.modalTitle}>Xác nhận gỡ liên kết Profile #{shop.profileNo}</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteOpen(false)}
                className={styles.modalCloseBtn}
                aria-label="Đóng"
              >
                <XMarkIcon className={styles.btnIcon} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.modalBody}>
              {deleteError && (
                <div className={`${styles.feedbackBanner} ${styles.feedbackError}`} role="alert">
                  <span>{deleteError}</span>
                </div>
              )}
              <div className={styles.safetyNoticeBox}>
                <p className={styles.safetyNoticeText}>
                  Thao tác này chỉ gỡ liên kết và dừng giám sát profile trong hệ thống Tool_TTS. Hồ sơ trình duyệt AdsPower và tài khoản TikTok Shop của bạn hoàn toàn <strong>KHÔNG</strong> bị xóa.
                </p>
              </div>
              <p className={styles.modalConfirmText}>
                Bạn có chắc chắn muốn gỡ liên kết cửa hàng <strong>{shop.displayName}</strong> (Profile #{shop.profileNo}) khỏi hệ thống giám sát?
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setIsDeleteOpen(false)}
                disabled={deleteSaving}
                className={styles.secondaryBtn}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteSaving}
                className={styles.dangerConfirmBtn}
              >
                {deleteSaving ? "Đang xử lý..." : "Xác nhận gỡ liên kết"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action feedback */}
      {actionFeedback && (
        <div
          className={`${styles.feedbackBanner} ${
            actionFeedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError
          }`}
          role="status"
        >
          <span>{actionFeedback.msg}</span>
          <button type="button" onClick={() => setActionFeedback(null)} className={styles.closeBtn}>
            &times;
          </button>
        </div>
      )}

      {/* DRY_RUN & Live Audit Notice */}
      <div className={styles.dryRunBanner}>
        <ShieldCheckIcon className={styles.dryRunIcon} aria-hidden="true" />
        <div>
          <strong>Chế độ Vận hành: DRY_RUN (Chỉ đọc & Phân tích rủi ro)</strong>
          <p>Hệ thống không tự động thay đổi giá, tắt quảng cáo, hoặc kích hoạt Holiday Mode trên TikTok Seller Center.</p>
        </div>
      </div>

      {/* 7-Tabs Bar */}
      <nav className={styles.tabNav} aria-label="Các phân hệ chi tiết cửa hàng">
        <button
          type="button"
          onClick={() => handleTabChange("overview")}
          className={`${styles.tabBtn} ${activeTab === "overview" ? styles.tabBtnActive : ""}`}
          aria-current={activeTab === "overview" ? "page" : undefined}
        >
          <Squares2X2Icon className={styles.tabIcon} aria-hidden="true" />
          <span>1. Tổng Quan</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("data")}
          className={`${styles.tabBtn} ${activeTab === "data" ? styles.tabBtnActive : ""}`}
          aria-current={activeTab === "data" ? "page" : undefined}
        >
          <CircleStackIcon className={styles.tabIcon} aria-hidden="true" />
          <span>2. Dữ Liệu & Độ Phủ</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("tags")}
          className={`${styles.tabBtn} ${activeTab === "tags" ? styles.tabBtnActive : ""}`}
          aria-current={activeTab === "tags" ? "page" : undefined}
        >
          <TagIcon className={styles.tabIcon} aria-hidden="true" />
          <span>3. Thẻ & Nhóm</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("sync")}
          className={`${styles.tabBtn} ${activeTab === "sync" ? styles.tabBtnActive : ""}`}
          aria-current={activeTab === "sync" ? "page" : undefined}
        >
          <ArrowPathIcon className={styles.tabIcon} aria-hidden="true" />
          <span>4. Lịch Sử Đồng Bộ</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("stats")}
          className={`${styles.tabBtn} ${activeTab === "stats" ? styles.tabBtnActive : ""}`}
          aria-current={activeTab === "stats" ? "page" : undefined}
        >
          <ChartBarIcon className={styles.tabIcon} aria-hidden="true" />
          <span>5. Thống Kê & Xu Hướng</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("ba")}
          className={`${styles.tabBtn} ${activeTab === "ba" ? styles.tabBtnActive : ""}`}
          aria-current={activeTab === "ba" ? "page" : undefined}
        >
          <ClipboardDocumentCheckIcon className={styles.tabIcon} aria-hidden="true" />
          <span>6. Thẩm Định BA</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("audit")}
          className={`${styles.tabBtn} ${activeTab === "audit" ? styles.tabBtnActive : ""}`}
          aria-current={activeTab === "audit" ? "page" : undefined}
        >
          <DocumentMagnifyingGlassIcon className={styles.tabIcon} aria-hidden="true" />
          <span>7. Nhật Ký Kiểm Toán</span>
        </button>
      </nav>

      {/* Tab Contents */}
      <main className={styles.tabPanel}>
        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
          <div className={styles.panelGrid}>
            <section className={styles.card} aria-labelledby="kpi-heading">
              <h2 id="kpi-heading" className={styles.cardTitle}>Chỉ Số Sức Khỏe Chính (KPIs)</h2>
              <div className={styles.kpiGrid}>
                {overview.kpis.map((kpi) => (
                  <div key={kpi.id} className={styles.kpiBox} data-tone={kpi.tone}>
                    <span className={styles.kpiLabel}>{kpi.label}</span>
                    <strong className={styles.kpiVal}>{kpi.value}</strong>
                    <small className={styles.kpiDetail}>{kpi.detail}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.card} aria-labelledby="order-health-heading">
              <div className={styles.cardHeaderFlex}>
                <h2 id="order-health-heading" className={styles.cardTitle}>
                  <Link
                    href={`/orders?profile=${encodeURIComponent(shop.profileNo)}`}
                    className={styles.cardTitleLink}
                    title="Mở Order Explorer cho profile này"
                  >
                    Cơ Cấu Sức Khỏe Đơn Hàng →
                  </Link>
                </h2>
                <Link
                  href={`/orders?profile=${encodeURIComponent(shop.profileNo)}`}
                  className={styles.cardHeaderActionLink}
                >
                  Order Explorer ({overview.orderHealth.total} đơn) →
                </Link>
              </div>
              <div className={styles.metricsList}>
                <div className={styles.metricRow}>
                  <span>Tổng đơn hàng ghi nhận:</span>
                  <strong>{overview.orderHealth.total}</strong>
                </div>
                {(overview.orderHealth.pending !== undefined && overview.orderHealth.pending !== "0") && (
                  <div className={styles.metricRow}>
                    <span>Đang chờ xử lý (Pending):</span>
                    <strong className={styles.warningText}>{overview.orderHealth.pending}</strong>
                  </div>
                )}
                <div className={styles.metricRow}>
                  <span>Đang chờ vận chuyển (Awaiting Shipment):</span>
                  <strong className={styles.warningText}>{overview.orderHealth.awaiting}</strong>
                </div>
                {(overview.orderHealth.inTransit !== undefined && overview.orderHealth.inTransit !== "0") && (
                  <div className={styles.metricRow}>
                    <span>Đang vận chuyển (In Transit):</span>
                    <strong className={styles.highlightVal}>{overview.orderHealth.inTransit}</strong>
                  </div>
                )}
                <div className={styles.metricRow}>
                  <span>Đã giao / Hoàn tất (Delivered/Completed):</span>
                  <strong className={styles.goodText}>{overview.orderHealth.delivered}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Đã hủy (Canceled):</span>
                  <strong className={styles.dangerText}>{overview.orderHealth.canceled}</strong>
                </div>
                {(overview.orderHealth.other !== undefined && overview.orderHealth.other !== "0") && (
                  <div className={styles.metricRow}>
                    <span>Khác / Chưa phân loại:</span>
                    <strong className={styles.dangerText}>{overview.orderHealth.other}</strong>
                  </div>
                )}
              </div>
            </section>

            <section className={styles.card} aria-labelledby="finance-heading">
              <h2 id="finance-heading" className={styles.cardTitle}>Tài Chính & On Hold</h2>
              <div className={styles.metricsList}>
                <div className={styles.metricRow}>
                  <span>Tổng On Hold Shop (sum_est_settlement_amount):</span>
                  <strong className={styles.highlightVal}>
                    {(() => {
                      const raw = overview.finance.cotikOnHold?.sumEstSettlementAmount ?? overview.finance.onHoldAmount;
                      if (raw === null || raw === "Unavailable") return "Chưa khả dụng";
                      const num = Number(raw);
                      if (!Number.isFinite(num)) return "Chưa khả dụng";
                      return `$${num.toLocaleString("vi-VN", { minimumFractionDigits: 2 })}`;
                    })()}
                  </strong>
                </div>
                {overview.finance.cotikOnHold?.estimatedSettlement && (
                  <div className={styles.metricRow}>
                    <span>Chu kỳ thanh toán ước tính (Estimated Settlement):</span>
                    <strong>{overview.finance.cotikOnHold.estimatedSettlement}</strong>
                  </div>
                )}
                <div className={styles.metricRow}>
                  <span>Tiền tệ vận hành:</span>
                  <strong>{overview.finance.currency}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Thời điểm trích xuất tài chính:</span>
                  <small>{overview.finance.capturedAt ? new Date(overview.finance.capturedAt).toLocaleString("vi-VN") : "Chưa có"}</small>
                </div>
              </div>

              {/* Chi tiết phân rã On Hold từ /api/analytic/on-hold */}
              {overview.finance.cotikOnHold?.onHoldBuckets && (
                <div className={styles.onHoldBreakdownSection}>
                  <h3 className={styles.onHoldBreakdownTitle}>
                    Chi Tiết Phân Rã Nguyên Nhân On Hold (/api/analytic/on-hold)
                  </h3>
                  <div className={styles.onHoldBucketsGrid}>
                    <div className={styles.bucketCard}>
                      <span className={styles.bucketLabel}>Chờ tất toán (Await Settlement)</span>
                      <strong className={styles.bucketVal}>
                        ${(Number(overview.finance.cotikOnHold.onHoldBuckets.totalAwaitSettlement) || 0).toLocaleString("vi-VN", { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <div className={styles.bucketCard}>
                      <span className={styles.bucketLabel}>Chờ hoàn tiền (Refund/Return)</span>
                      <strong className={styles.bucketVal}>
                        ${(Number(overview.finance.cotikOnHold.onHoldBuckets.totalAwaitRefundReturn) || 0).toLocaleString("vi-VN", { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <div className={styles.bucketCard}>
                      <span className={styles.bucketLabel}>Đang chờ giao (Waiting Delivered)</span>
                      <strong className={styles.bucketVal}>
                        ${(Number(overview.finance.cotikOnHold.onHoldBuckets.totalWaitingDelivered) || 0).toLocaleString("vi-VN", { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <div className={styles.bucketCard}>
                      <span className={styles.bucketLabel}>On Hold khác (Total On Hold)</span>
                      <strong className={styles.bucketVal}>
                        ${(Number(overview.finance.cotikOnHold.onHoldBuckets.totalOnHold) || 0).toLocaleString("vi-VN", { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <div className={styles.bucketCard}>
                      <span className={styles.bucketLabel}>Tiền ký quỹ (Reserve)</span>
                      <strong className={styles.bucketVal}>
                        ${(Number(overview.finance.cotikOnHold.onHoldBuckets.reserve) || 0).toLocaleString("vi-VN", { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>
                  <p className={styles.onHoldNotice}>
                    * <strong>Nguồn dữ liệu:</strong> Tổng On Hold của shop được xác định chuẩn xác từ <code>/api/analytic/shop → sum_est_settlement_amount</code> (khớp với tổng <code>est_amount</code> của các đơn hàng đang giữ tiền). Endpoint <code>/api/analytic/on-hold</code> phân rã các nhóm nguyên nhân cụ thể đã ghi nhận.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Tab 2: Data & Coverage */}
        {activeTab === "data" && (
          <div className={styles.panelSingle}>
            <section className={styles.dataHealthCard} aria-labelledby="data-health-heading">
              <div className={styles.dataHealthHeader}><div><p className={styles.eyebrow}>DATA TRUST &amp; HEALTH</p><h2 id="data-health-heading" className={styles.cardTitle}>Bảng Tổng Quan Độ Tin Cậy Dữ Liệu</h2></div><ShieldCheckIcon className={styles.healthIcon} aria-hidden="true" /></div>
              <div className={styles.healthGrid}>
                <div className={styles.healthItem}><span className={styles.healthLabel}>Trạng thái hoàn thiện</span><strong className={`${styles.healthBadge} ${dataTab.dataCoverage === "READY" ? styles.healthReady : dataTab.dataCoverage === "PARTIAL" ? styles.healthPartial : styles.healthUnavailable}`}>{dataTab.dataCoverage === "READY" ? "Đầy đủ" : dataTab.dataCoverage === "PARTIAL" ? "Một phần" : "Chưa khả dụng"}</strong><small>{dataTab.coverageReason || "Dữ liệu đáp ứng các tiêu chí kiểm chứng hiện tại."}</small></div>
                <div className={styles.healthItem}><span className={styles.healthLabel}>Cửa sổ kiểm chứng nguồn</span><strong>Đầy đủ trong cửa sổ 12 tháng gần nhất</strong><small>(Rolling 12 months) · Không đồng nghĩa đầy đủ lịch sử.</small></div>
                <div className={styles.healthItem}><span className={styles.healthLabel}>Kiểm chứng nguồn Seller Center</span><strong className={styles.healthPositive}>✓ Đã đối chiếu nguồn Seller Center</strong><small>(Phiên AdsPower xác thực)</small></div>
                <div className={styles.healthItem}><span className={styles.healthLabel}>Tính mới dữ liệu</span><strong>{dataTab.freshness === "FRESH" ? "Mới cập nhật" : dataTab.freshness}</strong><small>{dataTab.financeCapturedAt ? new Date(dataTab.financeCapturedAt).toLocaleString("vi-VN") : "Thời điểm cập nhật chưa có"}</small></div>
              </div>
            </section>
            <section className={styles.persistedCard} aria-labelledby="persisted-heading"><div className={styles.sectionHeading}><CircleStackIcon className={styles.sectionIcon} aria-hidden="true" /><h2 id="persisted-heading" className={styles.cardTitle}>Thống kê bản ghi đã lưu trữ</h2></div><div className={styles.persistedGrid}><div className={styles.persistedStat}><span>Số đơn hàng đã lưu trữ</span><strong>{dataTab.ordersCount !== null ? dataTab.ordersCount.toLocaleString("vi-VN") : "Chưa có"}</strong></div><div className={styles.persistedStat}><span>Dữ liệu tài chính gần nhất</span><strong>{dataTab.financeCapturedAt ? new Date(dataTab.financeCapturedAt).toLocaleString("vi-VN") : "Chưa có"}</strong></div></div></section>
            <details className={styles.provenanceCard}><summary>Ghi chú nguồn &amp; Dấu vết kỹ thuật</summary><p>Nguồn: TikTok Seller Center · Phiên trình duyệt: AdsPower · Cơ chế: Bất biến (Append-only PostgreSQL)</p><small>{dataTab.rawSummaryNote}</small></details>
          </div>
        )}

        {/* Tab 3: Tags & Groups */}
        {activeTab === "tags" && (
          <div className={styles.panelSingle}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Thẻ Profile & Phân Nhóm AdsPower</h2>
              <div className={styles.tagsContainer}>
                <div className={styles.tagItem}>
                  <span>Nhóm AdsPower:</span>
                  <strong>{tagsTab.groupName || "Chưa phân nhóm"}</strong>
                </div>
                <div className={styles.tagItem}>
                  <span>Khu vực / Locale:</span>
                  <strong>{tagsTab.region} / {tagsTab.locale}</strong>
                </div>
                <div className={styles.tagItem}>
                  <span>Đồng tiền thanh toán:</span>
                  <strong>{tagsTab.currency}</strong>
                </div>
              </div>
              <div className={styles.infoNotice}>
                <p>{tagsTab.dataNote}</p>
              </div>
            </section>
          </div>
        )}

        {/* Tab 4: Sync History */}
        {activeTab === "sync" && (
          <div className={styles.panelSingle}>
            <section className={styles.card}>
              <div className={styles.cardHeaderFlex}>
                <h2 className={styles.cardTitle}>Lịch Sử Các Phiên Đồng Bộ (Sync Runs)</h2>
                <span className={styles.subInfo}>Hiển thị 20 phiên gần nhất từ bảng `sync_runs`</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Thời gian bắt đầu</th>
                      <th>Chế độ</th>
                      <th>Trạng thái</th>
                      <th>Đọc / Ghi</th>
                      <th>Kết thúc</th>
                      <th>Lỗi nếu có</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncTab.syncRuns.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={styles.emptyTd}>Chưa có phiên đồng bộ nào được ghi nhận.</td>
                      </tr>
                    ) : (
                      syncTab.syncRuns.map((run) => (
                        <tr key={run.id}>
                          <td>{new Date(run.startedAt).toLocaleString("vi-VN")}</td>
                          <td><strong>{run.mode}</strong></td>
                          <td>
                            <span className={styles.syncBadge} data-state={run.status}>
                              {run.status}
                            </span>
                          </td>
                          <td>{run.rowsRead} / {run.rowsWritten}</td>
                          <td>{run.finishedAt ? new Date(run.finishedAt).toLocaleString("vi-VN") : "—"}</td>
                          <td>
                            {run.failureType ? (
                              <span className={styles.errorText} title={run.failureMessage || ""}>
                                {run.failureType}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* Tab 5: Stats & Trends */}
        {activeTab === "stats" && (
          <div className={styles.panelGrid}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Chỉ Số Vận Hành & Rủi Ro</h2>
              <div className={styles.metricsList}>
                {statsTab.metrics.length === 0 ? (
                  <p className={styles.emptyText}>Chưa có chỉ số phân tích rủi ro.</p>
                ) : (
                  statsTab.metrics.map((m) => (
                    <div key={m.label} className={styles.metricRow}>
                      <span>{m.label}:</span>
                      <strong>{metricValue(m.label, m.value)}</strong>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Tín Hiệu Xu Hướng (Trends)</h2>
              <div className={styles.trendsList}>
                {statsTab.trends.length === 0 ? (
                  <p className={styles.emptyText}>Chưa phát hiện tín hiệu biến động bất thường.</p>
                ) : (
                  statsTab.trends.map((t, idx) => (
                    <div key={idx} className={styles.trendCard}>
                      <strong className={styles.trendTitle}>{SIGNAL_LABELS[t.signal] ?? friendlyReason(t.signal)}</strong>
                      <span className={styles.trendStatusBadge} data-status={t.status}>{STATUS_LABELS[t.status] ?? friendlyReason(t.status)}</span>
                      <p className={styles.trendReason}><span>Lý do: </span>{friendlyReason(t.reason)}</p><details className={styles.trendTechDetails}><summary>Chi tiết kỹ thuật</summary><code>{t.signal} · {t.status} · {t.reason}</code></details>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* Tab 6: BA Review */}
        {activeTab === "ba" && (
          <div className={styles.baWorkspace}>
            <section className={styles.baDecisionWorkspace} aria-labelledby="ba-decision-heading">
              <div className={styles.baSectionHeading}>
                <p className={styles.baEyebrow}>DECISION WORKSPACE</p>
                <h2 id="ba-decision-heading" className={styles.cardTitle}>Đánh Giá Của Business Analyst (BA)</h2>
              </div>
              <div className={styles.baSummaryBox}>
                <div className={styles.baStatusRow}>
                  <span>Quyết định hiện tại</span>
                  <strong className={styles.baDecisionCurrent}>{baTab.currentDecision}</strong>
                </div>
                <div className={styles.baRecommendationGrid}>
                  <div className={styles.baRuleCard}>
                    <span className={styles.baCardLabel}>Khuyến nghị quy tắc</span>
                    <strong>{baTab.ruleResult}</strong>
                  </div>
                  <div className={styles.baAiCard}>
                    <span className={styles.baCardLabel}>AI tham khảo</span>
                    <strong>{baTab.aiRecommendation} · {baTab.aiConfidence}</strong>
                  </div>
                </div>
                <p className={styles.aiSummaryText}><strong>Tóm tắt AI:</strong> {baTab.aiSummary}</p>
              </div>

              {baTab.activeCaseId ? (
                <div className={styles.formContainer}>
                  <LiveBaForm caseId={baTab.activeCaseId} profileNo={shop.profileNo} />
                </div>
              ) : (
                <div className={styles.emptyNotice}>
                  <p>Không có hồ sơ rủi ro (Decision Case) LIVE nào khả dụng để nhập thẩm định BA.</p>
                </div>
              )}
            </section>

            <section className={styles.baHistoryWorkspace} aria-labelledby="ba-history-heading">
              <div className={styles.baSectionHeading}>
                <p className={styles.baEyebrow}>APPEND-ONLY TIMELINE</p>
                <h2 id="ba-history-heading" className={styles.cardTitle}>Lịch Sử Thẩm Định BA (Bất Biến)</h2>
              </div>
              {baTab.history.length === 0 ? (
                <div className={styles.emptyHistoryBox}><p>Chưa có lịch sử thẩm định nào cho hồ sơ này.</p></div>
              ) : (
                <div className={styles.historyList}>
                  {baTab.history.map((rev) => (
                    <div key={rev.id} className={styles.historyItem}>
                      <div className={styles.historyItemHead}>
                        <strong className={styles.historyDecision}>{rev.decision}</strong>
                        <span>{new Date(rev.decidedAt).toLocaleString("vi-VN")}</span>
                      </div>
                      <p className={styles.historyMeta}>
                        Người duyệt: <strong>{rev.actor}</strong> &bull; Lý do: <code>{rev.reasonCode}</code>
                      </p>
                      {rev.notes && <p className={styles.historyNotes}>&ldquo;{rev.notes}&rdquo;</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Tab 7: Audit Log */}
        {activeTab === "audit" && (
          <div className={styles.panelSingle}>
            <section className={styles.card}>
              <div className={styles.cardHeaderFlex}>
                <h2 className={styles.cardTitle}>Nhật Ký Kiểm Toán (Audit Trail)</h2>
                <span className={styles.subInfo}>{auditTab.schemaNotice}</span>
              </div>
              <div className={styles.auditList}>
                {auditTab.auditLogs.length === 0 ? (
                  <p className={styles.emptyText}>Chưa có bản ghi kiểm toán nào được lưu vết.</p>
                ) : (
                  auditTab.auditLogs.map((log) => (
                    <div key={log.id} className={styles.auditCard}>
                      <div className={styles.auditCardHead}>
                        <span className={styles.auditType} data-type={log.type}>
                          {log.type}
                        </span>
                        <span className={styles.auditTime}>
                          {new Date(log.timestamp).toLocaleString("vi-VN")}
                        </span>
                      </div>
                      <p className={styles.auditSummary}>
                        <strong>{log.actor}:</strong> {log.summary}
                      </p>
                      <pre className={styles.auditPayload}>
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
