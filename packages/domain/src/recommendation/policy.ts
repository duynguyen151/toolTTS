import { z } from "zod";

const ScoreComponentPolicySchema = z.object({
  weight: z.number().positive(),
  direction: z.enum(["HIGH_IS_GOOD", "LOW_IS_GOOD"]),
  good: z.number().min(0).max(1),
  critical: z.number().min(0).max(1),
});

export const ScorePolicySchema = z.object({
  version: z.string().min(1),
  minimumReliableOrders: z.number().int().positive(),
  minimumScaleOrders: z.number().int().positive(),
  scaleMinimumScore: z.number().min(0).max(100),
  continueMinimumScore: z.number().min(0).max(100),
  pauseBelowScore: z.number().min(0).max(100),
  scaleMinimumConfidence: z.number().min(0).max(1),
  scaleMinimumGrowth: z.number(),
  scaleMinimumSettlementRate: z.number().min(0).max(1),
  badTrendDelta: z.number().min(0).max(1),
  components: z.object({
    deliveryRate: ScoreComponentPolicySchema,
    cancellationRate: ScoreComponentPolicySchema,
    refundRate: ScoreComponentPolicySchema,
    onHoldOrderRate: ScoreComponentPolicySchema,
    onHoldMoneyRate: ScoreComponentPolicySchema,
    settlementRate: ScoreComponentPolicySchema,
  }),
});

export type ScorePolicy = z.infer<typeof ScorePolicySchema>;

export const SCORE_POLICY_V1: ScorePolicy = {
  version: "score-policy.v1",
  minimumReliableOrders: 20,
  minimumScaleOrders: 30,
  scaleMinimumScore: 85,
  continueMinimumScore: 70,
  pauseBelowScore: 40,
  scaleMinimumConfidence: 0.9,
  scaleMinimumGrowth: 0.1,
  scaleMinimumSettlementRate: 0.9,
  badTrendDelta: 0.03,
  components: {
    deliveryRate: {
      weight: 25,
      direction: "HIGH_IS_GOOD",
      good: 0.97,
      critical: 0.85,
    },
    cancellationRate: {
      weight: 20,
      direction: "LOW_IS_GOOD",
      good: 0.02,
      critical: 0.1,
    },
    refundRate: {
      weight: 20,
      direction: "LOW_IS_GOOD",
      good: 0.03,
      critical: 0.12,
    },
    onHoldOrderRate: {
      weight: 15,
      direction: "LOW_IS_GOOD",
      good: 0.03,
      critical: 0.15,
    },
    onHoldMoneyRate: {
      weight: 10,
      direction: "LOW_IS_GOOD",
      good: 0.03,
      critical: 0.2,
    },
    settlementRate: {
      weight: 10,
      direction: "HIGH_IS_GOOD",
      good: 0.95,
      critical: 0.7,
    },
  },
};
