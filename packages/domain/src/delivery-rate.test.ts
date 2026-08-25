import { describe, expect, it } from "vitest";
import type { CanonicalOrderStatus } from "./contracts/orders.js";
import { calculateAuthoritativeDeliveryRate, resolveAnalyticalDeliveryPeriod } from "./delivery-rate.js";
import { calculateAuthoritativeDeliveryRateFromCounts } from "./index.js";

describe("authoritative delivery rate", () => {
  it("exports the shared count contract through the package barrel", () => {
    expect(calculateAuthoritativeDeliveryRateFromCounts([{ canonicalStatus: "DELIVERED", count: 1 }]).rate).toBe(1);
  });

  it("uses the locked numerator and denominator status sets", () => {
    const result = calculateAuthoritativeDeliveryRate(["AWAITING_SHIPMENT", "AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELED"]);
    expect(result).toEqual({ deliveredCount: 3, totalCount: 5, rate: 0.6, dataIssues: [] });
  });
  it("fails closed for UNKNOWN and returns null for an empty denominator", () => {
    expect(calculateAuthoritativeDeliveryRate(["UNKNOWN"])).toEqual({ deliveredCount: null, totalCount: null, rate: null, dataIssues: ["UNKNOWN_STATUS_PRESENT"] });
    expect(calculateAuthoritativeDeliveryRate(["CANCELED"])).toEqual({ deliveredCount: 0, totalCount: 0, rate: null, dataIssues: ["NO_OPERATIONAL_ORDERS"] });
  });
});

describe("analytical delivery periods", () => {
  it.each(["TODAY", "7D", "30D", "12M"] as const)("uses Bangkok boundaries for %s", (key) => {
    const period = resolveAnalyticalDeliveryPeriod(key, new Date("2026-01-01T03:30:00.000Z"));
    expect(period.end).toEqual(new Date("2026-01-01T17:00:00.000Z"));
    expect(period.start).not.toBeNull();
  });
  it("pins the 12-month Bangkok boundary across a calendar year", () => {
    const period = resolveAnalyticalDeliveryPeriod("12M", new Date("2026-01-01T03:30:00.000Z"));
    expect(period.start).toEqual(new Date("2025-01-01T17:00:00.000Z"));
    expect(period.end).toEqual(new Date("2026-01-01T17:00:00.000Z"));
  });
  it("keeps a leap-day 12-month window ordered at Bangkok midnight", () => {
    const period = resolveAnalyticalDeliveryPeriod("12M", new Date("2024-02-29T03:30:00.000Z"));
    expect(period.start).toEqual(new Date("2023-02-28T17:00:00.000Z"));
    expect(period.end).toEqual(new Date("2024-02-29T17:00:00.000Z"));
    expect(period.start! < period.end!).toBe(true);
  });

  it("labels All Available without claiming lifetime completeness", () => {
    expect(resolveAnalyticalDeliveryPeriod("ALL_AVAILABLE").label).toMatch(/persisted source data; not lifetime completeness/);
  });
});
