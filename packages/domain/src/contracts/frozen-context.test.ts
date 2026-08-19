import { describe, expect, it } from "vitest";

import type {
  AiDecisionContext,
  DecisionCoverageSnapshot,
  DecisionFinanceSnapshot,
  DecisionMetricsSnapshot,
  DecisionRiskSnapshot,
} from "../index.js";
import { validateFrozenDecisionContext } from "./frozen-context.js";

const observedAt = "2026-08-14T00:00:00.000Z";

const metrics: DecisionMetricsSnapshot = {
  window: "FULL_PERSISTED_HISTORY",
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: observedAt,
  totalOrders: 10,
  totalPersistedOrders: 10,
  operationalOrderCount: 10,
  onHoldOrderCount: 10,
  deliveredCount: 9,
  deliveryRate: 0.9,
  cancellationRate: null,
  refundRate: null,
  onHoldValue: "0.0000",
  currency: "USD",
};

const finance: DecisionFinanceSnapshot = {
  capturedAt: observedAt,
  currency: "USD",
  availableBalance: null,
  frozenBalance: null,
  totalBalance: null,
  toSettleBalance: null,
  onHoldBalance: null,
  officialOnHoldAmount: null,
  settlementCount: 0,
  onHoldSettlementCount: 0,
};

const coverage: DecisionCoverageSnapshot = {
  coverageState: "COMPLETE",
  persistedMetricsWindow: metrics.window,
  source: "SELLER_CENTER",
  provenSourceWindow: "ROLLING_12_MONTHS",
  completeWithinSourceWindow: true,
  lifetimeHistoryComplete: false,
  ordersSourceComplete: true,
  financeRequiredSourceComplete: true,
  sourceReconciled: true,
  latestSuccessfulSyncAt: observedAt,
  financeCapturedAt: observedAt,
  freshness: "FRESH",
};

const risk: DecisionRiskSnapshot = {
  policyVersion: "risk-control-policy.v1",
  evaluatedAt: observedAt,
  onHoldValue: metrics.onHoldValue,
  deliveryRate: metrics.deliveryRate,
  stopByOnHoldValue: true,
  stopByDeliveryRate: false,
  dataSufficient: true,
  stopOnHoldValueAt: "0.0000",
  stopDeliveryRateBelow: 0.7,
  minimumOrdersForRateRule: 0,
};

function context(overrides: Partial<AiDecisionContext> = {}): AiDecisionContext {
  return {
    schemaVersion: "ai-decision-context.v1",
    profile: { profileId: "profile-1", profileNo: "1" },
    shop: {
      shopId: "shop-1",
      tiktokShopId: null,
      displayName: "Shop",
      region: "US",
      locale: "en-US",
      currency: "USD",
    },
    metrics: {
      observedAt,
      decision: (({ onHoldValue: _onHoldValue, ...decision }) => ({ ...decision, operationalExposure: metrics.onHoldValue }))(metrics),
      finance: (({ onHoldBalance: _onHoldBalance, officialOnHoldAmount: _officialOnHoldAmount, ...snapshot }) => ({ ...snapshot, officialFinanceOnHold: finance.officialOnHoldAmount }))(finance),
    },
    comparisons: [
      { metric: "operationalExposure", current: "0.0000", previous: null, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency: "USD" },
      { metric: "deliveryRate", current: 0.9, previous: null, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency: null },
      { metric: "refundRate", current: null, previous: null, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency: null },
      { metric: "cancellationRate", current: null, previous: null, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency: null },
    ],
    trends: [
      "RAPID_ONHOLD_GROWTH",
      "DELIVERY_DETERIORATION",
      "REFUND_SPIKE",
      "RECOVERY_TREND",
      "THRESHOLD_FLAPPING",
    ].map((signal) => ({ signal: signal as AiDecisionContext["trends"][number]["signal"], comparisons: [], status: "NOT_EVALUATED" as const, reasonCode: "POLICY_UNCONFIGURED" as const })),
    dataQuality: {
      coverage: "COMPLETE",
      source: "SELLER_CENTER",
      provenSourceWindow: "ROLLING_12_MONTHS",
      completeWithinSourceWindow: true,
      lifetimeHistoryComplete: false,
      ordersSourceComplete: true,
      financeRequiredSourceComplete: true,
      sourceReconciled: true,
      freshness: "FRESH",
      latestSuccessfulSyncAt: observedAt,
      financeCapturedAt: observedAt,
      blockers: [],
    },
    risk: {
      policyVersion: risk.policyVersion,
      evaluatedAt: observedAt,
      operationalExposure: metrics.onHoldValue,
      deliveryRate: metrics.deliveryRate,
      stopByOnHoldValue: true,
      stopByDeliveryRate: false,
      dataSufficient: true,
      stopOnHoldValueAt: risk.stopOnHoldValueAt,
      stopDeliveryRateBelow: risk.stopDeliveryRateBelow,
      minimumOrdersForRateRule: risk.minimumOrdersForRateRule,
    },
    rule: {
      result: "PAUSE",
      policyVersion: risk.policyVersion,
      checks: [
        { metric: "operationalExposure", observedValue: metrics.onHoldValue, threshold: risk.stopOnHoldValueAt, operator: "GTE", result: "FAIL", triggeredReason: "OPERATIONAL_EXPOSURE_LIMIT_REACHED" },
        { metric: "deliveryRate", observedValue: metrics.deliveryRate, threshold: risk.stopDeliveryRateBelow, operator: "LT", result: "PASS", triggeredReason: null },
      ],
      triggers: ["OPERATIONAL_EXPOSURE"],
      expression: "operationalExposure >= 0 USD OR deliveryRate < 70%",
      evaluatedAt: observedAt,
    },
    previousCompatibleSnapshot: null,
    policyVersions: {
      metricDefinitionVersion: "decision-metrics.v1",
      riskPolicyVersion: risk.policyVersion,
      trendPolicyVersion: null,
    },
    ...overrides,
  };
}

