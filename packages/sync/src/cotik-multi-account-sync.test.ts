import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseContext } from "@shop-health/db";

const mockDb = vi.hoisted(() => ({
  listActiveCotikAccounts: vi.fn(),
  listCotikAccounts: vi.fn(),
  getDecryptedCotikToken: vi.fn(),
  updateCotikAccountStatus: vi.fn(),
  upsertCotikLogicalShop: vi.fn(),
  upsertCotikAccountShop: vi.fn(),
  listCotikAccountShopsByAccount: vi.fn(),
  updateCotikAccountShopDiscoveryState: vi.fn(),
  updateCotikAccountShopCheckpoint: vi.fn(),
  recordCotikOrderObservations: vi.fn(),
  projectWinningCotikOrder: vi.fn()
}));

const mockCotik = vi.hoisted(() => ({
  createMultiAccountCotikClient: vi.fn(),
  classifyCotikAccountHealth: vi.fn(),
  discoverAccountShops: vi.fn(),
  fetchCotikOrdersPage: vi.fn()
}));

vi.mock("@shop-health/db", () => mockDb);
vi.mock("@shop-health/cotik", () => mockCotik);

import {
  runCotikDiscoverySync,
  runCotikMultiAccountOrdersSync
} from "./cotik-multi-account-sync.js";

const FIXED_NOW = new Date("2026-09-07T12:00:00.000Z");
const now = () => new Date(FIXED_NOW);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.listCotikAccounts.mockImplementation(() => mockDb.listActiveCotikAccounts());
  mockDb.listCotikAccountShopsByAccount.mockResolvedValue([]);
});

