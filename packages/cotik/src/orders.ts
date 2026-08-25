import { createHash } from "node:crypto";

import { z } from "zod";

import {
  type CanonicalOrderStatus,
  NormalizedOrderSchema,
  type NormalizedOrder,
} from "@shop-health/domain";

/**
 * COTIK guide §3.2 documents exactly these TikTok order statuses; CANCELLED is
 * the guide's British spelling of the canonical CANCELED bucket.
 */
const CANONICAL_STATUS_MAP: Readonly<Record<string, CanonicalOrderStatus>> = {
  UNPAID: "UNPAID",
  ON_HOLD: "ON_HOLD",
  AWAITING_SHIPMENT: "AWAITING_SHIPMENT",
  AWAITING_COLLECTION: "AWAITING_COLLECTION",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELED",
};

const EpochSecondsSchema = z.number().int().nonnegative();
const SourceTextSchema = z.union([z.string(), z.number()]);
const DecimalAmountSchema = z.string().regex(/^\d+(?:\.\d+)?$/);

/** Allowlisted operational payment values; no buyer or address data exists here. */
const CotikPaymentSchema = z.object({
  currency: z.string().min(1),
  total_amount: DecimalAmountSchema,
  sub_total: DecimalAmountSchema.optional(),
  shipping_fee: z.string().optional(),
});

/** Product/SKU summary only: identifiers and price, never product display names. */
const CotikLineItemSchema = z.object({
  product_id: SourceTextSchema.optional(),
  sku_id: SourceTextSchema.optional(),
  seller_sku: SourceTextSchema.optional(),
  sale_price: z.string().optional(),
  currency: z.string().optional(),
});

const CotikShopRefSchema = z.object({
  _id: z.string().min(1),
});

export const CotikOrderSchema = z.object({
  _id: z.string().min(1).optional(),
  apiOrderId: z.string().min(1),
  status: z.string().min(1),
  order_status: z.string().optional(),
  shipping_type: z.string().optional(),
  tracking_number: z.string().optional(),
  create_time: EpochSecondsSchema.optional(),
  update_time: EpochSecondsSchema.optional(),
  tts_sla_time: EpochSecondsSchema.optional(),
  rts_sla_time: EpochSecondsSchema.optional(),
  delivery_time: EpochSecondsSchema.optional(),
  cancel_time: EpochSecondsSchema.optional(),
  payment: CotikPaymentSchema,
  line_items: z.array(CotikLineItemSchema).optional(),
  shops: CotikShopRefSchema.optional(),
});

export type CotikOrderInput = z.infer<typeof CotikOrderSchema>;

/**
 * Normalizes one COTIK order into the canonical shape. Every supplied order
 * yields exactly one result; undocumented statuses stay explicitly UNKNOWN.
 * Missing optional fields become null — no value is ever invented.
 */
export function normalizeCotikOrder(raw: unknown, shopId: string, observedAt = new Date()): NormalizedOrder {
  const source = CotikOrderSchema.parse(raw);
  const canonicalStatus = CANONICAL_STATUS_MAP[source.status] ?? "UNKNOWN";
  // ponytail: local stable-hash copy mirrors seller-center's shared helper;
  // extract to a shared package util when a third consumer appears.
  const rawData = buildRawData(source);
  const workStatus = nullableText(source.order_status);

  return NormalizedOrderSchema.parse({
    shopId,
    sourceOrderId: source.apiOrderId,
    createdAt: secondsToTimestamp(source.create_time),
    paidAt: null,
    sourceUpdatedAt: secondsToTimestamp(source.update_time),
    readyToShipAt: null,
    latestDeliveryAt: secondsToTimestamp(source.delivery_time),
    sourceStatus: source.status,
    sourceSubStatus: workStatus,
    canonicalStatus,
    grandTotal: source.payment.total_amount,
    currency: source.payment.currency.trim().toUpperCase(),
    trackingNumber: nullableText(source.tracking_number),
    carrier: null,
    refundAmount: null,
    refundStatus: null,
    deliveryEligible: ["IN_TRANSIT", "DELIVERED", "COMPLETED"].includes(canonicalStatus) ? true : null,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    sourceHash: stableHash(rawData),
    sourceSchemaVersion: "cotik-us-orders.v1",
    rawData,
  });
}

/** rawData allowlist: operational values plus product/SKU summaries, never PII. */
function buildRawData(source: CotikOrderInput): Record<string, unknown> {
  return {
    cotikId: source._id ?? null,
    status: source.status,
    workStatus: nullableText(source.order_status),
    shippingType: nullableText(source.shipping_type),
    trackingNumber: nullableText(source.tracking_number),
    createdAt: source.create_time ?? null,
    updatedAt: source.update_time ?? null,
    ttsSlaAt: source.tts_sla_time ?? null,
    rtsSlaAt: source.rts_sla_time ?? null,
    deliveredAt: source.delivery_time ?? null,
    canceledAt: source.cancel_time ?? null,
    cotikShopId: source.shops?._id ?? null,
    payment: {
      currency: source.payment.currency.trim().toUpperCase(),
      totalAmount: source.payment.total_amount,
      subTotal: source.payment.sub_total ?? null,
      shippingFee: source.payment.shipping_fee ?? null,
    },
    lineItemSummaries: (source.line_items ?? []).map((item) => ({
      productId: optionalText(item.product_id),
      skuId: optionalText(item.sku_id),
      sellerSku: optionalText(item.seller_sku),
      salePrice: item.sale_price ?? null,
      currency: item.currency ?? null,
    })),
  };
}

/** COTIK epoch times are seconds; 0 means unset and must stay null. */
function secondsToTimestamp(value: number | undefined): Date | null {
  if (value === undefined || value <= 0) return null;
  const parsed = new Date(value * 1000);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function nullableText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function optionalText(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function stableHash(value: object): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
