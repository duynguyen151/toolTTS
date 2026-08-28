import { describe, expect, it } from "vitest";

import { assessDecisionFreshness, isCompleteDecisionCoverage, resolveDecisionDataCoverage, resolveDecisionDeliveryHealth, resolveDecisionFinanceHealth, resolveDecisionPeriod, resolveFinanceCaptureAt, resolveVerifiedFinanceCaptureAt } from "./persisted.js";

describe("assessDecisionFreshness", () => {
  it("requires Orders sync, Finance sync, and Finance capture all within the window", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    expect(assessDecisionFreshness({
      now,
      freshnessWindowMs: 24 * 60 * 60 * 1000,
      ordersSyncAt: new Date("2026-08-14T12:00:00.000Z"),
      financeSyncAt: new Date("2026-08-13T00:00:00.000Z"),
      financeCapturedAt: new Date("2026-08-14T12:00:00.000Z"),
    })).toBe("STALE");
  });

  it("returns UNKNOWN when required historical evidence is missing", () => {
    expect(assessDecisionFreshness({
      now: new Date("2026-08-15T00:00:00.000Z"),
      freshnessWindowMs: 24 * 60 * 60 * 1000,
      ordersSyncAt: null,
      financeSyncAt: null,
      financeCapturedAt: null,
    })).toBe("UNKNOWN");
  });
});

describe("resolveDecisionDeliveryHealth", () => {
  const evaluatedAt = new Date("2026-08-15T12:00:00.000Z");
  const completeSellerCenterRun = {
    sourceCoverage: {
      source: "SELLER_CENTER" as const,
      window: "ROLLING_12_MONTHS" as const,
      completeWithinSourceWindow: true,
      lifetimeHistoryComplete: false as const,
    },
    sourceComplete: true,
    sourceCapturedAt: new Date("2026-08-15T11:00:00.000Z"),
    finishedAt: new Date("2026-08-15T11:30:00.000Z"),
  };
  const sellerCenterFacts = [{
    canonicalStatus: "DELIVERED" as const,
    currency: "USD",
    orderCount: 1,
    totalValue: "10.0000",
    deliverySource: "SELLER_CENTER" as const,
  }] as const;

  it("accepts a complete fresh Seller Center Orders population independently of Finance", () => {
    expect(resolveDecisionDeliveryHealth({
      evaluatedAt,
      freshnessWindowMs: 86_400_000,
      facts: sellerCenterFacts,
      latestOrdersRun: completeSellerCenterRun,
    })).toMatchObject({
      coverageState: "COMPLETE",
      source: "SELLER_CENTER",
      sourceComplete: true,
      observedAt: completeSellerCenterRun.sourceCapturedAt,
      freshness: "FRESH",
    });
  });

  it("keeps complete Seller Center Orders evidence stale instead of making it unknown", () => {
    expect(resolveDecisionDeliveryHealth({
      evaluatedAt: new Date("2026-08-17T12:00:00.000Z"),
      freshnessWindowMs: 86_400_000,
      facts: sellerCenterFacts,
      latestOrdersRun: completeSellerCenterRun,
    })).toMatchObject({ coverageState: "PARTIAL", source: "SELLER_CENTER", freshness: "STALE" });
  });

  it("fails closed for mixed or unknown persisted order provenance", () => {
    expect(resolveDecisionDeliveryHealth({
      evaluatedAt,
      freshnessWindowMs: 86_400_000,
      facts: [{ ...sellerCenterFacts[0], deliverySource: null }],
      latestOrdersRun: completeSellerCenterRun,
    })).toMatchObject({ source: null, sourceComplete: false, freshness: "UNKNOWN" });
  });
});