describe("runCotikDiscoverySync", () => {
  it("retries read-only discovery for recoverable health states but never disabled accounts", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([]);
    mockDb.listCotikAccounts.mockResolvedValue([{ id: "recoverable", status: "UNKNOWN" }, { id: "disabled", status: "DISABLED" }]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("test-token");
    mockCotik.discoverAccountShops.mockResolvedValue({ state: "COMPLETE", shops: [], shopsFound: 0 });
    const result = await runCotikDiscoverySync({ context, now });
    expect(result.accountsProcessed).toBe(1);
    expect(mockDb.getDecryptedCotikToken).toHaveBeenCalledWith(context.db, "recoverable", undefined);
    expect(mockDb.getDecryptedCotikToken).not.toHaveBeenCalledWith(context.db, "disabled", undefined);
  });

  it("limits discovery to the requested account", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listCotikAccounts.mockResolvedValue([
      { id: "target", status: "UNKNOWN" },
      { id: "other", status: "ACTIVE" }
    ]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("test-token");
    mockCotik.discoverAccountShops.mockResolvedValue({ state: "COMPLETE", shops: [], shopsFound: 0 });

    const result = await runCotikDiscoverySync({ context, accountId: "target", now });

    expect(result.accountsProcessed).toBe(1);
    expect(mockDb.getDecryptedCotikToken).toHaveBeenCalledWith(context.db, "target", undefined);
    expect(mockDb.getDecryptedCotikToken).not.toHaveBeenCalledWith(context.db, "other", undefined);
  });
  it("pauses incomplete discovery and invalidates previously discovered links", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([{ id: "acc-1", status: "ACTIVE" }]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("test-token");
    mockDb.listCotikAccountShopsByAccount.mockResolvedValue([{ cotikShopId: "old-shop", discoveryState: "DISCOVERED" }]);
    mockCotik.discoverAccountShops.mockResolvedValue({ state: "DISCOVERY_INSUFFICIENT", shops: [], shopsFound: 0 });
    const result = await runCotikDiscoverySync({ context, now });
    expect(result.accountsFailed).toBe(1);
    expect(mockDb.updateCotikAccountShopDiscoveryState).toHaveBeenCalledWith(context.db, "acc-1", "old-shop", "ERROR", FIXED_NOW);
    expect(mockDb.updateCotikAccountStatus).toHaveBeenCalledWith(context.db, "acc-1", "UNKNOWN");
    expect(mockDb.upsertCotikLogicalShop).not.toHaveBeenCalled();
  });

  it("discovers shops for active accounts and upserts logical and account shops", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([
      { id: "acc-1", displayName: "Account 1", status: "ACTIVE" }
    ]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockCotik.discoverAccountShops.mockResolvedValue({
      state: "COMPLETE",
      accountId: "acc-1",
      totalReported: 1,
      shopsFound: 1,
      shops: [
        {
          cotikShopId: "c-shop-1",
          shopName: "My Shop US",
          maShopNoiBo: "My_Shop_US",
          region: "US",
          raw: {}
        }
      ]
    });
    mockDb.upsertCotikLogicalShop.mockResolvedValue({ id: "log-1", maShopNoiBo: "My_Shop_US", region: "US" });
    mockDb.upsertCotikAccountShop.mockResolvedValue({ id: "as-1" });
    mockDb.updateCotikAccountStatus.mockResolvedValue({});

    const result = await runCotikDiscoverySync({ context, now });

    expect(result.accountsProcessed).toBe(1);
    expect(result.shopsDiscovered).toBe(1);
    expect(result.accountsFailed).toBe(0);
    expect(mockDb.upsertCotikLogicalShop).toHaveBeenCalledWith(context.db, {
      maShopNoiBo: "My_Shop_US",
      region: "US"
    });
    expect(mockDb.upsertCotikAccountShop).toHaveBeenCalledWith(context.db, {
      accountId: "acc-1",
      logicalShopId: "log-1",
      cotikShopId: "c-shop-1",
      discoveryState: "DISCOVERED",
      lastDiscoveredAt: FIXED_NOW
    });
    expect(mockDb.updateCotikAccountStatus).toHaveBeenCalledWith(context.db, "acc-1", "ACTIVE", FIXED_NOW);
  });

  it("upserts a newly authenticated shop when Cotik reports a larger total", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([{ id: "acc-1", status: "ACTIVE" }]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockDb.listCotikAccountShopsByAccount.mockResolvedValue([
      { accountId: "acc-1", cotikShopId: "c-shop-1", discoveryState: "DISCOVERED" }
    ]);
    mockCotik.discoverAccountShops.mockResolvedValue({
      state: "COMPLETE",
      accountId: "acc-1",
      totalReported: 2,
      shopsFound: 2,
      shops: [
        { cotikShopId: "c-shop-1", shopName: "Existing", maShopNoiBo: "100", region: "US", raw: {} },
        { cotikShopId: "c-shop-2", shopName: "New", maShopNoiBo: "200", region: "US", raw: {} }
      ]
    });
    mockDb.upsertCotikLogicalShop
      .mockResolvedValueOnce({ id: "log-1" })
      .mockResolvedValueOnce({ id: "log-2" });

    const result = await runCotikDiscoverySync({ context, now });

    expect(result.shopsDiscovered).toBe(2);
    expect(mockDb.upsertCotikAccountShop).toHaveBeenCalledWith(context.db, {
      accountId: "acc-1",
      logicalShopId: "log-2",
      cotikShopId: "c-shop-2",
      discoveryState: "DISCOVERED",
      lastDiscoveredAt: FIXED_NOW
    });
    expect(mockDb.updateCotikAccountShopDiscoveryState).not.toHaveBeenCalled();
  });

  it("isolates errors per account without blocking subsequent accounts", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([
      { id: "acc-bad", displayName: "Bad Token Account", status: "ACTIVE" },
      { id: "acc-good", displayName: "Good Account", status: "ACTIVE" }
    ]);

    mockDb.getDecryptedCotikToken
      .mockRejectedValueOnce(new Error("Token is not valid!"))
      .mockResolvedValueOnce("good-token");

    mockCotik.classifyCotikAccountHealth.mockReturnValue({
      state: "TOKEN_EXPIRED",
      message: "Token is not valid!"
    });
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-good" });
    mockCotik.discoverAccountShops.mockResolvedValue({
      state: "COMPLETE",
      accountId: "acc-good",
      totalReported: 1,
      shopsFound: 1,
      shops: [
        {
          cotikShopId: "c-good-1",
          shopName: "Good Shop",
          maShopNoiBo: "Good_Shop",
          region: "US",
          raw: {}
        }
      ]
    });
    mockDb.upsertCotikLogicalShop.mockResolvedValue({ id: "log-good", maShopNoiBo: "Good_Shop", region: "US" });
    mockDb.upsertCotikAccountShop.mockResolvedValue({ id: "as-good" });

    const result = await runCotikDiscoverySync({ context, now });

    expect(result.accountsProcessed).toBe(2);
    expect(result.accountsFailed).toBe(1);
    expect(result.shopsDiscovered).toBe(1);
    expect(mockDb.updateCotikAccountStatus).toHaveBeenCalledWith(context.db, "acc-bad", "TOKEN_EXPIRED");
    expect(mockDb.updateCotikAccountStatus).toHaveBeenCalledWith(context.db, "acc-good", "ACTIVE", FIXED_NOW);
  });
});

