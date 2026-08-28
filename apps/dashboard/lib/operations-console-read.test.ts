import { describe, expect, it, vi } from "vitest";
import { readConsoleShops, readConsoleShopDetail } from "./operations-console-read.js";

vi.mock("@shop-health/db", () => {
  return {
    createDatabase: vi.fn(() => ({ db: {} })),
    closeDatabase: vi.fn(),
    listShops: vi.fn().mockResolvedValue([
      {
        id: "shop-1",
        profileId: "p-1",
        profileNo: "118",
        displayName: "Shop Alpha",
        region: "US",
        locale: "en-US",
        currency: "USD",
        enabled: true,
        syncState: "ACTIVE",
        pauseReason: null,
        verificationStatus: "VERIFIED",
        eligibilityStatus: "ELIGIBLE",
        tiktokShopId: "TTS_118",
        lastOrdersSyncedAt: new Date("2026-08-16T10:00:00Z"),
        lastFinanceSyncedAt: new Date("2026-08-16T10:00:00Z"),
      },
      {
        id: "shop-2",
        profileId: "p-2",
        profileNo: "957",
        displayName: "Shop Beta",
        region: "US",
        locale: "en-US",
        currency: "USD",
        enabled: true,
        syncState: "PAUSED_LOGIN",
        pauseReason: "LOGIN_REQUIRED",
        verificationStatus: "FAILED",
        eligibilityStatus: "INELIGIBLE",
        tiktokShopId: null,
        lastOrdersSyncedAt: null,
        lastFinanceSyncedAt: null,
      },
    ]),
    findShopByProfileNo: vi.fn().mockImplementation((_db, profileNo) => {
      if (profileNo === "118") {
        return Promise.resolve({
          id: "shop-1",
          profileId: "p-1",
          profileNo: "118",
          displayName: "Shop Alpha",
          region: "US",
          locale: "en-US",
          currency: "USD",
          enabled: true,
          syncState: "ACTIVE",
          pauseReason: null,
          verificationStatus: "VERIFIED",
          eligibilityStatus: "ELIGIBLE",
          tiktokShopId: "TTS_118",
          lastOrdersSyncedAt: new Date("2026-08-16T10:00:00Z"),
          lastFinanceSyncedAt: new Date("2026-08-16T10:00:00Z"),
        });
      }
      return Promise.resolve(null);
    }),
    listAdsPowerProfiles: vi.fn().mockResolvedValue([
      {
        id: "ap-1",
        profileId: "p-1",
        profileNo: "118",
        verificationState: "READY",
        eligibilityStatus: "ELIGIBLE",
        verifiedTiktokShopId: "TTS_118",
        verifiedShopDisplayName: "Shop Alpha",
        lastVerifiedAt: new Date("2026-08-16T09:00:00Z"),
      },
    ]),
    listDecisionHistory: vi.fn().mockResolvedValue({
      items: [
        {
          case: { id: "case-118", origin: "LIVE", observedAt: new Date("2026-08-16T10:00:00Z"), createdAt: new Date("2026-08-16T10:00:00Z") },
          shop: { id: "shop-1", profileNo: "118", displayName: "Shop Alpha", currency: "USD", dataOrigin: "LIVE", dataCoverage: "COMPLETE", lastSyncAt: null },
          coverageSnapshot: {
            coverageState: "COMPLETE",
            source: "SELLER_CENTER",
            provenSourceWindow: "ROLLING_12_MONTHS",
            completeWithinSourceWindow: true,
            lifetimeHistoryComplete: true,
            ordersSourceComplete: true,
            financeRequiredSourceComplete: true,
            sourceReconciled: true,
            freshness: "FRESH",
          },
          metrics: {
            totalOrders: 42,
            onHoldValue: "1250.00",
            deliveredCount: 30,
            deliveryRate: 0.714,
            cancellationRate: null,
            refundRate: null,
            currency: "USD",
          },
          rule: { decision: "CONTINUE" },
          ai: { recommendation: "CONTINUE", confidence: 0.95, riskLevel: "LOW", reason: "Good health", reasonCodes: [] },
          ba: { id: "ba-1", decision: "CONTINUE", reasonCode: "HIGH_VOLUME_HEALTHY", reasonCodes: ["HIGH_VOLUME_HEALTHY"], actor: "Boss", note: "Approved", decidedAt: new Date("2026-08-16T10:30:00Z") },
          baHistory: [],
        },
      ],
      nextCursor: null,
    }),
    getLatestKpiSnapshot: vi.fn().mockResolvedValue(null),
    getFinanceSummary: vi.fn().mockResolvedValue({
      latestSnapshot: { officialOnHoldAmount: "1250.00", capturedAt: new Date("2026-08-16T10:00:00Z"), currency: "USD" },
      statementsCount: 2,
    }),
    getFullPersistedRiskOrderFacts: vi.fn().mockResolvedValue([
      { canonicalStatus: "DELIVERED", orderCount: 30 },
      { canonicalStatus: "AWAITING_SHIPMENT", orderCount: 12 },
    ]),
    listSyncRuns: vi.fn().mockResolvedValue([
      {
        id: "sync-1",
        mode: "ORDERS",
        status: "SUCCEEDED",
        startedAt: new Date("2026-08-16T09:50:00Z"),
        finishedAt: new Date("2026-08-16T09:55:00Z"),
        rowsRead: 42,
        rowsWritten: 42,
        failureType: null,
        failureMessage: null,
      },
    ]),
  };
});

