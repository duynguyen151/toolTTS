import { z } from "zod";

import {
  CurrencyCodeSchema,
  DecimalStringSchema,
  JsonObjectSchema,
  NonNegativeDecimalStringSchema,
} from "./common.js";

export const SettlementStateSchema = z.enum([
  "ON_HOLD",
  "ELIGIBLE",
  "SETTLED",
  "UNKNOWN",
]);

export type SettlementState = z.infer<typeof SettlementStateSchema>;

export const NormalizedSettlementRecordSchema = z.object({
  shopId: z.string().min(1),
  sourceStatementDetailId: z.string().min(1),
  tradeOrderId: z.string().min(1).nullable(),
  placedAt: z.date().nullable(),
  deliveredAt: z.date().nullable(),
  estimatedSettlementAt: z.date().nullable(),
  earningAmount: NonNegativeDecimalStringSchema.nullable(),
  feeAmount: NonNegativeDecimalStringSchema.nullable(),
  shippingAmount: NonNegativeDecimalStringSchema.nullable(),
  expectedSettlementAmount: DecimalStringSchema.nullable(),
  eligibleSettlementAmount: NonNegativeDecimalStringSchema.nullable(),
  settledAmount: NonNegativeDecimalStringSchema.nullable(),
  currency: CurrencyCodeSchema,
  sourceSettlementStatus: z.string().min(1),
  settlementState: SettlementStateSchema,
  onHoldReason: z.string().nullable(),
  sourceHash: z.string().min(1),
  sourceSchemaVersion: z.string().min(1),
  rawData: JsonObjectSchema,
});

export type NormalizedSettlementRecord = z.infer<
  typeof NormalizedSettlementRecordSchema
>;

export const NormalizedFinancialSnapshotSchema = z.object({
  shopId: z.string().min(1),
  capturedAt: z.date(),
  currency: CurrencyCodeSchema,
  availableBalance: NonNegativeDecimalStringSchema.nullable(),
  frozenBalance: NonNegativeDecimalStringSchema.nullable(),
  totalBalance: NonNegativeDecimalStringSchema.nullable(),
  toSettleBalance: NonNegativeDecimalStringSchema.nullable(),
  onHoldBalance: NonNegativeDecimalStringSchema.nullable(),
  officialOnHoldAmount: DecimalStringSchema.nullable().default(null),
  waitingForPackageDeliveryAmount: DecimalStringSchema.nullable().optional(),
  deliveredAwaitingSettlementAmount: DecimalStringSchema.nullable().optional(),
  waitingForCompletedRefundReturnAmount: DecimalStringSchema.nullable().optional(),
  reasonTotalsReconcileToOfficialOnHold: z.boolean().nullable().optional(),
  settlementPeriodDays: z.number().int().nonnegative().nullable().default(null),
  settlementPeriodType: z.string().min(1).nullable().default(null),
  reserveRatio: z.number().min(0).max(1).nullable(),
  reserveDays: z.number().int().nonnegative().nullable(),
  reserveLevel: z.string().nullable(),
  snapshotHash: z.string().min(1),
  sourceSchemaVersion: z.string().min(1),
  rawData: JsonObjectSchema,
});

export type NormalizedFinancialSnapshot = z.infer<
  typeof NormalizedFinancialSnapshotSchema
>;

export const NormalizedFinancialBatchSchema = z.object({
  settlements: z.array(NormalizedSettlementRecordSchema),
  snapshot: NormalizedFinancialSnapshotSchema.nullable(),
  checkpoint: z.string().nullable(),
  complete: z.boolean(),
});

export type NormalizedFinancialBatch = z.infer<
  typeof NormalizedFinancialBatchSchema
>;

/** Signed COTIK amounts are bounded to PostgreSQL numeric(20,4) without rounding. */
export const CotikSignedDecimalAmountSchema = z
  .string()
  .regex(/^-?\d{1,16}(?:\.\d{1,4})?$/, "Expected a signed decimal amount with at most 4 fractional digits");

/** COTIK statements are supplementary facts, never Official On Hold evidence. */
export const CotikSupplementaryStatementSchema = z.strictObject({
  shopId: z.string().min(1),
  providerStatementId: z.string().min(1),
  providerPaymentId: z.string().min(1).nullable(),
  providerShopId: z.string().min(1),
  statementAt: z.date(),
  currency: CurrencyCodeSchema,
  revenueAmount: CotikSignedDecimalAmountSchema,
  feeAmount: CotikSignedDecimalAmountSchema,
  adjustmentAmount: CotikSignedDecimalAmountSchema,
  shippingCostAmount: CotikSignedDecimalAmountSchema,
  netSalesAmount: CotikSignedDecimalAmountSchema,
  settlementAmount: CotikSignedDecimalAmountSchema,
  paymentStatus: z.string().min(1),
  orderIds: z.array(z.string().min(1)),
  observedAt: z.date(),
  sourceHash: z.string().min(1),
  sourceSchemaVersion: z.string().min(1),
  rawData: JsonObjectSchema,
  classification: z.literal("SUPPLEMENTARY_FINANCE"),
  officialOnHoldCapabilityStatus: z.literal("OFFICIAL_ON_HOLD_UNPROVEN"),
});

export type CotikSupplementaryStatement = z.infer<typeof CotikSupplementaryStatementSchema>;

/** COTIK payouts join supplementary statements by `providerPaymentId` only. */
export const CotikSupplementaryPaymentSchema = z.strictObject({
  shopId: z.string().min(1),
  providerPaymentId: z.string().min(1),
  providerShopId: z.string().min(1),
  paymentStatus: z.string().min(1),
  currency: CurrencyCodeSchema,
  amount: CotikSignedDecimalAmountSchema,
  settlementAmount: CotikSignedDecimalAmountSchema,
  reserveAmount: CotikSignedDecimalAmountSchema,
  paymentAmountBeforeExchange: CotikSignedDecimalAmountSchema,
  createdAt: z.date(),
  paidAt: z.date(),
  observedAt: z.date(),
  sourceHash: z.string().min(1),
  sourceSchemaVersion: z.string().min(1),
  rawData: JsonObjectSchema,
  classification: z.literal("SUPPLEMENTARY_FINANCE"),
  officialOnHoldCapabilityStatus: z.literal("OFFICIAL_ON_HOLD_UNPROVEN"),
});

export type CotikSupplementaryPayment = z.infer<typeof CotikSupplementaryPaymentSchema>;
