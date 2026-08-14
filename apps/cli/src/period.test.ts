import { describe, expect, it } from "vitest";

import { parseComparisonPeriod } from "./period.js";

describe("parseComparisonPeriod", () => {
  it("creates adjacent current and previous windows", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    const period = parseComparisonPeriod("30d", now);
    expect(period.currentEnd).toEqual(now);
    expect(period.previousEnd).toEqual(period.currentStart);
    expect(period.currentStart.getTime() - period.previousStart.getTime()).toBe(30 * 86_400_000);
  });
});
