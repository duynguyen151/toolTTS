import { describe, expect, it } from "vitest";

import { buildDecisionFinanceSnapshot, normalizeFinanceReasonSummary } from "./finance.js";

describe("buildDecisionFinanceSnapshot", () => {
  it("preserves signed expected settlement amounts in reason aggregates", () => {
    const result = buildDecisionFinanceSnapshot({
      capturedAt: new Date("2026-08-14T00:00:00.000Z"),
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: null,
      onHoldBalance: null,
      officialOnHoldAmount: "0.0000",
      settlements: [
        {
          settlementState: "ON_HOLD",
          onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
          expectedSettlementAmount: "-0.4100",
        },
      ],
    });

    expect(result.waitingForPackageDeliveryAmount).toBe("-0.4100");
  });

  it("separates official On Hold from all verified typed reason totals", () => {
    const result = buildDecisionFinanceSnapshot({
      capturedAt: new Date("2026-08-14T00:00:00.000Z"),
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: "1200.0000",
      onHoldBalance: "1200.0000",
      officialOnHoldAmount: "1200.0000",
      settlements: [
        { settlementState: "ON_HOLD", onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY", expectedSettlementAmount: "100.0000" },
        { settlementState: "ON_HOLD", onHoldReason: "DELIVERED_AWAITING_SETTLEMENT", expectedSettlementAmount: "900.0000" },
        { settlementState: "ON_HOLD", onHoldReason: "WAITING_FOR_COMPLETED_REFUND_RETURN", expectedSettlementAmount: "200.0000" },
      ],
    });

    expect(result).toMatchObject({
      officialOnHoldAmount: "1200.0000",
      waitingForPackageDeliveryAmount: "100.0000",
      deliveredAwaitingSettlementAmount: "900.0000",
      waitingForCompletedRefundReturnAmount: "200.0000",
      reasonTotalsReconcileToOfficialOnHold: true,
    });
  });

  it("uses an all-row reason aggregate instead of a truncated settlement list", () => {
    const result = buildDecisionFinanceSnapshot({
      capturedAt: new Date("2026-08-14T00:00:00.000Z"),
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: "1200.0000",
      onHoldBalance: "1200.0000",
      officialOnHoldAmount: "1200.0000",
      settlements: [
        { settlementState: "ON_HOLD", onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY", expectedSettlementAmount: "100.0000" },
      ],
      reasonSummary: {
        statementCount: 2,
        waitingForPackageDeliveryAmount: "100.0000",
        deliveredAwaitingSettlementAmount: "1100.0000",
        waitingForCompletedRefundReturnAmount: "0.0000",
        unknownOnHoldReasonCount: 0,
        missingOnHoldExpectedAmountCount: 0,
        onHoldCount: 2,
      },
    });

    expect(result.reasonTotalsReconcileToOfficialOnHold).toBe(true);
    expect(result.deliveredAwaitingSettlementAmount).toBe("1100.0000");
    expect(result.onHoldSettlementCount).toBe(2);
  });

  it("keeps reason amounts unavailable when an On Hold amount is missing", () => {
    const result = buildDecisionFinanceSnapshot({
      capturedAt: new Date("2026-08-14T00:00:00.000Z"),
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: null,
      onHoldBalance: null,
      officialOnHoldAmount: "0.0000",
      settlements: [],
      reasonSummary: {
        statementCount: 1,
        waitingForPackageDeliveryAmount: null,
        deliveredAwaitingSettlementAmount: null,
        waitingForCompletedRefundReturnAmount: null,
        unknownOnHoldReasonCount: 0,
        missingOnHoldExpectedAmountCount: 1,
        onHoldCount: 1,
      },
    });

    expect(result.waitingForPackageDeliveryAmount).toBeNull();
    expect(result.deliveredAwaitingSettlementAmount).toBeNull();
    expect(result.missingOnHoldExpectedAmountCount).toBe(1);
    expect(result.reasonTotalsReconcileToOfficialOnHold).toBe(false);
  });

  it("keeps missing reason aggregates unavailable and cannot reconcile them", () => {
    const result = buildDecisionFinanceSnapshot({
      capturedAt: new Date("2026-08-14T00:00:00.000Z"),
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: null,
      onHoldBalance: null,
      officialOnHoldAmount: "0.0000",
      settlements: [],
      reasonSummary: {
        statementCount: 0,
        onHoldCount: 0,
        waitingForPackageDeliveryAmount: null,
        deliveredAwaitingSettlementAmount: null,
        waitingForCompletedRefundReturnAmount: null,
        unknownOnHoldReasonCount: 0,
        missingOnHoldExpectedAmountCount: 0,
      },
    });

    expect(result.waitingForPackageDeliveryAmount).toBeNull();
    expect(result.deliveredAwaitingSettlementAmount).toBeNull();
    expect(result.reasonTotalsReconcileToOfficialOnHold).toBe(false);
  });
});

describe("normalizeFinanceReasonSummary", () => {
  it("turns a proven empty Finance population into typed zero reason totals", () => {
    const capturedAt = new Date("2026-08-15T00:00:00.000Z");
    const reasonSummary = normalizeFinanceReasonSummary({
      statementCount: 0,
      onHoldCount: 0,
      waitingForPackageDeliveryAmount: null,
      deliveredAwaitingSettlementAmount: null,
      waitingForCompletedRefundReturnAmount: null,
      unknownOnHoldReasonCount: 0,
      missingOnHoldExpectedAmountCount: 0,
    }, capturedAt);

    expect(reasonSummary).toMatchObject({
      waitingForPackageDeliveryAmount: "0.0000",
      deliveredAwaitingSettlementAmount: "0.0000",
      waitingForCompletedRefundReturnAmount: "0.0000",
    });
    expect(buildDecisionFinanceSnapshot({
      capturedAt,
      currency: "USD",
      availableBalance: "0.0000",
      frozenBalance: "0.0000",
      totalBalance: "0.0000",
      toSettleBalance: "0.0000",
      onHoldBalance: "0.0000",
      officialOnHoldAmount: "0.0000",
      settlements: [],
      reasonSummary,
    }).reasonTotalsReconcileToOfficialOnHold).toBe(true);
  });

  it("does not fabricate reason totals without a proven capture", () => {
    const summary = {
      statementCount: 0,
      onHoldCount: 0,
      waitingForPackageDeliveryAmount: null,
      deliveredAwaitingSettlementAmount: null,
      waitingForCompletedRefundReturnAmount: null,
      unknownOnHoldReasonCount: 0,
      missingOnHoldExpectedAmountCount: 0,
    };

    expect(normalizeFinanceReasonSummary(summary, null)).toEqual(summary);
    expect(normalizeFinanceReasonSummary(summary)).toEqual(summary);
  });
});