describe("resolveDecisionFinanceHealth", () => {
  it("keeps proven Finance evidence while exposing a later failed refresh", () => {
    expect(resolveDecisionFinanceHealth({
      evaluatedAt: new Date("2026-08-15T00:00:00.000Z"),
      freshnessWindowMs: 86_400_000,
      latestRefreshRun: { status: "FAILED" },
      selectedFinanceRun: {
        status: "SUCCEEDED",
        sourceComplete: true,
        sourceCapturedAt: new Date("2026-08-14T12:00:00.000Z"),
      },
      financeSummary: { proofStatus: "PROVEN" },
      reconciled: true,
    })).toMatchObject({
      provider: "SELLER_CENTER",
      capability: "OFFICIAL_ON_HOLD",
      collectedAt: "2026-08-14T12:00:00.000Z",
      health: "FRESH",
      officialOnHoldAvailability: "AVAILABLE",
      refreshState: "FAILED",
    });
  });

  it("preserves an explicit contract-proven provider update separately from collection time", () => {
    expect(resolveDecisionFinanceHealth({
      evaluatedAt: new Date("2026-08-15T00:00:00.000Z"),
      freshnessWindowMs: 86_400_000,
      latestRefreshRun: { status: "SUCCEEDED" },
      selectedFinanceRun: {
        status: "SUCCEEDED",
        sourceComplete: true,
        sourceCapturedAt: new Date("2026-08-14T12:00:00.000Z"),
      },
      providerBinding: {
        provenance: { source: "SELLER_CENTER", capabilities: ["OFFICIAL_ON_HOLD"] },
        providerUpdatedAt: new Date("2026-08-13T00:00:00.000Z"),
      },
      financeSummary: { proofStatus: "PROVEN" },
      reconciled: true,
    })).toMatchObject({
      providerUpdatedAt: "2026-08-13T00:00:00.000Z",
      collectedAt: "2026-08-14T12:00:00.000Z",
      ageMs: 43_200_000,
      health: "FRESH",
    });
  });

  it("preserves persisted reconciliation failure separately from incomplete collection", () => {
    expect(resolveDecisionFinanceHealth({
      evaluatedAt: new Date("2026-08-15T00:00:00.000Z"),
      freshnessWindowMs: 86_400_000,
      latestRefreshRun: { status: "SUCCEEDED" },
      selectedFinanceRun: {
        status: "SUCCEEDED",
        sourceComplete: true,
        sourceCapturedAt: new Date("2026-08-14T12:00:00.000Z"),
        sourceReconciled: false,
      },
      financeSummary: { proofStatus: "PROOF_UNAVAILABLE" },
      reconciled: null,
    })).toMatchObject({
      completeness: "COMPLETE",
      reconciliation: "FAILED",
      health: "RECONCILIATION_FAILED",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
  });

  it("does not relabel a generic binding timestamp as provider-updated Finance time", () => {
    expect(resolveDecisionFinanceHealth({
      evaluatedAt: new Date("2026-08-15T00:00:00.000Z"),
      freshnessWindowMs: 86_400_000,
      latestRefreshRun: null,
      selectedFinanceRun: null,
      providerBinding: {
        provenance: { source: "SELLER_CENTER", capabilities: ["ORDERS"] },
        providerUpdatedAt: new Date("2026-08-13T00:00:00.000Z"),
      },
      financeSummary: { proofStatus: "PROOF_UNAVAILABLE" },
      reconciled: null,
    })).toMatchObject({ providerUpdatedAt: null });
  });

  it("keeps provider-updated time unknown when no explicit provider contract supplies it", () => {
    expect(resolveDecisionFinanceHealth({
      evaluatedAt: new Date("2026-08-15T00:00:00.000Z"),
      freshnessWindowMs: 86_400_000,
      latestRefreshRun: null,
      selectedFinanceRun: null,
      financeSummary: { proofStatus: "PROOF_UNAVAILABLE" },
      reconciled: null,
    })).toMatchObject({
      providerUpdatedAt: null,
      collectedAt: null,
      health: "UNKNOWN",
      officialOnHoldAvailability: "UNAVAILABLE",
      refreshState: "NOT_REQUESTED",
    });
  });
});

describe("resolveDecisionPeriod", () => {
  it("uses firstObservedAt for the persisted history start", () => {
    const period = resolveDecisionPeriod([
      {
        canonicalStatus: "DELIVERED",
        currency: "USD",
        orderCount: 1,
        totalValue: "10.0000",
        firstObservedAt: new Date("2025-01-01T00:00:00.000Z"),
        lastObservedAt: new Date("2026-08-14T00:00:00.000Z"),
      },
    ], new Date("2026-08-15T00:00:00.000Z"));

    expect(period.periodStart).toEqual(new Date("2025-01-01T00:00:00.000Z"));
  });
});

describe("isCompleteDecisionCoverage", () => {
  it("retains complete coverage when its captured evidence is stale", () => {
    expect(resolveDecisionDataCoverage(true)).toBe("COMPLETE");
    expect(resolveDecisionDataCoverage(false)).toBe("PARTIAL");
  });

  it("requires the exact Seller Center rolling-window coverage proof", () => {
    expect(isCompleteDecisionCoverage({
      sourceCoverage: null,
      ordersSourceComplete: true,
      financeSourceComplete: true,
      financeSnapshotCapturedAt: new Date("2026-08-14T00:00:00.000Z"),
      sourceReconciled: true,
    })).toBe(false);
  });

  it("accepts complete source coverage only with the exact proof", () => {
    expect(isCompleteDecisionCoverage({
      sourceCoverage: {
        source: "SELLER_CENTER",
        window: "ROLLING_12_MONTHS",
        completeWithinSourceWindow: true,
        lifetimeHistoryComplete: false,
      },
      ordersSourceComplete: true,
      financeSourceComplete: true,
      financeSnapshotCapturedAt: new Date("2026-08-14T00:00:00.000Z"),
      sourceReconciled: true,
    })).toBe(true);
  });

  it("rejects a successful but incomplete Finance source run", () => {
    expect(isCompleteDecisionCoverage({
      sourceCoverage: {
        source: "SELLER_CENTER",
        window: "ROLLING_12_MONTHS",
        completeWithinSourceWindow: true,
        lifetimeHistoryComplete: false,
      },
      ordersSourceComplete: true,
      financeSourceComplete: false,
      financeSnapshotCapturedAt: new Date("2026-08-14T00:00:00.000Z"),
      sourceReconciled: true,
    })).toBe(false);
  });
});

describe("resolveFinanceCaptureAt", () => {
  it("uses the successful Finance run capture time over an older deduplicated snapshot", () => {
    const runCapturedAt = new Date("2026-08-14T23:00:00.000Z");
    expect(resolveFinanceCaptureAt({
      sourceComplete: true,
      sourceCapturedAt: runCapturedAt,
    }, new Date("2026-08-10T00:00:00.000Z"))).toEqual(runCapturedAt);
  });

  it("keeps the prior proven capture when a newer Finance run is incomplete", () => {
    const provenCapture = new Date("2026-08-14T00:00:00.000Z");
    expect(resolveVerifiedFinanceCaptureAt({
      sourceComplete: false,
      sourceCapturedAt: new Date("2026-08-15T00:00:00.000Z"),
    }, {
      sourceComplete: true,
      sourceCapturedAt: provenCapture,
    })).toEqual(provenCapture);
  });
});
