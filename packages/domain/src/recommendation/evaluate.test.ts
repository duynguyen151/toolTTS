import { describe, expect, it } from "vitest";

import type {
  MetricsResult,
  MoneyRateMetric,
  PeriodMetrics,
  RateMetric,
} from "../metrics/types.js";
import { evaluateShopHealth } from "./evaluate.js";

function rate(value: number | null, coverage = 1): RateMetric {
  return {
    value,
    numerator: value ?? 0,
    denominator: value === null ? 0 : 1,
    sampleSize: value === null ? 0 : 40,
    coverage,
    warnings: [],
  };
}

function moneyRate(value: number | null, coverage = 1): MoneyRateMetric {
  return {
    value,
    numerator: value === null ? "0" : String(value),
    denominator: value === null ? "0" : "1",
    currency: "USD",
    sampleSize: value === null ? 0 : 40,
    coverage,
    warnings: [],
  };
}

function period(overrides: Partial<PeriodMetrics> = {}): PeriodMetrics {
  return {
    orders: {
      total: 40,
      awaitingShipment: 0,
      inTransit: 0,
      deliveredOrCompleted: 39,
      canceled: 1,
      refunded: 1,
      onHold: 0,
    },
    bookedSales: { value: "4000", currency: "USD", sampleSize: 40, coverage: 1, warnings: [] },
    grossValidSales: { value: "3900", currency: "USD", sampleSize: 39, coverage: 1, warnings: [] },
    refundedAmount: { value: "20", currency: "USD", sampleSize: 39, coverage: 1, warnings: [] },
    netSales: { value: "3880", currency: "USD", sampleSize: 39, coverage: 1, warnings: [] },
    settledCash: { value: "3700", currency: "USD", sampleSize: 39, coverage: 1, warnings: [] },
    averageOrderValue: { value: "100", currency: "USD", sampleSize: 39, coverage: 1, warnings: [] },
    deliveryRate: rate(0.98),
    cancellationRate: rate(0.02),
    refundRate: rate(0.02),
    onHoldOrderRate: rate(0.01),
    onHoldMoneyRate: moneyRate(0.01),
    settlementRate: moneyRate(0.96),
    warnings: [],
    ...overrides,
  };
}

function metrics(current: PeriodMetrics = period()): MetricsResult {
  return {
    current,
    previous: period({ orders: { ...current.orders, total: 30 } }),
    trends: {
      orders: { current: current.orders.total, previous: 30, absoluteDelta: 10, relativeChange: 1 / 3 },
      grossValidSales: { current: "3900", previous: "3000", absoluteDelta: "900", relativeChange: 0.3, currency: "USD" },
      deliveryRate: { current: current.deliveryRate.value, previous: 0.98, percentagePointDelta: 0 },
      cancellationRate: { current: current.cancellationRate.value, previous: 0.02, percentagePointDelta: 0 },
      refundRate: { current: current.refundRate.value, previous: 0.02, percentagePointDelta: 0 },
      onHoldOrderRate: { current: current.onHoldOrderRate.value, previous: 0.01, percentagePointDelta: 0 },
      onHoldMoneyRate: { current: current.onHoldMoneyRate.value, previous: 0.01, percentagePointDelta: 0 },
    },
  };
}

describe("evaluateShopHealth", () => {
  it("recommends SCALE only for strong score, coverage, volume, and growth", () => {
    const result = evaluateShopHealth({ metrics: metrics() });

    expect(result.score).toBe(100);
    expect(result.confidence).toBe(1);
    expect(result.recommendation).toBe("SCALE");
  });

  it("recommends PAUSE for a critical rate with a reliable sample", () => {
    const current = period({ cancellationRate: rate(0.12) });
    const result = evaluateShopHealth({ metrics: metrics(current) });

    expect(result.warnings).toContain("CRITICAL_CANCELLATION_RATE");
    expect(result.recommendation).toBe("PAUSE");
  });

  it("uses WATCH instead of PAUSE when the sample is too small", () => {
    const current = period({
      orders: { ...period().orders, total: 5 },
      cancellationRate: rate(0.12),
    });
    const result = evaluateShopHealth({ metrics: metrics(current) });

    expect(result.confidence).toBe(0.25);
    expect(result.warnings).toContain("LOW_SAMPLE_SIZE");
    expect(result.recommendation).toBe("WATCH");
  });

  it("does not emit a recommendation for stale data", () => {
    const result = evaluateShopHealth({ metrics: metrics(), dataStatus: "STALE" });

    expect(result.evaluationStatus).toBe("STALE");
    expect(result.recommendation).toBeNull();
  });

  it("reduces confidence when a component has incomplete coverage", () => {
    const current = period({ settlementRate: moneyRate(null, 0) });
    const result = evaluateShopHealth({ metrics: metrics(current) });

    expect(result.score).toBe(100);
    expect(result.scoredWeight).toBe(90);
    expect(result.confidence).toBe(0.9);
    expect(result.warnings).toContain("LOW_DATA_COVERAGE");
    expect(result.evaluationStatus).toBe("FRESH");
    expect(result.recommendation).toBe("WATCH");
  });

  it("returns insufficient data instead of a recommendation when there are no orders", () => {
    const current = period({
      orders: {
        total: 0,
        awaitingShipment: 0,
        inTransit: 0,
        deliveredOrCompleted: 0,
        canceled: 0,
        refunded: 0,
        onHold: 0,
      },
      deliveryRate: rate(null, 0),
      cancellationRate: rate(null, 0),
      refundRate: rate(null, 0),
      onHoldOrderRate: rate(null, 0),
      onHoldMoneyRate: moneyRate(null, 0),
      settlementRate: moneyRate(null, 0),
    });
    const result = evaluateShopHealth({ metrics: metrics(current) });

    expect(result.evaluationStatus).toBe("INSUFFICIENT_DATA");
    expect(result.score).toBeNull();
    expect(result.recommendation).toBeNull();
  });
});
