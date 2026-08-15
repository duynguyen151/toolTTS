import { describe, expect, it } from "vitest";

import {
  RawStatementOrderSchema,
  StatementStatResponseSchema,
} from "../extractors/schemas.js";
import {
  normalizeFinancialSnapshot,
  normalizeSettlementRecord,
} from "./finance.js";

describe("normalizeSettlementRecord", () => {
  it("maps the live On hold row without retaining buyer PII", () => {
    const raw = RawStatementOrderSchema.parse({
      statement_detail_id: "detail-1",
      reference_id: "reference-1",
      trade_order_id: "order-1",
      placed_time: 1_723_680_000_000,
      trade_type: 1,
      settlement_amount: { amount: "37.50", currency: "USD" },
      earning_amount: { amount: "40.00", currency: "USD" },
      fees: { amount: "-2.50", currency: "USD" },
      settlement_status: 1,
      to_settle_reason: 3,
      estimate_settle_time: 1_724_198_400_000,
      delivery_time: 1_723_939_200_000,
      estimate_settle_time_not_delivery: {
        starling_key: "finance_on_hold_waiting",
        starling_text: "Alice Private token=secret-token https://signed.example.test/?sig=secret-sign",
        params: ["31", "alice@example.test", "secret-token"],
        buyer_name: "Alice Private",
      },
      statement_id: "statement-1",
      statement_version: 1,
      source_page_types: [{
        starling_key: "finance_page_type_order",
        starling_text: "Order",
        buyer_email: "alice@example.test",
      }],
      buyer_name: "Alice Private",
      buyer_email: "alice@example.test",
      shipping_address: "123 Private Street",
    });

    const result = normalizeSettlementRecord(raw, "shop-1");

    expect(result).toMatchObject({
      shopId: "shop-1",
      sourceStatementDetailId: "detail-1",
      tradeOrderId: "order-1",
      placedAt: new Date("2024-08-15T00:00:00.000Z"),
      deliveredAt: new Date("2024-08-18T00:00:00.000Z"),
      estimatedSettlementAt: new Date("2024-08-21T00:00:00.000Z"),
      earningAmount: "40.00",
      feeAmount: "2.50",
      shippingAmount: null,
      expectedSettlementAmount: "37.50",
      eligibleSettlementAmount: null,
      settledAmount: null,
      currency: "USD",
      sourceSettlementStatus: "1",
      settlementState: "ON_HOLD",
      onHoldReason: "DELIVERED_AWAITING_SETTLEMENT",
      sourceSchemaVersion: "seller-center-us-finance.v2",
      rawData: {
        statementDetailId: "detail-1",
        referenceId: "reference-1",
        tradeOrderId: "order-1",
        tradeType: 1,
        settlementAmount: { amount: "37.50", currency: "USD" },
        earningAmount: { amount: "40.00", currency: "USD" },
        fees: { signedAmount: "-2.50", currency: "USD" },
        settlementStatus: 1,
        toSettleReason: 3,
        estimateSettleTimeNotDelivery: {
          starlingKey: "finance_on_hold_waiting",
        },
        statement: { id: "statement-1", version: 1 },
        sourcePageTypes: [{
          starlingKey: "finance_page_type_order",
        }],
      },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Alice Private");
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain("123 Private Street");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-sign");
    expect(serialized).not.toContain("signed.example.test");
  });

  it("maps proven reason 1 to waiting for package delivery", () => {
    const raw = RawStatementOrderSchema.parse(statementRow("detail-2", 1));

    const result = normalizeSettlementRecord(raw, "shop-1");

    expect(result).toMatchObject({
      onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
      estimatedSettlementAt: null,
      rawData: {
        estimateSettleTime: null,
        estimateSettleTimeNotDelivery: {
          starlingKey: "finance_on_hold_waiting",
        },
      },
    });
  });

  it("preserves a signed settlement amount from the live Finance response", () => {
    const raw = RawStatementOrderSchema.parse({
      ...statementRow("detail-signed-settlement", 1),
      settlement_amount: { amount: "-0.41", currency: "USD" },
    });

    expect(normalizeSettlementRecord(raw, "shop-1").expectedSettlementAmount).toBe("-0.41");
  });

  it("maps live reason code 2 to completed refund or return", () => {
    const raw = RawStatementOrderSchema.parse(statementRow("detail-reason-2", 2));

    expect(normalizeSettlementRecord(raw, "shop-1").onHoldReason).toBe(
      "WAITING_FOR_COMPLETED_REFUND_RETURN",
    );
  });

  it("treats Seller Center delivery time zero as unavailable", () => {
    const raw = RawStatementOrderSchema.parse({
      ...statementRow("detail-zero-delivery", 1),
      delivery_time: "0",
    });

    expect(normalizeSettlementRecord(raw, "shop-1").deliveredAt).toBeNull();
  });

  it("accepts a zero fee and normalizes its absolute value", () => {
    const raw = RawStatementOrderSchema.parse({
      ...statementRow("detail-3", 1),
      fees: { amount: "0", currency: "USD" },
    });

    expect(normalizeSettlementRecord(raw, "shop-1").feeAmount).toBe("0");
  });
});

describe("normalizeFinancialSnapshot", () => {
  it("uses the official On hold stat amount and keeps a sanitized reason breakdown", () => {
    const response = StatementStatResponseSchema.parse({
      code: 0,
      data: {
        to_settle_amount_stat: {
          amount: { amount: "310.16", currency: "USD" },
          reasons_detail: [
            { reason: 1, amount: { amount: "177.33", currency: "USD" } },
            { reason: 2, amount: { amount: "0.00", currency: "USD" } },
            { reason: 3, amount: { amount: "132.83", currency: "USD" } },
          ],
        },
        seller_quality_stat: {
          quality_title: {
            starling_key: "Dynamic_Settlement_Extended",
            starling_text: "Extended settlement period",
          },
          bill_finish_period_in_days: 31,
          settle_period_type: 1,
        },
      },
    });
    const snapshot = normalizeFinancialSnapshot(
      response,
      "shop-1",
      new Date("2026-08-14T00:00:00.000Z"),
    );

    expect(snapshot).toMatchObject({
      shopId: "shop-1",
      currency: "USD",
      onHoldBalance: "310.16",
      officialOnHoldAmount: "310.16",
      settlementPeriodDays: 31,
      settlementPeriodType: "Dynamic_Settlement_Extended",
      rawData: {
        sourceSurface: "ON_HOLD",
        onHoldAmount: "310.16",
        reasons: [
          { reason: 1, name: "WAITING_FOR_PACKAGE_DELIVERY", amount: "177.33", currency: "USD" },
          { reason: 2, name: "WAITING_FOR_COMPLETED_REFUND_RETURN", amount: "0.00", currency: "USD" },
          { reason: 3, name: "DELIVERED_AWAITING_SETTLEMENT", amount: "132.83", currency: "USD" },
        ],
      },
    });
    expect(snapshot?.reasonTotalsReconcileToOfficialOnHold).toBeUndefined();
  });
});

function statementRow(id: string, reason: 1 | 2 | 3): Record<string, unknown> {
  return {
    statement_detail_id: id,
    reference_id: `reference-${id}`,
    trade_order_id: `order-${id}`,
    placed_time: 1_723_680_000_000,
    trade_type: 1,
    settlement_amount: { amount: "37.50", currency: "USD" },
    earning_amount: { amount: "40.00", currency: "USD" },
    fees: { amount: "-2.50", currency: "USD" },
    settlement_status: 1,
    to_settle_reason: reason,
    ...(reason === 3 ? { estimate_settle_time: 1_724_198_400_000 } : {}),
    delivery_time: 1_723_939_200_000,
    statement_id: "statement-1",
    statement_version: 1,
    estimate_settle_time_not_delivery: {
      starling_key: "finance_on_hold_waiting",
      starling_text: "Waiting",
      params: ["31"],
    },
    source_page_types: [{
      starling_key: "finance_page_type_order",
      starling_text: "Order",
    }],
  };
}
