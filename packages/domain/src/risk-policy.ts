import { Decimal } from "decimal.js";
import { z } from "zod";

import {
  CurrencyCodeSchema,
  NonNegativeDecimalStringSchema,
} from "./contracts/common.js";
import {
  RiskControlPolicySchema,
  type RiskControlPolicy,
} from "./risk-control.js";

// Caution is an explicit per-metric state. There is deliberately no bare
// caution number anywhere in these contracts: nothing may imply an invented
// near-threshold warning value.
export const MetricCautionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("DISABLED") }).strict(),
  z
    .object({
      mode: z.literal("ABSOLUTE_BUFFER"),
      buffer: NonNegativeDecimalStringSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("RELATIVE_RATIO"),
      ratio: z.number().finite().gt(0).lte(1),
    })
    .strict(),
]);
export type MetricCaution = z.infer<typeof MetricCautionSchema>;

export const RiskPolicyCautionSchema = z
  .object({
    onHoldValue: MetricCautionSchema,
    deliveryRate: MetricCautionSchema,
  })
  .strict();
export type RiskPolicyCaution = z.infer<typeof RiskPolicyCautionSchema>;

const RISK_THRESHOLD_KEYS = [
  "stopOnHoldValueAt",
  "stopDeliveryRateBelow",
  "minimumOrdersForRateRule",
  "resumeOnHoldValueBelow",
  "resumeDeliveryRateAt",
  "stableCyclesBeforeResume",
] as const;

export const RiskThresholdKeySchema = z.enum(RISK_THRESHOLD_KEYS);
export type RiskThresholdKey = z.infer<typeof RiskThresholdKeySchema>;

const RiskThresholdShape = {
  stopOnHoldValueAt: NonNegativeDecimalStringSchema,
  stopDeliveryRateBelow: z.number().min(0).max(1),
  minimumOrdersForRateRule: z.number().int().nonnegative(),
  resumeOnHoldValueBelow: NonNegativeDecimalStringSchema,
  resumeDeliveryRateAt: z.number().min(0).max(1),
  stableCyclesBeforeResume: z.number().int().positive(),
};

export const RiskThresholdsSchema = z
  .object(RiskThresholdShape)
  .strict()
  .superRefine((thresholds, context) => {
    if (thresholds.resumeDeliveryRateAt < thresholds.stopDeliveryRateBelow) {
      context.addIssue({
        code: "custom",
        path: ["resumeDeliveryRateAt"],
        message: "Resume delivery rate cannot be below the stop threshold",
      });
    }
    if (
      new Decimal(thresholds.resumeOnHoldValueBelow).greaterThan(
        thresholds.stopOnHoldValueAt,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["resumeOnHoldValueBelow"],
        message: "Resume Onhold Value cannot exceed the stop threshold",
      });
    }
  });
export type RiskThresholds = z.infer<typeof RiskThresholdsSchema>;

const PartialRiskThresholdsSchema = z
  .object({
    stopOnHoldValueAt: NonNegativeDecimalStringSchema.optional(),
    stopDeliveryRateBelow: z.number().min(0).max(1).optional(),
    minimumOrdersForRateRule: z.number().int().nonnegative().optional(),
    resumeOnHoldValueBelow: NonNegativeDecimalStringSchema.optional(),
    resumeDeliveryRateAt: z.number().min(0).max(1).optional(),
    stableCyclesBeforeResume: z.number().int().positive().optional(),
  })
  .strict();

/** Complete GLOBAL policy state; each revision fully replaces the previous one. */
export const GlobalRiskPolicyRevisionSchema = z
  .object({
    revisionId: z.string().trim().min(1),
    version: z.string().trim().min(1),
    currency: CurrencyCodeSchema,
    thresholds: RiskThresholdsSchema,
    caution: RiskPolicyCautionSchema,
    effectiveFrom: z.date(),
  })
  .strict();
export type GlobalRiskPolicyRevision = z.infer<
  typeof GlobalRiskPolicyRevisionSchema
>;

/**
 * PARTIAL SHOP override: only provided values replace the effective GLOBAL
 * revision; everything else inherits.
 */
