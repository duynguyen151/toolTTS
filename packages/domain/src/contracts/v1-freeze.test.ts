import { describe, expect, it } from "vitest";

import {
  BaReviewCommandSchema,
  ReviewQueueReasonSchema,
  ShopHealthSnapshotSchema,
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
});