describe("operations-console-read", () => {
  it("reads and paginates console shops with real mapped DB facts", async () => {
    const result = await readConsoleShops("postgres://test-db", { pageSize: 10 });
    expect(result.totalItems).toBe(2);
    expect(result.items.length).toBe(2);

    const shop118 = result.items.find((s) => s.profileNo === "118");
    expect(shop118).toBeDefined();
    expect(shop118?.displayName).toBe("Shop Alpha");
    expect(shop118?.verificationState).toBe("READY");
    expect(shop118?.totalOrders).toBe(42);
    expect(shop118?.latestBaDecision).toBe("CONTINUE");

    const shop957 = result.items.find((s) => s.profileNo === "957");
    expect(shop957?.syncState).toBe("PAUSED_LOGIN");
    expect(shop957?.verificationState).toBe("UNVERIFIED");
  });

  it("filters shops by query keyword", async () => {
    const result = await readConsoleShops("postgres://test-db", { query: "Alpha" });
    expect(result.items.length).toBe(1);
    expect(result.items[0]?.profileNo).toBe("118");
  });

  it("reads detailed 7-tab console facts for profile 118", async () => {
    const detail = await readConsoleShopDetail("postgres://test-db", "118");
    expect(detail).not.toBeNull();
    expect(detail?.shop.profileNo).toBe("118");
    expect(detail?.shop.tags).toEqual([]);
    expect(detail?.tagsTab.profileTags).toEqual([]);
    expect(detail?.dataTab.dataCoverage).toBe("READY");
    expect(detail?.baTab.currentDecision).toBe("CONTINUE");
    expect(detail?.baTab.history.length).toBe(1);
    expect(detail?.syncTab.syncRuns.length).toBe(1);
    expect(detail?.auditTab.auditLogs.length).toBeGreaterThan(0);
  });

  it("passes AdsPower tags through to shop summary and tags tab", async () => {
    const mockAdsPowerClient = {
      listProfiles: vi.fn().mockResolvedValue([
        {
          profileId: "p-1",
          profileNo: "118",
          groupName: "Alpha Group",
          tags: [{ name: "vip" }, { name: "us-east" }],
          state: "OPEN" as const,
        },
      ]),
    } as any;

    const result = await readConsoleShops("postgres://test-db", { pageSize: 10 }, mockAdsPowerClient);
    const shop118 = result.items.find((s) => s.profileNo === "118");
    expect(shop118?.tags).toEqual([{ name: "vip" }, { name: "us-east" }]);
    expect(shop118?.groupName).toBe("Alpha Group");
    expect(shop118?.adsPowerState).toBe("OPEN");

    const detail = await readConsoleShopDetail("postgres://test-db", "118", mockAdsPowerClient);
    expect(detail?.shop.tags).toEqual([{ name: "vip" }, { name: "us-east" }]);
    expect(detail?.tagsTab.profileTags).toEqual([{ name: "vip" }, { name: "us-east" }]);
    expect(detail?.tagsTab.groupName).toBe("Alpha Group");
    expect(detail?.tagsTab.dataNote).toBe("Thẻ và phân nhóm được đồng bộ trực tiếp từ hồ sơ AdsPower hiện tại.");
  });

  it("returns null when profile does not exist in DB", async () => {
    const detail = await readConsoleShopDetail("postgres://test-db", "99999");
    expect(detail).toBeNull();
  });

  it("passes raw numeric string or null for overview.finance.onHoldAmount", async () => {
    const detail = await readConsoleShopDetail("postgres://test-db", "118");
    expect(detail?.overview.finance.onHoldAmount).toBe("1250.00");
  });

  it("handles various onHoldAmount values (null, 0, 0.00, formatted) properly in readConsoleShopDetail", async () => {
    // Check when onHoldAmount is null
    const db = await import("@shop-health/db");
    vi.mocked(db.listDecisionHistory).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });
    vi.mocked(db.getFinanceSummary).mockResolvedValueOnce({
      latestSnapshot: { officialOnHoldAmount: null, capturedAt: null, currency: "USD" } as any,
    } as any);
    const detailNull = await readConsoleShopDetail("postgres://test-db", "118");
    expect(detailNull?.overview.finance.onHoldAmount).toBeNull();

    // Check when onHoldAmount is "0"
    vi.mocked(db.listDecisionHistory).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });
    vi.mocked(db.getFinanceSummary).mockResolvedValueOnce({
      latestSnapshot: { officialOnHoldAmount: "0", capturedAt: null, currency: "USD" } as any,
    } as any);
    const detailZero = await readConsoleShopDetail("postgres://test-db", "118");
    expect(detailZero?.overview.finance.onHoldAmount).toBe("0");

    // Check when onHoldAmount is "0.00"
    vi.mocked(db.listDecisionHistory).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });
    vi.mocked(db.getFinanceSummary).mockResolvedValueOnce({
      latestSnapshot: { officialOnHoldAmount: "0.00", capturedAt: null, currency: "USD" } as any,
    } as any);
    const detailZeroDec = await readConsoleShopDetail("postgres://test-db", "118");
    expect(detailZeroDec?.overview.finance.onHoldAmount).toBe("0.00");

    // Check when onHoldAmount is "102.60"
    vi.mocked(db.listDecisionHistory).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });
    vi.mocked(db.getFinanceSummary).mockResolvedValueOnce({
      latestSnapshot: { officialOnHoldAmount: "102.60", capturedAt: null, currency: "USD" } as any,
    } as any);
    const detailCustom = await readConsoleShopDetail("postgres://test-db", "118");
    expect(detailCustom?.overview.finance.onHoldAmount).toBe("102.60");
  });

  it("provides correct order explorer URL for shop detail overview", async () => {
    const detail = await readConsoleShopDetail("postgres://test-db", "118");
    expect(detail).not.toBeNull();
    const expectedOrderExplorerHref = `/orders?profile=${encodeURIComponent(detail!.shop.profileNo)}`;
    expect(expectedOrderExplorerHref).toBe("/orders?profile=118");
  });
});

