import { z } from "zod";

import {
  CurrencyCodeSchema,
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
  expectedSettlementAmount: NonNegativeDecimalStringSchema.nullable(),
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
