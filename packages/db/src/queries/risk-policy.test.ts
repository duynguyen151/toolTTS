import { describe, expect, it } from "vitest";

import type { Database } from "../client.js";
import {
  appendGlobalRiskPolicyRevision,
  appendShopRiskPolicyOverrideRevision,
  disableShopRiskPolicyOverride,
  getEffectiveRiskPolicy,
} from "./risk-policy.js";

const unusedDb = {} as Database;

const globalPolicy = {
  version: "risk-control-policy.v2",
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
    onHoldValue: { mode: "DISABLED" as const },
    deliveryRate: { mode: "DISABLED" as const },
  },
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
};

describe("risk policy repository input validation", () => {
  it("rejects invalid complete GLOBAL policy before touching the database", async () => {
    await expect(appendGlobalRiskPolicyRevision(unusedDb, {
      ...globalPolicy,
      thresholds: { ...globalPolicy.thresholds, stopDeliveryRateBelow: 1.1 },
    })).rejects.toThrow();
  });

  it("rejects invalid SHOP identity and payload before touching the database", async () => {
    await expect(appendShopRiskPolicyOverrideRevision(unusedDb, {
      shopId: "not-a-uuid",
      thresholds: { stopOnHoldValueAt: "4200.0000" },
      caution: {},
      effectiveFrom: globalPolicy.effectiveFrom,
    })).rejects.toThrow();
  });

  it("rejects unknown SHOP contract keys before touching the database", async () => {
    await expect(appendShopRiskPolicyOverrideRevision(unusedDb, {
      shopId: "00000000-0000-4000-8000-000000000001",
      thresholds: {},
      caution: {},
      effectiveFrom: globalPolicy.effectiveFrom,
      unexpected: true,
    } as Parameters<typeof appendShopRiskPolicyOverrideRevision>[1])).rejects.toThrow();
  });

  it("rejects invalid effective dates for disabling and effective reads", async () => {
    await expect(disableShopRiskPolicyOverride(unusedDb, {
      shopId: "00000000-0000-4000-8000-000000000001",
      effectiveFrom: new Date("invalid"),
    })).rejects.toThrow();
    await expect(getEffectiveRiskPolicy(unusedDb, {
      shopId: "00000000-0000-4000-8000-000000000001",
      effectiveAt: new Date("invalid"),
    })).rejects.toThrow();
  });
});
