import { describe, expect, it } from "vitest";

import { NormalizedOrderBatchSchema, ProviderNormalizedOrderBatchSchema } from "./orders.js";
import {
  ProviderSourceCoverageProofSchema,
  CredentialCapabilitySchema,
  SourceCoverageProofSchema,
  SourceProvenanceSchema,
  type ReadProviderDataSource,
  type SellerDataSource,
} from "./source.js";

const capturedAt = new Date("2026-08-14T00:00:00.000Z");

describe("SourceCoverageProofSchema", () => {
  it("still parses the legacy Seller Center coverage shape", () => {
    const proof = SourceCoverageProofSchema.parse({
      source: "SELLER_CENTER",
      window: "ROLLING_12_MONTHS",
      completeWithinSourceWindow: true,
      completeWithinWindow: true,
      lifetimeHistoryComplete: false,
    });

    expect(proof).toMatchObject({
      source: "SELLER_CENTER",
      window: "ROLLING_12_MONTHS",
      completeWithinWindow: true,
      lifetimeHistoryComplete: false,
    });
    expect(
      SourceCoverageProofSchema.safeParse({
        source: "COTIK",
        window: "ROLLING_12_MONTHS",
        completeWithinSourceWindow: true,
        lifetimeHistoryComplete: false,
      }).success,
    ).toBe(false);
  });

  it("parses provider-neutral coverage for any declared provider", () => {
    const proof = ProviderSourceCoverageProofSchema.parse({
      source: "COTIK",
      window: "ROLLING_12_MONTHS",
      completeWithinSourceWindow: false,
      lifetimeHistoryComplete: false,
    });

    expect(proof.source).toBe("COTIK");
    expect(proof.completeWithinWindow).toBeUndefined();
  });
});

describe("NormalizedOrderBatchSchema provider neutrality", () => {
  it("accepts COTIK order batches through the shared Orders interface", () => {
    const batch = ProviderNormalizedOrderBatchSchema.parse({
      orders: [],
      checkpoint: null,
      complete: true,
      sourceWindow: {
        source: "COTIK",
        kind: "ROLLING_MONTHS",
        months: 12,
        lifetimeHistory: false,
      },
    });

    expect(batch.sourceWindow.source).toBe("COTIK");
    expect(
      NormalizedOrderBatchSchema.safeParse({
        orders: [],
        checkpoint: null,
        complete: true,
        sourceWindow: {
          source: "COTIK",
          kind: "ROLLING_MONTHS",
          months: 12,
          lifetimeHistory: false,
        },
      }).success,
    ).toBe(false);
  });
});

describe("SourceProvenanceSchema", () => {
  it("accepts COTIK Orders and supplementary Finance capabilities", () => {
    const provenance = SourceProvenanceSchema.parse({
      source: "COTIK",
      capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"],
    });

    expect(provenance.capabilities).toEqual([
      "ORDERS",
      "SUPPLEMENTARY_FINANCE",
    ]);
  });

  it("rejects any COTIK OFFICIAL_ON_HOLD capability declaration", () => {
    const result = SourceProvenanceSchema.safeParse({
      source: "COTIK",
      capabilities: ["ORDERS", "OFFICIAL_ON_HOLD"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(
        "OFFICIAL_ON_HOLD",
      );
    }
  });

  it("keeps Seller Center as the Official On-Hold capable provider", () => {
    const result = SourceProvenanceSchema.safeParse({
      source: "SELLER_CENTER",
      capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE", "OFFICIAL_ON_HOLD"],
    });

    expect(result.success).toBe(true);
  });
});

describe("CredentialCapabilitySchema", () => {
  it("allows only opaque server-side AdsPower autofill references", () => {
    expect(CredentialCapabilitySchema.parse({
      status: "AVAILABLE",
      mechanism: "ADSPOWER_AUTOFILL",
      reference: "SELLER_CENTER_AUTOFILL",
    })).toEqual({
      status: "AVAILABLE",
      mechanism: "ADSPOWER_AUTOFILL",
      reference: "SELLER_CENTER_AUTOFILL",
    });
    expect(CredentialCapabilitySchema.safeParse({
      status: "AVAILABLE",
      mechanism: "ADSPOWER_AUTOFILL",
      reference: "password",
    }).success).toBe(false);
  });
});

describe("provider read and Official-On-Hold contract separation", () => {
  function assertOfficialProvider(source: SellerDataSource): SellerDataSource {
    return source;
  }

  function assertReadProvider(source: ReadProviderDataSource): ReadProviderDataSource {
    return source;
  }

  it("remains structurally compatible with legacy Official-On-Hold implementations", () => {
    const legacy = assertOfficialProvider({
      health: async () => ({ status: "HEALTHY", checkedAt: capturedAt, detail: null }),
      probe: async () => ({ value: "fp-1", capturedAt }),
      collectOrders: async function* () {},
      collectFinancials: async function* () {},
    });

    expect(legacy.collectSupplementaryFinancials).toBeUndefined();
  });

  it("allows COTIK Orders plus supplementary Finance through the read-provider contract", () => {
    const cotik = assertReadProvider({
      health: async () => ({ status: "HEALTHY", checkedAt: capturedAt, detail: null }),
      probe: async () => ({ value: "fp-2", capturedAt }),
      collectOrders: async function* () {},
      collectSupplementaryFinancials: async function* () {},
    });

    expect(typeof cotik.collectSupplementaryFinancials).toBe("function");
  });
});
