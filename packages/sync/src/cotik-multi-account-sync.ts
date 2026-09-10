import type { DatabaseContext } from "@shop-health/db";
import {
  listActiveCotikAccounts,
  listCotikAccounts,
  getDecryptedCotikToken,
  updateCotikAccountStatus,
  upsertCotikLogicalShop,
  upsertCotikAccountShop,
  listCotikAccountShopsByAccount,
  updateCotikAccountShopDiscoveryState,
  updateCotikAccountShopCheckpoint,
  recordCotikOrderObservations,
  projectWinningCotikOrder,
  type CotikAccountRow,
  type CotikAccountShopRow
} from "@shop-health/db";
import {
  createMultiAccountCotikClient,
  classifyCotikAccountHealth,
  discoverAccountShops,
  fetchCotikOrdersPage,
  type MultiAccountCotikClient,
  type ShopDiscoveryResult
} from "@shop-health/cotik";
import type { CotikAccountHealthState } from "@shop-health/domain";
import type { Logger } from "pino";

export interface RunCotikMultiAccountDiscoveryInput {
  readonly context: DatabaseContext;
  readonly accountId?: string | undefined;
  readonly vaultKeyHex?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface AccountDiscoverySummary {
  readonly accountId: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly healthState: CotikAccountHealthState;
  readonly shopsFound: number;
  readonly error?: string | undefined;
}

export interface CotikMultiAccountDiscoveryResult {
  readonly accountsProcessed: number;
  readonly shopsDiscovered: number;
  readonly accountsFailed: number;
  readonly accountSummaries: AccountDiscoverySummary[];
}

export async function runCotikDiscoverySync(
  input: RunCotikMultiAccountDiscoveryInput
): Promise<CotikMultiAccountDiscoveryResult> {
  const requestedAccountId = input.accountId?.trim();
  const accounts = (await listCotikAccounts(input.context.db)).filter((account) =>
    ["ACTIVE", "UNKNOWN", "NETWORK_ERROR", "RATE_LIMITED", "SHOP_DISCONNECTED"].includes(account.status) &&
    (requestedAccountId === undefined || account.id === requestedAccountId)
  );
  const now = input.now ? input.now() : new Date();

  let shopsDiscovered = 0;
  let accountsFailed = 0;
  const accountSummaries: AccountDiscoverySummary[] = [];

  for (const account of accounts) {
    try {
      const token = await getDecryptedCotikToken(
        input.context.db,
        account.id,
        input.vaultKeyHex
      );

      if (!token) {
        throw new Error("Missing secret token for Cotik account");
      }

      const client = createMultiAccountCotikClient({
        accountId: account.id,
        token,
        baseUrl: input.baseUrl
      });

      const discovery: ShopDiscoveryResult = await discoverAccountShops(client, input.logger);
      const existingLinks = await listCotikAccountShopsByAccount(input.context.db, account.id);
      if (discovery.state !== "COMPLETE") {
        for (const link of existingLinks) {
          await updateCotikAccountShopDiscoveryState(input.context.db, account.id, link.cotikShopId, "ERROR", now);
        }
        await updateCotikAccountStatus(input.context.db, account.id, "UNKNOWN");
        accountsFailed++;
        accountSummaries.push({ accountId: account.id, status: "FAILED", healthState: "UNKNOWN", shopsFound: 0, error: "DISCOVERY_INSUFFICIENT" });
        continue;
      }
      for (const link of existingLinks) {
        if (!discovery.shops.some((shop) => shop.cotikShopId === link.cotikShopId)) {
          await updateCotikAccountShopDiscoveryState(input.context.db, account.id, link.cotikShopId, "DISCONNECTED", now);
        }
      }

      for (const shop of discovery.shops) {
        // Fail-closed: skip shops with unknown region instead of defaulting to US
        if (shop.region === null) {
          input.logger?.warn(
            { accountId: account.id, cotikShopId: shop.cotikShopId, shopName: shop.shopName },
            "Skipping shop with unknown region (fail-closed)"
          );
          continue;
        }

        const logicalShop = await upsertCotikLogicalShop(input.context.db, {
          maShopNoiBo: shop.maShopNoiBo,
          region: shop.region
        });

        await upsertCotikAccountShop(input.context.db, {
          accountId: account.id,
          logicalShopId: logicalShop.id,
          cotikShopId: shop.cotikShopId,
          discoveryState: "DISCOVERED",
          lastDiscoveredAt: now
        });

        shopsDiscovered++;
      }

      await updateCotikAccountStatus(input.context.db, account.id, "ACTIVE", now);

      accountSummaries.push({
        accountId: account.id,
        status: "SUCCEEDED",
        healthState: "ACTIVE",
        shopsFound: discovery.shops.length
      });
    } catch (error) {
      accountsFailed++;
      const healthDiagnosis = classifyCotikAccountHealth(error);
      await updateCotikAccountStatus(input.context.db, account.id, healthDiagnosis.state);

      const errorMessage = error instanceof Error ? error.message : String(error);
      input.logger?.warn(
        { accountId: account.id, healthState: healthDiagnosis.state, error: errorMessage },
        "Cotik account discovery failed (isolated per account)"
      );

      accountSummaries.push({
        accountId: account.id,
        status: "FAILED",
        healthState: healthDiagnosis.state,
        shopsFound: 0,
        error: errorMessage
      });
    }
  }

  return {
    accountsProcessed: accounts.length,
    shopsDiscovered,
    accountsFailed,
    accountSummaries
  };
}

export type CotikMultiAccountSyncMode = "incremental" | "reconcile";

export interface RunCotikMultiAccountOrdersSyncInput {
  readonly context: DatabaseContext;
  readonly accountId?: string | undefined;
  readonly vaultKeyHex?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly mode?: CotikMultiAccountSyncMode | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
  readonly pageSize?: number | undefined;
  readonly overlapMs?: number | undefined; // default 2 hours (7_200_000 ms)
}

export interface ShopSyncSummary {
  readonly cotikShopId: string;
  readonly logicalShopId: string;
  readonly observationsRead: number;
  readonly ordersProjected: number;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly error?: string | undefined;
}

export interface AccountOrderSyncSummary {
  readonly accountId: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly healthState: CotikAccountHealthState;
  readonly shopsSynced: ShopSyncSummary[];
  readonly error?: string | undefined;
}

export interface CotikMultiAccountOrdersSyncResult {
  readonly mode: CotikMultiAccountSyncMode;
  readonly accountsProcessed: number;
  readonly totalObservationsRead: number;
  readonly totalOrdersProjected: number;
  readonly accountSummaries: AccountOrderSyncSummary[];
}

const DEFAULT_OVERLAP_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function runCotikMultiAccountOrdersSync(
  input: RunCotikMultiAccountOrdersSyncInput
): Promise<CotikMultiAccountOrdersSyncResult> {
  const mode = input.mode ?? "incremental";
  const now = input.now ? input.now() : new Date();
  const overlapMs = input.overlapMs ?? DEFAULT_OVERLAP_MS;
  const pageSize = input.pageSize ?? 100;

  const requestedAccountId = input.accountId?.trim();
  const accounts = (await listActiveCotikAccounts(input.context.db)).filter((account) =>
    requestedAccountId === undefined || account.id === requestedAccountId
  );

  let totalObservationsRead = 0;
  let totalOrdersProjected = 0;
  const accountSummaries: AccountOrderSyncSummary[] = [];

  for (const account of accounts) {
    try {
      const token = await getDecryptedCotikToken(
        input.context.db,
        account.id,
        input.vaultKeyHex
      );

      if (!token) {
        throw new Error("Missing secret token for Cotik account");
      }

      const client = createMultiAccountCotikClient({
        accountId: account.id,
        token,
        baseUrl: input.baseUrl
      });

      const accountShops = await listCotikAccountShopsByAccount(input.context.db, account.id);
      const discoveredShops = accountShops.filter((s) => s.discoveryState === "DISCOVERED");

      const shopSummaries: ShopSyncSummary[] = [];

      for (const accountShop of discoveredShops) {
        try {
          let updateTimeFromMs: number;

          if (mode === "reconcile") {
            // Reconcile covers current month + previous month in UTC
            const startOfPrevMonth = new Date(
              Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
            );
            updateTimeFromMs = startOfPrevMonth.getTime();
          } else {
            // Incremental: use checkpoint - 2 hours overlap
            const checkpoint = accountShop.checkpoint as Record<string, unknown> | null;
            const lastUpdateTimeMs =
              typeof checkpoint?.lastUpdateTimeMs === "number"
                ? checkpoint.lastUpdateTimeMs
                : null;

            if (lastUpdateTimeMs !== null) {
              updateTimeFromMs = Math.max(0, lastUpdateTimeMs - overlapMs);
            } else {
              updateTimeFromMs = Math.max(0, now.getTime() - overlapMs);
            }
          }

          let page = 1;
          let shopObsRead = 0;
          let shopOrdersProj = 0;
          let maxUpdateTimeMs = 0;
          let hasMore = true;

          while (hasMore) {
            const pageResult = await fetchCotikOrdersPage(
              client,
              {
                cotikShopId: accountShop.cotikShopId,
                updateTimeFromMs,
                pageSize
              },
              page
            );

            if (pageResult.observations.length === 0) {
              hasMore = false;
              break;
            }

            // Assign logicalShopId to each observation
            const observations = pageResult.observations.map((obs) => ({
              ...obs,
              logicalShopId: accountShop.logicalShopId
            }));

            await recordCotikOrderObservations(input.context.db, observations);
            await updateCotikAccountStatus(input.context.db, account.id, "ACTIVE", input.now ? input.now() : new Date());
            shopObsRead += observations.length;

            for (const obs of observations) {
              await projectWinningCotikOrder(input.context.db, {
                logicalShopId: obs.logicalShopId,
                orderId: obs.orderId,
                sourceAccountId: account.id,
                items: obs.items
              });
              shopOrdersProj++;

              const obsUpdateTimeMs = obs.orderUpdateTime.getTime();
              if (obsUpdateTimeMs > maxUpdateTimeMs) {
                maxUpdateTimeMs = obsUpdateTimeMs;
              }
            }

            if (pageResult.observations.length < pageSize) {
              hasMore = false;
            } else {
              page++;
              if (page > 100) {
                // Safety bound per sync cycle
                hasMore = false;
              }
            }
          }

          if (maxUpdateTimeMs > 0) {
            await updateCotikAccountShopCheckpoint(
              input.context.db,
              account.id,
              accountShop.cotikShopId,
              {
                lastUpdateTimeMs: maxUpdateTimeMs,
                lastSyncedAt: now.toISOString()
              }
            );
          }

          totalObservationsRead += shopObsRead;
          totalOrdersProjected += shopOrdersProj;

          shopSummaries.push({
            cotikShopId: accountShop.cotikShopId,
            logicalShopId: accountShop.logicalShopId,
            observationsRead: shopObsRead,
            ordersProjected: shopOrdersProj,
            status: "SUCCEEDED"
          });
        } catch (shopError) {
          const errorMessage = shopError instanceof Error ? shopError.message : String(shopError);
          input.logger?.warn(
            {
              accountId: account.id,
              cotikShopId: accountShop.cotikShopId,
              error: errorMessage
            },
            "Cotik shop order sync failed (isolated per shop)"
          );

          if (
            errorMessage.includes("Shop/App not found") ||
            errorMessage.includes("not found")
          ) {
            await updateCotikAccountShopDiscoveryState(
              input.context.db,
              account.id,
              accountShop.cotikShopId,
              "DISCONNECTED"
            );
          }

          shopSummaries.push({
            cotikShopId: accountShop.cotikShopId,
            logicalShopId: accountShop.logicalShopId,
            observationsRead: 0,
            ordersProjected: 0,
            status: "FAILED",
            error: errorMessage
          });
        }
      }

      accountSummaries.push({
        accountId: account.id,
        status: "SUCCEEDED",
        healthState: "ACTIVE",
        shopsSynced: shopSummaries
      });
    } catch (accountError) {
      const healthDiagnosis = classifyCotikAccountHealth(accountError);
      await updateCotikAccountStatus(input.context.db, account.id, healthDiagnosis.state);

      const errorMessage =
        accountError instanceof Error ? accountError.message : String(accountError);
      input.logger?.warn(
        { accountId: account.id, healthState: healthDiagnosis.state, error: errorMessage },
        "Cotik account order sync failed (isolated per account)"
      );

      accountSummaries.push({
        accountId: account.id,
        status: "FAILED",
        healthState: healthDiagnosis.state,
        shopsSynced: [],
        error: errorMessage
      });
    }
  }

  return {
    mode,
    accountsProcessed: accounts.length,
    totalObservationsRead,
    totalOrdersProjected,
    accountSummaries
  };
}
