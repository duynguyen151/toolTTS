import { closeDatabase, createDatabase, getCotikWorkflowSettings, getCurrentAiTaskConfig, getCurrentRefreshSettings, getEffectiveRiskPolicy, listActiveCotikAccounts, listCotikLogicalShops, listProviderCatalog, listShops } from "@shop-health/db";
import { AI_TASK_IDS } from "@shop-health/decision-ai";
import { SettingsForm } from "./settings-form";
import { safeAiTaskConfig } from "./settings-contract";
import { KNOWN_COTIK_ACCOUNTS, maskToken } from "../../lib/cotik-account-types";
import { PageSidePanel } from "../../components/shell/page-side-panel";
import { ThemeShowcase } from "../../components/settings/theme-showcase";
import { CotikSettings } from "./cotik-settings";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ shopId?: string | string[] | undefined }>;
}) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return <main><h1>Settings</h1><p>Configure DATABASE_URL to edit persisted settings.</p></main>;
  const context = createDatabase(databaseUrl);
  try {
    const now = new Date();
    const [refresh, shops, cotikLogicalShops, cotikAccounts, cotikProviders, cotikWorkflow, ...aiConfigs] = await Promise.all([
      getCurrentRefreshSettings(context.db),
      listShops(context.db),
      listCotikLogicalShops(context.db),
      listActiveCotikAccounts(context.db),
      listProviderCatalog(context.db),
      getCotikWorkflowSettings(context.db),
      ...AI_TASK_IDS.map((taskId) => getCurrentAiTaskConfig(context.db, { taskId, effectiveAt: now })),
    ]);
    const query = await searchParams;
    const requestedShopId = Array.isArray(query.shopId) ? query.shopId[0] : query.shopId;
    const selectedShopId = shops.some((shop) => shop.id === requestedShopId) ? requestedShopId : undefined;
    const policy = await getEffectiveRiskPolicy(context.db, { effectiveAt: now, ...(selectedShopId === undefined ? {} : { shopId: selectedShopId }) });

    const accountStatuses = KNOWN_COTIK_ACCOUNTS.map((acc) => {
      const token = process.env[acc.tokenKey];
      return {
        key: acc.key,
        tokenKey: acc.tokenKey,
        name: acc.name,
        owner: acc.owner,
        isConfigured: Boolean(token),
        maskedToken: maskToken(token),
      };
    });

    return (
      <div className={styles.settingsPageLayout}>
        {/* Left Column: Full-height PageSidePanel */}
        <PageSidePanel badgeText="CONFIGURATION · GMT+07">
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
              <span style={{ color: "var(--color-ink-muted)" }}>Múi giờ:</span>
              <strong style={{ color: "var(--color-ink)" }}>Asia/Bangkok (GMT+07)</strong>
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
              <span style={{ color: "var(--color-ink-muted)" }}>Checkpoint:</span>
              <strong style={{ color: "var(--color-primary)" }}>08:00 · 11:00 · 17:00</strong>
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
              <span style={{ color: "var(--color-ink-muted)" }}>Tài khoản Cotik:</span>
              <strong style={{ color: "var(--color-success)" }}>5 Tài khoản</strong>
            </div>
          </div>

          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              borderRadius: "8px",
              background: "var(--color-surface-subtle)",
              border: "1px solid var(--color-border)",
              fontSize: "0.75rem",
              color: "var(--color-ink-muted)",
            }}
          >
            🔒 Mọi thay đổi đều được lưu vết lịch sử (Append-only).
          </div>
        </PageSidePanel>

        {/* Right Column: Theme Showcase & Settings Form */}
        <div className="settings-page" style={{ minWidth: 0, width: "100%" }}>
          <div className="settings-header" style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-ink)", margin: "0 0 6px" }}>
              Cài đặt hệ thống (System Settings)
            </h1>
            <p style={{ color: "var(--color-ink-muted)", margin: 0, fontSize: "0.875rem" }}>
              Múi giờ vận hành: Asia/Bangkok (GMT+07). Các thay đổi chính sách và cấu hình được lưu theo cơ chế append-only an toàn.
            </p>
          </div>

          {/* Kyoto Light Theme Showcase from Image 4 */}
          <ThemeShowcase />

          <SettingsForm
            refresh={refresh}
            policy={policy}
            selectedShopId={selectedShopId ?? ""}
            shops={shops.map((shop) => ({ id: shop.id, profileNo: shop.profileNo, displayName: shop.displayName }))}
            aiTasks={aiConfigs.map((config) => config === null ? null : safeAiTaskConfig(config))}
            accountStatuses={accountStatuses}
          />
          <CotikSettings
            accounts={cotikAccounts.map((account) => ({
              id: account.id,
              displayName: account.displayName,
              status: account.status,
              priority: account.priority,
              lastSeenAt: account.lastSeenAt?.toISOString() ?? null,
            }))}
            logicalShops={cotikLogicalShops.flatMap((shop) =>
              shop.region === "US" || shop.region === "UK"
                ? [{ id: shop.id, displayName: shop.maShopNoiBo, region: shop.region }]
                : [],
            )}
            providers={cotikProviders.flatMap((provider) =>
              provider.region === "US" || provider.region === "UK"
                ? [{
                    providerId: provider.providerId,
                    carrierName: provider.carrierName,
                    region: provider.region,
                  }]
                : [],
            )}
            syncEnabled={cotikWorkflow?.cotikSyncEnabled ?? false}
            postEnabled={cotikWorkflow?.cotikPostEnabled ?? false}
            activeDeploymentId={cotikWorkflow?.deploymentId ?? null}
            lastResetAt={cotikWorkflow?.lastResetAt?.toISOString() ?? null}
          />
        </div>
      </div>
    );
  } finally { await closeDatabase(context); }
}
