import { describe, expect, it } from "vitest";
import {
  SEED_PROVIDER_CATALOG,
  SEED_PROVIDER_RULES,
  matchTrackingToProvider
} from "./provider-matcher.js";

describe("Provider Matcher (W21-T01)", () => {
  it("matches US seed carriers with exact length and case insensitivity", () => {
    // GFU/18 -> Gofo
    const gofo = matchTrackingToProvider(
      "  gfu123456789012345  ",
      "US",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(gofo.status).toBe("MATCHED");
    if (gofo.status === "MATCHED") {
      expect(gofo.providerId).toBe("7352739623900022544");
      expect(gofo.carrierName).toBe("Gofo");
      expect(gofo.prefix).toBe("GFU");
    }

    // UUS/26 -> UniUni
    const uniuni = matchTrackingToProvider(
      "UUS12345678901234567890123",
      "US",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(uniuni.status).toBe("MATCHED");
    if (uniuni.status === "MATCHED") {
      expect(uniuni.providerId).toBe("7352738314622863120");
      expect(uniuni.carrierName).toBe("UniUni");
    }

    // SPX/24 -> SpeedX
    const speedx = matchTrackingToProvider(
      "SPX123456789012345678901",
      "US",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(speedx.status).toBe("MATCHED");
    if (speedx.status === "MATCHED") {
      expect(speedx.providerId).toBe("7325327335803406082");
      expect(speedx.carrierName).toBe("SpeedX");
    }
  });

  it("matches UK seed carriers with pipe-separated prefixes", () => {
    // JJD/19 -> DHL_UK
    const dhl = matchTrackingToProvider(
      "JJD1234567890123456",
      "UK",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(dhl.status).toBe("MATCHED");
    if (dhl.status === "MATCHED") {
      expect(dhl.providerId).toBe("6639580521074524161");
      expect(dhl.carrierName).toBe("DHL_UK");
    }

    // H022/16 -> EVRi
    const evri1 = matchTrackingToProvider(
      "H022123456789012",
      "UK",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(evri1.status).toBe("MATCHED");
    if (evri1.status === "MATCHED") {
      expect(evri1.providerId).toBe("6599541761693270018");
      expect(evri1.carrierName).toBe("EVRi");
      expect(evri1.prefix).toBe("H022");
    }

    // H023/16 -> EVRi
    const evri2 = matchTrackingToProvider(
      "H023123456789012",
      "UK",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(evri2.status).toBe("MATCHED");
    if (evri2.status === "MATCHED") {
      expect(evri2.providerId).toBe("6599541761693270018");
      expect(evri2.prefix).toBe("H023");
    }

    // Royal Mail HD3/13, HD5/13, GV5/13
    const rm1 = matchTrackingToProvider(
      "HD31234567890",
      "UK",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(rm1.status).toBe("MATCHED");
    if (rm1.status === "MATCHED") {
      expect(rm1.providerId).toBe("6671794738251726849");
      expect(rm1.carrierName).toBe("Royal_Mail");
      expect(rm1.prefix).toBe("HD3");
    }

    const rm2 = matchTrackingToProvider(
      "GV51234567890",
      "UK",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(rm2.status).toBe("MATCHED");
    if (rm2.status === "MATCHED") {
      expect(rm2.prefix).toBe("GV5");
    }
  });

  it("fails closed on unproven patterns, RELP/REL, and numeric-only", () => {
    expect(matchTrackingToProvider("RELP1234567890", "US", SEED_PROVIDER_RULES)).toMatchObject({
      status: "NOT_PROVEN_SUPPORTED"
    });
    expect(matchTrackingToProvider("rel1234567890", "US", SEED_PROVIDER_RULES)).toMatchObject({
      status: "NOT_PROVEN_SUPPORTED"
    });
    expect(matchTrackingToProvider("1234567890123456", "US", SEED_PROVIDER_RULES)).toMatchObject({
      status: "NOT_PROVEN_SUPPORTED"
    });
    expect(matchTrackingToProvider("", "US", SEED_PROVIDER_RULES)).toMatchObject({
      status: "NOT_PROVEN_SUPPORTED"
    });
    expect(matchTrackingToProvider("   ", "US", SEED_PROVIDER_RULES)).toMatchObject({
      status: "NOT_PROVEN_SUPPORTED"
    });
  });

  it("fails closed when length does not match rule trackingLength", () => {
    // GFU expects 18 chars, here 10 chars
    const result = matchTrackingToProvider(
      "GFU1234567",
      "US",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(result.status).toBe("NOT_PROVEN_SUPPORTED");
  });

  it("fails closed when region does not match", () => {
    // GFU is US, querying UK
    const result = matchTrackingToProvider(
      "GFU123456789012345",
      "UK",
      SEED_PROVIDER_RULES,
      SEED_PROVIDER_CATALOG
    );
    expect(result.status).toBe("NOT_PROVEN_SUPPORTED");
  });

  it("fails closed when rule references provider not in catalog for region", () => {
    const rules = [
      {
        region: "US" as const,
        prefix: "TEST",
        trackingLength: 8,
        providerId: "unknown-provider-id",
        isActive: true
      }
    ];
    const result = matchTrackingToProvider(
      "TEST1234",
      "US",
      rules,
      SEED_PROVIDER_CATALOG
    );
    expect(result.status).toBe("NOT_PROVEN_SUPPORTED");
  });

  it("returns AMBIGUOUS when multiple rules point to different providers", () => {
    const conflictingRules = [
      {
        region: "US" as const,
        prefix: "DUAL",
        trackingLength: 10,
        providerId: "7352739623900022544",
        isActive: true
      },
      {
        region: "US" as const,
        prefix: "DUAL",
        trackingLength: 10,
        providerId: "7352738314622863120",
        isActive: true
      }
    ];
    const result = matchTrackingToProvider(
      "DUAL123456",
      "US",
      conflictingRules,
      SEED_PROVIDER_CATALOG
    );
    expect(result.status).toBe("AMBIGUOUS");
    if (result.status === "AMBIGUOUS") {
      expect(result.candidateProviderIds).toContain("7352739623900022544");
      expect(result.candidateProviderIds).toContain("7352738314622863120");
    }
  });

  it("validates charsetPattern if provided", () => {
    const charsetRules = [
      {
        region: "US" as const,
        prefix: "ABC",
        trackingLength: 8,
        charsetPattern: "^ABC[0-9]+$",
        providerId: "7352739623900022544",
        isActive: true
      }
    ];

    // Matches charset
    const match = matchTrackingToProvider(
      "ABC12345",
      "US",
      charsetRules,
      SEED_PROVIDER_CATALOG
    );
    expect(match.status).toBe("MATCHED");

    // Fails charset
    const fail = matchTrackingToProvider(
      "ABC1234X",
      "US",
      charsetRules,
      SEED_PROVIDER_CATALOG
    );
    expect(fail.status).toBe("NOT_PROVEN_SUPPORTED");
  });
});
