import { closeDatabase, createDatabase, getCotikWorkflowSettings, getCurrentAiTaskConfig, getCurrentRefreshSettings, getEffectiveRiskPolicy, listActiveCotikAccounts, listCotikLogicalShops, listProviderCatalog, listShops } from "@shop-health/db";
import { AI_TASK_IDS } from "@shop-health/decision-ai";
import { SettingsForm } from "./settings-form";
import { safeAiTaskConfig } from "./settings-contract";
import { CotikSettings } from "./cotik-settings";

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
    return (
      <main>
        <h1>Settings</h1>
        <p>Business timezone: Asia/Bangkok (GMT+07). Changes append persisted revisions where supported.</p>
        <SettingsForm
          refresh={refresh}
          policy={policy}
          selectedShopId={selectedShopId ?? ""}
          shops={shops.map((shop) => ({ id: shop.id, profileNo: shop.profileNo, displayName: shop.displayName }))}
          aiTasks={aiConfigs.map((config) => config === null ? null : safeAiTaskConfig(config))}
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
              ? [{ providerId: provider.providerId, carrierName: provider.carrierName, region: provider.region }]
              : [],
          )}
          syncEnabled={cotikWorkflow?.cotikSyncEnabled ?? false}
          postEnabled={cotikWorkflow?.cotikPostEnabled ?? false}
          activeDeploymentId={cotikWorkflow?.deploymentId ?? null}
          lastResetAt={cotikWorkflow?.lastResetAt?.toISOString() ?? null}
        />
      </main>
    );
  } finally { await closeDatabase(context); }
}
