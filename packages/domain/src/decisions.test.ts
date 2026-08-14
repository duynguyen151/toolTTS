import { describe, expect, it } from "vitest";

import {
  BaDecisionInputSchema,
  BaDecisionSchema,
  CaptureBaDecisionInputSchema,
  DecisionCaseInputSchema,
  mapRiskResultToRuleDecision,
} from "./decisions.js";

const validCase = {
  shopId: "00000000-0000-4000-8000-000000000001",
  observedAt: new Date("2026-08-14T00:00:00.000Z"),
  metricsSnapshot: {
    window: "FULL_PERSISTED_HISTORY",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-14T00:00:00.000Z",
    totalOrders: 120,
    onHoldOrderCount: 18,
    deliveredCount: 84,
    deliveryRate: 0.84,
    cancellationRate: 0.05,
    refundRate: 0.02,
    onHoldValue: "1200.0000",
    currency: "USD",
  },
  riskSnapshot: {
    policyVersion: "risk-control-policy.v1",
    evaluatedAt: "2026-08-14T00:00:00.000Z",
    onHoldValue: "1200.0000",
    deliveryRate: 0.84,
    stopByOnHoldValue: false,
    stopByDeliveryRate: false,
    dataSufficient: true,
  },
  financeSnapshot: {
    capturedAt: "2026-08-14T00:00:00.000Z",
    currency: "USD",
    availableBalance: "2400.0000",
    frozenBalance: "100.0000",
    totalBalance: "2500.0000",
    toSettleBalance: "800.0000",
    onHoldBalance: "1200.0000",
    settlementCount: 40,
    onHoldSettlementCount: 6,
  },
  ruleDecision: "CONTINUE" as const,
  ruleTriggers: [] as const,
  dataCoverage: "COMPLETE" as const,
  sourceSyncRunId: null,
};

describe("decision contracts", () => {
  it.each(["SCALE", "CONTINUE", "WATCH", "PAUSE"] as const)(
    "accepts the BA decision %s",
    (decision) => {
      expect(BaDecisionSchema.parse(decision)).toBe(decision);
    },
  );

  it("accepts a complete decision case and BA submission", () => {
    const result = CaptureBaDecisionInputSchema.parse({
      decisionCase: validCase,
      baDecision: {
        decision: "WATCH",
        confidence: 0.75,
        reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE", "RECOVERY_TREND"],
        note: "  Monitor the next settlement cycle.  ",
      },
    });

    expect(result.decisionCase.sourceSyncRunId).toBeNull();
    expect(result.baDecision.note).toBe("Monitor the next settlement cycle.");
  });

  it.each([
    ["decision", { decision: "STOP", reasonCodes: ["OTHER"] }],
    ["confidence below zero", { decision: "WATCH", confidence: -0.01, reasonCodes: ["OTHER"] }],
    ["confidence above one", { decision: "WATCH", confidence: 1.01, reasonCodes: ["OTHER"] }],
    ["unknown reason code", { decision: "WATCH", reasonCodes: ["UNRECOGNIZED"] }],
    ["missing reason code", { decision: "WATCH", reasonCodes: [] }],
    ["duplicate reason code", { decision: "WATCH", reasonCodes: ["OTHER", "OTHER"] }],
    ["blank note", { decision: "WATCH", reasonCodes: ["OTHER"], note: "   " }],
  ])("rejects an invalid BA %s", (_label, input) => {
    expect(BaDecisionInputSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["raw metrics data", { ...validCase, metricsSnapshot: { ...validCase.metricsSnapshot, rawData: {} } }],
    ["buyer data", { ...validCase, metricsSnapshot: { ...validCase.metricsSnapshot, buyerName: "Sensitive" } }],
    ["session data", { ...validCase, riskSnapshot: { ...validCase.riskSnapshot, token: "secret" } }],
    ["address data", { ...validCase, financeSnapshot: { ...validCase.financeSnapshot, shippingAddress: "secret" } }],
    ["rule decision", { ...validCase, ruleDecision: "CLEAR" }],
    ["data coverage", { ...validCase, dataCoverage: "ASSUMED" }],
    ["source run ID", { ...validCase, sourceSyncRunId: "sync-run" }],
    ["unknown trigger", { ...validCase, ruleDecision: "PAUSE", ruleTriggers: ["REFUND_RATE"] }],
    ["duplicate trigger", { ...validCase, ruleDecision: "PAUSE", ruleTriggers: ["ONHOLD_VALUE", "ONHOLD_VALUE"] }],
    ["pause without trigger", { ...validCase, ruleDecision: "PAUSE", ruleTriggers: [] }],
    ["continue with trigger", { ...validCase, ruleDecision: "CONTINUE", ruleTriggers: ["DELIVERY_RATE"] }],
  ])("rejects a malformed decision case %s", (_label, input) => {
    expect(DecisionCaseInputSchema.safeParse(input).success).toBe(false);
  });

  it.each(["COMPLETE", "PARTIAL", "UNKNOWN"] as const)(
    "accepts %s data coverage",
    (dataCoverage) => {
      expect(
        DecisionCaseInputSchema.parse({ ...validCase, dataCoverage }).dataCoverage,
      ).toBe(dataCoverage);
    },
  );

  it.each([
    ["PAUSE", ["ONHOLD_VALUE"]],
    ["CONTINUE", []],
    ["INSUFFICIENT_DATA", []],
  ] as const)("accepts canonical rule decision %s", (ruleDecision, ruleTriggers) => {
    expect(
      DecisionCaseInputSchema.parse({
        ...validCase,
        ruleDecision,
        ruleTriggers,
      }).ruleDecision,
    ).toBe(ruleDecision);
  });

  it.each([
    ["WARNING", "PAUSE"],
    ["CLEAR", "CONTINUE"],
    ["INSUFFICIENT_DATA", "INSUFFICIENT_DATA"],
  ] as const)("maps risk result %s to product decision %s", (riskResult, expected) => {
    expect(mapRiskResultToRuleDecision(riskResult)).toBe(expected);
  });
});
