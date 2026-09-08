import React from "react";
import Link from "next/link";
import { loadCotikPortfolioMetrics, KNOWN_COTIK_ACCOUNTS } from "../../lib/cotik-accounts";
import { PageSidePanel } from "../../components/shell/page-side-panel";
import { AccountSyncButton } from "./account-sync-button";
import styles from "./accounts.module.css";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const metrics = await loadCotikPortfolioMetrics();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link href="/dashboard" className={styles.breadcrumbLink}>Dashboard</Link>
          <span>/</span>
          <span>Tài khoản Cotik</span>
        </div>

        <div className={styles.headerTop}>
          <div className={styles.titleArea}>
            <div className={styles.eyebrow}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
              COTIK MULTI-ACCOUNT MANAGEMENT
            </div>
            <h1 className={styles.title}>Quản trị 5 Tài khoản Cotik (AL-Token)</h1>
            <p className={styles.subtitle}>
              Mỗi tài khoản Cotik sở hữu một AL-Token độc lập, quản lý danh sách shop TikTok riêng biệt. Dữ liệu đồng bộ trực tiếp không phụ thuộc AdsPower.
            </p>
          </div>

          <div className={styles.actionRow}>
            <Link href="/dashboard" className={styles.secondaryBtn}>
              ← Quay lại Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* ── 2-Column Responsive Layout: Left PageSidePanel + Right Content ── */}
      <div className={styles.pageLayout}>
        {/* Left Column: Full-height PageSidePanel */}
        <PageSidePanel badgeText="KYOTO SANCTUARY · 5 AL-TOKENS">
          <p style={{ margin: "0 0 6px", fontSize: "0.775rem", color: "var(--color-ink-muted)" }}>
            5 phân hệ tài khoản hoạt động song song. Chọn nhanh một tài khoản bên dưới để vào trang quản trị chuyên biệt:
          </p>

          <ul className={styles.artAccountList} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 0, margin: 0, listStyle: "none" }}>
            {metrics.accounts.map((acc) => (
              <li key={acc.key}>
                <Link
                  href={`/accounts/${acc.key}`}
                  className={styles.artAccountItem}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--color-surface-subtle)",
                    border: "1px solid var(--color-border)",
                    fontSize: "0.8125rem",
                    textDecoration: "none",
                  }}
                >
                  <span>
                    <strong style={{ color: "var(--color-ink)", marginRight: 6 }}>{acc.name}</strong>
                    <small style={{ color: "var(--color-ink-muted)" }}>({acc.shopCount} shop)</small>
                  </span>
                  <span style={{ color: "var(--color-success)", fontWeight: 600 }}>
                    ${acc.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.75rem",
              color: "var(--color-ink-muted)",
              marginTop: 4,
            }}
          >
            <span style={{ color: "var(--color-success)", fontWeight: 600 }}>● 100% Active</span> · 5 Token đã cấu hình sẵn sàng đồng bộ realtime.
          </div>
        </PageSidePanel>

        {/* Right Column: Main KPI Band & Account Cards */}
        <main style={{ minWidth: 0 }}>
          {/* Summary KPI grid for Cotik Accounts */}
          <section className={styles.kpiGrid} aria-label="Tổng quan hệ thống Cotik" style={{ marginTop: 0 }}>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Tổng số tài khoản Cotik</span>
              <strong className={styles.kpiValue}>{metrics.totalAccounts} Tài khoản</strong>
              <span className={styles.kpiSub}>100% Active (Đã gắn AL-Token)</span>
            </div>

            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Tổng cửa hàng liên kết</span>
              <strong className={styles.kpiValue}>{metrics.totalShops} Shops</strong>
              <span className={styles.kpiSub}>Phân bổ trên 5 tài khoản</span>
            </div>

            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Tổng On Hold toàn hệ thống</span>
              <strong className={styles.kpiValue} style={{ color: "#34d399" }}>
                ${metrics.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </strong>
              <span className={styles.kpiSub}>USD Ước tính quyết toán</span>
            </div>

            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Delivery Rate toàn danh mục</span>
              <strong className={styles.kpiValue} style={{ color: "#ff8e88" }}>
                {metrics.overallDeliveryRate}
              </strong>
              <span className={styles.kpiSub}>{metrics.totalOrders} đơn hàng ghi nhận</span>
            </div>
          </section>

          {/* Account Cards Grid */}
          <h2 style={{ fontSize: "1.0625rem", fontWeight: 600, color: "#ffffff", margin: "20px 0 14px" }}>
            Chi tiết 5 Tài khoản Cotik (Tuấn, Chúc, Lan, Việt, Hằng)
          </h2>

          <div className={styles.accountCardsGrid}>
            {metrics.accounts.map((account) => (
              <div
                key={account.key}
                className={styles.accountCard}
              >
                <div className={styles.cardHeader}>
                  <Link href={`/accounts/${account.key}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12 }}>
                    <div className={styles.cardAvatar}>
                      {account.shortName.charAt(0)}
                    </div>
                    <div className={styles.cardMeta}>
                      <span className={styles.accountName} style={{ fontWeight: 700, fontSize: "1rem" }}>{account.name}</span>
                      <span className={styles.accountOwner}>Tài khoản {account.name}</span>
                    </div>
                  </Link>
                  <span className={styles.tokenPill}>
                    {account.isConfigured ? "Token OK" : "Thiếu Token"}
                  </span>
                </div>

                <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "monospace" }}>
                  {account.tokenKey}: <span style={{ color: "#cbd5e1" }}>{account.maskedToken}</span>
                </div>

                <div className={styles.cardStats}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Cửa hàng</span>
                    <span className={styles.statValue}>{account.shopCount} Shop</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>On Hold</span>
                    <span className={`${styles.statValue} ${styles.statGreen}`}>
                      ${account.totalOnHoldUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Delivery Rate</span>
                    <span className={styles.statValue}>{account.deliveryRate}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Tổng đơn</span>
                    <span className={styles.statValue}>{account.totalOrders}</span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--color-border, rgba(255,255,255,0.06))" }}>
                  <AccountSyncButton
                    accountKey={account.key}
                    accountName={account.name}
                    shopCount={account.shopCount}
                    size="small"
                  />
                  <Link href={`/accounts/${account.key}`} className={styles.cardFooterLink} style={{ margin: 0, padding: "6px 10px" }}>
                    <span>Chi tiết</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Future Account Provisioning Note */}
          <div style={{
            marginTop: 20,
            padding: "16px 20px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.03)",
            border: "1px dashed rgba(255,255,255,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}>
            <div>
              <strong style={{ color: "#ffffff", display: "block", marginBottom: 2, fontSize: "0.875rem" }}>
                Sẵn sàng mở rộng: Tự động nhận diện tài khoản Cotik mới
              </strong>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                Khi bổ sung thêm biến môi trường <code style={{ color: "#ff8e88" }}>COTIK_TOKEN_[NAME]</code> vào .env, hệ thống sẽ tự sinh trang quản trị riêng cho tài khoản đó với đầy đủ chỉ số và danh sách shop.
              </span>
            </div>
            <Link href="/settings" className={styles.secondaryBtn}>
              Kiểm tra Cài đặt Token →
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