function input(contextValue: AiDecisionContext = context()) {
  return {
    context: contextValue,
    metrics,
    finance,
    coverage,
    risk,
    ruleDecision: "PAUSE" as const,
    ruleTriggers: ["ONHOLD_VALUE"] as const,
    owner: { shopId: "shop-1", profileId: "profile-1", profileNo: "1" },
  };
}

describe("validateFrozenDecisionContext", () => {
  it("accepts canonical facts and preserves a zero decimal threshold", () => {
    expect(validateFrozenDecisionContext(input())).toMatchObject({ valid: true });
  });

  it("rejects contradictory stop flags, rule checks, and triggers", () => {
    const invalid = context({
      risk: { ...context().risk, stopByOnHoldValue: false },
      rule: { ...context().rule, result: "PAUSE", triggers: ["OPERATIONAL_EXPOSURE"] },
    });
    expect(validateFrozenDecisionContext(input(invalid))).toMatchObject({ valid: false });
  });

  it("rejects decimal expression formatting that drops the zero threshold", () => {
    const invalid = context({ rule: { ...context().rule, expression: "operationalExposure >=  USD OR deliveryRate < 70%" } });
    expect(validateFrozenDecisionContext(input(invalid))).toMatchObject({ valid: false });
  });

  it("rejects a context bound to another shop or profile", () => {
    const invalid = context({ profile: { profileId: "other-profile", profileNo: "2" } });
    expect(validateFrozenDecisionContext(input(invalid))).toMatchObject({ valid: false });
  });

  it("rejects prior history when its profile provenance cannot be proven", () => {
    const foreignProfileContext = context({
      profile: { profileId: "profile-2", profileNo: "2" },
      shop: { ...context().shop, shopId: "shop-2" },
    });
    const priorFromUnknownProfile = {
      observedAt,
      metrics: foreignProfileContext.metrics,
      dataQuality: foreignProfileContext.dataQuality,
    };
    const invalid = context({ previousCompatibleSnapshot: priorFromUnknownProfile });

    expect(validateFrozenDecisionContext(input(invalid))).toMatchObject({ valid: false });
    expect(validateFrozenDecisionContext(input(invalid))).toMatchObject({
      issues: expect.arrayContaining(["frozen context does not match the v1 schema"]),
    });
  });

  it("accepts prior history only with matching immutable provenance", () => {
    const prior = context({
      previousCompatibleSnapshot: null,
    });
    const withProvenance = context({
      comparisons: [
        { metric: "operationalExposure", current: "0.0000", previous: "0.0000", absoluteDelta: "0", relativeDelta: null, direction: "INCREASED", currency: "USD" },
        { metric: "deliveryRate", current: 0.9, previous: 0.9, absoluteDelta: 0, relativeDelta: 0, direction: "UNCHANGED", currency: null },
        { metric: "refundRate", current: null, previous: null, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency: null },
        { metric: "cancellationRate", current: null, previous: null, absoluteDelta: null, relativeDelta: null, direction: "UNKNOWN", currency: null },
      ],
      previousCompatibleSnapshot: {
        observedAt,
        metrics: prior.metrics,
        dataQuality: prior.dataQuality,
        provenance: { shopId: "shop-1", profileId: "profile-1", profileNo: "1" },
      } as unknown as AiDecisionContext["previousCompatibleSnapshot"],
    });

    expect(validateFrozenDecisionContext(input(withProvenance))).toMatchObject({ valid: true });
  });

  it("rejects foreign prior profile provenance", () => {
    const prior = context({
      previousCompatibleSnapshot: null,
    });
    const withForeignProvenance = context({
      previousCompatibleSnapshot: {
        observedAt,
        metrics: prior.metrics,
        dataQuality: prior.dataQuality,
        provenance: { shopId: "shop-foreign", profileId: "profile-foreign", profileNo: "foreign" },
      } as unknown as AiDecisionContext["previousCompatibleSnapshot"],
    });

    expect(validateFrozenDecisionContext(input(withForeignProvenance))).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["previous snapshot provenance does not match current profile/shop"]),
    });
  });

  it("rejects a declared trend policy when no canonical policy is supplied", () => {
    const invalid = context({
      policyVersions: { ...context().policyVersions, trendPolicyVersion: "trend-policy.v1" },
    });

    expect(validateFrozenDecisionContext(input(invalid))).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["trend policy version cannot be verified without a canonical trend policy"]),
    });
  });
});
