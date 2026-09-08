import { afterEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  closeDatabase: vi.fn(),
  createDatabase: vi.fn(),
  getFinanceSummary: vi.fn(),
  getFullPersistedRiskOrderFacts: vi.fn(),
  getLatestKpiSnapshot: vi.fn(),
  listAdsPowerProfiles: vi.fn(),
  listDecisionHistory: vi.fn(),
  listEnabledShopProviderBindings: vi.fn(),
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
  databaseMocks.listAdsPowerProfiles.mockResolvedValue([]);
  databaseMocks.listDecisionHistory.mockResolvedValue({ items: [], nextCursor: null });
  databaseMocks.listEnabledShopProviderBindings.mockResolvedValue([]);
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
  it("builds the boss portfolio from currency buckets and canonical rate counts", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([
      {
        id: "shop-a",
        profileNo: "SHOP-A",
        displayName: "Shop A",
        currency: "USD",
        dataOrigin: "LIVE",
        enabled: true,
        syncState: "ACTIVE",
        pauseReason: null,
        lastOrdersSyncedAt: null,
        lastFinanceSyncedAt: null,
        verificationStatus: "VERIFIED",
      },
      {
        id: "shop-b",
        profileNo: "SHOP-B",
        displayName: "Shop B",
        currency: "VND",
        dataOrigin: "LIVE",
        enabled: true,
        syncState: "ACTIVE",
        pauseReason: null,
        lastOrdersSyncedAt: null,
        lastFinanceSyncedAt: null,
        verificationStatus: "VERIFIED",
      },
    ]);
    databaseMocks.getFullPersistedRiskOrderFacts.mockImplementation(async (_db: unknown, shopId: string) => shopId === "shop-a"
      ? [
          { canonicalStatus: "DELIVERED", currency: "USD", orderCount: 1, totalValue: "10.0000" },
          { canonicalStatus: "AWAITING_SHIPMENT", currency: "USD", orderCount: 1, totalValue: "10.0000" },
        ]
      : [{ canonicalStatus: "DELIVERED", currency: "VND", orderCount: 8, totalValue: "80.0000" }]);
    databaseMocks.getFinanceSummary.mockImplementation(async (_db: unknown, shopId: string) => ({
      latestSnapshot: shopId === "shop-a"
        ? { officialOnHoldAmount: "100.0000", currency: "USD", capturedAt: new Date("2026-08-16T00:00:00.000Z") }
        : { officialOnHoldAmount: "200000.0000", currency: "VND", capturedAt: new Date("2026-08-16T00:00:00.000Z") },
    }));

    const presentation = await loadDashboardPresentation();

    expect(presentation.portfolio).toMatchObject({
      activeShops: 2,
      totalShops: 2,
      totalPortfolioOrders: 10,
      portfolioDeliveryRate: { numerator: 9, denominator: 10, formatted: "90.0%" },
    });
    expect(presentation.portfolio?.officialOnHoldByCurrency).toEqual([
      expect.objectContaining({ currency: "USD", totalAmount: "100.0000", shopCount: 1 }),
      expect.objectContaining({ currency: "VND", totalAmount: "200000.0000", shopCount: 1 }),
    ]);
  });

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
    expect(presentation.coverage.label).toBe("Coverage unavailable");
    expect(presentation.coverage.detail).not.toContain("Last 12 months");
    expect(presentation.decisionCenter?.coverage.source).toBe("Unavailable");
    expect(presentation.decisionCenter?.coverage.provenWindow).toBe("Unavailable");
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
    expect(presentation.coverage.label).toBe("Coverage unavailable");
    expect(presentation.coverage.detail).not.toContain("Last 12 months");
    expect(presentation.decisionCenter?.coverage.source).toBe("Unavailable");
    expect(presentation.decisionCenter?.coverage.provenWindow).toBe("Unavailable");
  });

  it("excludes a healthy trustworthy rule and AI case from the exception queue", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "SHOP-A",
      displayName: "Shop A",
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
        shop: { id: "live-shop", profileNo: "SHOP-A", displayName: "Shop A", dataCoverage: "COMPLETE" },
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
        metrics: { totalOrders: 10, onHoldValue: "100", deliveredCount: 9, deliveryRate: 0.9, cancellationRate: 0, refundRate: 0, currency: "USD" },
        ai: {
          status: "AVAILABLE",
          recommendation: "SCALE",
          humanReviewRequired: false,
          reasonCodes: [],
          supportingFactors: [],
          riskFactors: [],
          whatWouldChangeDecision: [],
          provider: "9router",
          requestedModel: "requested",
          reportedModel: "reported",
          actualModelUsed: "actual",
          reason: "Healthy evidence supports scaling.",
          policyVersion: "ai-policy.v1",
        },
        ba: null,
        execution: null,
      }],
      nextCursor: null,
    });

    const presentation = await loadDashboardPresentation();

    expect(presentation.decisionCenter?.reviewQueue).toEqual([]);
  });

  it("preserves frozen rule, AI, Finance health, and comparison facts", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "SHOP-A",
      displayName: "Shop A",
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
        shop: { id: "live-shop", profileNo: "SHOP-A", displayName: "Shop A", dataCoverage: "COMPLETE" },
        coverageSnapshot: {
          coverageState: "COMPLETE",
          source: "SELLER_CENTER",
          provenSourceWindow: "ROLLING_12_MONTHS",
          completeWithinSourceWindow: true,
          lifetimeHistoryComplete: false,
          ordersSourceComplete: true,
          financeRequiredSourceComplete: true,
          sourceReconciled: true,
          freshness: "STALE",
          financeCapturedAt: "2026-08-16T00:00:00.000Z",
          financeHealth: {
            schemaVersion: "finance-health.v1",
            provider: "SELLER_CENTER",
            capability: "OFFICIAL_ON_HOLD",
            capabilityProofRevision: "seller-center-official-on-hold.v1",
            providerUpdatedAt: null,
            collectedAt: "2026-08-16T00:00:00.000Z",
            evaluatedAt: "2026-08-16T01:00:00.000Z",
            ageMs: 3_600_000,
            health: "STALE",
            completeness: "COMPLETE",
            reconciliation: "RECONCILED",
            officialOnHoldAvailability: "AVAILABLE",
            refreshState: "SUCCEEDED",
          },
        },
        rule: { decision: "CONTINUE", triggers: [], policyVersion: "risk-policy.v1" },
        resolvedPolicySnapshot: {
          policyVersion: "risk-policy.v1",
          currency: "USD",
          effectiveAt: "2026-08-15T00:00:00.000Z",
          thresholds: {
            stopOnHoldValueAt: "3500.0000",
            stopDeliveryRateBelow: 0.7,
            minimumOrdersForRateRule: 10,
            resumeOnHoldValueBelow: "1000.0000",
            resumeDeliveryRateAt: 0.8,
            stableCyclesBeforeResume: 2,
          },
          caution: { onHoldValue: "WARN", deliveryRate: "WARN" },
          globalRevisionId: "global-policy-1",
          shopOverrideRevisionId: "shop-policy-1",
          sources: {
            thresholds: {
              stopOnHoldValueAt: "SHOP",
              stopDeliveryRateBelow: "GLOBAL",
              minimumOrdersForRateRule: "GLOBAL",
              resumeOnHoldValueBelow: "GLOBAL",
              resumeDeliveryRateAt: "GLOBAL",
              stableCyclesBeforeResume: "GLOBAL",
            },
            caution: { onHoldValue: "SHOP", deliveryRate: "GLOBAL" },
          },
        },
        metrics: { totalOrders: 10, onHoldValue: "100", deliveredCount: 9, deliveryRate: 0.9, cancellationRate: 0, refundRate: 0, currency: "USD" },
        ai: {
          status: "AVAILABLE",
          recommendation: "CONTINUE",
          ruleOverride: true,
          humanReviewRequired: false,
          reasonCodes: [],
          supportingFactors: [],
          riskFactors: [],
          whatWouldChangeDecision: [],
          provider: "9router",
          requestedModel: "requested",
          reportedModel: "reported",
          actualModelUsed: "actual",
          reason: "Healthy evidence supports continuation.",
          policyVersion: "ai-policy.v1",
          createdAt: new Date("2026-08-16T00:30:00.000Z"),
        },
        decisionContextSnapshot: {
          comparisons: [{ metric: "deliveryRate", previous: 0.8, current: 0.9, absoluteDelta: 0.1, relativeDelta: 0.125, direction: "INCREASED" }],
          trends: [],
          rule: {
            expression: "exposure >= 3500 OR deliveryRate < 0.7",
            evaluatedAt: "2026-08-16T00:00:00.000Z",
            checks: [{ metric: "deliveryRate", observedValue: 0.9, threshold: 0.7, operator: "LT", result: "PASS", triggeredReason: null }],
          },
          targetRuleEvidence: {
            schemaVersion: "official-on-hold-rule.v1",
            policyVersion: "risk-policy.v1",
            evaluatedAt: "2026-08-16T00:00:00.000Z",
            decision: "PAUSE",
            triggers: ["OFFICIAL_ON_HOLD"],
            expression: "officialFinanceOnHold >= 3500 USD OR deliveryRate < 70%",
            officialOnHold: { state: "TRIGGERED", source: "SELLER_CENTER", observedValue: "4000", observedAt: "2026-08-16T00:00:00.000Z", ageMs: 0, quality: "FRESH", completeness: "COMPLETE", reconciliation: "RECONCILED", refreshState: "SUCCEEDED", threshold: "3500" },
            deliveryRate: { state: "CLEAR", source: "SELLER_CENTER", observedValue: 0.9, observedAt: "2026-08-16T00:00:00.000Z", ageMs: 0, quality: "FRESH", deliveredCount: 9, totalCount: 10, threshold: 0.7, unavailableReasons: [] },
          },
        },
        ba: null,
        execution: null,
      }],
      nextCursor: null,
    });

    const presentation = await loadDashboardPresentation();
    const center = presentation.decisionCenter!;

    expect(presentation.coverage.status).toBe("PARTIAL");
    expect(center.coverage.status).toBe("PARTIAL");
    expect(center.financeHealth).toMatchObject({
      provider: "SELLER_CENTER",
      health: "STALE",
      officialOnHoldAvailability: "AVAILABLE",
    });
    expect(center.coverage.financeCapturedAt).toBe("2026-08-16T00:00:00.000Z");
    expect(center.coverage.financeAgeMs).toBe(3_600_000);
    expect(center.coverage.staleDisclosure).toBe("STALE: Finance evidence is advisory only and is not current.");
    expect(center.reviewSnapshot).toEqual({
      owner: "IMMUTABLE_DECISION_CASE",
      source: "DECISION_CASE",
      businessTimeZone: "Asia/Bangkok",
      observedAt: "Unavailable",
    });
    expect(center.effectivePolicy).toMatchObject({
      owner: "IMMUTABLE_DECISION_CASE",
      policyVersion: "risk-policy.v1",
      effectiveAt: "15 Aug 2026, 07:00 GMT+7",
      stopOnHoldValueAt: "3500.0000 USD",
      stopOnHoldValueAtSource: "SHOP",
    });
    expect(center.rule.conditions.officialOnHold).toMatchObject({ state: "TRIGGERED", source: "SELLER_CENTER", observedValue: "4000", threshold: "3500" });
    expect(center.rule.conditions.deliveryRate).toMatchObject({ state: "CLEAR", source: "SELLER_CENTER", observedValue: "0.9", threshold: "0.7" });
    expect(center.comparisons[0]).toMatchObject({ relativeDelta: "0.125", previous: "0.8", current: "0.9" });
    expect(center.rule.checks[0]).toMatchObject({ operator: "LT", result: "PASS" });
    expect(center.ai.reason).toBe("Healthy evidence supports continuation.");
    expect(center.ai.ruleAgreement).toBe("AI differs from deterministic Rule");
    expect(center.ai.policyVersion).toBe("ai-policy.v1");
    expect(center.ai.evidence).toEqual({ owner: "AI_DECISION", source: "AI_DECISION", observedAt: "16 Aug 2026, 07:30 GMT+7" });
  });

  it("uses the requested linked LIVE shop for server-backed dashboard selection", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([
      {
        id: "shop-a",
        profileNo: "SHOP-A",
        displayName: "Shop A",
        currency: "USD",
        dataOrigin: "LIVE",
        enabled: true,
        syncState: "ACTIVE",
        pauseReason: null,
        lastOrdersSyncedAt: null,
        lastFinanceSyncedAt: null,
      },
      {
        id: "shop-b",
        profileNo: "SHOP-B",
        displayName: "Shop B",
        currency: "USD",
        dataOrigin: "LIVE",
        enabled: true,
        syncState: "ACTIVE",
        pauseReason: null,
        lastOrdersSyncedAt: null,
        lastFinanceSyncedAt: null,
      },
    ]);
    databaseMocks.getFullPersistedRiskOrderFacts.mockImplementation(async (_db: unknown, shopId: string) => shopId === "shop-b" ? [{ orderCount: 2, canonicalStatus: "DELIVERED" }] : [{ orderCount: 1, canonicalStatus: "DELIVERED" }]);

    const presentation = await loadDashboardPresentation("SHOP-B");

    expect(presentation.selectedShop.profileNo).toBe("SHOP-B");
    expect(presentation.selectedShop.displayName).toBe("Shop B");
    expect(databaseMocks.getFullPersistedRiskOrderFacts).toHaveBeenCalledWith({}, "shop-b");
  });

  it("returns an unavailable selection error instead of falling back for an unknown LIVE shop", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "shop-a",
      profileNo: "SHOP-A",
      displayName: "Shop A",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);

    const presentation = await loadDashboardPresentation("UNKNOWN");

    expect(presentation.dataOrigin).toBe("UNAVAILABLE");
    expect(presentation.selectedShop.profileNo).toBe("UNAVAILABLE");
    expect(presentation.coverage.detail).toContain("Requested LIVE shop UNKNOWN was not found");
    expect(databaseMocks.getFullPersistedRiskOrderFacts).not.toHaveBeenCalled();
  });

  it("renders BA history only from the current decision case", async () => {
    process.env.DATABASE_URL = "postgres://dashboard-test";
    configureDatabaseRead();
    databaseMocks.listShops.mockResolvedValue([{
      id: "live-shop",
      profileNo: "SHOP-A",
      displayName: "Shop A",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
      pauseReason: null,
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    }]);

    const currentCase = {
      case: { id: "current-case" },
      shop: { id: "live-shop", profileNo: "SHOP-A", displayName: "Shop A", dataCoverage: "PARTIAL" },
      coverageSnapshot: { coverageState: "PARTIAL", freshness: "FRESH" },
      rule: { decision: "CONTINUE", triggers: [], policyVersion: "risk-policy.v1" },
      metrics: { onHoldValue: null, currency: "USD" },
      ai: null,
      decisionContextSnapshot: null,
      ba: { decision: "WATCH", reasonCode: "CURRENT_REASON", reasonCodes: [], confidence: null, note: null, notes: "Current revision", actor: "operator", decidedAt: new Date("2026-08-16T02:00:00.000Z") },
      baHistory: [
        { decision: "WATCH", reasonCode: "CURRENT_REASON", actor: "operator", decidedAt: new Date("2026-08-16T02:00:00.000Z"), notes: "Current revision" },
        { decision: "CONTINUE", reasonCode: "CURRENT_PRIOR_REASON", actor: "operator", decidedAt: new Date("2026-08-16T01:00:00.000Z"), notes: "Current prior revision" },
      ],
      execution: null,
    };
    const olderCase = {
      ...currentCase,
      case: { id: "older-case" },
      ba: { decision: "PAUSE", reasonCode: "OLDER_REASON", reasonCodes: [], confidence: null, note: null, notes: "Older case revision", actor: "operator", decidedAt: new Date("2026-08-15T02:00:00.000Z") },
      baHistory: [
        { decision: "PAUSE", reasonCode: "OLDER_REASON", actor: "operator", decidedAt: new Date("2026-08-15T02:00:00.000Z"), notes: "Older case revision" },
      ],
    };
    databaseMocks.listDecisionHistory.mockImplementation(async (_db: unknown, input: { limit?: number }) => ({
      items: input.limit === 1 ? [currentCase] : [currentCase, olderCase],
      nextCursor: null,
    }));

    const presentation = await loadDashboardPresentation();
    const history = presentation.decisionCenter?.ba.history ?? [];

    expect(presentation.decisionCenter?.caseId).toBe("current-case");
    expect(history.map((entry) => entry.reason)).toEqual(["CURRENT_REASON", "CURRENT_PRIOR_REASON"]);
    expect(history.some((entry) => entry.reason === "OLDER_REASON")).toBe(false);
    expect(history[0]?.plannedMethods).toEqual([]);
  });
});
