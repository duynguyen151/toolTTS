import { z } from "zod";

import {
  CurrencyCodeSchema,
  JsonObjectSchema,
  NonNegativeDecimalStringSchema,
} from "./common.js";

export const CanonicalOrderStatusSchema = z.enum([
  "PENDING",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "CANCELED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "UNKNOWN",
]);

export type CanonicalOrderStatus = z.infer<
  typeof CanonicalOrderStatusSchema
>;

export const NormalizedOrderSchema = z.object({
  shopId: z.string().min(1),
  sourceOrderId: z.string().min(1),
  createdAt: z.date().nullable(),
  paidAt: z.date().nullable(),
  sourceUpdatedAt: z.date().nullable(),
  readyToShipAt: z.date().nullable().default(null),
  latestDeliveryAt: z.date().nullable(),
  sourceStatus: z.string().min(1),
  sourceSubStatus: z.string().nullable(),
  canonicalStatus: CanonicalOrderStatusSchema,
  grandTotal: NonNegativeDecimalStringSchema,
  currency: CurrencyCodeSchema,
  trackingNumber: z.string().min(1).nullable(),
  carrier: z.string().min(1).nullable(),
  refundAmount: NonNegativeDecimalStringSchema.nullable(),
  refundStatus: z.string().nullable(),
  deliveryEligible: z.boolean().nullable(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  sourceHash: z.string().min(1),
  sourceSchemaVersion: z.string().min(1),
  rawData: JsonObjectSchema,
});

export type NormalizedOrder = z.infer<typeof NormalizedOrderSchema>;

export const OrderSourceWindowSchema = z.object({
  source: z.literal("SELLER_CENTER"),
  kind: z.literal("ROLLING_MONTHS"),
  months: z.literal(12),
  lifetimeHistory: z.literal(false),
});

export type OrderSourceWindow = z.infer<typeof OrderSourceWindowSchema>;

export const NormalizedOrderBatchSchema = z.object({
  orders: z.array(NormalizedOrderSchema),
  checkpoint: z.string().nullable(),
  complete: z.boolean(),
  sourceWindow: OrderSourceWindowSchema,
});

export type NormalizedOrderBatch = z.infer<
  typeof NormalizedOrderBatchSchema
>;
