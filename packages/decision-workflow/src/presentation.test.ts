import { describe, expect, test } from "vitest";

import {
  toDecisionHistoryPage,
  toDecisionReviewView,
  type PersistedDecisionReview,
} from "./index.js";

const review: PersistedDecisionReview = {
  case: {
    id: "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
    origin: "DEMO_SANITIZED",
    observedAt: new Date("2026-08-14T01:00:00.000Z"),
    createdAt: new Date("2026-08-14T01:00:01.000Z"),
  },
  shop: {
    id: "d91ef278-d9f0-4322-aaf9-f9683d6143e4",
    profileNo: "DEMO-001",
    displayName: "Sanitized Demo Shop",
    currency: "USD",
    dataOrigin: "DEMO_SANITIZED",
    dataCoverage: "UNKNOWN",
    lastSyncAt: null,
  },
  metrics: {
    totalOrders: 12,
    onHoldValue: null,
    deliveredCount: null,
    deliveryRate: null,
    cancellationRate: null,
    refundRate: null,
    currency: "USD",
    unavailableReasons: {
      onHoldValue: "UNKNOWN_ORDER_STATUS",
      deliveredCount: "UNKNOWN_ORDER_STATUS",
      deliveryRate: "UNKNOWN_ORDER_STATUS",
      cancellationRate: "NOT_CAPTURED",
      refundRate: "NOT_CAPTURED",
    },
  },
  rule: {
    decision: "INSUFFICIENT_DATA",
    triggers: [],
    expression: "VALUE >= 3500 USD OR DELIVERY_RATE < 70%",
    policyVersion: "risk-control-policy.v1",
    thresholds: {
      stopOnHoldValueAt: "3500.0000",
      stopDeliveryRateBelow: 0.7,
      minimumOrdersForRateRule: 0,
    },
  },
  ai: {
    status: "UNAVAILABLE",
    recommendation: null,
    riskLevel: null,
    confidence: null,
    ruleOverride: null,
    reasonCodes: null,
    supportingFactors: null,
    riskFactors: null,
    whatWouldChangeDecision: null,
    reason: null,
    failureCode: "NOT_CONFIGURED",
    humanReviewRequired: true,
    provider: "opencode-zen",
    model: "deepseek-v4-flash-free",
    requestedModel: null,
    reportedModel: null,
    actualModelUsed: null,
    authMode: null,
    outputSchemaVersion: null,
    promptVersion: "baseline-ai-prompt.v1",
    policyVersion: "risk-control-policy.v1",
    aiPolicyVersion: null,
    createdAt: new Date("2026-08-14T01:00:02.000Z"),
  },
  ba: null,
  execution: null,
  events: [
    {
      type: "CASE_STARTED",
      occurredAt: new Date("2026-08-14T01:00:01.000Z"),
    },
  ],
};

describe("decision presentation contracts", () => {
  test("does not turn unavailable metrics into zero", () => {
    const view = toDecisionReviewView(review);

    expect(view.schemaVersion).toBe("decision-review.v1");
    expect(view.metrics.totalOrders).toEqual({ status: "AVAILABLE", value: 12 });
    expect(view.metrics.onHoldValue).toEqual({
      status: "UNAVAILABLE",
      reason: "UNKNOWN_ORDER_STATUS",
    });
    expect(view.metrics.deliveredCount).toEqual({
      status: "UNAVAILABLE",
      reason: "UNKNOWN_ORDER_STATUS",
    });
    expect(view.metrics.deliveryRate).toEqual({
      status: "UNAVAILABLE",
      reason: "UNKNOWN_ORDER_STATUS",
    });
  });

  test("keeps rule, AI, BA, and execution as separate sections", () => {
    const view = toDecisionReviewView(review);

    expect(view.rule.decision).toBe("INSUFFICIENT_DATA");
    expect(view.ai).toMatchObject({ status: "UNAVAILABLE", failureCode: "NOT_CONFIGURED" });
    expect(view.ba).toEqual({ status: "NOT_DECIDED" });
    expect(view.execution).toEqual({ status: "NOT_REQUESTED" });
    expect(view.case.observedAt).toBe("2026-08-14T01:00:00.000Z");
    expect(view.events).toEqual([
      { type: "CASE_STARTED", occurredAt: "2026-08-14T01:00:01.000Z" },
    ]);
  });

  test("marks demo history explicitly and preserves the pagination cursor", () => {
    const page = toDecisionHistoryPage({ items: [review], nextCursor: "cursor-2" });

    expect(page.schemaVersion).toBe("decision-history.v1");
    expect(page.items[0]?.case.origin).toBe("DEMO_SANITIZED");
    expect(page.items[0]?.shop.dataOrigin).toBe("DEMO_SANITIZED");
    expect(page.nextCursor).toBe("cursor-2");
  });
});
