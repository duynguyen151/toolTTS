import { describe, expect, it } from "vitest";

import { formatOrderExplorerCoverage, orderExplorerWindow, parseOrderExplorerQuery } from "./order-explorer.js";

describe("Order Explorer query", () => {
  it("defaults to all available persisted data and rejects unknown filters", () => {
    expect(parseOrderExplorerQuery({ profile: "957", period: "unknown", status: "BAD", page: "-1" })).toEqual({
      profileNo: "957", period: "ALL_AVAILABLE", status: undefined, search: undefined, page: 1,
    });
  });

  it("uses Asia/Bangkok analytical periods without changing Rule inputs", () => {
    const period = orderExplorerWindow("TODAY", new Date("2026-01-01T03:30:00.000Z"));
    expect(period).toMatchObject({ key: "TODAY", start: new Date("2025-12-31T17:00:00.000Z"), end: new Date("2026-01-01T17:00:00.000Z") });
  });

  it("labels persisted coverage without claiming unavailable history", () => {
    expect(formatOrderExplorerCoverage({
      availableFrom: new Date("2026-01-01T00:00:00.000Z"),
      availableTo: new Date("2026-01-31T00:00:00.000Z"),
    })).toBe("Persisted coverage: 2026-01-01 to 2026-01-31 (not a lifetime-history claim)");
    expect(formatOrderExplorerCoverage({ availableFrom: new Date("2026-01-01T17:30:00.000Z"), availableTo: new Date("2026-01-02T16:59:00.000Z") })).toContain("2026-01-02 to 2026-01-02");
    expect(formatOrderExplorerCoverage({ availableFrom: null, availableTo: null })).toBe("Persisted coverage: unavailable");
  });
});
