import { describe, expect, test } from "vitest";

import {
  normalizeRiskFacts,
  resolveFullHistoryPeriod,
  toAiPersistenceInput,
} from "./review-workflow.js";

const provenance = {
  provider: "9router" as const,
  requestedModel: "oc/deepseek-v4-flash-free",
  reportedModel: "deepseek-v4-flash-free",
  actualModelUsed: "deepseek-v4-flash-free",
  authMode: "LOCAL_NO_AUTH" as const,
  outputSchemaVersion: "decision-ai-output.v1" as const,
  promptVersion: "decision-ai-prompt.v2" as const,
  aiPolicyVersion: "decision-ai-policy.v1" as const,
  rulePolicyVersion: "risk-control-policy.v1",
  generatedAt: "2026-08-14T08:30:00.000Z",
};

describe("review workflow DB mapping", () => {
  test("uses the earliest persisted fact even when it predates shop creation", () => {
    const periodEnd = new Date("2026-08-14T08:30:00.000Z");
    const period = resolveFullHistoryPeriod([
      {
        canonicalStatus: "DELIVERED",
        currency: "USD",
        orderCount: 2,
        totalValue: "10.0000",
        firstObservedAt: new Date("2026-07-01T00:00:00.000Z"),
        lastObservedAt: new Date("2026-08-13T00:00:00.000Z"),
      },
      {
        canonicalStatus: "AWAITING_SHIPMENT",
        currency: "USD",
        orderCount: 1,
        totalValue: "5.0000",
        firstObservedAt: new Date("2026-08-01T00:00:00.000Z"),
        lastObservedAt: new Date("2026-08-12T00:00:00.000Z"),
      },
    ], periodEnd);

    expect(period).toEqual({
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd,
    });
  });

  test("uses a deterministic zero-length period for empty persisted history", () => {
    const periodEnd = new Date("2026-08-14T08:30:00.000Z");

    expect(resolveFullHistoryPeriod([], periodEnd)).toEqual({
      periodStart: periodEnd,
      periodEnd,
    });
  });

  test("normalizes PostgreSQL aggregate timestamps before domain evaluation", () => {
    const facts = normalizeRiskFacts([{
      canonicalStatus: "DELIVERED",
      currency: "USD",
      orderCount: 2,
      totalValue: "10.0000",
      firstObservedAt: "2026-08-01T08:30:00.000Z" as unknown as Date,
      lastObservedAt: "2026-08-14T08:30:00.000Z" as unknown as Date,
    }]);

    expect(facts[0]?.firstObservedAt).toEqual(new Date("2026-08-01T08:30:00.000Z"));
    expect(facts[0]?.lastObservedAt).toEqual(new Date("2026-08-14T08:30:00.000Z"));
  });

  test("maps an available AI decision without mixing it into the rule or BA fields", () => {
    expect(toAiPersistenceInput(
      "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      {
        status: "AVAILABLE",
        recommendation: "WATCH",
        riskLevel: "MEDIUM",
        confidence: 0.82,
        ruleResult: "CONTINUE",
        ruleOverride: true,
        reasonCodes: ["DATA_INCOMPLETE"],
        supportingFactors: ["Delivery remains above threshold."],
        riskFactors: ["Coverage is incomplete."],
        whatWouldChangeDecision: ["Verified complete coverage."],
        reason: "More persisted history is required.",
        humanReviewRequired: true,
        ...provenance,
      },
    )).toEqual({
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      decisionCaseId: "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      status: "AVAILABLE",
      model: "deepseek-v4-flash-free",
      recommendation: "WATCH",
      riskLevel: "MEDIUM",
      confidence: 0.82,
      ruleOverride: true,
      reasonCodes: ["DATA_INCOMPLETE"],
      supportingFactors: ["Delivery remains above threshold."],
      riskFactors: ["Coverage is incomplete."],
      whatWouldChangeDecision: ["Verified complete coverage."],
      reason: "More persisted history is required.",
      humanReviewRequired: true,
      failureCode: null,
      provider: "9router",
      requestedModel: "oc/deepseek-v4-flash-free",
      reportedModel: "deepseek-v4-flash-free",
      actualModelUsed: "deepseek-v4-flash-free",
      authMode: "LOCAL_NO_AUTH",
      outputSchemaVersion: "decision-ai-output.v1",
      promptVersion: "decision-ai-prompt.v2",
      policyVersion: "risk-control-policy.v1",
      aiPolicyVersion: "decision-ai-policy.v1",
    });
  });

  test("maps unavailable AI provenance without fabricating a recommendation", () => {
    expect(toAiPersistenceInput(
      "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      {
        status: "UNAVAILABLE",
        errorCode: "CONFIG_MISSING",
        humanReviewRequired: true,
        ...provenance,
        reportedModel: null,
        actualModelUsed: null,
        authMode: "CONFIG_MISSING",
      },
    )).toMatchObject({
      status: "UNAVAILABLE",
      model: null,
      recommendation: null,
      riskLevel: null,
      confidence: null,
      ruleOverride: null,
      reasonCodes: null,
      supportingFactors: null,
      riskFactors: null,
      whatWouldChangeDecision: null,
      reason: null,
      failureCode: "CONFIG_MISSING",
      humanReviewRequired: true,
    });
  });
});
