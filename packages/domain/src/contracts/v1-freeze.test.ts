import { describe, expect, it } from "vitest";

import {
  AiDecisionContextSchema,
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
