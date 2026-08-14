import { describe, expect, it } from "vitest";

import type { NormalizedSettlementRecord } from "../contracts/finance.js";
import type { NormalizedOrder } from "../contracts/orders.js";
import { calculateMetrics } from "./calculate.js";

const CURRENT_START = new Date("2026-07-01T00:00:00.000Z");
const CURRENT_END = new Date("2026-08-01T00:00:00.000Z");
const PREVIOUS_START = new Date("2026-06-01T00:00:00.000Z");

function order(
  id: string,
  status: NormalizedOrder["canonicalStatus"],
  amount: string,
  overrides: Partial<NormalizedOrder> = {},
): NormalizedOrder {
  return {
    shopId: "shop-1",
    sourceOrderId: id,
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    paidAt: new Date("2026-07-10T00:00:00.000Z"),
    sourceUpdatedAt: new Date("2026-07-11T00:00:00.000Z"),
    readyToShipAt: null,
    latestDeliveryAt: null,
    sourceStatus: status,
    sourceSubStatus: null,
    canonicalStatus: status,
    grandTotal: amount,
    currency: "USD",
    trackingNumber: null,
    carrier: null,
    refundAmount: "0",
    refundStatus: null,
    deliveryEligible: true,
    firstSeenAt: new Date("2026-07-10T00:00:00.000Z"),
    lastSeenAt: new Date("2026-07-11T00:00:00.000Z"),
    sourceHash: `hash-${id}`,
    sourceSchemaVersion: "orders.v1",
    rawData: {},
    ...overrides,
  };
}

function settlement(
  id: string,
  tradeOrderId: string,
  state: NormalizedSettlementRecord["settlementState"],
  expected: string,
  eligible: string,
  settled: string,
): NormalizedSettlementRecord {
  return {
    shopId: "shop-1",
    sourceStatementDetailId: id,
    tradeOrderId,
    placedAt: new Date("2026-07-10T00:00:00.000Z"),
    deliveredAt: new Date("2026-07-14T00:00:00.000Z"),
    estimatedSettlementAt: new Date("2026-07-20T00:00:00.000Z"),
    earningAmount: expected,
    feeAmount: "0",
    shippingAmount: "0",
    expectedSettlementAmount: expected,
    eligibleSettlementAmount: eligible,
    settledAmount: settled,
    currency: "USD",
    sourceSettlementStatus: state,
    settlementState: state,
    onHoldReason: state === "ON_HOLD" ? "SOURCE_REASON" : null,
    sourceHash: `settlement-${id}`,
    sourceSchemaVersion: "finance.v1",
    rawData: {},
  };
}

describe("calculateMetrics", () => {
  it("calculates decimal money, operational rates, and finance rates", () => {
    const result = calculateMetrics({
      currency: "USD",
      currentRange: { start: CURRENT_START, end: CURRENT_END },
      previousRange: { start: PREVIOUS_START, end: CURRENT_START },
      orders: [
        order("1", "COMPLETED", "10.10"),
        order("2", "CANCELED", "20.20", { deliveryEligible: false }),
        order("3", "REFUNDED", "30.30", { refundAmount: "5.05" }),
      ],
      settlements: [
        settlement("s1", "1", "SETTLED", "10", "10", "9"),
        settlement("s2", "3", "ON_HOLD", "20", "20", "0"),
      ],
    });

    expect(result.current.orders).toEqual({
      total: 3,
      awaitingShipment: 0,
      inTransit: 0,
      deliveredOrCompleted: 1,
      canceled: 1,
      refunded: 1,
      onHold: 1,
    });
    expect(result.current.bookedSales.value).toBe("60.6000");
    expect(result.current.grossValidSales.value).toBe("40.4000");
    expect(result.current.refundedAmount.value).toBe("5.0500");
    expect(result.current.netSales.value).toBe("35.3500");
    expect(result.current.averageOrderValue.value).toBe("20.2000");
    expect(result.current.cancellationRate.value).toBeCloseTo(1 / 3);
    expect(result.current.refundRate.value).toBe(0.5);
    expect(result.current.onHoldOrderRate.value).toBe(0.5);
    expect(result.current.onHoldMoneyRate.value).toBeCloseTo(2 / 3);
    expect(result.current.settlementRate.value).toBe(0.3);
    expect(result.current.settledCash.value).toBe("9.0000");
  });

  it("returns null ratios and relative growth when denominators are zero", () => {
    const result = calculateMetrics({
      currency: "USD",
      currentRange: { start: CURRENT_START, end: CURRENT_END },
      previousRange: { start: PREVIOUS_START, end: CURRENT_START },
      orders: [order("1", "AWAITING_SHIPMENT", "10", { deliveryEligible: false })],
      settlements: [],
    });

    expect(result.current.deliveryRate.value).toBeNull();
    expect(result.current.refundRate.value).toBeNull();
    expect(result.current.onHoldMoneyRate.value).toBeNull();
    expect(result.current.settlementRate.value).toBeNull();
    expect(result.trends.orders.relativeChange).toBeNull();
    expect(result.trends.grossValidSales.relativeChange).toBeNull();
    expect(result.current.warnings).toContain("FINANCE_DATA_MISSING");
  });

  it("does not mix currencies into monetary KPI", () => {
    const result = calculateMetrics({
      currency: "USD",
      currentRange: { start: CURRENT_START, end: CURRENT_END },
      previousRange: { start: PREVIOUS_START, end: CURRENT_START },
      orders: [
        order("usd", "COMPLETED", "10"),
        order("eur", "COMPLETED", "100", { currency: "EUR" }),
      ],
      settlements: [],
    });

    expect(result.current.orders.total).toBe(2);
    expect(result.current.bookedSales.value).toBe("10.0000");
    expect(result.current.bookedSales.coverage).toBe(0.5);
    expect(result.current.warnings).toContain("CURRENCY_MISMATCH");
  });

  it("keeps dashboard delivery KPI separate from the BA operational risk formula", () => {
    const result = calculateMetrics({
      currency: "USD",
      currentRange: { start: CURRENT_START, end: CURRENT_END },
      previousRange: { start: PREVIOUS_START, end: CURRENT_START },
      orders: [
        order("transit", "IN_TRANSIT", "10"),
        order("delivered", "DELIVERED", "10"),
        order("completed", "COMPLETED", "10"),
        order("awaiting", "AWAITING_SHIPMENT", "10", {
          deliveryEligible: false,
        }),
      ],
      settlements: [],
    });

    expect(result.current.deliveryRate.numerator).toBe(2);
    expect(result.current.deliveryRate.denominator).toBe(3);
    expect(result.current.deliveryRate.value).toBeCloseTo(2 / 3);
  });
});