export const ShopRiskPolicyOverrideRevisionSchema = z
  .object({
    revisionId: z.string().trim().min(1),
    shopId: z.string().trim().min(1),
    thresholds: PartialRiskThresholdsSchema,
    caution: z
      .object({
        onHoldValue: MetricCautionSchema.optional(),
        deliveryRate: MetricCautionSchema.optional(),
      })
      .strict(),
    effectiveFrom: z.date(),
  })
  .strict();
export type ShopRiskPolicyOverrideRevision = z.infer<
  typeof ShopRiskPolicyOverrideRevisionSchema
>;

export const RiskPolicyValueSourceSchema = z.enum(["GLOBAL", "SHOP"]);
export type RiskPolicyValueSource = z.infer<typeof RiskPolicyValueSourceSchema>;

const ThresholdSourcesSchema = z.object({
  stopOnHoldValueAt: RiskPolicyValueSourceSchema,
  stopDeliveryRateBelow: RiskPolicyValueSourceSchema,
  minimumOrdersForRateRule: RiskPolicyValueSourceSchema,
  resumeOnHoldValueBelow: RiskPolicyValueSourceSchema,
  resumeDeliveryRateAt: RiskPolicyValueSourceSchema,
  stableCyclesBeforeResume: RiskPolicyValueSourceSchema,
});

