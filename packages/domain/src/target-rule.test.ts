import { describe, expect, it } from "vitest";

import {
  evaluateOfficialOnHoldRule,
  resolveAnalyticalDeliveryPeriod,
  resolveEffectiveRiskPolicy,
  type OfficialOnHoldRuleInput,
} from "./index.js";

const evaluatedAt = new Date("2026-08-15T12:00:00.000Z");
const capturedAt = new Date("2026-08-15T11:00:00.000Z");
const policy = resolveEffectiveRiskPolicy({ globalRevisions: [], effectiveAt: evaluatedAt });

function financeHealth(overrides: Partial<OfficialOnHoldRuleInput["officialOnHold"]["health"]> = {}) {
  return {
    schemaVersion: "finance-health.v1" as const,
    provider: "SELLER_CENTER" as const,
    capability: "OFFICIAL_ON_HOLD" as const,
    capabilityProofRevision: "seller-center-official-on-hold.v1",
    providerUpdatedAt: null,
    collectedAt: capturedAt.toISOString(),
    evaluatedAt: evaluatedAt.toISOString(),
    ageMs: 3_600_000,
    health: "FRESH" as const,
    completeness: "COMPLETE" as const,
    reconciliation: "RECONCILED" as const,
    officialOnHoldAvailability: "AVAILABLE" as const,
    refreshState: "SUCCEEDED" as const,
    ...overrides,
  };
}

function input(overrides: Partial<OfficialOnHoldRuleInput> = {}): OfficialOnHoldRuleInput {
  return {
    evaluatedAt,
    policy,
    officialOnHold: {
      amount: "3499.9999",
      currency: "USD",
      capturedAt,
      health: financeHealth(),
    },
    delivery: {
      counts: [{ canonicalStatus: "DELIVERED", count: 10 }],
      observedAt: capturedAt,
      source: "SELLER_CENTER",
      quality: "FRESH",
    },
    ...overrides,
  };
}

