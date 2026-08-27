import { describe, expect, it } from "vitest";

import {
  CotikSupplementaryPaymentSchema,
  CotikSupplementaryStatementSchema,
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

describe("COTIK supplementary Finance contracts", () => {
  it("requires a supplementary classification and unproven Official-OH status without Official fields", () => {
    const statementInput = {
      shopId: "shop-1",
      providerStatementId: "statement-1",
      providerPaymentId: "payment-1",
      providerShopId: "cotik-shop-1",
      statementAt: new Date("2026-08-24T00:00:00.000Z"),
      currency: "USD",
      revenueAmount: "10.00",
      feeAmount: "-1.25",
      adjustmentAmount: "0.00",
      shippingCostAmount: "-0.50",
      netSalesAmount: "8.25",
      settlementAmount: "8.25",
      paymentStatus: "PAID",
      orderIds: ["order-1"],
      observedAt: new Date("2026-08-24T12:00:00.000Z"),
      sourceHash: "hash",
      sourceSchemaVersion: "cotik-us-supplementary-finance.v1",
      rawData: {},
      classification: "SUPPLEMENTARY_FINANCE",
      officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
      officialOnHoldAmount: "8.25",
    };
    expect(() => CotikSupplementaryStatementSchema.parse(statementInput)).toThrow(/officialOnHoldAmount/);
    const { officialOnHoldAmount: _officialOnHoldAmount, ...statementWithoutOfficialOnHold } = statementInput;
    const statement = CotikSupplementaryStatementSchema.parse(statementWithoutOfficialOnHold);
    const payment = CotikSupplementaryPaymentSchema.parse({
      shopId: "shop-1",
      providerPaymentId: "payment-1",
      providerShopId: "cotik-shop-1",
      paymentStatus: "PAID",
      currency: "USD",
      amount: "8.25",
      settlementAmount: "8.25",
      reserveAmount: "-0.25",
      paymentAmountBeforeExchange: "8.25",
      createdAt: new Date("2026-08-24T00:00:00.000Z"),
      paidAt: new Date("2026-08-24T01:00:00.000Z"),
      observedAt: new Date("2026-08-24T12:00:00.000Z"),
      sourceHash: "hash",
      sourceSchemaVersion: "cotik-us-supplementary-finance.v1",
      rawData: {},
      classification: "SUPPLEMENTARY_FINANCE",
      officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
    });

    expect(CotikSupplementaryStatementSchema.safeParse({
      ...statementWithoutOfficialOnHold,
      feeAmount: "-1.23456",
    }).success).toBe(false);
    expect(statement.feeAmount).toBe("-1.25");
    expect(payment.reserveAmount).toBe("-0.25");
    expect(statement).not.toHaveProperty("officialOnHoldAmount");
    expect(statement.providerPaymentId).toBe(payment.providerPaymentId);
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
