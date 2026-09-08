import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCotikPortfolioMetrics, KNOWN_COTIK_ACCOUNTS } from "../../../lib/cotik-accounts";
import { AccountSyncButton } from "../account-sync-button";
import styles from "../accounts.module.css";

export const dynamic = "force-dynamic";

interface AccountPageProps {
  params: Promise<{ accountKey: string }>;
}

export default async function DedicatedAccountPage({ params }: AccountPageProps) {
  const { accountKey } = await params;
  const metrics = await loadCotikPortfolioMetrics();

  const account = metrics.accounts.find(
    (a) => a.key.toLowerCase() === accountKey.toLowerCase()
  );

  if (!account) {
    // If not found in known accounts, check if it's a valid new key format
    return (
      <div className={styles.container}>
        <div className={styles.breadcrumb}>
          <Link href="/dashboard" className={styles.breadcrumbLink}>Dashboard</Link>
          <span>/</span>
          <Link href="/accounts" className={styles.breadcrumbLink}>Tài khoản Cotik</Link>
          <span>/</span>
          <span>Không tìm thấy</span>
        </div>
        <div style={{ padding: "48px 0", textAlign: "center" }}>
          <h2 style={{ color: "#ffffff", fontSize: "1.5rem" }}>Không tìm thấy Tài khoản Cotik "{accountKey}"</h2>
          <p style={{ color: "#94a3b8", marginTop: 8 }}>Vui lòng kiểm tra lại mã tài khoản hoặc cấu hình trong .env</p>
          <div style={{ marginTop: 24 }}>
            <Link href="/accounts" className={styles.secondaryBtn}>← Quay lại danh sách Tài khoản</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link href="/dashboard" className={styles.breadcrumbLink}>Dashboard</Link>
          <span>/</span>
          <Link href="/accounts" className={styles.breadcrumbLink}>Tài khoản Cotik</Link>
          <span>/</span>
          <span style={{ color: "#ff8e88" }}>{account.name}</span>
        </div>

        <div className={styles.headerTop}>
          <div className={styles.titleArea}>
            <div className={styles.eyebrow}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
              COTIK DEDICATED ACCOUNT WORKSPACE
            </div>
            <h1 className={styles.title}>Tài khoản {account.name}</h1>
            <p className={styles.subtitle}>
              Biến môi trường: <code style={{ color: "#e2e8f0" }}>{account.tokenKey}</code> · Token: <code style={{ color: "#34d399" }}>{account.maskedToken}</code> · Trạng thái: <strong>Sẵn sàng đồng bộ</strong>
            </p>
          </div>

          <div className={styles.actionRow} style={{ alignItems: "center", gap: 10 }}>
            <AccountSyncButton
              accountKey={account.key}
              accountName={account.name}
              shopCount={account.shopCount}
            />
            <Link href="/dashboard" className={styles.secondaryBtn}>
              ← Về Dashboard
            </Link>
            <Link href="/accounts" className={styles.secondaryBtn}>
              Đổi tài khoản khác
            </Link>
          </div>
        </div>
      </header>

      {/* Account Metric Cards */}
      <section className={styles.kpiGrid} aria-label={`Chỉ số tài khoản ${account.name}`}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Cửa hàng liên kết</span>
          <strong className={styles.kpiValue}>{account.shopCount} Shops</strong>
          <span className={styles.kpiSub}>Thuộc quản lý của {account.owner}</span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Tài chính On Hold</span>
          <strong className={styles.kpiValue} style={{ color: "#34d399" }}>
            ${account.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </strong>
          <span className={styles.kpiSub}>USD Ước tính quyết toán</span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Delivery Rate</span>
          <strong className={styles.kpiValue} style={{ color: "#ff8e88" }}>
            {account.deliveryRate}
          </strong>
          <span className={styles.kpiSub}>Tỷ lệ giao hàng thành công</span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Tổng đơn hàng</span>
          <strong className={styles.kpiValue}>{account.totalOrders} Đơn</strong>
          <span className={styles.kpiSub}>Ghi nhận từ các shop liên kết</span>
        </div>
      </section>

      {/* Order Status Breakdown for this Account */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        overflowX: "auto",
        padding: "12px 16px",
        marginBottom: 28,
        borderRadius: 10,
        background: "rgba(14, 20, 32, 0.55)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          Phân bổ đơn:
        </span>
        <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          Đang vận chuyển: {account.inTransitOrders}
        </span>
        <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(52, 211, 153, 0.15)", color: "#34d399", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          Đã giao hàng: {account.deliveredOrders}
        </span>
        <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(168, 85, 247, 0.15)", color: "#c084fc", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          Hoàn thành: {account.completedOrders}
        </span>
        <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          Refund/Return: {account.refundOrders}
        </span>
        <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(239, 68, 68, 0.15)", color: "#f87171", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          Đã hủy: {account.cancelledOrders}
        </span>
        <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(255, 255, 255, 0.1)", color: "#cbd5e1", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          Chờ tracking: {account.awaitingTrackingOrders}
        </span>
      </div>

      {/* Linked Shops Table */}
      <section className={styles.tableSection} aria-label={`Bảng cửa hàng liên kết của ${account.name}`}>
        <div className={styles.tableHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 className={styles.tableTitle}>Danh sách {account.shops.length} Cửa hàng liên kết</h2>
            <span style={{
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(224, 35, 28, 0.15)",
              color: "#ff8e88",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}>
              {account.name}
            </span>
          </div>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Tên Cửa Hàng</th>
                <th scope="col">Profile</th>
                <th scope="col">On Hold (Ước tính)</th>
                <th scope="col">Delivery Rate</th>
                <th scope="col">Tổng Đơn</th>
                <th scope="col">Đang Vận Chuyển</th>
                <th scope="col">Đã Giao</th>
                <th scope="col">Đồng Bộ Gần Nhất</th>
                <th scope="col">Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {account.shops.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 32, color: "#94a3b8" }}>
                    Chưa có cửa hàng nào được gán cho tài khoản này trong cơ sở dữ liệu.
                  </td>
                </tr>
              ) : (
                account.shops.map((shop) => (
                  <tr key={shop.id}>
                    <td>
                      <Link href={`/shops/${encodeURIComponent(shop.profileNo)}`} prefetch={false} style={{ textDecoration: "none" }}>
                        <span className={styles.shopDisplayName}>{shop.displayName}</span>
                        <span style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginTop: 2 }}>
                          ShopID: <code style={{ color: "#cbd5e1" }}>{shop.tiktokShopId || "Chưa có ID"}</code>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: "rgba(224, 35, 28, 0.15)",
                        color: "#ff8e88",
                        fontWeight: 700,
                        fontSize: "0.8125rem",
                      }}>
                        #{shop.profileNo}
                      </span>
                    </td>
                    <td>
                      <strong style={{ color: "#34d399", fontWeight: 600 }}>
                        ${shop.onHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </strong>
                    </td>
                    <td>
                      <span style={{
                        color: shop.deliveryRate === "Chưa đủ" ? "#94a3b8" : Number.parseFloat(shop.deliveryRate) < 70 ? "#ff8e88" : "#ffffff",
                        fontWeight: 600,
                      }}>
                        {shop.deliveryRate}
                      </span>
                    </td>
                    <td>{shop.totalOrders}</td>
                    <td>{shop.inTransitOrders}</td>
                    <td>{shop.deliveredOrders}</td>
                    <td style={{ fontSize: "0.75rem", color: "#64748b" }}>
                      {shop.lastSyncedAt ? new Date(shop.lastSyncedAt).toLocaleString("vi-VN") : "Chưa sync"}
                    </td>
                    <td>
                      <Link
                        href={`/shops/${encodeURIComponent(shop.profileNo)}`}
                        prefetch={false}
                        className={styles.tableActionBtn}
                      >
                        Chi tiết →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
