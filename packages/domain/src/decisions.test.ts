import { describe, expect, it } from "vitest";

import {
  AiDecisionInputSchema,
  BaDecisionInputSchema,
  BaDecisionSchema,
  BaPlannedMethodSchema,
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
    officialOnHoldAmount: "1200.0000",
    settlementCount: 40,
    onHoldSettlementCount: 6,
  },
  coverageSnapshot: {
    coverageState: "COMPLETE" as const,
    persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
    provenSourceWindow: "ROLLING_12_MONTHS" as const,
    completeWithinSourceWindow: true,
    lifetimeHistoryComplete: false,
  },
  ruleDecision: "CONTINUE" as const,
  ruleTriggers: [] as const,
  dataCoverage: "COMPLETE" as const,
  sourceSyncRunId: null,
};

describe("decision contracts", () => {
  it("accepts the singular BA reasonCode and requires notes for OTHER", () => {
    expect(BaDecisionInputSchema.safeParse({
      decision: "WATCH",
      reasonCode: "DATA_INCOMPLETE",
      notes: "Coverage is incomplete",
    }).success).toBe(true);
    expect(BaDecisionInputSchema.safeParse({
      decision: "WATCH",
      reasonCode: "OTHER",
    }).success).toBe(false);
    expect(BaDecisionInputSchema.safeParse({
      decision: "WATCH",
      reasonCodes: ["DATA_INCOMPLETE"],
    }).success).toBe(false);
  });

  it.each(["SCALE", "CONTINUE", "WATCH", "PAUSE", "SLOW_SELL"] as const)(
    "accepts the BA decision %s",
    (decision) => {
      expect(BaDecisionSchema.parse(decision)).toBe(decision);
    },
  );

  it.each(["DISABLE_FLASH_SALE", "INCREASE_PRICE", "OTHER"] as const)(
    "accepts the planned method %s",
    (method) => {
      expect(BaPlannedMethodSchema.parse(method)).toBe(method);
    },
  );

  it("accepts multiple unique planned methods for SLOW_SELL", () => {
    expect(BaDecisionInputSchema.parse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      plannedMethods: ["DISABLE_FLASH_SALE", "INCREASE_PRICE"],
    }).plannedMethods).toEqual(["DISABLE_FLASH_SALE", "INCREASE_PRICE"]);
  });

  it("rejects missing, duplicate, or unknown SLOW_SELL planned methods", () => {
    expect(BaDecisionInputSchema.safeParse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
    }).success).toBe(false);
    expect(BaDecisionInputSchema.safeParse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      plannedMethods: ["INCREASE_PRICE", "INCREASE_PRICE"],
    }).success).toBe(false);
    expect(BaDecisionInputSchema.safeParse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      plannedMethods: ["UNKNOWN"],
    }).success).toBe(false);
  });

  it("requires meaningful notes when the planned method is OTHER", () => {
    expect(BaDecisionInputSchema.safeParse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      plannedMethods: ["OTHER"],
    }).success).toBe(false);
    expect(BaDecisionInputSchema.safeParse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      plannedMethods: ["OTHER"],
      notes: "   ",
    }).success).toBe(false);
    expect(BaDecisionInputSchema.safeParse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      plannedMethods: ["OTHER"],
      notes: "\t\n\u0001\u200b\ufeff",
    }).success).toBe(false);
    expect(BaDecisionInputSchema.parse({
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      plannedMethods: ["OTHER", "DISABLE_FLASH_SALE"],
      notes: "  Review another operator-led option.  ",
    })).toMatchObject({
      plannedMethods: ["OTHER", "DISABLE_FLASH_SALE"],
      notes: "Review another operator-led option.",
    });
  });

  it.each(["SCALE", "CONTINUE", "WATCH", "PAUSE"] as const)(
    "rejects planned methods for non-SLOW_SELL decision %s",
    (decision) => {
      expect(BaDecisionInputSchema.safeParse({
        decision,
        reasonCode: "LOW_DELIVERY_RATE",
        plannedMethods: ["INCREASE_PRICE"],
      }).success).toBe(false);
    },
  );

  it("accepts a complete decision case and BA submission", () => {
    const result = CaptureBaDecisionInputSchema.parse({
      decisionCase: validCase,
      baDecision: {
        decision: "WATCH",
        reasonCode: "HIGH_ABSOLUTE_EXPOSURE",
        confidence: 0.75,
        reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE", "RECOVERY_TREND"],
        note: "  Monitor the next settlement cycle.  ",
      },
    });

    expect(result.decisionCase.sourceSyncRunId).toBeNull();
    expect(result.baDecision.note).toBe("Monitor the next settlement cycle.");
  });

  it("requires explicit rolling-window proof to deny lifetime completeness", () => {
    expect(DecisionCaseInputSchema.safeParse({
      ...validCase,
      coverageSnapshot: {
        ...validCase.coverageSnapshot,
        provenSourceWindow: "ROLLING_12_MONTHS",
        completeWithinSourceWindow: true,
        lifetimeHistoryComplete: true,
      },
    }).success).toBe(false);
  });

  it("does not allow FRESH coverage without complete reconciled source facts", () => {
    expect(DecisionCaseInputSchema.safeParse({
      ...validCase,
      coverageSnapshot: {
        ...validCase.coverageSnapshot,
        freshness: "FRESH",
        ordersSourceComplete: false,
        financeRequiredSourceComplete: true,
        sourceReconciled: true,
        latestSuccessfulSyncAt: "2026-08-14T00:00:00.000Z",
        financeCapturedAt: "2026-08-14T00:00:00.000Z",
      },
    }).success).toBe(false);
  });

  it("rejects FRESH coverage when required timestamps are omitted", () => {
    expect(DecisionCaseInputSchema.safeParse({
      ...validCase,
      coverageSnapshot: {
        ...validCase.coverageSnapshot,
        freshness: "FRESH",
        ordersSourceComplete: true,
        financeRequiredSourceComplete: true,
        sourceReconciled: true,
        latestSuccessfulSyncAt: undefined,
        financeCapturedAt: "2026-08-14T00:00:00.000Z",
      },
    }).success).toBe(false);
  });

  it("accepts typed quality, explicit order, and finance separation facts", () => {
    const parsed = DecisionCaseInputSchema.parse({
      ...validCase,
      metricsSnapshot: {
        ...validCase.metricsSnapshot,
        totalPersistedOrders: 120,
        operationalOrderCount: 100,
      },
      financeSnapshot: {
        ...validCase.financeSnapshot,
        waitingForPackageDeliveryAmount: "100.0000",
        deliveredAwaitingSettlementAmount: "1100.0000",
        waitingForCompletedRefundReturnAmount: "50.0000",
        reasonTotalsReconcileToOfficialOnHold: true,
      },
      coverageSnapshot: {
        ...validCase.coverageSnapshot,
        ordersSourceComplete: true,
        financeRequiredSourceComplete: true,
        sourceReconciled: true,
        latestSuccessfulSyncAt: "2026-08-14T00:00:00.000Z",
        financeCapturedAt: "2026-08-14T00:00:00.000Z",
        freshness: "FRESH",
      },
    });

    expect(parsed.metricsSnapshot.operationalOrderCount).toBe(100);
    expect(parsed.financeSnapshot.reasonTotalsReconcileToOfficialOnHold).toBe(true);
    expect(parsed.financeSnapshot.waitingForCompletedRefundReturnAmount).toBe("50.0000");
    expect(parsed.coverageSnapshot.freshness).toBe("FRESH");
  });

  it("preserves signed Finance reason amounts in a decision case", () => {
    const parsed = DecisionCaseInputSchema.parse({
      ...validCase,
      financeSnapshot: {
        ...validCase.financeSnapshot,
        waitingForPackageDeliveryAmount: "-0.4100",
      },
    });

    expect(parsed.financeSnapshot.waitingForPackageDeliveryAmount).toBe("-0.4100");
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
    ["coverage snapshot mismatch", {
      ...validCase,
      dataCoverage: "PARTIAL",
      coverageSnapshot: { ...validCase.coverageSnapshot, coverageState: "COMPLETE" },
    }],
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
        DecisionCaseInputSchema.parse({
          ...validCase,
          dataCoverage,
          coverageSnapshot: { ...validCase.coverageSnapshot, coverageState: dataCoverage },
        }).dataCoverage,
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
      provider: "9router",
      model: "deepseek-v4-flash-free",
      requestedModel: "oc/deepseek-v4-flash-free",
      reportedModel: "deepseek-v4-flash-free",
      actualModelUsed: "deepseek-v4-flash-free",
      authMode: "LOCAL_NO_AUTH",
      outputSchemaVersion: "decision-ai-output.v1",
      promptVersion: "decision-ai-prompt.v2",
      policyVersion: "risk-control-policy.v1",
      aiPolicyVersion: "decision-ai-policy.v1",
      recommendation: "WATCH",
      riskLevel: "MEDIUM",
      confidence: 0.7,
      ruleOverride: true,
      reasonCodes: ["DATA_INCOMPLETE"],
      supportingFactors: ["Delivery rate remains above the rule threshold."],
      riskFactors: ["Lifetime history is not complete."],
      whatWouldChangeDecision: ["Verified complete coverage with stable delivery."],
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
      provider: "9router",
      model: null,
      requestedModel: "oc/deepseek-v4-flash-free",
      reportedModel: null,
      actualModelUsed: null,
      authMode: "LOCAL_NO_AUTH",
      outputSchemaVersion: "decision-ai-output.v1",
      promptVersion: "decision-ai-prompt.v2",
      policyVersion: "risk-control-policy.v1",
      aiPolicyVersion: "decision-ai-policy.v1",
      recommendation: null,
      riskLevel: null,
      confidence: null,
      ruleOverride: null,
      reasonCodes: null,
      supportingFactors: null,
      riskFactors: null,
      whatWouldChangeDecision: null,
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
      provider: "9router",
      model: "deepseek-v4-flash-free",
      requestedModel: "oc/deepseek-v4-flash-free",
      reportedModel: "deepseek-v4-flash-free",
      actualModelUsed: "deepseek-v4-flash-free",
      authMode: "LOCAL_NO_AUTH",
      outputSchemaVersion: "decision-ai-output.v1",
      promptVersion: "decision-ai-prompt.v2",
      policyVersion: "risk-control-policy.v1",
      aiPolicyVersion: "decision-ai-policy.v1",
      recommendation: "WATCH",
      riskLevel: "MEDIUM",
      confidence: 0.7,
      ruleOverride: true,
      reasonCodes: ["DATA_INCOMPLETE"],
      supportingFactors: ["Delivery rate remains above the rule threshold."],
      riskFactors: ["Lifetime history is not complete."],
      whatWouldChangeDecision: ["Verified complete coverage with stable delivery."],
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