export const ResolvedRiskPolicySchema = z
  .object({
    policyVersion: z.string().min(1),
    currency: CurrencyCodeSchema,
    effectiveAt: z.string().datetime(),
    thresholds: RiskThresholdsSchema,
    caution: RiskPolicyCautionSchema,
    globalRevisionId: z.string().min(1),
    shopOverrideRevisionId: z.string().min(1).nullable(),
    sources: z
      .object({
        thresholds: ThresholdSourcesSchema.strict(),
        caution: z
          .object({
            onHoldValue: RiskPolicyValueSourceSchema,
            deliveryRate: RiskPolicyValueSourceSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type ResolvedRiskPolicy = z.infer<typeof ResolvedRiskPolicySchema>;

// Exact resolver output retained on historical Decision Cases.
export const ResolvedRiskPolicySnapshotSchema = ResolvedRiskPolicySchema;
export type ResolvedRiskPolicySnapshot = z.infer<
  typeof ResolvedRiskPolicySnapshotSchema
>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as object)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// The published BA defaults from RISK_CONTROL_POLICY_V1 expressed as the seed
// GLOBAL revision, so resolution can always emit the existing defaults before
// any persisted revision takes effect.
export const INITIAL_GLOBAL_RISK_POLICY_REVISION: GlobalRiskPolicyRevision =
  deepFreeze(
    GlobalRiskPolicyRevisionSchema.parse({
      revisionId: "risk-policy-global-initial-v1",
      version: "risk-control-policy.v1",
      currency: "USD",
      thresholds: {
        stopOnHoldValueAt: "3500.0000",
        stopDeliveryRateBelow: 0.7,
        minimumOrdersForRateRule: 0,
        resumeOnHoldValueBelow: "3500.0000",
        resumeDeliveryRateAt: 0.7,
        stableCyclesBeforeResume: 1,
      },
      caution: {
        onHoldValue: { mode: "DISABLED" },
        deliveryRate: { mode: "DISABLED" },
      },
      effectiveFrom: new Date(0),
    }),
  );

export interface ResolveRiskPolicyInput {
  readonly globalRevisions?: readonly GlobalRiskPolicyRevision[];
  readonly shopOverrides?: readonly ShopRiskPolicyOverrideRevision[];
  readonly shopId?: string;
  readonly effectiveAt: Date;
}

const EffectiveDateSchema = z.date().refine((value) => !Number.isNaN(value.getTime()), {
  message: "effectiveAt must be a valid Date",
});
const ShopIdSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), {
    message: "shopId must not include surrounding whitespace",
  });

/**
 * Latest revision with effectiveFrom <= effectiveAt wins; later array
 * position wins equal timestamps so ties stay deterministic. Revisions are
 * complete per-scope states: they never merge across revisions of one scope.
 */
function selectEffective<T extends { readonly effectiveFrom: Date }>(
  revisions: readonly T[],
  effectiveAt: Date,
): T | null {
  let selected: T | null = null;
  let selectedFrom = Number.NEGATIVE_INFINITY;
  for (const revision of revisions) {
    const from = revision.effectiveFrom.getTime();
    if (from <= effectiveAt.getTime() && from >= selectedFrom) {
      selected = revision;
      selectedFrom = from;
    }
  }
  return selected;
}

export function resolveEffectiveRiskPolicy(
  input: ResolveRiskPolicyInput,
): ResolvedRiskPolicy {
  const effectiveAt = EffectiveDateSchema.parse(input.effectiveAt);
  const shopId =
    input.shopId === undefined ? undefined : ShopIdSchema.parse(input.shopId);
  const globals = (input.globalRevisions ?? []).map((revision) =>
    GlobalRiskPolicyRevisionSchema.parse(revision),
  );
  const globalWinner =
    selectEffective(globals, effectiveAt) ??
    GlobalRiskPolicyRevisionSchema.parse(INITIAL_GLOBAL_RISK_POLICY_REVISION);

  let shopWinner: ShopRiskPolicyOverrideRevision | null = null;
  if (input.shopOverrides !== undefined && input.shopOverrides.length > 0) {
    const candidates = input.shopOverrides
      .map((revision) => ShopRiskPolicyOverrideRevisionSchema.parse(revision))
      .filter((revision) => revision.shopId === shopId);
    shopWinner = selectEffective(candidates, effectiveAt);
  }

  const mergedThresholds: RiskThresholds = { ...globalWinner.thresholds };
  const thresholdSources: Record<RiskThresholdKey, RiskPolicyValueSource> = {
    stopOnHoldValueAt: "GLOBAL",
    stopDeliveryRateBelow: "GLOBAL",
    minimumOrdersForRateRule: "GLOBAL",
    resumeOnHoldValueBelow: "GLOBAL",
    resumeDeliveryRateAt: "GLOBAL",
    stableCyclesBeforeResume: "GLOBAL",
  };
  if (shopWinner !== null) {
    for (const key of RISK_THRESHOLD_KEYS) {
      const value: number | string | undefined = shopWinner.thresholds[key];
      if (value !== undefined) {
        Object.assign(mergedThresholds, { [key]: value });
        thresholdSources[key] = "SHOP";
      }
    }
  }
  // Re-validate the merged state so a partial override cannot break the
  // stop/resume invariants of the combined policy.
  const thresholds = RiskThresholdsSchema.parse(mergedThresholds);

  const caution: RiskPolicyCaution = { ...globalWinner.caution };
  const cautionSources: Record<
    "onHoldValue" | "deliveryRate",
    RiskPolicyValueSource
  > = { onHoldValue: "GLOBAL", deliveryRate: "GLOBAL" };
  if (shopWinner !== null && shopWinner.caution.onHoldValue !== undefined) {
    caution.onHoldValue = shopWinner.caution.onHoldValue;
    cautionSources.onHoldValue = "SHOP";
  }
  if (shopWinner !== null && shopWinner.caution.deliveryRate !== undefined) {
    caution.deliveryRate = shopWinner.caution.deliveryRate;
    cautionSources.deliveryRate = "SHOP";
  }

  return deepFreeze(
    ResolvedRiskPolicySchema.parse({
      policyVersion: globalWinner.version,
      currency: globalWinner.currency,
      effectiveAt: effectiveAt.toISOString(),
      thresholds,
      caution,
      globalRevisionId: globalWinner.revisionId,
      shopOverrideRevisionId: shopWinner?.revisionId ?? null,
      sources: { thresholds: thresholdSources, caution: cautionSources },
    }),
  );
}

/** Flatten a resolved policy into the existing risk-control evaluator contract. */
export function toRiskControlPolicy(
  resolvedPolicy: ResolvedRiskPolicy,
): RiskControlPolicy {
  const resolved = ResolvedRiskPolicySchema.parse(resolvedPolicy);
  return RiskControlPolicySchema.parse({
    version: resolved.policyVersion,
    currency: resolved.currency,
    ...resolved.thresholds,
  });
}
