import { describe, expect, it } from "vitest";

import { calculateMetrics } from "./metrics/calculate.js";
import { evaluateShopHealth } from "./recommendation/evaluate.js";
import { buildShopReport, ShopReportSchema } from "./report.js";

describe("ShopReport", () => {
  it("builds a stable JSON-safe report contract", () => {
    const currentStart = new Date("2026-07-01T00:00:00.000Z");
    const currentEnd = new Date("2026-08-01T00:00:00.000Z");
    const previousStart = new Date("2026-06-01T00:00:00.000Z");
    const metrics = calculateMetrics({
      currency: "USD",
      currentRange: { start: currentStart, end: currentEnd },
      previousRange: { start: previousStart, end: currentStart },
      orders: [],
      settlements: [],
    });
    const health = evaluateShopHealth({ metrics });
    const report = buildShopReport({
      generatedAt: new Date("2026-08-01T01:00:00.000Z"),
      shop: {
        id: "shop-1",
        profileNo: "957",
        displayName: "Cerelia4630@",
        currency: "USD",
      },
      dataStatus: health.evaluationStatus,
      period: {
        label: "Last 30 days vs previous 30 days",
        currentStart,
        currentEnd,
        previousStart,
        previousEnd: currentStart,
      },
      metrics,
      health,
    });
    const serialized = JSON.parse(JSON.stringify(report)) as unknown;

    expect(report.schemaVersion).toBe("shop-report.v1");
    expect(ShopReportSchema.safeParse(serialized).success).toBe(true);
    expect(report.generatedAt).toBe("2026-08-01T01:00:00.000Z");
    expect(report.health.recommendation).toBeNull();
  });
});
