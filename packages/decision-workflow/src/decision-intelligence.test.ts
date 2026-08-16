import { describe, expect, test } from "vitest";

import { buildDecisionIntelligence } from "./decision-intelligence.js";

const observedAt = new Date("2026-08-14T00:00:00.000Z");

function input(overrides: Record<string, unknown> = {}) {
  return {
    observedAt,
    profile: { profileId: "profile-safe-1", profileNo: "SAFE-1" },
    shop: { shopId: "shop-safe-1", tiktokShopId: null, displayName: "Safe Shop", region: "US" as const, locale: "en-US" as const, currency: "USD" as const },
    metrics: { window: "FULL_PERSISTED_HISTORY", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-14T00:00:00.000Z", totalOrders: 10, totalPersistedOrders: 10, operationalOrderCount: 10, onHoldOrderCount: 10, deliveredCount: 9, deliveryRate: 0.9, cancellationRate: null, refundRate: null, onHoldValue: "1200.0000", currency: "USD" as const },
    finance: { capturedAt: observedAt.toISOString(), currency: "USD" as const, availableBalance: null, frozenBalance: null, totalBalance: null, toSettleBalance: null, onHoldBalance: "400.0000", officialOnHoldAmount: "400.0000", settlementCount: 1, onHoldSettlementCount: 1 },
    coverage: { coverageState: "COMPLETE" as const, persistedMetricsWindow: "FULL_PERSISTED_HISTORY", source: "SELLER_CENTER" as const, provenSourceWindow: "ROLLING_12_MONTHS" as const, completeWithinSourceWindow: true, lifetimeHistoryComplete: false, ordersSourceComplete: true, financeRequiredSourceComplete: true, sourceReconciled: true, latestSuccessfulSyncAt: observedAt.toISOString(), financeCapturedAt: observedAt.toISOString(), freshness: "FRESH" as const },
    risk: { policyVersion: "risk-control-policy.v1", evaluatedAt: observedAt.toISOString(), onHoldValue: "1200.0000", deliveryRate: 0.9, stopByOnHoldValue: false, stopByDeliveryRate: false, dataSufficient: true, stopOnHoldValueAt: "3500.0000", stopDeliveryRateBelow: 0.7, minimumOrdersForRateRule: 0 },
    ruleDecision: "CONTINUE" as const,
    ruleTriggers: [],
    previous: null,
    ...overrides,
  };
}

describe("decision intelligence", () => {
  test("builds a healthy, privacy-safe context with unconfigured trends", () => {
    const result = buildDecisionIntelligence(input());
    expect(result.context.metrics.decision.operationalExposure).toBe("1200.0000");
    expect(result.context.metrics.finance.officialFinanceOnHold).toBe("400.0000");
    expect(result.context.rule).toMatchObject({ result: "CONTINUE", triggers: [] });
    expect(result.context.rule.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "operationalExposure", result: "PASS" }),
      expect.objectContaining({ metric: "deliveryRate", result: "PASS" }),
    ]));
    expect(result.context.trends).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: "DELIVERY_DETERIORATION", status: "NOT_EVALUATED", reasonCode: "POLICY_UNCONFIGURED" }),
    ]));
    expect(JSON.stringify(result.context)).not.toMatch(/cookie|token|credential|rawData/i);
  });

  test("compares compatible history and applies only configured trend thresholds", () => {
    const previous = buildDecisionIntelligence(input()).context;
    const result = buildDecisionIntelligence(input({
      metrics: { ...input().metrics, deliveryRate: 0.8, onHoldValue: "2200.0000" },
      risk: { ...input().risk, deliveryRate: 0.8, onHoldValue: "2200.0000" },
      previous,
      trendPolicy: { version: "trend-policy.v1", signals: [{ signal: "RAPID_ONHOLD_GROWTH", thresholds: [{ metric: "operationalExposure.absoluteDelta", operator: "GTE", value: 1000 }] }] },
    }));
    expect(result.context.comparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "operationalExposure", absoluteDelta: "1000", direction: "INCREASED" }),
      expect.objectContaining({ metric: "deliveryRate", absoluteDelta: -0.1, direction: "DECREASED" }),
    ]));
    expect(result.context.trends).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: "RAPID_ONHOLD_GROWTH", status: "TRIGGERED", reasonCode: null }),
      expect.objectContaining({ signal: "DELIVERY_DETERIORATION", status: "NOT_EVALUATED", reasonCode: "POLICY_UNCONFIGURED" }),
    ]));
  });

  test("marks unavailable optional metrics and incomplete data honestly", () => {
    const result = buildDecisionIntelligence(input({
      coverage: { ...input().coverage, coverageState: "PARTIAL", freshness: "STALE" },
      risk: { ...input().risk, dataSufficient: false, deliveryRate: null, onHoldValue: null },
      metrics: { ...input().metrics, deliveryRate: null, onHoldValue: null },
      ruleDecision: "INSUFFICIENT_DATA",
    }));
    expect(result.context.rule.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: "NOT_EVALUATED" }),
    ]));
    expect(result.context.dataQuality.blockers).toContain("DATA_COVERAGE_PARTIAL");
    expect(result.context.metrics.decision.refundRate).toBeNull();
  });

  test("renders each hard-rule breach as explicit failed evidence", () => {
    const exposure = buildDecisionIntelligence(input({
      metrics: { ...input().metrics, onHoldValue: "3500.0000" },
      risk: { ...input().risk, onHoldValue: "3500.0000", stopByOnHoldValue: true },
      ruleDecision: "PAUSE",
    })).context;
    const rate = buildDecisionIntelligence(input({
      metrics: { ...input().metrics, deliveryRate: 0.69 },
      risk: { ...input().risk, deliveryRate: 0.69, stopByDeliveryRate: true },
      ruleDecision: "PAUSE",
    })).context;
    expect(exposure.rule.checks[0]).toMatchObject({ result: "FAIL", triggeredReason: "OPERATIONAL_EXPOSURE_LIMIT_REACHED" });
    expect(rate.rule.checks[1]).toMatchObject({ result: "FAIL", triggeredReason: "DELIVERY_RATE_BELOW_LIMIT" });
  });

  test("does not compare an incompatible previous snapshot", () => {
    const incompatible = buildDecisionIntelligence(input()).context;
    const result = buildDecisionIntelligence(input({
      previous: { ...incompatible, shop: { ...incompatible.shop, shopId: "other-shop" } },
    })).context;
    expect(result.previousCompatibleSnapshot).toBeNull();
    expect(result.comparisons[0]).toMatchObject({ previous: null, direction: "UNKNOWN" });
  });
});
