import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { DecisionCaseInputSchema } from "./decisions.js";
import {
  evaluateRiskControlFacts,
  RISK_CONTROL_POLICY_V1,
} from "./risk-control.js";
import {
  INITIAL_GLOBAL_RISK_POLICY_REVISION,
  MetricCautionSchema,
  ResolvedRiskPolicySnapshotSchema,
  GlobalRiskPolicyRevisionSchema,
  ShopRiskPolicyOverrideRevisionSchema,
  resolveEffectiveRiskPolicy,
  toRiskControlPolicy,
} from "./risk-policy.js";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const MAR_1 = new Date("2026-03-01T00:00:00.000Z");
const APR_1 = new Date("2026-04-01T00:00:00.000Z");

function thresholds(overrides: Record<string, unknown> = {}) {
  return {
    stopOnHoldValueAt: "3500.0000",
    stopDeliveryRateBelow: 0.7,
    minimumOrdersForRateRule: 0,
    resumeOnHoldValueBelow: "3500.0000",
    resumeDeliveryRateAt: 0.7,
    stableCyclesBeforeResume: 1,
    ...overrides,
  };
}

function disabledCaution() {
  return {
    onHoldValue: { mode: "DISABLED" as const },
    deliveryRate: { mode: "DISABLED" as const },
  };
}

function globalRevision(overrides: Record<string, unknown> = {}) {
  return {
    revisionId: "global-a",
    version: "risk-control-policy.v1",
    currency: "USD",
    thresholds: thresholds(),
    caution: disabledCaution(),
    effectiveFrom: T0,
    ...overrides,
  };
}

