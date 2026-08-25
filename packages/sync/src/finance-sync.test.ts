import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShopRow } from "@shop-health/db";
import type { NormalizedFinancialBatch, SellerDataSource } from "@shop-health/domain";

const db = vi.hoisted(() => ({
  beginSyncRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  finalizeFinanceSyncRun: vi.fn().mockImplementation(async (_transaction, input) => ({
    snapshotInserted: input.snapshot !== null,
    captureInserted: input.sourceComplete && input.sourceReconciled && input.snapshot?.officialOnHoldAmount !== null,
    evidenceItemsInserted: input.sourceComplete && input.sourceReconciled ? input.settlements.length : 0,
  })),
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
  afterEach(() => {
    vi.clearAllMocks();
  });

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
      financeProof: {
        capturedAt: new Date("2026-08-14T00:00:00.000Z"),
        officialOnHoldAmount: "1200.0000",
        reasonTotalsReconcileToOfficialOnHold: true,
      },
    });
    expect(db.upsertSettlementBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      new Date("2026-08-14T00:00:00.000Z")
    );
    expect(db.finalizeFinanceSyncRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      runId: "run-1",
      shopId: "00000000-0000-0000-0000-000000000001",
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: expect.objectContaining({ capturedAt: expect.any(Date) }),
      settlements: expect.any(Array),
    }));
    expect(db.completeSyncRun).not.toHaveBeenCalled();
  });

  it("persists incomplete finance coverage when the source batch is incomplete", async () => {
    await runShopSync({
      context: { db: {}, sql: {} } as never,
      source: financeSource({ ...financialBatch(), complete: false }),
      shop: shop(),
      kind: "finance",
    });

    expect(db.finalizeFinanceSyncRun).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      sourceComplete: false,
      sourceReconciled: true,
      snapshot: expect.objectContaining({ capturedAt: expect.any(Date) }),
    }));
    expect(db.markShopSynced).not.toHaveBeenCalled();
  });

  it.each([
    ["a final unreconciled batch", false],
    ["individually reconciled batches", true],
  ])("refuses authoritative Finance proof for multiple batches with %s", async (_description, finalReconciled) => {
    const result = await runShopSync({
      context: { db: {}, sql: {} } as never,
      source: financeSource([
        financialBatch(),
        {
          ...financialBatch(),
          settlements: [],
          snapshot: {
            ...financialSnapshot(),
            capturedAt: new Date("2026-08-14T00:01:00.000Z"),
            reasonTotalsReconcileToOfficialOnHold: finalReconciled,
          },
        },
      ]),
      shop: shop(),
      kind: "finance",
    });

    expect(result.complete).toBe(false);
    expect(result.financeProof).toBeUndefined();
    expect(db.finalizeFinanceSyncRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sourceComplete: false,
      sourceReconciled: false,
      snapshot: expect.objectContaining({ capturedAt: new Date("2026-08-14T00:01:00.000Z") }),
      settlements: [],
    }));
    expect(db.markShopSynced).not.toHaveBeenCalled();
  });

  it.each([
    ["the snapshot is absent", null],
    ["the official On Hold amount is absent", { officialOnHoldAmount: null }],
    ["reason totals do not reconcile", { reasonTotalsReconcileToOfficialOnHold: false }],
  ])("does not report finance proof when %s", async (_description, snapshotOverride) => {
    const result = await runShopSync({
      context: { db: {}, sql: {} } as never,
      source: financeSource(snapshotOverride === null
        ? { ...financialBatch(), snapshot: null }
        : { ...financialBatch(), snapshot: { ...financialSnapshot(), ...snapshotOverride } }),
      shop: shop(),
      kind: "finance",
    });

    expect(result.complete).toBe(false);
    expect(result.financeProof).toBeUndefined();
    expect(db.finalizeFinanceSyncRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sourceComplete: true,
      sourceReconciled: snapshotOverride === null
        ? false
        : !("reasonTotalsReconcileToOfficialOnHold" in snapshotOverride) ||
          snapshotOverride.reasonTotalsReconcileToOfficialOnHold !== false,
    }));
    expect(db.completeSyncRun).not.toHaveBeenCalled();
    expect(db.markShopSynced).not.toHaveBeenCalled();
  });
});

function financeSource(batch: NormalizedFinancialBatch | readonly NormalizedFinancialBatch[]): SellerDataSource {
  const batches = Array.isArray(batch) ? batch : [batch];
  return {
    health: vi.fn(),
    probe: vi.fn(),
    verifyProfile: vi.fn().mockResolvedValue({ status: "IDENTIFIED", tiktokShopId: "seller-957" }),
    collectOrders: vi.fn(),
    collectFinancials: async function* () {
      for (const current of batches) yield current;
    },
  } as SellerDataSource;
}

function financialBatch(): NormalizedFinancialBatch {
  return {
    settlements: Array.from({ length: 8 }, () => ({})) as never,
    snapshot: financialSnapshot(),
    checkpoint: null,
    complete: true,
  };
}

function financialSnapshot() {
  return {
    capturedAt: new Date("2026-08-14T00:00:00.000Z"),
    officialOnHoldAmount: "1200.0000",
    reasonTotalsReconcileToOfficialOnHold: true,
  } as NormalizedFinancialBatch["snapshot"] & {};
}

function shop(): ShopRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    profileId: "profile-1",
    profileNo: "957",
    tiktokShopId: "seller-957",
    region: "US",
    locale: "en-US",
  } as ShopRow;
}
