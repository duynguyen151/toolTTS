import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShopRow } from "@shop-health/db";
import type { NormalizedFinancialBatch, ProxyPreflightResult, SellerDataSource } from "@shop-health/domain";

import { runAuthoritativeFinanceRefresh } from "./authoritative-refresh-controller.js";

const db = vi.hoisted(() => ({
  beginSyncRun: vi.fn().mockResolvedValue({ id: "sync-run-1" }),
  completeSyncRun: vi.fn().mockResolvedValue(undefined),
  failSyncRun: vi.fn().mockResolvedValue(undefined),
  finalizeFinanceSyncRun: vi.fn().mockImplementation(async (_transaction, input) => ({
    snapshotInserted: input.snapshot !== null,
    captureInserted: input.sourceComplete && input.sourceReconciled,
    evidenceItemsInserted: input.settlements.length,
  })),
  getFullPersistedRiskOrderFacts: vi.fn(),
  getRiskControlState: vi.fn(),
  markShopSynced: vi.fn().mockResolvedValue(undefined),
  saveRiskControlEvaluation: vi.fn(),
  setShopSyncState: vi.fn().mockResolvedValue(undefined),
  updateSyncCheckpoint: vi.fn().mockResolvedValue(undefined),
  upsertOrderBatch: vi.fn(),
  upsertSettlementBatch: vi.fn().mockResolvedValue({ rowsRead: 1, rowsWritten: 1 }),
  withShopAdvisoryLock: vi.fn(async (_context, _shopId, operation) => operation()),
  withShopRiskControlLock: vi.fn(),
  withTransactionalShopLock: vi.fn(async (_context, _shopId, operation) => operation({})),
}));

vi.mock("@shop-health/db", () => db);

const healthyPreflight: ProxyPreflightResult = {
  status: "HEALTHY",
  latencyMs: 25,
  exitIp: null,
  reasonClass: "OBSERVED_HEALTHY",
};

describe("runAuthoritativeFinanceRefresh", () => {
  afterEach(() => vi.clearAllMocks());

  it("collects authoritative finance only after runShopSync canonically verifies an existing authenticated session", async () => {
    const events: string[] = [];
    const source = financeSource(events);

    const result = await runAuthoritativeFinanceRefresh({
      context: { db: {}, sql: {} } as never,
      source,
      shop: shop(),
      preflight: healthyPreflight,
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      authoritativeProvider: "SELLER_CENTER",
      financeProof: expect.objectContaining({ officialOnHoldAmount: "1200.0000" }),
    });
    expect(events).toEqual(["health", "verify", "collect"]);
    expect(db.beginSyncRun).toHaveBeenCalledOnce();
  });

  it("fails before collection when runShopSync rejects the canonical shop identity", async () => {
    const source = financeSource([]);
    source.verifyProfile = vi.fn().mockResolvedValue({ status: "IDENTIFIED", tiktokShopId: "seller-other" });

    const result = await runAuthoritativeFinanceRefresh({
      context: { db: {}, sql: {} } as never,
      source,
      shop: shop(),
      preflight: healthyPreflight,
    });

    expect(result).toEqual({
      status: "FAILED",
      authoritativeProvider: "SELLER_CENTER",
      reason: "SYNC_SHOP_IDENTITY_CHANGED",
    });
    expect(source.collectFinancials).not.toHaveBeenCalled();
    expect(db.beginSyncRun).not.toHaveBeenCalled();
  });

  it.each(["LOGIN_REQUIRED", "CHALLENGE_REQUIRED"] as const)("returns %s as a typed manual outcome without collecting", async (status) => {
    const source = financeSource([], status);

    const result = await runAuthoritativeFinanceRefresh({
      context: { db: {}, sql: {} } as never,
      source,
      shop: shop(),
      preflight: healthyPreflight,
    });

    expect(result).toEqual({
      status: "HUMAN_ACTION_REQUIRED",
      authoritativeProvider: "SELLER_CENTER",
      reason: status,
    });
    expect(source.verifyProfile).not.toHaveBeenCalled();
    expect(source.collectFinancials).not.toHaveBeenCalled();
    expect(db.beginSyncRun).not.toHaveBeenCalled();
  });

  it.each(["UNKNOWN", "UNAVAILABLE"] as const)("blocks %s proxy results before browser work", async (status) => {
    const source = financeSource([]);
    const preflight: ProxyPreflightResult = status === "UNKNOWN"
      ? { status, latencyMs: 0, exitIp: null, reasonClass: "OBSERVATION_UNAVAILABLE" }
      : { status, latencyMs: 0, exitIp: null, reasonClass: "NETWORK_UNAVAILABLE" };

    const result = await runAuthoritativeFinanceRefresh({
      context: { db: {}, sql: {} } as never,
      source,
      shop: shop(),
      preflight,
    });

    expect(result).toEqual({
      status: "BLOCKED",
      authoritativeProvider: "SELLER_CENTER",
      reason: `PROXY_${status}`,
    });
    expect(source.health).not.toHaveBeenCalled();
    expect(source.collectFinancials).not.toHaveBeenCalled();
  });

  it("fails closed when collection does not produce reconciled Official Finance On Hold", async () => {
    const source = financeSource([], "HEALTHY", { reasonTotalsReconcileToOfficialOnHold: false });

    const result = await runAuthoritativeFinanceRefresh({
      context: { db: {}, sql: {} } as never,
      source,
      shop: shop(),
      preflight: healthyPreflight,
    });

    expect(result).toEqual({
      status: "FAILED",
      authoritativeProvider: "SELLER_CENTER",
      reason: "FINANCE_RECONCILIATION_INCOMPLETE",
    });
    expect(source.collectFinancials).toHaveBeenCalledOnce();
    expect(db.markShopSynced).not.toHaveBeenCalled();
  });
});

function financeSource(
  events: string[],
  healthStatus: "HEALTHY" | "LOGIN_REQUIRED" | "CHALLENGE_REQUIRED" = "HEALTHY",
  snapshotOverride: Partial<NonNullable<NormalizedFinancialBatch["snapshot"]>> = {},
): SellerDataSource {
  return {
    health: vi.fn(async () => {
      events.push("health");
      return { status: healthStatus, checkedAt: new Date("2026-08-28T00:00:00.000Z"), detail: null };
    }),
    probe: vi.fn(),
    verifyProfile: vi.fn(async () => {
      events.push("verify");
      return { status: "IDENTIFIED", tiktokShopId: "seller-957" } as const;
    }),
    collectOrders: vi.fn(),
    collectFinancials: vi.fn(async function* () {
      events.push("collect");
      yield {
        settlements: [{}] as never,
        snapshot: {
          capturedAt: new Date("2026-08-28T00:00:00.000Z"),
          officialOnHoldAmount: "1200.0000",
          reasonTotalsReconcileToOfficialOnHold: true,
          ...snapshotOverride,
        },
        checkpoint: null,
        complete: true,
      } as never as NormalizedFinancialBatch;
    }),
  } as SellerDataSource;
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
