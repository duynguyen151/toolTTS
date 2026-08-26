import { describe, expect, it } from "vitest";

import {
  DecisionCoverageSnapshotSchema,
  FinanceHealthSnapshotSchema,
  resolveFinanceHealth,
  type FinanceHealthResolverInput,
} from "./index.js";

const evaluatedAt = new Date("2026-08-15T12:00:00.000Z");
const officialCapabilityProof = {
  provider: "SELLER_CENTER",
  capability: "OFFICIAL_ON_HOLD",
  proofRevision: "seller-center-official-on-hold.v1",
} as const;

function input(
  overrides: Partial<FinanceHealthResolverInput> = {},
): FinanceHealthResolverInput {
  return {
    capabilityProof: officialCapabilityProof,
    providerUpdatedAt: null,
    collectedAt: new Date("2026-08-15T11:00:00.000Z"),
    evaluatedAt,
    freshnessWindowMs: 24 * 60 * 60 * 1000,
    proofStatus: "PROVEN",
    sourceComplete: true,
    reconciled: true,
    refreshState: "SUCCEEDED",
    ...overrides,
  };
}

describe("resolveFinanceHealth", () => {
  it("resolves fresh proven Seller Center Official-OH evidence as healthy and available", () => {
    const result = resolveFinanceHealth(input());

    expect(result).toEqual({
      schemaVersion: "finance-health.v1",
      provider: "SELLER_CENTER",
      capability: "OFFICIAL_ON_HOLD",
      capabilityProofRevision: "seller-center-official-on-hold.v1",
      providerUpdatedAt: null,
      collectedAt: "2026-08-15T11:00:00.000Z",
      evaluatedAt: "2026-08-15T12:00:00.000Z",
      ageMs: 3_600_000,
      health: "FRESH",
      completeness: "COMPLETE",
      reconciliation: "RECONCILED",
      officialOnHoldAvailability: "AVAILABLE",
      refreshState: "SUCCEEDED",
    });
    expect(FinanceHealthSnapshotSchema.parse(result)).toEqual(result);
  });

  it("keeps a stale complete and reconciled Official-OH observation available", () => {
    expect(resolveFinanceHealth(input({
      collectedAt: new Date("2026-08-13T11:59:59.999Z"),
    }))).toMatchObject({
      ageMs: 172_800_001,
      health: "STALE",
      officialOnHoldAvailability: "AVAILABLE",
      refreshState: "SUCCEEDED",
    });
  });

  it("fails closed with unknown freshness when collected time is missing", () => {
    expect(resolveFinanceHealth(input({ collectedAt: null }))).toMatchObject({
      collectedAt: null,
      ageMs: null,
      health: "UNKNOWN",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
  });

  it("distinguishes source incompleteness from proof and reconciliation", () => {
    expect(resolveFinanceHealth(input({ sourceComplete: false }))).toMatchObject({
      health: "INCOMPLETE",
      completeness: "INCOMPLETE",
      reconciliation: "RECONCILED",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
  });

  it("distinguishes reconciliation failure from freshness and proof", () => {
    expect(resolveFinanceHealth(input({ reconciled: false }))).toMatchObject({
      health: "RECONCILIATION_FAILED",
      completeness: "COMPLETE",
      reconciliation: "FAILED",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
  });

  it("keeps W5-T01 integrity proof unavailable separate from freshness", () => {
    expect(resolveFinanceHealth(input({ proofStatus: "PROOF_UNAVAILABLE" }))).toMatchObject({
      health: "UNKNOWN",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
  });

  it("never treats COTIK supplementary Finance as Official OH", () => {
    expect(resolveFinanceHealth(input({
      capabilityProof: {
        provider: "COTIK",
        capability: "SUPPLEMENTARY_FINANCE",
        proofRevision: "cotik-supplementary-finance.v1",
      },
    }))).toMatchObject({
      provider: "COTIK",
      capability: "SUPPLEMENTARY_FINANCE",
      health: "UNKNOWN",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
  });

  it("supports future provider promotion only through an explicit capability proof revision", () => {
    expect(resolveFinanceHealth(input({
      capabilityProof: {
        provider: "COTIK",
        capability: "OFFICIAL_ON_HOLD",
        proofRevision: "future-cotik-official.v1",
      },
    }))).toMatchObject({
      provider: "COTIK",
      capability: "OFFICIAL_ON_HOLD",
      capabilityProofRevision: "future-cotik-official.v1",
      officialOnHoldAvailability: "AVAILABLE",
    });
  });

  it("preserves explicit provider-updated time separately from collected time", () => {
    expect(resolveFinanceHealth(input({
      providerUpdatedAt: new Date("2026-08-14T00:00:00.000Z"),
    }))).toMatchObject({
      providerUpdatedAt: "2026-08-14T00:00:00.000Z",
      collectedAt: "2026-08-15T11:00:00.000Z",
      ageMs: 3_600_000,
    });
  });

  it("keeps provider-updated time null when the provider did not supply it", () => {
    expect(resolveFinanceHealth(input()).providerUpdatedAt).toBeNull();
  });

  it("does not invalidate delayed T-1 source data or use it as freshness time", () => {
    expect(resolveFinanceHealth(input({
      providerUpdatedAt: new Date("2026-08-13T00:00:00.000Z"),
      collectedAt: new Date("2026-08-15T11:30:00.000Z"),
    }))).toMatchObject({
      health: "FRESH",
      ageMs: 1_800_000,
      officialOnHoldAvailability: "AVAILABLE",
    });
  });

  it("fails closed on a future collection timestamp instead of returning a negative age", () => {
    expect(resolveFinanceHealth(input({
      collectedAt: new Date("2026-08-15T12:00:00.001Z"),
    }))).toMatchObject({
      ageMs: null,
      health: "UNKNOWN",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
  });

  it("requires an explicit capability proof revision instead of provider-name promotion", () => {
    expect(resolveFinanceHealth(input({
      capabilityProof: null,
    }))).toMatchObject({
      provider: null,
      health: "UNKNOWN",
      officialOnHoldAvailability: "UNAVAILABLE",
    });
    expect(resolveFinanceHealth(input()).officialOnHoldAvailability).toBe("AVAILABLE");
  });

  it.each(["NOT_REQUESTED", "RUNNING", "FAILED", "ABORTED", "PAUSED", "SUCCEEDED"] as const)(
    "projects refresh state %s without reinterpretation",
    (refreshState) => {
      expect(resolveFinanceHealth(input({ refreshState })).refreshState).toBe(refreshState);
    },
  );

  it("projects only aggregate provenance and excludes raw items, PII, and secrets", () => {
    const result = resolveFinanceHealth({
      ...input(),
      rawItems: [{ buyerName: "do-not-copy" }],
      accessToken: "do-not-copy",
    } as FinanceHealthResolverInput);

    expect(Object.keys(result).sort()).toEqual([
      "ageMs",
      "capability",
      "capabilityProofRevision",
      "collectedAt",
      "completeness",
      "evaluatedAt",
      "health",
      "officialOnHoldAvailability",
      "provider",
      "providerUpdatedAt",
      "reconciliation",
      "refreshState",
      "schemaVersion",
    ].sort());
    expect(JSON.stringify(result)).not.toMatch(/buyer|token|secret/i);
  });
});

describe("Decision coverage Finance health compatibility", () => {
  it("still parses legacy coverage snapshots without Finance health metadata", () => {
    const parsed = DecisionCoverageSnapshotSchema.parse({
      coverageState: "PARTIAL",
      persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
      source: "SELLER_CENTER",
      provenSourceWindow: "ROLLING_12_MONTHS",
      completeWithinSourceWindow: true,
      lifetimeHistoryComplete: false,
      freshness: "STALE",
    });

    expect(parsed.financeHealth).toBeUndefined();
  });

  it("parses versioned additive Finance health metadata for new Cases", () => {
    const financeHealth = resolveFinanceHealth(input());
    const parsed = DecisionCoverageSnapshotSchema.parse({
      coverageState: "COMPLETE",
      persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
      source: "SELLER_CENTER",
      provenSourceWindow: "ROLLING_12_MONTHS",
      completeWithinSourceWindow: true,
      lifetimeHistoryComplete: false,
      ordersSourceComplete: true,
      financeRequiredSourceComplete: true,
      sourceReconciled: true,
      latestSuccessfulSyncAt: "2026-08-15T11:30:00.000Z",
      financeCapturedAt: "2026-08-15T11:00:00.000Z",
      freshness: "FRESH",
      financeHealth,
    });

    expect(parsed.financeHealth).toEqual(financeHealth);
  });
});
