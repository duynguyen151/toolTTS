import { describe, expect, test } from "vitest";

import {
  normalizeRiskFacts,
  resolveFullHistoryPeriod,
  toAiPersistenceInput,
} from "./review-workflow.js";

const provenance = {
  provider: "opencode-zen" as const,
  model: "deepseek-v4-flash-free",
  promptVersion: "baseline-ai-prompt.v1" as const,
  policyVersion: "risk-control-policy.v1",
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
        decision: "WATCH",
        confidence: 0.82,
        reasonCodes: ["DATA_INCOMPLETE"],
        reason: "More persisted history is required.",
        humanReviewRequired: true,
        ...provenance,
      },
    )).toEqual({
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      decisionCaseId: "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      status: "AVAILABLE",
      recommendation: "WATCH",
      confidence: 0.82,
      reasonCodes: ["DATA_INCOMPLETE"],
      reason: "More persisted history is required.",
      humanReviewRequired: true,
      failureCode: null,
      provider: "opencode-zen",
      model: "deepseek-v4-flash-free",
      promptVersion: "baseline-ai-prompt.v1",
      policyVersion: "risk-control-policy.v1",
    });
  });

  test("maps unavailable AI provenance without fabricating a recommendation", () => {
    expect(toAiPersistenceInput(
      "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      {
        status: "UNAVAILABLE",
        errorCode: "MISSING_API_KEY",
        humanReviewRequired: true,
        ...provenance,
      },
    )).toMatchObject({
      status: "UNAVAILABLE",
      recommendation: null,
      confidence: null,
      reasonCodes: null,
      reason: null,
      failureCode: "MISSING_API_KEY",
      humanReviewRequired: true,
    });
  });
});
