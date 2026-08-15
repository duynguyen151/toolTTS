import { describe, expect, it } from "vitest";

import { assessDecisionFreshness, isCompleteDecisionCoverage, resolveDecisionPeriod, resolveFinanceCaptureAt, resolveVerifiedFinanceCaptureAt } from "./persisted.js";

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
