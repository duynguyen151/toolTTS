import {
  NormalizedOrderSchema,
  type CanonicalOrderStatus,
  type NormalizedOrder,
} from "@shop-health/domain";

import type { RawOrder } from "../extractors/schemas.js";
import { nullableText, stableHash, timestamp } from "./shared.js";

const CONFIRMED_STATUS_MAP: Readonly<Record<string, CanonicalOrderStatus>> = {
  "101": "AWAITING_SHIPMENT",
  "102": "DELIVERED",
  "104": "CANCELED",
};

export function normalizeOrder(raw: RawOrder, shopId: string, observedAt = new Date()): NormalizedOrder {
  const statusCodes = raw.order_status_module.map((status) => String(status.main_order_status));
  const subStatusCodes = raw.order_status_module
    .map((status) => status.main_sub_order_status)
    .filter((status): status is string | number => status !== undefined)
    .map(String);
  const canonicalStatus = canonicalizeStatuses(statusCodes);
  const price = raw.price_module.grand_total;
  const grandTotal = price.price_val ?? price.amount;
  const currency = price.currency?.toUpperCase();
  if (!grandTotal || !currency) {
    throw new Error(`Order ${raw.main_order_id} has no validated grand total/currency`);
  }

  const delivery = raw.delivery_module?.find((item) => item.tracking_no) ?? raw.delivery_module?.[0];
  const updateTimes = raw.fulfillment_module
    ?.map((item) => timestamp(item.update_time))
    .filter((item): item is Date => item !== null) ?? [];
  const sourceUpdatedAt = updateTimes.sort((left, right) => right.valueOf() - left.valueOf())[0] ?? null;
  const readyToShipTimes = raw.fulfillment_module
    ?.map((item) => timestamp(item.rts_time))
    .filter((item): item is Date => item !== null) ?? [];
  const readyToShipAt = singleTimestamp(readyToShipTimes);
  const reverseSource = raw.reverse_module?.[0];
  const reverse = reverseSource === undefined
    ? null
    : {
        reverseStatus: String(reverseSource.reverse_status),
        reverseTabStatus: String(reverseSource.reverse_tab_status),
        reverseType: String(reverseSource.reverse_type),
        reverseFrom: String(reverseSource.reverse_from),
        cancelledTime: reverseSource.cancelled_time,
        refundTime: reverseSource.refund_time,
        sellerAutoApproveTime: reverseSource.seller_auto_approve_time,
      };
  const rawData = {
    mainOrderId: raw.main_order_id,
    tradeOrder: {
      createTime: raw.trade_order_module.create_time ?? null,
      paymentTime: raw.trade_order_module.payment_time ?? null,
      latestDeliveryTime: raw.trade_order_module.latest_delivery_time ?? null,
    },
    statusCodes,
    subStatusCodes,
    fulfillmentUpdateTimes: raw.fulfillment_module?.map((item) => item.update_time ?? null) ?? [],
    fulfillmentReadyToShipTimes: raw.fulfillment_module?.map((item) => item.rts_time ?? null) ?? [],
    price: { grandTotal, currency },
    delivery: {
      trackingNumber: nullableText(delivery?.tracking_no),
      carrier: nullableText(delivery?.logistics_service_info?.logistics_service_name),
      serviceLevel: nullableText(delivery?.logistics_service_info?.logistics_service_level),
    },
    reverse,
  };

  return NormalizedOrderSchema.parse({
    shopId,
    sourceOrderId: raw.main_order_id,
    createdAt: timestamp(raw.trade_order_module.create_time),
    paidAt: timestamp(raw.trade_order_module.payment_time),
    sourceUpdatedAt,
    readyToShipAt,
    latestDeliveryAt: timestamp(raw.trade_order_module.latest_delivery_time),
    sourceStatus: statusCodes.join(","),
    sourceSubStatus: subStatusCodes.length > 0 ? subStatusCodes.join(",") : null,
    canonicalStatus,
    grandTotal,
    currency,
    trackingNumber: rawData.delivery.trackingNumber,
    carrier: rawData.delivery.carrier,
    refundAmount: null,
    refundStatus: reverse === null
      ? null
      : JSON.stringify({
          source: "SELLER_CENTER_REVERSE",
          reverseStatus: reverse.reverseStatus,
          reverseTabStatus: reverse.reverseTabStatus,
          reverseType: reverse.reverseType,
          reverseFrom: reverse.reverseFrom,
        }),
    deliveryEligible: ["IN_TRANSIT", "DELIVERED", "COMPLETED"].includes(canonicalStatus) ? true : null,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    sourceHash: stableHash(rawData),
    sourceSchemaVersion: "seller-center-us-orders.v2",
    rawData,
  });
}

function singleTimestamp(values: readonly Date[]): Date | null {
  const unique = [...new Map(values.map((value) => [value.valueOf(), value])).values()];
  return unique.length === 1 ? unique[0] ?? null : null;
}

function canonicalizeStatuses(statusCodes: readonly string[]): CanonicalOrderStatus {
  const mapped = new Set(statusCodes.map((code) => CONFIRMED_STATUS_MAP[code] ?? "UNKNOWN"));
  if (mapped.size === 1) return mapped.values().next().value ?? "UNKNOWN";
  return "UNKNOWN";
}
