import { describe, expect, it } from "vitest";

import {
  AiDecisionContextSchema,
  BaDecisionRevisionSchema,
  BaReviewCommandSchema,
  MetricComparisonSchema,
  ReviewQueueReasonSchema,
  ShopHealthSnapshotSchema,
  TrendSignalSchema,
} from "./v1-freeze.js";

describe("V1 shared contracts", () => {
  it("keeps BA submission rules and review reasons explicit", () => {
    expect(BaReviewCommandSchema.safeParse({
      decision: "WATCH",
      reasonCode: "DATA_INCOMPLETE",
    }).success).toBe(true);
    expect(BaReviewCommandSchema.safeParse({
      decision: "PAUSE",
      reasonCode: "OTHER",
    }).success).toBe(false);
    expect(ReviewQueueReasonSchema.parse("RULE_AI_DISAGREEMENT")).toBe(
      "RULE_AI_DISAGREEMENT",
    );
  });

  it("round-trips SLOW_SELL planned methods in BA revisions", () => {
    expect(BaDecisionRevisionSchema.parse({
      id: "00000000-0000-4000-8000-000000000010",
      decisionCaseId: "00000000-0000-4000-8000-000000000011",
      decision: "SLOW_SELL",
      reasonCode: "LOW_DELIVERY_RATE",
      reasonCodes: ["LOW_DELIVERY_RATE"],
      plannedMethods: ["DISABLE_FLASH_SALE", "INCREASE_PRICE"],
      notes: null,
      actor: "test-ba",
      decidedAt: "2026-08-14T00:00:00.000Z",
    }).plannedMethods).toEqual(["DISABLE_FLASH_SALE", "INCREASE_PRICE"]);
  });

  it("keeps old BA revisions valid with null planned methods", () => {
    expect(BaDecisionRevisionSchema.parse({
      id: "00000000-0000-4000-8000-000000000012",
      decisionCaseId: "00000000-0000-4000-8000-000000000011",
      decision: "WATCH",
      reasonCode: "DATA_INCOMPLETE",
      reasonCodes: ["DATA_INCOMPLETE"],
      notes: null,
      actor: "LEGACY_UNATTRIBUTED",
      decidedAt: "2026-08-14T00:00:00.000Z",
    }).plannedMethods).toBeNull();
  });

  it("keeps dashboard snapshot decision layers separate", () => {
    expect(ShopHealthSnapshotSchema.shape).toMatchObject({
      profile: expect.anything(),
      shop: expect.anything(),
      dataQuality: expect.anything(),
      metrics: expect.anything(),
      trends: expect.anything(),
      rule: expect.anything(),
      ai: expect.anything(),
      currentBaDecision: expect.anything(),
      baHistory: expect.anything(),
      execution: expect.anything(),
    });
  });

  it("keeps operational exposure separate from official Finance On Hold", () => {
    expect(MetricComparisonSchema.parse({
      metric: "operationalExposure",
      current: "125.0000",
      previous: "100.0000",
      absoluteDelta: "25.0000",
      relativeDelta: 0.25,
      direction: "INCREASED",
      currency: "USD",
    })).toMatchObject({ metric: "operationalExposure", relativeDelta: 0.25 });

    expect(TrendSignalSchema.parse({
      signal: "RAPID_ONHOLD_GROWTH",
      comparisons: [],
      status: "NOT_EVALUATED",
      reasonCode: "POLICY_UNCONFIGURED",
    }).status).toBe("NOT_EVALUATED");
  });

  it("requires the AI context to retain deterministic audit inputs", () => {
    expect(AiDecisionContextSchema.shape).toMatchObject({
      schemaVersion: expect.anything(),
      profile: expect.anything(),
      shop: expect.anything(),
      metrics: expect.anything(),
      comparisons: expect.anything(),
      trends: expect.anything(),
      rule: expect.anything(),
      dataQuality: expect.anything(),
      previousCompatibleSnapshot: expect.anything(),
      policyVersions: expect.anything(),
    });
  });
});
