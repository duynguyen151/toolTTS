import { afterEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  closeDatabase: vi.fn(),
  createDatabase: vi.fn(),
  getFinanceSummary: vi.fn(),
  getFullPersistedRiskOrderFacts: vi.fn(),
  getLatestKpiSnapshot: vi.fn(),
  listDecisionHistory: vi.fn(),
  listShops: vi.fn(),
  listSyncRuns: vi.fn(),
}));

vi.mock("@shop-health/db", () => databaseMocks);

import { loadDashboardPresentation } from "./dashboard-read.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

function configureDatabaseRead() {
  databaseMocks.createDatabase.mockReturnValue({ db: {} });
  databaseMocks.closeDatabase.mockResolvedValue(undefined);
  databaseMocks.getFinanceSummary.mockResolvedValue({ latestSnapshot: null });
  databaseMocks.getFullPersistedRiskOrderFacts.mockResolvedValue([]);
  databaseMocks.getLatestKpiSnapshot.mockResolvedValue(null);
  databaseMocks.listDecisionHistory.mockResolvedValue({ items: [], nextCursor: null });
  databaseMocks.listSyncRuns.mockResolvedValue([]);
}

afterEach(() => {
  vi.clearAllMocks();
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("loadDashboardPresentation", () => {
  it("does not replace unavailable live data with sanitized demo data", async () => {
    delete process.env.DATABASE_URL;

    const presentation = await loadDashboardPresentation();

    expect(presentation.dataOrigin).toBe("UNAVAILABLE");
    expect(presentation.selectedShop.profileNo).toBe("UNAVAILABLE");
    expect(presentation.profile.status).toBe("NOT_VERIFIED");
    expect(presentation.coverage.status).toBe("UNAVAILABLE");
    expect(presentation.coverage.detail).toContain("Live dashboard data is unavailable");
  });

  it("does not use persisted demo rows as a fallback for a configured live database", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "demo-shop",
      profileNo: "DEMO-001",
      displayName: "Demo shop",
      currency: "USD",
      dataOrigin: "DEMO_SANITIZED",
      enabled: false,
      syncState: "DISABLED",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);

    const presentation = await loadDashboardPresentation();

    expect(presentation.dataOrigin).toBe("UNAVAILABLE");
    expect(presentation.selectedShop.profileNo).toBe("UNAVAILABLE");
    expect(databaseMocks.getFullPersistedRiskOrderFacts).not.toHaveBeenCalled();
  });

  it("labels order-derived exposure and complete AI provenance distinctly", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "957",
      displayName: "Live shop",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);
    databaseMocks.listDecisionHistory.mockResolvedValue({
      items: [{
        shop: { dataCoverage: "PARTIAL" },
        rule: { decision: "PAUSE", triggers: ["ONHOLD_VALUE"], policyVersion: "risk-policy.v1" },
        metrics: { onHoldValue: "125.00", currency: "USD" },
        ai: {
          status: "AVAILABLE",
          recommendation: "PAUSE",
          riskLevel: "HIGH",
          confidence: 0.91,
          reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
          supportingFactors: ["Finance reconciled"],
          riskFactors: ["On hold amount elevated"],
          whatWouldChangeDecision: ["Lower operational exposure"],
          humanReviewRequired: true,
          provider: "9router",
          requestedModel: "requested-model",
          reportedModel: "reported-model",
          actualModelUsed: "actual-model",
          model: "actual-model",
        },
        ba: null,
        execution: null,
      }],
      nextCursor: null,
    });

    const presentation = await loadDashboardPresentation();
    const rule = presentation.decisionTrace.find((stage) => stage.id === "rule");
    const ai = presentation.decisionTrace.find((stage) => stage.id === "ai");

    expect(rule?.detail).toContain("Operational order-derived exposure: 125.00 USD.");
    expect(rule?.detail).toContain("Official Finance On Hold is shown separately");
    expect(ai?.detail).toContain("What would change decision: Lower operational exposure.");
    expect(ai?.detail).toContain("Requested model: requested-model.");
    expect(ai?.detail).toContain("Reported model: reported-model.");
    expect(ai?.detail).toContain("Actual model: actual-model.");
  });

  it("requires complete, reconciled rolling-window proof before claiming source-window coverage", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "957",
      displayName: "Live shop",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);
    databaseMocks.listDecisionHistory.mockResolvedValue({
      items: [{
        shop: { dataCoverage: "COMPLETE" },
        coverageSnapshot: {
          coverageState: "COMPLETE",
          source: "SELLER_CENTER",
          provenSourceWindow: "ROLLING_12_MONTHS",
          completeWithinSourceWindow: true,
          lifetimeHistoryComplete: false,
          ordersSourceComplete: true,
          financeRequiredSourceComplete: true,
          sourceReconciled: true,
          freshness: "FRESH",
        },
        rule: { decision: "CONTINUE", triggers: [], policyVersion: "risk-policy.v1" },
        metrics: { onHoldValue: null, currency: "USD" },
        ai: null,
        ba: null,
        execution: null,
      }],
      nextCursor: null,
    });

    const presentation = await loadDashboardPresentation();

    expect(presentation.coverage.label).toBe("Complete within proven source window");
    expect(presentation.coverage.detail).toContain("History window: Last 12 months");
    expect(presentation.coverage.detail).toContain("Lifetime history: not proven");
  });

  it("does not present a succeeded but incomplete persisted sync as complete", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "957",
      displayName: "Live shop",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);
    databaseMocks.listSyncRuns.mockResolvedValue([{
      status: "SUCCEEDED",
      sourceComplete: false,
      startedAt: new Date("2026-08-15T01:00:00.000Z"),
      failureType: null,
    }]);

    const presentation = await loadDashboardPresentation();

    expect(presentation.sync.status).toBe("FAILED");
    expect(presentation.sync.label).toBe("Sync error");
    expect(presentation.sync.tone).toBe("danger");
  });

  it("keeps otherwise complete proof without a Seller Center source partial", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "957",
      displayName: "Live shop",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);
    databaseMocks.listDecisionHistory.mockResolvedValue({
      items: [{
        shop: { dataCoverage: "COMPLETE" },
        coverageSnapshot: {
          coverageState: "COMPLETE",
          provenSourceWindow: "ROLLING_12_MONTHS",
          completeWithinSourceWindow: true,
          lifetimeHistoryComplete: false,
          ordersSourceComplete: true,
          financeRequiredSourceComplete: true,
          sourceReconciled: true,
          freshness: "FRESH",
        },
        rule: { decision: "CONTINUE", triggers: [], policyVersion: "risk-policy.v1" },
        metrics: { onHoldValue: null, currency: "USD" },
        ai: null,
        ba: null,
        execution: null,
      }],
      nextCursor: null,
    });

    const presentation = await loadDashboardPresentation();

    expect(presentation.coverage.status).toBe("PARTIAL");
    expect(presentation.coverage.label).toBe("Last 12 months");
  });

  it("keeps legacy complete reviews without source proof explicitly partial", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "957",
      displayName: "Live shop",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);
    databaseMocks.listDecisionHistory.mockResolvedValue({
      items: [{
        shop: { dataCoverage: "COMPLETE" },
        coverageSnapshot: {
          coverageState: "COMPLETE",
          provenSourceWindow: null,
          completeWithinSourceWindow: null,
          lifetimeHistoryComplete: null,
        },
        rule: { decision: "CONTINUE", triggers: [], policyVersion: "risk-policy.v1" },
        metrics: { onHoldValue: null, currency: "USD" },
        ai: null,
        ba: null,
        execution: null,
      }],
      nextCursor: null,
    });

    const presentation = await loadDashboardPresentation();

    expect(presentation.coverage.status).toBe("PARTIAL");
    expect(presentation.coverage.label).toBe("Last 12 months");
  });
});
