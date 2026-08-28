import "dotenv/config";

import {
  abortStaleSyncRuns,
  claimDueRefreshAttempts,
  closeDatabase,
  completeRefreshAttempt,
  releaseRefreshClaim,
  renewRefreshAttemptLease,
  createDatabase,
  listAutomaticRefreshEligibleAdsPowerProfileShops,
  listReadyAdsPowerProfileShops,
  recordRefreshAttemptStarted,
  recordRefreshAttemptProxyPreflight,
  withRefreshProfileExecutionLock,
  type ShopRow
} from "@shop-health/db";
import { createSellerCenterDataSource } from "@shop-health/seller-center";
import { createAdsPowerProxyPreflight } from "@shop-health/seller-center/proxy-preflight";
import {
  evaluateAndStoreRiskControl,
  runAuthoritativeFinanceRefresh,
  runShopSync,
  type SyncKind,
} from "@shop-health/sync";
import pino from "pino";

import { loadWorkerConfig } from "./config.js";
import { executeClaimedRefreshAttempts } from "./refresh-controller-loop.js";
import { selectAutomaticOrdersShops } from "./automatic-shop-selector.js";
import { runAutomaticOrdersWithPreflight } from "./automatic-orders-preflight.js";

const config = loadWorkerConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["cookie", "cookies", "token", "headers.cookie", "headers.authorization", "session", "storageState"],
    censor: "[REDACTED]"
  }
});
const context = createDatabase(config.DATABASE_URL);
const sourceOptions = {
  baseUrl: config.ADSPOWER_BASE_URL,
  logger,
  ...(config.ADSPOWER_AUTOFILL_REFERENCE === undefined ? {} : { credentialReference: config.ADSPOWER_AUTOFILL_REFERENCE }),
};
const source = createSellerCenterDataSource(config.ADSPOWER_API_KEY === undefined
  ? sourceOptions
  : { ...sourceOptions, apiKey: config.ADSPOWER_API_KEY });
const proxyPreflight = createAdsPowerProxyPreflight(config.ADSPOWER_API_KEY === undefined
  ? { baseUrl: config.ADSPOWER_BASE_URL }
  : { baseUrl: config.ADSPOWER_BASE_URL, apiKey: config.ADSPOWER_API_KEY });

let stopping = false;
const lastRun = new Map<string, number>();

function isDue(shop: ShopRow, kind: SyncKind, now: number): boolean {
  const key = `${shop.id}:${kind}`;
  const interval = kind === "orders" ? config.ORDERS_PROBE_INTERVAL_MS : config.FINANCE_PROBE_INTERVAL_MS;
  return now - (lastRun.get(key) ?? 0) >= interval;
}

async function syncShop(shop: ShopRow, kind: SyncKind): Promise<boolean> {
  const key = `${shop.id}:${kind}`;
  lastRun.set(key, Date.now());
  try {
    const result = await runShopSync({ context, source, shop, kind, logger });
    if (kind === "orders" && result.status === "SUCCEEDED") {
      const risk = await evaluateAndStoreRiskControl(context, shop);
      logger.info({ shopId: shop.id, profileId: shop.profileId, operation: "risk.evaluate", entity: "holiday_mode", mode: "DRY_RUN", desiredState: risk.desiredState, reasons: risk.reasons }, "Risk control evaluated without applying Holiday Mode");
    }
    logger.info({ shopId: shop.id, profileId: shop.profileId, operation: "worker.cycle", entity: kind, status: result.status, rowsRead: result.rowsRead, rowsWritten: result.rowsWritten }, "Worker cycle completed");
    return result.status === "SUCCEEDED";
  } catch (error) {
    logger.error({ shopId: shop.id, profileId: shop.profileId, operation: "worker.cycle", entity: kind, failureType: error instanceof Error && "failureType" in error ? String(error.failureType) : "UNEXPECTED_ERROR", error: error instanceof Error ? error.message : "Unknown error" }, "Worker cycle failed");
    return false;
  }
}

async function runClaimedRefreshAttempts(shops: readonly ShopRow[], now: Date): Promise<void> {
  const runs = await claimDueRefreshAttempts(context.db, {
    now,
    shops: shops.map((shop) => ({ id: shop.id })),
  });
  await executeClaimedRefreshAttempts({
    runs,
    shops,
    now,
    repository: {
      recordRefreshAttemptStarted: (input) => recordRefreshAttemptStarted(context.db, input),
      recordRefreshAttemptProxyPreflight: (input) => recordRefreshAttemptProxyPreflight(context.db, input),
      renewRefreshAttemptLease: (input) => renewRefreshAttemptLease(context.db, input),
      releaseRefreshClaim: (input) => releaseRefreshClaim(context.db, input),
      completeRefreshAttempt: (input) => completeRefreshAttempt(context.db, input),
    },
    preflight: async (shop) => proxyPreflight.preflight({ profileId: shop.profileId }),
    withExecutionLock: (shop, operation) => withRefreshProfileExecutionLock(context, shop.profileId, operation),
    execute: async (shop, preflight) => {
      const result = await runAuthoritativeFinanceRefresh({
        context,
        source,
        shop,
        preflight,
        logger,
      });
      return result.status === "SUCCEEDED"
        ? { success: true }
        : { success: false, failureMessage: `${result.status}:${result.reason}` };
    },
  });
}

async function workerLoop(): Promise<void> {
  await abortStaleSyncRuns(context.db, new Date(Date.now() - 10 * 60 * 1000));
  logger.info({ operation: "worker.start" }, "Shop Health worker started");

  while (!stopping) {
    try {
      const now = new Date();
      const shops = await listReadyAdsPowerProfileShops(context.db);
      const automaticRefreshShops = await listAutomaticRefreshEligibleAdsPowerProfileShops(context.db, now);
      const automaticOrdersShops = selectAutomaticOrdersShops(shops, automaticRefreshShops);
      const nowMs = now.getTime();
      for (const shop of automaticOrdersShops) {
        if (stopping) break;
        if (isDue(shop, "orders", nowMs)) {
          await runAutomaticOrdersWithPreflight({
            shop,
            proxyPreflight,
            execute: (eligibleShop) => syncShop(eligibleShop, "orders"),
            logBlocked: (event, message) => logger.warn(event, message),
          });
        }
      }
      if (!stopping) await runClaimedRefreshAttempts(automaticRefreshShops, now);
    } catch (error) {
      logger.error({ operation: "worker.scheduler", entity: "shop", failureType: "DATABASE_UNAVAILABLE", error: error instanceof Error ? error.message : "Unknown error" }, "Scheduler cycle failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ operation: "worker.stop", signal }, "Stopping Shop Health worker");
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

try {
  await workerLoop();
} finally {
  await closeDatabase(context).catch(() => undefined);
}
