import { describe, expect, test } from "vitest";

import type { DecisionReviewView } from "@shop-health/decision-workflow";

import { formatDecisionHistory, formatDecisionReview } from "./review.js";

const view: DecisionReviewView = {
  schemaVersion: "decision-review.v1",
  case: {
    id: "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
    origin: "DEMO_SANITIZED",
    observedAt: "2026-08-14T01:00:00.000Z",
    createdAt: "2026-08-14T01:00:01.000Z",
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
    totalOrders: { status: "AVAILABLE", value: 12 },
    onHoldValue: { status: "UNAVAILABLE", reason: "UNKNOWN_ORDER_STATUS" },
    deliveredCount: { status: "UNAVAILABLE", reason: "UNKNOWN_ORDER_STATUS" },
    deliveryRate: { status: "UNAVAILABLE", reason: "UNKNOWN_ORDER_STATUS" },
    cancellationRate: { status: "UNAVAILABLE", reason: "NOT_CAPTURED" },
    refundRate: { status: "UNAVAILABLE", reason: "NOT_CAPTURED" },
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
    createdAt: "2026-08-14T01:00:02.000Z",
  },
  ba: { status: "NOT_DECIDED" },
  execution: { status: "NOT_REQUESTED" },
  events: [{ type: "CASE_STARTED", occurredAt: "2026-08-14T01:00:01.000Z" }],
};

describe("decision review human presentation", () => {
  test("renders the required sections in order without replacing unavailable metrics with zero", () => {
    const output = formatDecisionReview(view, "Asia/Bangkok");
    const sections = ["SHOP", "METRICS", "RULE", "AI", "BA", "EXECUTION", "HISTORY"];

    expect(sections.map((section) => output.indexOf(`${section}\n`))).toEqual(
      [...sections].map((_, index, values) => expect.any(Number)),
    );
    for (let index = 1; index < sections.length; index += 1) {
      expect(output.indexOf(`${sections[index - 1]}\n`)).toBeLessThan(
        output.indexOf(`${sections[index]}\n`),
      );
    }
    expect(output).toContain("Onhold Value: UNAVAILABLE (UNKNOWN_ORDER_STATUS)");
    expect(output).not.toContain("Onhold Value: 0");
  });

  test("shows AI, BA, and execution states independently", () => {
    const output = formatDecisionReview(view, "Asia/Bangkok");

    expect(output).toContain("Availability: UNAVAILABLE");
    expect(output).toContain("Failure Code: NOT_CONFIGURED");
    expect(output).toContain("Status: NOT_DECIDED");
    expect(output).toContain("Status: NOT_REQUESTED");
  });

  test("renders history as a top-level section while preserving separate decision actors", () => {
    const output = formatDecisionHistory({
      schemaVersion: "decision-history.v1",
      items: [view],
      nextCursor: null,
    }, "Asia/Bangkok");

    expect(output.startsWith("HISTORY\n")).toBe(true);
    expect(output).toContain("RULE\n");
    expect(output).toContain("AI\n");
    expect(output).toContain("BA\n");
    expect(output).toContain("EXECUTION\n");
    expect(output).toContain("Origin: DEMO_SANITIZED");
  });

  test("renders SLOW_SELL methods and notes in current and history output", () => {
    const decided = {
      ...view,
      ba: {
        status: "DECIDED" as const,
        decision: "SLOW_SELL" as const,
        confidence: null,
        reasonCodes: ["LOW_DELIVERY_RATE" as const],
        plannedMethods: ["DISABLE_FLASH_SALE" as const, "OTHER" as const],
        note: "Operator review: use a safer fallback.",
        decidedAt: "2026-08-14T01:00:03.000Z",
      },
    };
    const output = formatDecisionReview(decided, "Asia/Bangkok");
    const history = formatDecisionHistory({
      schemaVersion: "decision-history.v1",
      items: [decided],
      nextCursor: null,
    }, "Asia/Bangkok");

    for (const rendered of [output, history]) {
      expect(rendered).toContain("Decision: SLOW_SELL");
      expect(rendered).toContain("Planned Methods: DISABLE_FLASH_SALE, OTHER");
      expect(rendered).toContain("Note: Operator review: use a safer fallback.");
    }
  });
});
