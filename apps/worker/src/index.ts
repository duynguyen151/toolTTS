import "dotenv/config";

import {
  abortStaleSyncRuns,
  closeDatabase,
  createDatabase,
  listReadyAdsPowerProfileShops,
  type ShopRow
} from "@shop-health/db";
import { createSellerCenterDataSource } from "@shop-health/seller-center";
import { evaluateAndStoreRiskControl, runShopSync, type SyncKind } from "@shop-health/sync";
import pino from "pino";

import { loadWorkerConfig } from "./config.js";

const config = loadWorkerConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["cookie", "cookies", "token", "headers.cookie", "headers.authorization", "session", "storageState"],
    censor: "[REDACTED]"
  }
});
const context = createDatabase(config.DATABASE_URL);
const sourceOptions = { baseUrl: config.ADSPOWER_BASE_URL, logger };
const source = createSellerCenterDataSource(config.ADSPOWER_API_KEY === undefined
  ? sourceOptions
  : { ...sourceOptions, apiKey: config.ADSPOWER_API_KEY });

let stopping = false;
const lastRun = new Map<string, number>();

function isDue(shop: ShopRow, kind: SyncKind, now: number): boolean {
  const key = `${shop.id}:${kind}`;
  const interval = kind === "orders" ? config.ORDERS_PROBE_INTERVAL_MS : config.FINANCE_PROBE_INTERVAL_MS;
  return now - (lastRun.get(key) ?? 0) >= interval;
}

async function syncShop(shop: ShopRow, kind: SyncKind): Promise<void> {
  const key = `${shop.id}:${kind}`;
  lastRun.set(key, Date.now());
  try {
    const result = await runShopSync({ context, source, shop, kind, logger });
    if (kind === "orders" && result.status === "SUCCEEDED") {
      const risk = await evaluateAndStoreRiskControl(context, shop);
      logger.info({ shopId: shop.id, profileId: shop.profileId, operation: "risk.evaluate", entity: "holiday_mode", mode: "DRY_RUN", desiredState: risk.desiredState, reasons: risk.reasons }, "Risk control evaluated without applying Holiday Mode");
    }
    logger.info({ shopId: shop.id, profileId: shop.profileId, operation: "worker.cycle", entity: kind, status: result.status, rowsRead: result.rowsRead, rowsWritten: result.rowsWritten }, "Worker cycle completed");
  } catch (error) {
    logger.error({ shopId: shop.id, profileId: shop.profileId, operation: "worker.cycle", entity: kind, failureType: error instanceof Error && "failureType" in error ? String(error.failureType) : "UNEXPECTED_ERROR", error: error instanceof Error ? error.message : "Unknown error" }, "Worker cycle failed");
  }
}

async function workerLoop(): Promise<void> {
  await abortStaleSyncRuns(context.db, new Date(Date.now() - 10 * 60 * 1000));
  logger.info({ operation: "worker.start" }, "Shop Health worker started");

  while (!stopping) {
    try {
      const shops = await listReadyAdsPowerProfileShops(context.db);
      const now = Date.now();
      for (const shop of shops) {
        if (stopping) break;
        if (isDue(shop, "orders", now)) await syncShop(shop, "orders");
        if (isDue(shop, "finance", now)) await syncShop(shop, "finance");
      }
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
