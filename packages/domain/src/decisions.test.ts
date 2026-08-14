import { describe, expect, it } from "vitest";

import {
  AiDecisionInputSchema,
  BaDecisionInputSchema,
  BaDecisionSchema,
  CaptureBaDecisionInputSchema,
  CreateDecisionCaseInputSchema,
  DecisionCaseInputSchema,
  DryRunExecutionSchema,
  RecordBaDecisionForCaseInputSchema,
  RecordDryRunExecutionInputSchema,
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
    stopOnHoldValueAt: "4321.0000",
    stopDeliveryRateBelow: 0.73,
    minimumOrdersForRateRule: 25,
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

  it("rejects a decision snapshot without its evaluated rule thresholds", () => {
    const {
      stopOnHoldValueAt: _stopOnHoldValueAt,
      stopDeliveryRateBelow: _stopDeliveryRateBelow,
      minimumOrdersForRateRule: _minimumOrdersForRateRule,
      ...riskSnapshotWithoutThresholds
    } = validCase.riskSnapshot;

    expect(
      DecisionCaseInputSchema.safeParse({
        ...validCase,
        riskSnapshot: riskSnapshotWithoutThresholds,
      }).success,
    ).toBe(false);
  });

  it("accepts a zero-length metrics period only when no orders were observed", () => {
    const periodEnd = validCase.metricsSnapshot.periodEnd;

    expect(DecisionCaseInputSchema.safeParse({
      ...validCase,
      metricsSnapshot: {
        ...validCase.metricsSnapshot,
        periodStart: periodEnd,
        totalOrders: 0,
      },
    }).success).toBe(true);
    expect(DecisionCaseInputSchema.safeParse({
      ...validCase,
      metricsSnapshot: {
        ...validCase.metricsSnapshot,
        periodStart: periodEnd,
        totalOrders: 1,
      },
    }).success).toBe(false);
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

  it("accepts explicit LIVE and sanitized DEMO decision case requests", () => {
    const live = CreateDecisionCaseInputSchema.parse({
      ...validCase,
      requestId: "00000000-0000-4000-8000-000000000020",
      caseOrigin: "LIVE",
    });
    const demo = CreateDecisionCaseInputSchema.parse({
      ...validCase,
      requestId: "00000000-0000-4000-8000-000000000021",
      caseOrigin: "DEMO_SANITIZED",
      sourceSyncRunId: null,
    });

    expect(live.caseOrigin).toBe("LIVE");
    expect(demo.caseOrigin).toBe("DEMO_SANITIZED");
  });

  it.each([
    ["non-UUID request", { requestId: "retry-1", caseOrigin: "LIVE" }],
    [
      "DEMO source run",
      {
        requestId: "00000000-0000-4000-8000-000000000022",
        caseOrigin: "DEMO_SANITIZED",
        sourceSyncRunId: "00000000-0000-4000-8000-000000000023",
      },
    ],
  ])("rejects a decision case with %s", (_label, overrides) => {
    expect(
      CreateDecisionCaseInputSchema.safeParse({
        ...validCase,
        ...overrides,
      }).success,
    ).toBe(false);
  });

  it("accepts a complete available AI decision", () => {
    const result = AiDecisionInputSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000030",
      decisionCaseId: "00000000-0000-4000-8000-000000000031",
      status: "AVAILABLE",
      provider: "openai",
      model: "gpt-5-mini",
      promptVersion: "shop-health.v1",
      policyVersion: "ai-policy.v1",
      recommendation: "WATCH",
      confidence: 0.7,
      reasonCodes: ["DATA_INCOMPLETE"],
      reason: "  Delivery history is incomplete.  ",
      humanReviewRequired: true,
      failureCode: null,
    });

    expect(result.reason).toBe("Delivery history is incomplete.");
    expect(result.failureCode).toBeNull();
  });

  it("accepts an unavailable AI decision only in its fail-closed shape", () => {
    const result = AiDecisionInputSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000032",
      decisionCaseId: "00000000-0000-4000-8000-000000000033",
      status: "UNAVAILABLE",
      provider: "openai",
      model: "gpt-5-mini",
      promptVersion: "shop-health.v1",
      policyVersion: "ai-policy.v1",
      recommendation: null,
      confidence: null,
      reasonCodes: null,
      reason: null,
      humanReviewRequired: true,
      failureCode: "PROVIDER_UNAVAILABLE",
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.humanReviewRequired).toBe(true);
  });

  it.each([
    ["available failure code", { status: "AVAILABLE", failureCode: "TIMEOUT" }],
    ["available missing recommendation", { status: "AVAILABLE", recommendation: null }],
    ["unavailable recommendation", { status: "UNAVAILABLE", recommendation: "WATCH" }],
    ["unavailable confidence", { status: "UNAVAILABLE", confidence: 0.5 }],
    ["unavailable reason codes", { status: "UNAVAILABLE", reasonCodes: ["OTHER"] }],
    ["unavailable reason", { status: "UNAVAILABLE", reason: "Maybe watch" }],
    ["unavailable without review", { status: "UNAVAILABLE", humanReviewRequired: false }],
    ["unavailable blank failure", { status: "UNAVAILABLE", failureCode: "   " }],
  ])("rejects inconsistent AI state: %s", (_label, overrides) => {
    const base = {
      requestId: "00000000-0000-4000-8000-000000000034",
      decisionCaseId: "00000000-0000-4000-8000-000000000035",
      status: "AVAILABLE",
      provider: "openai",
      model: "gpt-5-mini",
      promptVersion: "shop-health.v1",
      policyVersion: "ai-policy.v1",
      recommendation: "WATCH",
      confidence: 0.7,
      reasonCodes: ["DATA_INCOMPLETE"],
      reason: "Delivery history is incomplete.",
      humanReviewRequired: true,
      failureCode: null,
    };

    expect(AiDecisionInputSchema.safeParse({ ...base, ...overrides }).success).toBe(false);
  });

  it("requires UUID request IDs for separate BA recording", () => {
    expect(
      RecordBaDecisionForCaseInputSchema.safeParse({
        requestId: "ba-retry",
        decisionCaseId: "00000000-0000-4000-8000-000000000040",
        baDecision: {
          decision: "PAUSE",
          reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only the safe dry-run execution literals", () => {
    const input = {
      requestId: "00000000-0000-4000-8000-000000000050",
      decisionCaseId: "00000000-0000-4000-8000-000000000051",
      baDecisionId: "00000000-0000-4000-8000-000000000052",
      requestedAction: "HOLIDAY_MODE_ON",
      executionMode: "DRY_RUN",
    } as const;

    expect(RecordDryRunExecutionInputSchema.parse(input)).toEqual(input);
    expect(
      DryRunExecutionSchema.parse({
        ...input,
        executionStatus: "SIMULATED",
        sellerCenterCalled: false,
      }).sellerCenterCalled,
    ).toBe(false);
    expect(
      RecordDryRunExecutionInputSchema.safeParse({ ...input, executionMode: "LIVE" }).success,
    ).toBe(false);
    expect(
      DryRunExecutionSchema.safeParse({ ...input, executionStatus: "SUCCEEDED", sellerCenterCalled: true })
        .success,
    ).toBe(false);
  });
});
