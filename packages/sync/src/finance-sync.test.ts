import { describe, expect, it, vi } from "vitest";

import type { ShopRow } from "@shop-health/db";
import type { NormalizedFinancialBatch, SellerDataSource } from "@shop-health/domain";

const db = vi.hoisted(() => ({
  beginSyncRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  insertFinancialSnapshot: vi.fn().mockResolvedValue({ inserted: true, row: {} }),
  markShopSynced: vi.fn().mockResolvedValue(undefined),
  setShopSyncState: vi.fn().mockResolvedValue(undefined),
  updateSyncCheckpoint: vi.fn().mockResolvedValue(undefined),
  upsertOrderBatch: vi.fn(),
  upsertSettlementBatch: vi.fn().mockResolvedValue({ rowsRead: 8, rowsWritten: 8 }),
  withShopAdvisoryLock: vi.fn(async (_context, _shopId, operation) => operation()),
  withTransactionalShopLock: vi.fn(async (_context, _shopId, operation) => operation({})),
  withShopRiskControlLock: vi.fn(),
  getFullPersistedRiskOrderFacts: vi.fn(),
  getRiskControlState: vi.fn(),
  saveRiskControlEvaluation: vi.fn(),
}));

vi.mock("@shop-health/db", () => db);

import { runShopSync } from "./index.js";

describe("finance sync persistence", () => {
  it("counts and persists settlements and the summary snapshot", async () => {
    const result = await runShopSync({
      context: { db: {}, sql: {} } as never,
      source: financeSource(financialBatch()),
      shop: shop(),
      kind: "finance",
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      rowsRead: 9,
      rowsWritten: 9,
      complete: true,
    });
  });
});

function financeSource(batch: NormalizedFinancialBatch): SellerDataSource {
  return {
    health: vi.fn(),
    probe: vi.fn(),
    collectOrders: vi.fn(),
    collectFinancials: async function* () {
      yield batch;
    },
  } as SellerDataSource;
}

function financialBatch(): NormalizedFinancialBatch {
  return {
    settlements: Array.from({ length: 8 }, () => ({})) as never,
    snapshot: {} as never,
    checkpoint: null,
    complete: true,
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
