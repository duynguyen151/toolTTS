import { describe, expect, it } from "vitest";

import { resolveObjectiveAnalyticalPeriods, unconfiguredCategoricalTrends } from "./health-history.js";

describe("objective shop-health analytical periods", () => {
  it("uses Bangkok calendar boundaries and retains the known All Available source boundary", () => {
    const periods = resolveObjectiveAnalyticalPeriods({
      now: new Date("2026-01-01T03:30:00.000Z"),
      firstAvailableAt: new Date("2025-06-01T12:00:00.000Z"),
    });

    expect(periods.map((period) => period.key)).toEqual([
      "TODAY", "7D", "30D", "12M", "ALL_AVAILABLE",
    ]);
    expect(periods[0]).toMatchObject({
      start: new Date("2025-12-31T17:00:00.000Z"),
      end: new Date("2026-01-01T17:00:00.000Z"),
    });
    expect(periods[4]).toMatchObject({
      start: new Date("2025-06-01T12:00:00.000Z"),
      end: new Date("2026-01-01T17:00:00.000Z"),
      comparison: null,
    });
  });

  it("does not invent an All Available duration or delta when no persisted source exists", () => {
    const allAvailable = resolveObjectiveAnalyticalPeriods({
      now: new Date("2026-01-01T03:30:00.000Z"),
      firstAvailableAt: null,
    }).at(-1);

    expect(allAvailable).toMatchObject({
      key: "ALL_AVAILABLE",
      start: null,
      comparison: null,
      deltaStatus: "NOT_EVALUATED",
      deltaReason: "NO_PERSISTED_SOURCE_DATA",
    });
  });
});

describe("objective categorical trends", () => {
  it("fails closed without a configured categorical trend policy", () => {
    expect(unconfiguredCategoricalTrends()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        signal: "DELIVERY_DETERIORATION",
        status: "NOT_EVALUATED",
        reasonCode: "POLICY_UNCONFIGURED",
        comparisons: [],
      }),
    ]));
  });
});
