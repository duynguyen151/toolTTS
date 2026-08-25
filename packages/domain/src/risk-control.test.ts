import { describe, expect, it } from "vitest";

import type { NormalizedOrder } from "./contracts/orders.js";
import {
  evaluateRiskControl,
  RISK_CONTROL_POLICY_V1,
  RiskControlPolicySchema,
} from "./risk-control.js";

function order(
  id: string,
  status: NormalizedOrder["canonicalStatus"],
  value: string,
  currency = "USD",
): NormalizedOrder {
  const now = new Date("2026-08-13T00:00:00.000Z");
  return {
    shopId: "shop",
    sourceOrderId: id,
    createdAt: now,
    paidAt: now,
    sourceUpdatedAt: now,
    readyToShipAt: null,
    latestDeliveryAt: null,
    sourceStatus: status,
    sourceSubStatus: null,
    canonicalStatus: status,
    grandTotal: value,
    currency,
    trackingNumber: null,
    carrier: null,
    refundAmount: null,
    refundStatus: null,
    deliveryEligible: null,
    firstSeenAt: now,
    lastSeenAt: now,
    sourceHash: id,
    sourceSchemaVersion: "test",
    rawData: {},
  };
}

describe("evaluateRiskControl", () => {
  it("publishes persisted and operational order counts separately", () => {
    const result = evaluateRiskControl({
      orders: [
        order("awaiting", "AWAITING_SHIPMENT", "100.0000"),
        order("delivered", "DELIVERED", "200.0000"),
        order("canceled", "CANCELED", "50.0000"),
      ],
    });

    expect(result.totalPersistedOrders).toBe(3);
    expect(result.operationalOrderCount).toBe(2);
    expect(result.deliveredCount).toBe(1);
    expect(result.deliveryRate).toBe(0.5);
  });

  it("uses the exact BA total, delivered, and operational Onhold Value sets", () => {
    const result = evaluateRiskControl({
      orders: [
        order("packing", "AWAITING_SHIPMENT", "100"),
        order("transit", "IN_TRANSIT", "200"),
        order("delivered", "DELIVERED", "300"),
        order("completed", "COMPLETED", "400"),
        order("pending", "PENDING", "5000"),
        order("canceled", "CANCELED", "5000"),
        order("refunded", "REFUNDED", "5000"),
      ],
    });

    expect(result.onHoldValue).toBe("1000.0000");
    expect(result.onHoldOrderCount).toBe(4);
    expect(result.totalCount).toBe(4);
    expect(result.deliveredCount).toBe(3);
    expect(result.deliveryRate).toBe(0.75);
    expect(result.desiredState).toBe("HOLIDAY_MODE_OFF");
  });

  it("counts Awaiting Collection in the authoritative delivery denominator", () => {
    const result = evaluateRiskControl({
      orders: [
        order("collection", "AWAITING_COLLECTION", "10"),
        order("delivered", "DELIVERED", "10"),
      ],
    });

    expect(result.totalCount).toBe(2);
    expect(result.deliveredCount).toBe(1);
    expect(result.deliveryRate).toBe(0.5);
  });

  it("stops when either BA condition is true", () => {
    const valueStop = evaluateRiskControl({
      orders: [order("1", "COMPLETED", "3500")],
    });
    const rateStop = evaluateRiskControl({
      orders: [
        order("1", "IN_TRANSIT", "10"),
        order("2", "AWAITING_SHIPMENT", "10"),
      ],
    });

    expect(valueStop.stopByOnHoldValue).toBe(true);
    expect(valueStop.stopByDeliveryRate).toBe(false);
    expect(valueStop.stopConditionOperator).toBe("OR");
    expect(valueStop.desiredState).toBe("HOLIDAY_MODE_ON");
    expect(rateStop.stopByOnHoldValue).toBe(false);
    expect(rateStop.stopByDeliveryRate).toBe(true);
    expect(rateStop.desiredState).toBe("HOLIDAY_MODE_ON");
  });

  it("returns insufficient data when a configured minimum sample is not met", () => {
    const result = evaluateRiskControl({
      orders: [order("1", "AWAITING_SHIPMENT", "10")],
      policy: {
        ...RISK_CONTROL_POLICY_V1,
        minimumOrdersForRateRule: 10,
      },
    });

    expect(result.rateRuleApplied).toBe(false);
    expect(result.sampleSufficient).toBe(false);
    expect(result.dataSufficient).toBe(false);
    expect(result.desiredState).toBe("INSUFFICIENT_DATA");
    expect(result.reasons).toContain("DELIVERY_RATE_SAMPLE_TOO_SMALL");
  });

  it("marks an empty operational set as an explicit insufficient-data state", () => {
    const result = evaluateRiskControl({ orders: [] });

    expect(result.totalCount).toBe(0);
    expect(result.sampleSufficient).toBe(false);
    expect(result.rateRuleApplied).toBe(false);
    expect(result.desiredState).toBe("INSUFFICIENT_DATA");
    expect(result.reasons).toContain("NO_OPERATIONAL_ORDERS");
  });

  it("does not report safe when statuses or operational currency are incomplete", () => {
    const unknown = evaluateRiskControl({
      orders: [order("1", "UNKNOWN", "10")],
    });
    const currencyMismatch = evaluateRiskControl({
      orders: [
        order("1", "COMPLETED", "100", "USD"),
        order("2", "COMPLETED", "5000", "EUR"),
      ],
    });

    expect(unknown.statusCoverage).toBe(0);
    expect(unknown.onHoldValue).toBeNull();
    expect(unknown.onHoldOrderCount).toBeNull();
    expect(unknown.deliveredCount).toBeNull();
    expect(unknown.totalCount).toBeNull();
    expect(unknown.deliveryRate).toBeNull();
    expect(unknown.stopByDeliveryRate).toBe(false);
    expect(unknown.desiredState).toBe("INSUFFICIENT_DATA");
    expect(unknown.reasons).toContain("UNKNOWN_STATUS_PRESENT");
    expect(currencyMismatch.onHoldValue).toBeNull();
    expect(currencyMismatch.onHoldValueKnownPolicyCurrencySubtotal).toBe(
      "100.0000",
    );
    expect(currencyMismatch.currencyMismatchCount).toBe(1);
    expect(currencyMismatch.desiredState).toBe("INSUFFICIENT_DATA");
  });

  it("allows a definitive OR stop even when another part of the data is incomplete", () => {
    const result = evaluateRiskControl({
      orders: [
        order("known", "COMPLETED", "3500"),
        order("unknown", "UNKNOWN", "10"),
      ],
    });

    expect(result.dataSufficient).toBe(false);
    expect(result.definitiveStop).toBe(true);
    expect(result.desiredState).toBe("HOLIDAY_MODE_ON");
  });

  it("applies configurable resume thresholds and stable-cycle hysteresis", () => {
    const policy = {
      ...RISK_CONTROL_POLICY_V1,
      resumeOnHoldValueBelow: "3000",
      resumeDeliveryRateAt: 0.8,
      stableCyclesBeforeResume: 2,
    };
    const safeOrders = [
      order("1", "COMPLETED", "1000"),
      order("2", "COMPLETED", "1000"),
    ];
    const firstSafeCycle = evaluateRiskControl({
      orders: safeOrders,
      policy,
      holidayModeCurrentlyEnabled: true,
      consecutiveSafeCycles: 0,
    });
    const secondSafeCycle = evaluateRiskControl({
      orders: safeOrders,
      policy,
      holidayModeCurrentlyEnabled: true,
      consecutiveSafeCycles: firstSafeCycle.consecutiveSafeCycles,
    });

    expect(firstSafeCycle.resumeCriteriaMet).toBe(true);
    expect(firstSafeCycle.consecutiveSafeCycles).toBe(1);
    expect(firstSafeCycle.desiredState).toBe("HOLIDAY_MODE_ON");
    expect(firstSafeCycle.reasons).toContain("RECOVERY_HYSTERESIS_PENDING");
    expect(secondSafeCycle.consecutiveSafeCycles).toBe(2);
    expect(secondSafeCycle.desiredState).toBe("HOLIDAY_MODE_OFF");
  });

  it("keeps Holiday Mode on inside a configured hysteresis gap", () => {
    const result = evaluateRiskControl({
      orders: [
        order("1", "COMPLETED", "1600"),
        order("2", "IN_TRANSIT", "1600"),
      ],
      policy: {
        ...RISK_CONTROL_POLICY_V1,
        resumeOnHoldValueBelow: "3000",
        resumeDeliveryRateAt: 0.8,
      },
      holidayModeCurrentlyEnabled: true,
    });

    expect(result.definitiveStop).toBe(false);
    expect(result.resumeCriteriaMet).toBe(false);
    expect(result.desiredState).toBe("HOLIDAY_MODE_ON");
    expect(result.reasons).toContain("RESUME_THRESHOLDS_NOT_MET");
  });

  it("rejects policy thresholds that invert hysteresis", () => {
    expect(
      RiskControlPolicySchema.safeParse({
        ...RISK_CONTROL_POLICY_V1,
        resumeOnHoldValueBelow: "4000",
      }).success,
    ).toBe(false);
    expect(
      RiskControlPolicySchema.safeParse({
        ...RISK_CONTROL_POLICY_V1,
        resumeDeliveryRateAt: 0.6,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["3499.99", false, "NONE", "CLEAR"],
    ["3500", true, "VALUE", "WARNING"],
    ["3500.01", true, "VALUE", "WARNING"],
  ] as const)(
    "applies the inclusive value threshold at %s",
    (value, stops, trigger, ruleResult) => {
      const result = evaluateRiskControl({
        orders: [order("historical-completed", "COMPLETED", value)],
      });

      expect(result.stopByOnHoldValue).toBe(stops);
      expect(result.trigger).toBe(trigger);
      expect(result.ruleResult).toBe(ruleResult);
    },
  );

  it.each([
    [69, 100, true, "RATE"],
    [6999, 10000, true, "RATE"],
    [70, 100, false, "NONE"],
    [71, 100, false, "NONE"],
  ] as const)(
    "applies the exclusive rate threshold to %s/%s delivered",
    (delivered, total, stops, trigger) => {
      const orders = Array.from({ length: total }, (_, index) =>
        order(
          String(index),
          index < delivered ? "COMPLETED" : "AWAITING_SHIPMENT",
          "0.1",
        ),
      );
      const result = evaluateRiskControl({ orders });

      expect(result.stopByDeliveryRate).toBe(stops);
      expect(result.trigger).toBe(trigger);
    },
  );

  it("reports BOTH only when both locked OR conditions trigger", () => {
    const result = evaluateRiskControl({
      orders: [
        order("delivered", "COMPLETED", "2000"),
        order("waiting", "AWAITING_SHIPMENT", "2000"),
      ],
    });

    expect(result.stopByOnHoldValue).toBe(true);
    expect(result.stopByDeliveryRate).toBe(true);
    expect(result.trigger).toBe("BOTH");
    expect(result.suggestedOperationalAction).toBe("REVIEW_SHOP");
    expect(result.executionMode).toBe("DRY_RUN");
    expect(result.executedAction).toBe("NONE");
  });

  it("exposes honest full-persisted-history semantics", () => {
    const observedAt = new Date("2025-01-01T00:00:00.000Z");
    const historical = order("old-completed", "COMPLETED", "100");
    historical.lastSeenAt = observedAt;
    const result = evaluateRiskControl({ orders: [historical] });

    expect(result.historyMode).toBe("FULL_PERSISTED_HISTORY");
    expect(result.dataCoverage).toBe("UNKNOWN");
    expect(result.totalPersistedOrderCount).toBe(1);
    expect(result.totalPersistedValue).toBe("100.0000");
    expect(result.onHoldOrderCount).toBe(1);
    expect(result.lastSuccessfulObservationAt).toEqual(observedAt);
  });

  it("does not present the operational Onhold Rate as a useful 100 percent metric", () => {
    const result = evaluateRiskControl({
      orders: [order("1", "AWAITING_SHIPMENT", "10")],
    });

    expect(result.onHoldRate).toBeNull();
    expect(result.onHoldRateUnavailableReason).toBe(
      "OPERATIONAL_ONHOLD_COUNT_AND_TOTAL_COUNT_USE_THE_SAME_STATUS_SET",
    );
  });

  it("deduplicates repeated observations and keeps the latest order state", () => {
    const first = order("same-order", "AWAITING_SHIPMENT", "100");
    first.sourceUpdatedAt = new Date("2026-08-12T00:00:00.000Z");
    const latest = order("same-order", "COMPLETED", "125");
    latest.sourceUpdatedAt = new Date("2026-08-13T00:00:00.000Z");
    const result = evaluateRiskControl({ orders: [first, latest] });

    expect(result.totalPersistedOrderCount).toBe(1);
    expect(result.onHoldOrderCount).toBe(1);
    expect(result.deliveredCount).toBe(1);
    expect(result.onHoldValue).toBe("125.0000");
  });

  it("marks total persisted value unavailable when currencies cannot be combined", () => {
    const result = evaluateRiskControl({
      orders: [
        order("usd", "COMPLETED", "100", "USD"),
        order("eur", "CANCELED", "100", "EUR"),
      ],
    });

    expect(result.totalPersistedOrderCount).toBe(2);
    expect(result.totalPersistedValue).toBeNull();
  });

  it("keeps a definitive value warning from the known USD subtotal", () => {
    const result = evaluateRiskControl({
      orders: [
        order("usd", "COMPLETED", "3500", "USD"),
        order("eur", "COMPLETED", "100", "EUR"),
      ],
    });

    expect(result.onHoldValue).toBeNull();
    expect(result.onHoldValueKnownPolicyCurrencySubtotal).toBe("3500.0000");
    expect(result.stopByOnHoldValue).toBe(true);
    expect(result.trigger).toBe("VALUE");
    expect(result.ruleResult).toBe("WARNING");
  });

  it("preserves an unknown Holiday Mode observation", () => {
    const result = evaluateRiskControl({
      orders: [order("safe", "COMPLETED", "100")],
      holidayModeCurrentlyEnabled: null,
    });

    expect(result.holidayModeCurrentlyEnabled).toBeNull();
    expect(result.desiredState).toBe("HOLIDAY_MODE_OFF");
  });

  it("derives rule wording from the validated active policy", () => {
    const result = evaluateRiskControl({
      orders: [order("safe", "COMPLETED", "100")],
      policy: {
        ...RISK_CONTROL_POLICY_V1,
        currency: "EUR",
        stopOnHoldValueAt: "4200.0000",
        stopDeliveryRateBelow: 0.725,
        resumeOnHoldValueBelow: "4200.0000",
        resumeDeliveryRateAt: 0.725,
      },
    });

    expect(result.ruleExpression).toBe(
      "VALUE >= 4200 EUR OR DELIVERY_RATE < 72.5%",
    );
  });
});