function shopOverride(overrides: Record<string, unknown> = {}) {
  return {
    revisionId: "shop-o1",
    shopId: "shop-1",
    thresholds: {},
    caution: {},
    effectiveFrom: T0,
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as object)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("risk control policy contracts", () => {
  describe("global revision schema", () => {
    it("requires every global threshold", () => {
      const { stableCyclesBeforeResume: _omitted, ...incomplete } = thresholds();
      expect(
        GlobalRiskPolicyRevisionSchema.safeParse(
          globalRevision({ thresholds: incomplete }),
        ).success,
      ).toBe(false);
      expect(
        GlobalRiskPolicyRevisionSchema.safeParse(globalRevision()).success,
      ).toBe(true);
    });

    it("rejects unknown global threshold keys", () => {
      expect(
        GlobalRiskPolicyRevisionSchema.safeParse(
          globalRevision({
            thresholds: thresholds({ stopDeliveryRateBelwo: 0.8 }),
          }),
        ).success,
      ).toBe(false);
    });

    it("rejects invalid global threshold values", () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ["negative money threshold", { stopOnHoldValueAt: "-1" }],
        ["rate above one", { stopDeliveryRateBelow: 1.5 }],
        ["resume rate below stop rate", { resumeDeliveryRateAt: 0.69 }],
        ["resume value above stop value", { resumeOnHoldValueBelow: "3500.0001" }],
        ["fractional sample size", { minimumOrdersForRateRule: 1.5 }],
        ["zero hysteresis", { stableCyclesBeforeResume: 0 }],
      ];
      for (const [name, thresholdOverrides] of cases) {
        expect(
          GlobalRiskPolicyRevisionSchema.safeParse(
            globalRevision({ thresholds: thresholds(thresholdOverrides) }),
          ).success,
          name,
        ).toBe(false);
      }
    });

    it("rejects invalid revision metadata", () => {
      expect(
        GlobalRiskPolicyRevisionSchema.safeParse(
          globalRevision({ revisionId: "" }),
        ).success,
      ).toBe(false);
      expect(
        GlobalRiskPolicyRevisionSchema.safeParse(
          globalRevision({ currency: "usd" }),
        ).success,
      ).toBe(false);
    });
  });

  describe("metric caution contracts", () => {
    it("supports disabled, absolute-buffer, and relative-ratio as explicit states", () => {
      const disabled = MetricCautionSchema.parse({ mode: "DISABLED" });
      expect(Object.keys(disabled)).toEqual(["mode"]);

      const absolute = MetricCautionSchema.parse({
        mode: "ABSOLUTE_BUFFER",
        buffer: "150.0000",
      });
      expect(absolute).toEqual({ mode: "ABSOLUTE_BUFFER", buffer: "150.0000" });

      const relative = MetricCautionSchema.parse({
        mode: "RELATIVE_RATIO",
        ratio: 0.9,
      });
      expect(relative).toEqual({ mode: "RELATIVE_RATIO", ratio: 0.9 });
    });

    it("rejects implicit or out-of-range caution numbers", () => {
      const cases: Array<[string, unknown]> = [
        ["absolute buffer without a value", { mode: "ABSOLUTE_BUFFER" }],
        ["negative absolute buffer", { mode: "ABSOLUTE_BUFFER", buffer: "-5" }],
        ["relative ratio of zero", { mode: "RELATIVE_RATIO", ratio: 0 }],
        ["relative ratio above one", { mode: "RELATIVE_RATIO", ratio: 1.5 }],
        ["unknown caution mode", { mode: "SILENT" }],
      ];
      for (const [name, caution] of cases) {
        expect(MetricCautionSchema.safeParse(caution).success, name).toBe(false);
      }
    });
  });

  describe("shop override schema", () => {
    it("rejects unknown shop threshold keys", () => {
      expect(
        ShopRiskPolicyOverrideRevisionSchema.safeParse(
          shopOverride({
            thresholds: { stopDeliveryRateBelwo: 0.8 },
          }),
        ).success,
      ).toBe(false);
    });

    it("accepts partial overrides with only provided values", () => {
      expect(
        ShopRiskPolicyOverrideRevisionSchema.safeParse(
          shopOverride({
            thresholds: { stopDeliveryRateBelow: 0.8 },
          }),
        ).success,
      ).toBe(true);
      expect(
        ShopRiskPolicyOverrideRevisionSchema.safeParse(
          shopOverride({
            caution: {
              deliveryRate: { mode: "ABSOLUTE_BUFFER", buffer: "0.05" },
            },
          }),
        ).success,
      ).toBe(true);
      expect(
        ShopRiskPolicyOverrideRevisionSchema.safeParse(shopOverride()).success,
      ).toBe(true);
    });
  });

  describe("resolveEffectiveRiskPolicy", () => {
    it("falls back to the initial BA defaults when no global revision is effective", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [],
        effectiveAt: T0,
      });

      expect(resolved.globalRevisionId).toBe(
        INITIAL_GLOBAL_RISK_POLICY_REVISION.revisionId,
      );
      expect(resolved.policyVersion).toBe(RISK_CONTROL_POLICY_V1.version);
      expect(resolved.shopOverrideRevisionId).toBeNull();
      expect(resolved.thresholds).toEqual({
        stopOnHoldValueAt: "3500.0000",
        stopDeliveryRateBelow: 0.7,
        minimumOrdersForRateRule: 0,
        resumeOnHoldValueBelow: "3500.0000",
        resumeDeliveryRateAt: 0.7,
        stableCyclesBeforeResume: 1,
      });
      expect(Object.values(resolved.sources.thresholds)).toEqual([
        "GLOBAL",
        "GLOBAL",
        "GLOBAL",
        "GLOBAL",
        "GLOBAL",
        "GLOBAL",
      ]);
    });

    it("prefers the shop override over global only for provided values", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [globalRevision()],
        shopOverrides: [
          shopOverride({
            revisionId: "shop-o1",
            thresholds: { stopOnHoldValueAt: "4200.0000" },
          }),
        ],
        shopId: "shop-1",
        effectiveAt: T0,
      });

      expect(resolved.thresholds.stopOnHoldValueAt).toBe("4200.0000");
      expect(resolved.sources.thresholds.stopOnHoldValueAt).toBe("SHOP");
      expect(resolved.thresholds.stopDeliveryRateBelow).toBe(0.7);
      expect(resolved.sources.thresholds.stopDeliveryRateBelow).toBe("GLOBAL");
      expect(resolved.globalRevisionId).toBe("global-a");
      expect(resolved.shopOverrideRevisionId).toBe("shop-o1");
      expect(resolved.sources.caution.onHoldValue).toBe("GLOBAL");
    });

    it("resolves other shops without applying another shop's override", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [globalRevision()],
        shopOverrides: [
          shopOverride({
            revisionId: "shop-o1",
            shopId: "shop-1",
            thresholds: { stopDeliveryRateBelow: 0.8 },
          }),
        ],
        shopId: "shop-2",
        effectiveAt: T0,
      });

      expect(resolved.shopOverrideRevisionId).toBeNull();
      expect(resolved.thresholds.stopDeliveryRateBelow).toBe(0.7);
    });

    it("applies the latest revision effective at the evaluation time, including the exact boundary", () => {
      const globalRevisions = [
        globalRevision(),
        globalRevision({
          revisionId: "global-b",
          thresholds: thresholds({ stopOnHoldValueAt: "5000.0000" }),
          effectiveFrom: MAR_1,
        }),
        globalRevision({
          revisionId: "global-c-tie",
          thresholds: thresholds({ stopOnHoldValueAt: "6000.0000" }),
          effectiveFrom: MAR_1,
        }),
      ];

      const before = resolveEffectiveRiskPolicy({
        globalRevisions,
        effectiveAt: new Date("2026-02-15T00:00:00.000Z"),
      });
      expect(before.globalRevisionId).toBe("global-a");
      expect(before.thresholds.stopOnHoldValueAt).toBe("3500.0000");

      const atBoundary = resolveEffectiveRiskPolicy({
        globalRevisions,
        effectiveAt: MAR_1,
      });
      expect(atBoundary.globalRevisionId).toBe("global-c-tie");
      expect(atBoundary.thresholds.stopOnHoldValueAt).toBe("6000.0000");
    });

    it("replaces the whole shop scope with the latest shop revision instead of merging across shop revisions", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [globalRevision()],
        shopOverrides: [
          shopOverride({
            revisionId: "shop-o1",
            thresholds: { stopDeliveryRateBelow: 0.8 },
            effectiveFrom: T0,
          }),
          shopOverride({
            revisionId: "shop-o2",
            thresholds: { minimumOrdersForRateRule: 10 },
            effectiveFrom: APR_1,
          }),
        ],
        shopId: "shop-1",
        effectiveAt: APR_1,
      });

      expect(resolved.shopOverrideRevisionId).toBe("shop-o2");
      expect(resolved.thresholds.minimumOrdersForRateRule).toBe(10);
      expect(resolved.sources.thresholds.minimumOrdersForRateRule).toBe("SHOP");
      expect(resolved.thresholds.stopDeliveryRateBelow).toBe(0.7);
      expect(resolved.sources.thresholds.stopDeliveryRateBelow).toBe("GLOBAL");
    });

    it("ignores future-dated revisions prospectively", () => {
      const futureOnly = resolveEffectiveRiskPolicy({
        globalRevisions: [
          globalRevision({
            revisionId: "global-b",
            thresholds: thresholds({ stopOnHoldValueAt: "5000.0000" }),
            effectiveFrom: MAR_1,
          }),
        ],
        effectiveAt: new Date("2026-02-15T00:00:00.000Z"),
      });
      expect(futureOnly.globalRevisionId).toBe(
        INITIAL_GLOBAL_RISK_POLICY_REVISION.revisionId,
      );
      expect(futureOnly.thresholds.stopOnHoldValueAt).toBe("3500.0000");

      const futureShopOnly = resolveEffectiveRiskPolicy({
        globalRevisions: [globalRevision()],
        shopOverrides: [
          shopOverride({
            revisionId: "shop-o2",
            thresholds: { minimumOrdersForRateRule: 10 },
            effectiveFrom: APR_1,
          }),
        ],
        shopId: "shop-1",
        effectiveAt: new Date("2026-03-15T00:00:00.000Z"),
      });
      expect(futureShopOnly.shopOverrideRevisionId).toBeNull();
      expect(futureShopOnly.thresholds.minimumOrdersForRateRule).toBe(0);
    });

    it("keeps caution explicitly disabled until configured", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [],
        effectiveAt: T0,
      });

      expect(resolved.caution).toEqual({
        onHoldValue: { mode: "DISABLED" },
        deliveryRate: { mode: "DISABLED" },
      });
    });

    it("overrides caution per metric while the other metric inherits global", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [
          globalRevision({
            caution: {
              onHoldValue: { mode: "ABSOLUTE_BUFFER", buffer: "150.0000" },
              deliveryRate: { mode: "RELATIVE_RATIO", ratio: 0.9 },
            },
          }),
        ],
        shopOverrides: [
          shopOverride({
            revisionId: "shop-o1",
            caution: { deliveryRate: { mode: "DISABLED" } },
          }),
        ],
        shopId: "shop-1",
        effectiveAt: T0,
      });

      expect(resolved.caution.onHoldValue).toEqual({
        mode: "ABSOLUTE_BUFFER",
        buffer: "150.0000",
      });
      expect(resolved.sources.caution.onHoldValue).toBe("GLOBAL");
      expect(resolved.caution.deliveryRate).toEqual({ mode: "DISABLED" });
      expect(resolved.sources.caution.deliveryRate).toBe("SHOP");
    });

    it("rejects a shop override that breaks merged threshold invariants", () => {
      expect(() =>
        resolveEffectiveRiskPolicy({
          globalRevisions: [globalRevision()],
          shopOverrides: [
            shopOverride({
              revisionId: "shop-bad",
              thresholds: { stopOnHoldValueAt: "1000.0000" },
            }),
          ],
          shopId: "shop-1",
          effectiveAt: T0,
        }),
      ).toThrow();
    });

    it("rejects an invalid effectiveAt date", () => {
      expect(() =>
        resolveEffectiveRiskPolicy({
          globalRevisions: [],
          effectiveAt: new Date("invalid"),
        }),
      ).toThrow(ZodError);
    });

    it.each(["", "   ", " shop-1", "shop-1 "])(
      "rejects a blank or trim-mismatched shopId %j",
      (shopId) => {
        expect(() =>
          resolveEffectiveRiskPolicy({
            globalRevisions: [globalRevision()],
            shopOverrides: [shopOverride()],
            shopId,
            effectiveAt: T0,
          }),
        ).toThrow(ZodError);
      },
    );

    it("does not mutate inputs and freezes its result", () => {
      const globalRevisions = deepFreeze([globalRevision()]);
      const shopOverrides = deepFreeze([
        shopOverride({
          revisionId: "shop-o1",
          shopId: "shop-1",
          thresholds: { stopDeliveryRateBelow: 0.8, resumeDeliveryRateAt: 0.8 },
        }),
      ]);
      const before = JSON.stringify({ globalRevisions, shopOverrides });

      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions,
        shopOverrides,
        shopId: "shop-1",
        effectiveAt: T0,
      });

      expect(JSON.stringify({ globalRevisions, shopOverrides })).toBe(before);
      expect(Object.isFrozen(resolved)).toBe(true);
      expect(resolved.effectiveAt).toBe("2026-01-01T00:00:00.000Z");
      expect(Object.isFrozen(resolved.thresholds)).toBe(true);
      expect(Object.isFrozen(resolved.caution.onHoldValue)).toBe(true);
    });
  });

  describe("risk-control adapter", () => {
    it("returns the exact flattened policy shape and feeds the evaluator", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [
          globalRevision({
            currency: "EUR",
            thresholds: thresholds({
              stopOnHoldValueAt: "4200.0000",
              stopDeliveryRateBelow: 0.8,
              minimumOrdersForRateRule: 10,
              resumeOnHoldValueBelow: "4000.0000",
              resumeDeliveryRateAt: 0.85,
              stableCyclesBeforeResume: 2,
            }),
          }),
        ],
        effectiveAt: T0,
      });
      const inputBefore = JSON.stringify(resolved);

      const policy = toRiskControlPolicy(resolved);
      const decision = evaluateRiskControlFacts({
        facts: [
          {
            canonicalStatus: "COMPLETED",
            currency: "EUR",
            orderCount: 10,
            totalValue: "1000.0000",
          },
        ],
        policy,
      });

      expect(policy).toEqual({
        version: "risk-control-policy.v1",
        currency: "EUR",
        stopOnHoldValueAt: "4200.0000",
        stopDeliveryRateBelow: 0.8,
        minimumOrdersForRateRule: 10,
        resumeOnHoldValueBelow: "4000.0000",
        resumeDeliveryRateAt: 0.85,
        stableCyclesBeforeResume: 2,
      });
      expect(decision.policyVersion).toBe("risk-control-policy.v1");
      expect(decision.currency).toBe("EUR");
      expect(decision.thresholds).toEqual({
        stopOnHoldValueAt: "4200.0000",
        stopDeliveryRateBelow: 0.8,
        minimumOrdersForRateRule: 10,
        resumeOnHoldValueBelow: "4000.0000",
        resumeDeliveryRateAt: 0.85,
      });
      expect(JSON.stringify(resolved)).toBe(inputBefore);
    });

    it("keeps resolved initial defaults identical to the existing evaluator policy", () => {
      const policy = toRiskControlPolicy(
        resolveEffectiveRiskPolicy({ globalRevisions: [], effectiveAt: T0 }),
      );

      expect(policy).toEqual(RISK_CONTROL_POLICY_V1);
    });
  });

  describe("initial defaults compatibility", () => {
    it("pins the built-in thresholds to the published BA defaults", () => {
      expect(INITIAL_GLOBAL_RISK_POLICY_REVISION.thresholds).toEqual({
        stopOnHoldValueAt: RISK_CONTROL_POLICY_V1.stopOnHoldValueAt,
        stopDeliveryRateBelow: RISK_CONTROL_POLICY_V1.stopDeliveryRateBelow,
        minimumOrdersForRateRule: RISK_CONTROL_POLICY_V1.minimumOrdersForRateRule,
        resumeOnHoldValueBelow: RISK_CONTROL_POLICY_V1.resumeOnHoldValueBelow,
        resumeDeliveryRateAt: RISK_CONTROL_POLICY_V1.resumeDeliveryRateAt,
        stableCyclesBeforeResume: RISK_CONTROL_POLICY_V1.stableCyclesBeforeResume,
      });
      expect(INITIAL_GLOBAL_RISK_POLICY_REVISION.version).toBe(
        RISK_CONTROL_POLICY_V1.version,
      );
      expect(INITIAL_GLOBAL_RISK_POLICY_REVISION.currency).toBe(
        RISK_CONTROL_POLICY_V1.currency,
      );
    });
  });

  describe("resolved policy snapshot contract", () => {
    it("serializes the resolved policy with an ISO effective time", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [],
        effectiveAt: T0,
      });
      const snapshot = ResolvedRiskPolicySnapshotSchema.parse(resolved);

      expect(snapshot.effectiveAt).toBe("2026-01-01T00:00:00.000Z");
      expect(snapshot.thresholds.stopDeliveryRateBelow).toBe(0.7);
    });

    it("rejects non-string effective times", () => {
      const resolved = resolveEffectiveRiskPolicy({
        globalRevisions: [],
        effectiveAt: T0,
      });
      expect(
        ResolvedRiskPolicySnapshotSchema.safeParse({ ...resolved, effectiveAt: T0 }).success,
      ).toBe(false);
    });
  });

  describe("decision case wiring", () => {
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

    it("still parses historical cases without a resolved policy snapshot", () => {
      const parsed = DecisionCaseInputSchema.parse(validCase);
      expect(parsed.resolvedPolicySnapshot).toBeUndefined();
    });

    function matchingResolvedPolicy() {
      return resolveEffectiveRiskPolicy({
        globalRevisions: [
          globalRevision({
            thresholds: thresholds({
              stopOnHoldValueAt: "4321.0000",
              stopDeliveryRateBelow: 0.73,
              minimumOrdersForRateRule: 25,
              resumeOnHoldValueBelow: "4321.0000",
              resumeDeliveryRateAt: 0.73,
            }),
          }),
        ],
        effectiveAt: new Date("2026-08-14T00:00:00.000Z"),
      });
    }

    it("accepts numerically equivalent decimal threshold formatting", () => {
      const snapshot = matchingResolvedPolicy();
      const parsed = DecisionCaseInputSchema.parse({
        ...validCase,
        riskSnapshot: { ...validCase.riskSnapshot, stopOnHoldValueAt: "4321" },
        resolvedPolicySnapshot: snapshot,
      });

      expect(parsed.resolvedPolicySnapshot?.thresholds.stopOnHoldValueAt).toBe("4321.0000");
    });

    it("accepts a resolved policy snapshot matching the case evidence", () => {
      const parsed = DecisionCaseInputSchema.parse({
        ...validCase,
        resolvedPolicySnapshot: matchingResolvedPolicy(),
      });

      expect(parsed.resolvedPolicySnapshot?.thresholds.stopOnHoldValueAt).toBe(
        "4321.0000",
      );
    });

    it.each([
      [
        "policy version",
        (snapshot: ReturnType<typeof matchingResolvedPolicy>) => ({
          ...snapshot,
          policyVersion: "risk-control-policy.v2",
        }),
      ],
      [
        "evaluation time",
        (snapshot: ReturnType<typeof matchingResolvedPolicy>) => ({
          ...snapshot,
          effectiveAt: "2026-08-14T00:00:00.001Z",
        }),
      ],
      [
        "Onhold Value threshold",
        (snapshot: ReturnType<typeof matchingResolvedPolicy>) => ({
          ...snapshot,
          thresholds: {
            ...snapshot.thresholds,
            stopOnHoldValueAt: "4322.0000",
          },
        }),
      ],
      [
        "delivery-rate threshold",
        (snapshot: ReturnType<typeof matchingResolvedPolicy>) => ({
          ...snapshot,
          thresholds: {
            ...snapshot.thresholds,
            stopDeliveryRateBelow: 0.74,
            resumeDeliveryRateAt: 0.74,
          },
        }),
      ],
      [
        "minimum-order threshold",
        (snapshot: ReturnType<typeof matchingResolvedPolicy>) => ({
          ...snapshot,
          thresholds: {
            ...snapshot.thresholds,
            minimumOrdersForRateRule: 26,
          },
        }),
      ],
      [
        "currency",
        (snapshot: ReturnType<typeof matchingResolvedPolicy>) => ({
          ...snapshot,
          currency: "EUR",
        }),
      ],
    ])("rejects a resolved policy snapshot with mismatched %s", (_label, mismatch) => {
      expect(
        DecisionCaseInputSchema.safeParse({
          ...validCase,
          resolvedPolicySnapshot: mismatch(matchingResolvedPolicy()),
        }).success,
      ).toBe(false);
    });

    it.each(["metricsSnapshot", "financeSnapshot"] as const)(
      "rejects snapshot currency inconsistent with %s",
      (field) => {
        expect(
          DecisionCaseInputSchema.safeParse({
            ...validCase,
            [field]: { ...validCase[field], currency: "EUR" },
            resolvedPolicySnapshot: matchingResolvedPolicy(),
          }).success,
        ).toBe(false);
      },
    );
  });
});
