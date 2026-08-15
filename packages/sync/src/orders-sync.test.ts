import { describe, expect, it, vi } from "vitest";

import type { ShopRow } from "@shop-health/db";
import type { NormalizedOrderBatch, SellerDataSource } from "@shop-health/domain";

const db = vi.hoisted(() => ({
  beginSyncRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  insertFinancialSnapshot: vi.fn(),
  markShopSynced: vi.fn().mockResolvedValue(undefined),
  setShopSyncState: vi.fn().mockResolvedValue(undefined),
  updateSyncCheckpoint: vi.fn().mockResolvedValue(undefined),
  upsertOrderBatch: vi.fn().mockResolvedValue({ rowsRead: 9, rowsWritten: 9 }),
  upsertSettlementBatch: vi.fn(),
  withShopAdvisoryLock: vi.fn(async (_context, _shopId, operation) => operation()),
  withTransactionalShopLock: vi.fn(async (_context, _shopId, operation) => operation({})),
  withShopRiskControlLock: vi.fn(),
  getFullPersistedRiskOrderFacts: vi.fn(),
  getRiskControlState: vi.fn(),
  saveRiskControlEvaluation: vi.fn(),
}));

vi.mock("@shop-health/db", () => db);

import { runShopSync } from "./index.js";

describe("orders sync coverage", () => {
  it("reports completeness only within the proven rolling 12-month source window", async () => {
    const result = await runShopSync({
      context: { db: {}, sql: {} } as never,
      source: ordersSource(orderBatch()),
      shop: shop(),
      kind: "orders",
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      complete: true,
      sourceCoverage: {
        source: "SELLER_CENTER",
        window: "ROLLING_12_MONTHS",
        completeWithinWindow: true,
        lifetimeHistoryComplete: false,
      },
    });
    expect(db.completeSyncRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sourceComplete: true,
      sourceCapturedAt: expect.any(Date),
      sourceCoverage: expect.objectContaining({
        source: "SELLER_CENTER",
        window: "ROLLING_12_MONTHS",
        completeWithinSourceWindow: true,
        lifetimeHistoryComplete: false,
      }),
    }));
  });
});

function ordersSource(batch: NormalizedOrderBatch): SellerDataSource {
  return {
    health: vi.fn(),
    probe: vi.fn(),
    collectOrders: async function* () {
      yield batch;
    },
    collectFinancials: vi.fn(),
  } as SellerDataSource;
}

function orderBatch(): NormalizedOrderBatch {
  return {
    orders: Array.from({ length: 9 }, () => ({})) as never,
    checkpoint: null,
    complete: true,
    sourceWindow: {
      source: "SELLER_CENTER",
      kind: "ROLLING_MONTHS",
      months: 12,
      lifetimeHistory: false,
    },
  };
}

function shop(): ShopRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    profileId: "profile-1",
    profileNo: "957",
    region: "US",
    locale: "en-US",
  } as ShopRow;
}
