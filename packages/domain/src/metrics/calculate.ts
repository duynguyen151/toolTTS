import { Decimal } from "decimal.js";

import type { DateRange } from "../contracts/common.js";
import type {
  NormalizedFinancialSnapshot,
  NormalizedSettlementRecord,
} from "../contracts/finance.js";
import type { NormalizedOrder } from "../contracts/orders.js";
import type {
  MetricWarning,
  MetricsResult,
  MoneyMetric,
  PeriodMetrics,
  RateMetric,
} from "./types.js";

export interface MetricsInput {
  currency: string;
  currentRange: DateRange;
  previousRange: DateRange;
  orders: readonly NormalizedOrder[];
  settlements: readonly NormalizedSettlementRecord[];
  financialSnapshots?: readonly NormalizedFinancialSnapshot[];
}

const FULFILLED_STATUSES = new Set([
  "DELIVERED",
  "COMPLETED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

function inRange(value: Date | null, range: DateRange): boolean {
  return value !== null && value >= range.start && value < range.end;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function decimalString(value: Decimal): string {
  return value.toDecimalPlaces(4).toFixed(4);
}

function divide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function decimalRate(numerator: Decimal, denominator: Decimal): number | null {
  return denominator.isZero() ? null : numerator.dividedBy(denominator).toNumber();
}

function moneyMetric(
  value: Decimal | null,
  currency: string,
  sampleSize: number,
  coverage: number,
  warnings: MetricWarning[] = [],
): MoneyMetric {
  return {
    value: value === null ? null : decimalString(value),
    currency,
    sampleSize,
    coverage,
    warnings,
  };
}

function rateMetric(
  numerator: number,
  denominator: number,
  sampleSize: number,
  coverage: number,
  warnings: MetricWarning[] = [],
): RateMetric {
  return {
    value: divide(numerator, denominator),
    numerator,
    denominator,
    sampleSize,
    coverage,
    warnings,
  };
}

function calculatePeriod(
  input: MetricsInput,
  range: DateRange,
): PeriodMetrics {
  const periodOrders = input.orders.filter((order) => inRange(order.paidAt, range));
  const currencyOrders = periodOrders.filter(
    (order) => order.currency === input.currency,
  );
  const currencyMismatch = currencyOrders.length !== periodOrders.length;
  const commonWarnings: MetricWarning[] = currencyMismatch
    ? ["CURRENCY_MISMATCH"]
    : [];

  const bookedSales = currencyOrders.reduce(
    (sum, order) => sum.plus(order.grandTotal),
    new Decimal(0),
  );
  const validOrders = currencyOrders.filter(
    (order) => order.canonicalStatus !== "CANCELED",
  );
  const grossValidSales = validOrders.reduce(
    (sum, order) => sum.plus(order.grandTotal),
    new Decimal(0),
  );
  const refundKnown = currencyOrders.filter((order) => order.refundAmount !== null);
  const validRefundKnown = validOrders.filter((order) => order.refundAmount !== null);
  const refundedAmount = refundKnown.reduce(
    (sum, order) => sum.plus(order.refundAmount ?? 0),
    new Decimal(0),
  );
  const validRefundedAmount = validOrders.reduce(
    (sum, order) => sum.plus(order.refundAmount ?? 0),
    new Decimal(0),
  );
  const netSales = Decimal.max(grossValidSales.minus(validRefundedAmount), 0);
  const aov = validOrders.length === 0
    ? null
    : grossValidSales.dividedBy(validOrders.length);

  const canceledCount = periodOrders.filter(
    (order) => order.canonicalStatus === "CANCELED",
  ).length;
  const eligibleKnownCount = periodOrders.filter(
    (order) => order.deliveryEligible !== null,
  ).length;
  const deliveryEligible = periodOrders.filter(
    (order) => order.deliveryEligible === true,
  );
  const deliveredCount = deliveryEligible.filter((order) =>
    FULFILLED_STATUSES.has(order.canonicalStatus)
  ).length;
  const fulfilled = periodOrders.filter((order) =>
    FULFILLED_STATUSES.has(order.canonicalStatus)
  );
  const refundedOrders = fulfilled.filter(
    (order) =>
      order.canonicalStatus === "PARTIALLY_REFUNDED" ||
      order.canonicalStatus === "REFUNDED" ||
      (order.refundAmount !== null && new Decimal(order.refundAmount).greaterThan(0)),
  );
  const refundCoverage = fulfilled.length === 0
    ? 0
    : fulfilled.filter((order) => order.refundAmount !== null).length /
      fulfilled.length;

  const periodSettlements = input.settlements.filter((record) =>
    inRange(record.placedAt, range)
  );
  const currencySettlements = periodSettlements.filter(
    (record) => record.currency === input.currency,
  );
  const linkedSettlements = currencySettlements.filter(
    (record) => record.tradeOrderId !== null,
  );
  const linkedOrderIds = unique(
    linkedSettlements.map((record) => record.tradeOrderId as string),
  );
  const onHoldOrderIds = unique(
    linkedSettlements
      .filter((record) => record.settlementState === "ON_HOLD")
      .map((record) => record.tradeOrderId as string),
  );
  const expectedKnown = currencySettlements.filter(
    (record) => record.expectedSettlementAmount !== null,
  );
  const expectedTotal = expectedKnown.reduce(
    (sum, record) => sum.plus(record.expectedSettlementAmount ?? 0),
    new Decimal(0),
  );
  const onHoldExpected = expectedKnown
    .filter((record) => record.settlementState === "ON_HOLD")
    .reduce(
      (sum, record) => sum.plus(record.expectedSettlementAmount ?? 0),
      new Decimal(0),
    );
  const eligibleKnown = currencySettlements.filter(
    (record) => record.eligibleSettlementAmount !== null,
  );
  const settledAmountKnown = currencySettlements.filter(
    (record) => record.settledAmount !== null,
  );
  const settlementRateKnown = eligibleKnown.filter(
    (record) => record.settledAmount !== null,
  );
  const eligibleTotal = eligibleKnown.reduce(
    (sum, record) => sum.plus(record.eligibleSettlementAmount ?? 0),
    new Decimal(0),
  );
  const settledCashTotal = settledAmountKnown.reduce(
    (sum, record) => sum.plus(record.settledAmount ?? 0),
    new Decimal(0),
  );
  const settlementRateSettledTotal = settlementRateKnown.reduce(
    (sum, record) => sum.plus(record.settledAmount ?? 0),
    new Decimal(0),
  );

  const noFinance = currencySettlements.length === 0;
  const financeWarnings: MetricWarning[] = noFinance
    ? ["FINANCE_DATA_MISSING"]
    : [];
  const linkWarnings: MetricWarning[] = linkedSettlements.length === currencySettlements.length
    ? financeWarnings
    : [...financeWarnings, "FINANCE_ORDER_LINK_INCOMPLETE"];
  const expectedWarnings: MetricWarning[] = expectedKnown.length === currencySettlements.length
    ? financeWarnings
    : [...financeWarnings, "ON_HOLD_AMOUNT_INCOMPLETE"];
  const settlementWarnings: MetricWarning[] =
    eligibleKnown.length === currencySettlements.length &&
      settlementRateKnown.length === eligibleKnown.length
      ? financeWarnings
      : [...financeWarnings, "SETTLEMENT_DATA_INCOMPLETE"];

  const warnings = unique<MetricWarning>([
    ...commonWarnings,
    ...(periodOrders.length === 0 ? ["NO_ORDERS" as const] : []),
    ...(eligibleKnownCount === periodOrders.length
      ? []
      : ["DELIVERY_ELIGIBILITY_INCOMPLETE" as const]),
    ...(refundCoverage === 1 || fulfilled.length === 0
      ? []
      : ["REFUND_DATA_INCOMPLETE" as const]),
    ...financeWarnings,
  ]);

  const dataCoverage = periodOrders.length === 0
    ? 0
    : currencyOrders.length / periodOrders.length;
  const refundAmountCoverage = currencyOrders.length === 0
    ? 0
    : refundKnown.length / currencyOrders.length;
  const netSalesCoverage = validOrders.length === 0
    ? dataCoverage
    : validRefundKnown.length / validOrders.length;
  const settlementCoverage = currencySettlements.length === 0
    ? 0
    : settlementRateKnown.length / currencySettlements.length;
  const settledCashCoverage = currencySettlements.length === 0
    ? 0
    : settledAmountKnown.length / currencySettlements.length;

  return {
    orders: {
      total: periodOrders.length,
      awaitingShipment: periodOrders.filter(
        (order) => order.canonicalStatus === "AWAITING_SHIPMENT",
      ).length,
      inTransit: periodOrders.filter(
        (order) => order.canonicalStatus === "IN_TRANSIT",
      ).length,
      deliveredOrCompleted: periodOrders.filter((order) =>
        order.canonicalStatus === "DELIVERED" ||
        order.canonicalStatus === "COMPLETED"
      ).length,
      canceled: canceledCount,
      refunded: refundedOrders.length,
      onHold: onHoldOrderIds.length,
    },
    bookedSales: moneyMetric(
      bookedSales,
      input.currency,
      currencyOrders.length,
      dataCoverage,
      commonWarnings,
    ),
    grossValidSales: moneyMetric(
      grossValidSales,
      input.currency,
      validOrders.length,
      dataCoverage,
      commonWarnings,
    ),
    refundedAmount: moneyMetric(
      refundedAmount,
      input.currency,
      refundKnown.length,
      refundAmountCoverage,
      refundAmountCoverage === 1
        ? commonWarnings
        : [...commonWarnings, "REFUND_DATA_INCOMPLETE"],
    ),
    netSales: moneyMetric(
      netSales,
      input.currency,
      validOrders.length,
      Math.min(dataCoverage, netSalesCoverage),
      warnings.filter((warning) =>
        warning === "CURRENCY_MISMATCH" || warning === "REFUND_DATA_INCOMPLETE"
      ),
    ),
    settledCash: moneyMetric(
      settledAmountKnown.length === 0 ? null : settledCashTotal,
      input.currency,
      settledAmountKnown.length,
      settledCashCoverage,
      settledCashCoverage === 1
        ? financeWarnings
        : [...financeWarnings, "SETTLEMENT_DATA_INCOMPLETE"],
    ),
    averageOrderValue: moneyMetric(
      aov,
      input.currency,
      validOrders.length,
      dataCoverage,
      commonWarnings,
    ),
    deliveryRate: rateMetric(
      deliveredCount,
      deliveryEligible.length,
      deliveryEligible.length,
      periodOrders.length === 0 ? 0 : eligibleKnownCount / periodOrders.length,
      eligibleKnownCount === periodOrders.length
        ? []
        : ["DELIVERY_ELIGIBILITY_INCOMPLETE"],
    ),
    cancellationRate: rateMetric(
      canceledCount,
      periodOrders.length,
      periodOrders.length,
      1,
    ),
    refundRate: rateMetric(
      refundedOrders.length,
      fulfilled.length,
      fulfilled.length,
      refundCoverage,
      refundCoverage === 1 || fulfilled.length === 0
        ? []
        : ["REFUND_DATA_INCOMPLETE"],
    ),
    onHoldOrderRate: rateMetric(
      onHoldOrderIds.length,
      linkedOrderIds.length,
      linkedOrderIds.length,
      currencySettlements.length === 0
        ? 0
        : linkedSettlements.length / currencySettlements.length,
      linkWarnings,
    ),
    onHoldMoneyRate: {
      value: decimalRate(onHoldExpected, expectedTotal),
      numerator: decimalString(onHoldExpected),
      denominator: decimalString(expectedTotal),
      currency: input.currency,
      sampleSize: expectedKnown.length,
      coverage: currencySettlements.length === 0
        ? 0
        : expectedKnown.length / currencySettlements.length,
      warnings: expectedWarnings,
    },
    settlementRate: {
      value: decimalRate(settlementRateSettledTotal, eligibleTotal),
      numerator: decimalString(settlementRateSettledTotal),
      denominator: decimalString(eligibleTotal),
      currency: input.currency,
      sampleSize: settlementRateKnown.length,
      coverage: settlementCoverage,
      warnings: settlementWarnings,
    },
    warnings,
  };
}

function relativeChange(current: Decimal, previous: Decimal): number | null {
  return previous.isZero()
    ? null
    : current.minus(previous).dividedBy(previous).toNumber();
}

function rateDelta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

export function calculateMetrics(input: MetricsInput): MetricsResult {
  const current = calculatePeriod(input, input.currentRange);
  const previous = calculatePeriod(input, input.previousRange);
  const currentSales = new Decimal(current.grossValidSales.value ?? 0);
  const previousSales = new Decimal(previous.grossValidSales.value ?? 0);

  return {
    current,
    previous,
    trends: {
      orders: {
        current: current.orders.total,
        previous: previous.orders.total,
        absoluteDelta: current.orders.total - previous.orders.total,
        relativeChange: previous.orders.total === 0
          ? null
          : (current.orders.total - previous.orders.total) /
            previous.orders.total,
      },
      grossValidSales: {
        current: decimalString(currentSales),
        previous: decimalString(previousSales),
        absoluteDelta: decimalString(currentSales.minus(previousSales)),
        relativeChange: relativeChange(currentSales, previousSales),
        currency: input.currency,
      },
      deliveryRate: {
        current: current.deliveryRate.value,
        previous: previous.deliveryRate.value,
        percentagePointDelta: rateDelta(
          current.deliveryRate.value,
          previous.deliveryRate.value,
        ),
      },
      cancellationRate: {
        current: current.cancellationRate.value,
        previous: previous.cancellationRate.value,
        percentagePointDelta: rateDelta(
          current.cancellationRate.value,
          previous.cancellationRate.value,
        ),
      },
      refundRate: {
        current: current.refundRate.value,
        previous: previous.refundRate.value,
        percentagePointDelta: rateDelta(
          current.refundRate.value,
          previous.refundRate.value,
        ),
      },
      onHoldOrderRate: {
        current: current.onHoldOrderRate.value,
        previous: previous.onHoldOrderRate.value,
        percentagePointDelta: rateDelta(
          current.onHoldOrderRate.value,
          previous.onHoldOrderRate.value,
        ),
      },
      onHoldMoneyRate: {
        current: current.onHoldMoneyRate.value,
        previous: previous.onHoldMoneyRate.value,
        percentagePointDelta: rateDelta(
          current.onHoldMoneyRate.value,
          previous.onHoldMoneyRate.value,
        ),
      },
    },
  };
}
