import { z } from "zod";

import { NonNegativeDecimalStringSchema } from "../contracts/common.js";

export const MetricWarningSchema = z.enum([
  "NO_ORDERS",
  "DELIVERY_ELIGIBILITY_INCOMPLETE",
  "REFUND_DATA_INCOMPLETE",
  "FINANCE_DATA_MISSING",
  "FINANCE_ORDER_LINK_INCOMPLETE",
  "ON_HOLD_AMOUNT_INCOMPLETE",
  "SETTLEMENT_DATA_INCOMPLETE",
  "CURRENCY_MISMATCH",
]);

export type MetricWarning = z.infer<typeof MetricWarningSchema>;

const MetricMetadataSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  warnings: z.array(MetricWarningSchema),
});

export const RateMetricSchema = MetricMetadataSchema.extend({
  value: z.number().min(0).max(1).nullable(),
  numerator: z.number().nonnegative(),
  denominator: z.number().nonnegative(),
});

export type RateMetric = z.infer<typeof RateMetricSchema>;

export const MoneyRateMetricSchema = MetricMetadataSchema.extend({
  value: z.number().min(0).max(1).nullable(),
  numerator: NonNegativeDecimalStringSchema,
  denominator: NonNegativeDecimalStringSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export type MoneyRateMetric = z.infer<typeof MoneyRateMetricSchema>;

export const MoneyMetricSchema = MetricMetadataSchema.extend({
  value: NonNegativeDecimalStringSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export type MoneyMetric = z.infer<typeof MoneyMetricSchema>;

export const OrderCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  awaitingShipment: z.number().int().nonnegative(),
  inTransit: z.number().int().nonnegative(),
  deliveredOrCompleted: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  refunded: z.number().int().nonnegative(),
  onHold: z.number().int().nonnegative(),
});

export type OrderCounts = z.infer<typeof OrderCountsSchema>;

export const PeriodMetricsSchema = z.object({
  orders: OrderCountsSchema,
  bookedSales: MoneyMetricSchema,
  grossValidSales: MoneyMetricSchema,
  refundedAmount: MoneyMetricSchema,
  netSales: MoneyMetricSchema,
  settledCash: MoneyMetricSchema,
  averageOrderValue: MoneyMetricSchema,
  deliveryRate: RateMetricSchema,
  cancellationRate: RateMetricSchema,
  refundRate: RateMetricSchema,
  onHoldOrderRate: RateMetricSchema,
  onHoldMoneyRate: MoneyRateMetricSchema,
  settlementRate: MoneyRateMetricSchema,
  warnings: z.array(MetricWarningSchema),
});

export type PeriodMetrics = z.infer<typeof PeriodMetricsSchema>;

export const NumericTrendSchema = z.object({
  current: z.number(),
  previous: z.number(),
  absoluteDelta: z.number(),
  relativeChange: z.number().nullable(),
});

export const MoneyTrendSchema = z.object({
  current: NonNegativeDecimalStringSchema,
  previous: NonNegativeDecimalStringSchema,
  absoluteDelta: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  relativeChange: z.number().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const RateTrendSchema = z.object({
  current: z.number().min(0).max(1).nullable(),
  previous: z.number().min(0).max(1).nullable(),
  percentagePointDelta: z.number().nullable(),
});

export const MetricsTrendsSchema = z.object({
  orders: NumericTrendSchema,
  grossValidSales: MoneyTrendSchema,
  deliveryRate: RateTrendSchema,
  cancellationRate: RateTrendSchema,
  refundRate: RateTrendSchema,
  onHoldOrderRate: RateTrendSchema,
  onHoldMoneyRate: RateTrendSchema,
});

export type MetricsTrends = z.infer<typeof MetricsTrendsSchema>;

export const MetricsResultSchema = z.object({
  current: PeriodMetricsSchema,
  previous: PeriodMetricsSchema,
  trends: MetricsTrendsSchema,
});

export type MetricsResult = z.infer<typeof MetricsResultSchema>;