describe("runCotikMultiAccountOrdersSync", () => {
  it("limits order reconcile to the requested account", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([
      { id: "target", status: "ACTIVE" },
      { id: "other", status: "ACTIVE" }
    ]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("test-token");
    mockDb.listCotikAccountShopsByAccount.mockResolvedValue([]);

    const result = await runCotikMultiAccountOrdersSync({ context, accountId: "target", mode: "reconcile", now });

    expect(result.accountsProcessed).toBe(1);
    expect(mockDb.getDecryptedCotikToken).toHaveBeenCalledWith(context.db, "target", undefined);
    expect(mockDb.getDecryptedCotikToken).not.toHaveBeenCalledWith(context.db, "other", undefined);
  });

  it("runs incremental sync with 2-hour overlap, records observations, and updates checkpoint", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([
      { id: "acc-1", displayName: "Account 1", status: "ACTIVE" }
    ]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });

    const lastUpdateTimeMs = 1725700000000;
    mockDb.listCotikAccountShopsByAccount.mockResolvedValue([
      {
        id: "as-1",
        accountId: "acc-1",
        logicalShopId: "log-1",
        cotikShopId: "c-shop-1",
        discoveryState: "DISCOVERED",
        checkpoint: { lastUpdateTimeMs }
      }
    ]);

    const orderTime = new Date(1725700500000);
    mockCotik.fetchCotikOrdersPage.mockResolvedValue({
      observations: [
        {
          accountId: "acc-1",
          logicalShopId: "",
          cotikShopId: "c-shop-1",
          orderId: "ord-100",
          orderStatus: "DELIVERED",
          orderCreateTime: new Date(1725700000000),
          orderUpdateTime: orderTime,
          tracking: "GFU123456789012345",
          carrier: "GOFO",
          shippingProvider: null,
          items: [{ sku: "SKU1", skuName: "Item 1", quantity: 1, refLink: null, providerEvidence: null }],
          rawData: {},
          observedAt: FIXED_NOW
        }
      ],
      total: 1
    });

    mockDb.recordCotikOrderObservations.mockResolvedValue([{}]);
    mockDb.projectWinningCotikOrder.mockResolvedValue({});
    mockDb.updateCotikAccountShopCheckpoint.mockResolvedValue({});

    const result = await runCotikMultiAccountOrdersSync({ context, now });

    expect(result.mode).toBe("incremental");
    expect(result.totalObservationsRead).toBe(1);
    expect(result.totalOrdersProjected).toBe(1);

    // Verify 2-hour overlap was passed to fetchCotikOrdersPage:
    // lastUpdateTimeMs - 2 hours (7_200_000 ms)
    const expectedFromMs = lastUpdateTimeMs - 2 * 3600 * 1000;
    expect(mockCotik.fetchCotikOrdersPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cotikShopId: "c-shop-1",
        updateTimeFromMs: expectedFromMs
      }),
      1
    );

    // Verify logicalShopId was assigned before persistence
    expect(mockDb.recordCotikOrderObservations).toHaveBeenCalledWith(
      context.db,
      expect.arrayContaining([
        expect.objectContaining({
          logicalShopId: "log-1",
          orderId: "ord-100"
        })
      ])
    );

    expect(mockDb.projectWinningCotikOrder).toHaveBeenCalledWith(context.db, {
      logicalShopId: "log-1",
      orderId: "ord-100",
      sourceAccountId: "acc-1",
      items: expect.any(Array)
    });
    expect(mockDb.updateCotikAccountStatus.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.projectWinningCotikOrder.mock.invocationCallOrder[0]!
    );

    // Verify checkpoint updated with maxUpdateTime
    expect(mockDb.updateCotikAccountShopCheckpoint).toHaveBeenCalledWith(
      context.db,
      "acc-1",
      "c-shop-1",
      expect.objectContaining({
        lastUpdateTimeMs: orderTime.getTime()
      })
    );
  });

  it("calculates reconcile range to start of previous month UTC", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([
      { id: "acc-1", displayName: "Account 1", status: "ACTIVE" }
    ]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockDb.listCotikAccountShopsByAccount.mockResolvedValue([
      {
        id: "as-1",
        accountId: "acc-1",
        logicalShopId: "log-1",
        cotikShopId: "c-shop-1",
        discoveryState: "DISCOVERED",
        checkpoint: null
      }
    ]);
    mockCotik.fetchCotikOrdersPage.mockResolvedValue({ observations: [], total: 0 });

    const testNow = new Date("2026-09-15T10:00:00.000Z");
    const result = await runCotikMultiAccountOrdersSync({
      context,
      mode: "reconcile",
      now: () => testNow
    });

    expect(result.mode).toBe("reconcile");
    // Start of previous month (August 1, 2026 00:00:00.000Z)
    const expectedReconcileStartMs = new Date("2026-08-01T00:00:00.000Z").getTime();
    expect(mockCotik.fetchCotikOrdersPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        updateTimeFromMs: expectedReconcileStartMs
      }),
      1
    );
  });

  it("handles shop errors gracefully without blocking other shops or accounts", async () => {
    const context = { db: {} } as DatabaseContext;
    mockDb.listActiveCotikAccounts.mockResolvedValue([
      { id: "acc-1", displayName: "Account 1", status: "ACTIVE" }
    ]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockDb.listCotikAccountShopsByAccount.mockResolvedValue([
      {
        id: "as-bad",
        accountId: "acc-1",
        logicalShopId: "log-bad",
        cotikShopId: "c-bad",
        discoveryState: "DISCOVERED",
        checkpoint: null
      },
      {
        id: "as-good",
        accountId: "acc-1",
        logicalShopId: "log-good",
        cotikShopId: "c-good",
        discoveryState: "DISCOVERED",
        checkpoint: null
      }
    ]);

    mockCotik.fetchCotikOrdersPage
      .mockRejectedValueOnce(new Error("Shop/App not found!"))
      .mockResolvedValueOnce({ observations: [], total: 0 });

    const result = await runCotikMultiAccountOrdersSync({ context, now });

    expect(result.accountsProcessed).toBe(1);
    expect(mockDb.updateCotikAccountShopDiscoveryState).toHaveBeenCalledWith(
      context.db,
      "acc-1",
      "c-bad",
      "DISCONNECTED"
    );
    expect(result.accountSummaries[0]!.shopsSynced).toHaveLength(2);
    expect(result.accountSummaries[0]!.shopsSynced[0]!.status).toBe("FAILED");
    expect(result.accountSummaries[0]!.shopsSynced[1]!.status).toBe("SUCCEEDED");
  });
});
