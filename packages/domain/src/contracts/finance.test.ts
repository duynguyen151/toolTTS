import { describe, expect, it } from "vitest";

import {
  NormalizedFinancialSnapshotSchema,
  NormalizedSettlementRecordSchema,
} from "./finance.js";

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
      waitingForCompletedRefundReturnAmount: "10.00",
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
      waitingForCompletedRefundReturnAmount: "10.00",
      settlementPeriodDays: null,
      settlementPeriodType: null,
    });
    expect(snapshot).not.toHaveProperty("netEarnings");
    expect(snapshot).not.toHaveProperty("paidAmount");
    expect(snapshot).not.toHaveProperty("processingAmount");
  });
});

describe("NormalizedSettlementRecordSchema", () => {
  it("accepts signed expected settlement amounts", () => {
    const result = NormalizedSettlementRecordSchema.parse({
      shopId: "shop-1",
      sourceStatementDetailId: "detail-signed",
      tradeOrderId: null,
      placedAt: null,
      deliveredAt: null,
      estimatedSettlementAt: null,
      earningAmount: "0.00",
      feeAmount: "0.00",
      shippingAmount: null,
      expectedSettlementAmount: "-0.41",
      eligibleSettlementAmount: null,
      settledAmount: null,
      currency: "USD",
      sourceSettlementStatus: "1",
      settlementState: "ON_HOLD",
      onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
      sourceHash: "hash",
      sourceSchemaVersion: "test.v1",
      rawData: {},
    });

    expect(result.expectedSettlementAmount).toBe("-0.41");
  });
});
