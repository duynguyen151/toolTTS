import { describe, expect, it } from "vitest";

import { NormalizedFinancialSnapshotSchema } from "./finance.js";

describe("NormalizedFinancialSnapshotSchema", () => {
  it("keeps only verified nullable summary fields", () => {
    const snapshot = NormalizedFinancialSnapshotSchema.parse({
      shopId: "shop-1",
      capturedAt: new Date("2026-08-14T00:00:00.000Z"),
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: null,
      onHoldBalance: "310.16",
      netEarnings: "10.00",
      paidAmount: "20.00",
      processingAmount: "30.00",
      reserveRatio: null,
      reserveDays: null,
      reserveLevel: null,
      snapshotHash: "snapshot-1",
      sourceSchemaVersion: "finance.v1",
      rawData: {},
    });

    expect(snapshot).toMatchObject({
      officialOnHoldAmount: null,
      settlementPeriodDays: null,
      settlementPeriodType: null,
    });
    expect(snapshot).not.toHaveProperty("netEarnings");
    expect(snapshot).not.toHaveProperty("paidAmount");
    expect(snapshot).not.toHaveProperty("processingAmount");
  });
});