describe("Official On-Hold target Rule", () => {
  it.each([
    ["below", "3499.9999", "CLEAR"],
    ["at", "3500.0000", "TRIGGERED"],
    ["above", "3500.0001", "TRIGGERED"],
  ] as const)("evaluates fresh Official OH %s the effective threshold", (_label, amount, state) => {
    expect(evaluateOfficialOnHoldRule(input({
      officialOnHold: { amount, currency: "USD", capturedAt, health: financeHealth() },
    })).officialOnHold.state).toBe(state);
  });

  it("evaluates stale complete/reconciled Official OH while preserving STALE evidence", () => {
    const result = evaluateOfficialOnHoldRule(input({
      officialOnHold: {
        amount: "3500.0000",
        currency: "USD",
        capturedAt,
        health: financeHealth({
          ageMs: 172_800_000,
          health: "STALE",
        }),
      },
    }));

    expect(result.officialOnHold).toMatchObject({
      state: "TRIGGERED",
      observedValue: "3500.0000",
      observedAt: capturedAt.toISOString(),
      ageMs: 172_800_000,
      quality: "STALE",
      source: "SELLER_CENTER",
    });
  });

  it("returns PAUSE when stale Official OH triggers and Delivery Rate is unavailable", () => {
    expect(evaluateOfficialOnHoldRule(input({
      officialOnHold: {
        amount: "3500.0000",
        currency: "USD",
        capturedAt,
        health: financeHealth({ health: "STALE", ageMs: 172_800_000 }),
      },
      delivery: { counts: [{ canonicalStatus: "UNKNOWN", count: 1 }], observedAt: capturedAt, source: "SELLER_CENTER", quality: "FRESH" },
    }))).toMatchObject({ decision: "PAUSE", triggers: ["OFFICIAL_ON_HOLD"] });
  });

  it.each([
    ["missing OH with triggered Delivery Rate", null, financeHealth({ officialOnHoldAvailability: "UNAVAILABLE", health: "UNKNOWN", completeness: "UNKNOWN", reconciliation: "UNKNOWN" }), [{ canonicalStatus: "AWAITING_SHIPMENT", count: 4 }, { canonicalStatus: "DELIVERED", count: 1 }], "PAUSE"],
    ["missing OH with clear Delivery Rate", null, financeHealth({ officialOnHoldAvailability: "UNAVAILABLE", health: "UNKNOWN", completeness: "UNKNOWN", reconciliation: "UNKNOWN" }), [{ canonicalStatus: "DELIVERED", count: 5 }], "INSUFFICIENT_DATA"],
    ["incomplete OH with triggered Delivery Rate", "5000.0000", financeHealth({ officialOnHoldAvailability: "UNAVAILABLE", health: "INCOMPLETE", completeness: "INCOMPLETE" }), [{ canonicalStatus: "AWAITING_SHIPMENT", count: 4 }, { canonicalStatus: "DELIVERED", count: 1 }], "PAUSE"],
    ["reconciliation-failed OH with clear Delivery Rate", "5000.0000", financeHealth({ officialOnHoldAvailability: "UNAVAILABLE", health: "RECONCILIATION_FAILED", reconciliation: "FAILED" }), [{ canonicalStatus: "DELIVERED", count: 5 }], "INSUFFICIENT_DATA"],
    ["clear OH with triggered Delivery Rate", "1.0000", financeHealth(), [{ canonicalStatus: "AWAITING_SHIPMENT", count: 4 }, { canonicalStatus: "DELIVERED", count: 1 }], "PAUSE"],
    ["triggered OH with clear Delivery Rate", "3500.0000", financeHealth(), [{ canonicalStatus: "DELIVERED", count: 5 }], "PAUSE"],
    ["triggered OH with unavailable Delivery Rate", "3500.0000", financeHealth(), [{ canonicalStatus: "UNKNOWN", count: 1 }], "PAUSE"],
    ["both conditions clear", "1.0000", financeHealth(), [{ canonicalStatus: "DELIVERED", count: 5 }], "CONTINUE"],
    ["both conditions are not evaluated", null, financeHealth({ officialOnHoldAvailability: "UNAVAILABLE", health: "UNKNOWN", completeness: "UNKNOWN", reconciliation: "UNKNOWN" }), [{ canonicalStatus: "UNKNOWN", count: 1 }], "INSUFFICIENT_DATA"],
  ] as const)("%s resolves independently", (_label, amount, health, counts, decision) => {
    expect(evaluateOfficialOnHoldRule(input({
      officialOnHold: { amount, currency: "USD", capturedAt, health },
      delivery: { counts, observedAt: capturedAt, source: "SELLER_CENTER", quality: "FRESH" },
    })).decision).toBe(decision);
  });

  it("does not let a non-Seller Center delivery source trigger the target Delivery condition", () => {
    const result = evaluateOfficialOnHoldRule(input({
      officialOnHold: {
        amount: null,
        currency: "USD",
        capturedAt: null,
        health: financeHealth({
          health: "UNKNOWN",
          completeness: "UNKNOWN",
          reconciliation: "UNKNOWN",
          officialOnHoldAvailability: "UNAVAILABLE",
        }),
      },
      delivery: {
        counts: [{ canonicalStatus: "AWAITING_SHIPMENT", count: 4 }, { canonicalStatus: "DELIVERED", count: 1 }],
        observedAt: capturedAt,
        source: null,
        quality: "FRESH",
      },
    }));

    expect(result.deliveryRate).toMatchObject({
      state: "NOT_EVALUATED",
      source: null,
      unavailableReasons: expect.arrayContaining(["SOURCE_NOT_AUTHORITATIVE"]),
    });
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("does not let COTIK supplementary Finance satisfy the Official OH condition", () => {
    const result = evaluateOfficialOnHoldRule(input({
      officialOnHold: {
        amount: "9999.0000",
        currency: "USD",
        capturedAt,
        health: financeHealth({
          provider: "COTIK",
          capability: "SUPPLEMENTARY_FINANCE",
          capabilityProofRevision: "cotik-supplementary-finance.v1",
          health: "UNKNOWN",
          officialOnHoldAvailability: "UNAVAILABLE",
        }),
      },
    }));

    expect(result.officialOnHold.state).toBe("NOT_EVALUATED");
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("fails closed when an Official-OH capability is claimed by a non-Seller Center provider", () => {
    const result = evaluateOfficialOnHoldRule(input({
      officialOnHold: {
        amount: "9999.0000",
        currency: "USD",
        capturedAt,
        health: financeHealth({
          provider: "COTIK",
          capability: "OFFICIAL_ON_HOLD",
          capabilityProofRevision: "contradictory-test-proof.v1",
        }),
      },
    }));

    expect(result.officialOnHold).toMatchObject({
      state: "NOT_EVALUATED",
      source: "COTIK",
    });
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("does not accept analytical periods as Rule input", () => {
    expect(() => evaluateOfficialOnHoldRule({
      ...input(),
      analyticalPeriod: resolveAnalyticalDeliveryPeriod("TODAY", evaluatedAt),
    } as unknown as OfficialOnHoldRuleInput)).toThrow();
  });
});
