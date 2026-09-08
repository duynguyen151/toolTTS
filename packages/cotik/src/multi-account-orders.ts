import { z } from "zod";
import type { CotikOrderItemContract, CotikOrderObservationContract } from "@shop-health/domain";
import type { MultiAccountCotikClient } from "./multi-account-client.js";

const EpochSecondsSchema = z.union([
  z.number().int().nonnegative(),
  z.string().trim().regex(/^\d+$/).transform((val) => Number.parseInt(val, 10))
]);

export const RawCotikOrderItemSchema = z.object({
  sku_id: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? String(v) : "")),
  seller_sku: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? String(v) : "")),
  sku_name: z.string().optional().default(""),
  product_name: z.string().optional().default(""),
  quantity: z.union([z.number(), z.string()]).optional().default(1).transform((v) => {
    const n = typeof v === "number" ? v : Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }),
  ref_link: z.string().optional(),
  provider_evidence: z.record(z.string(), z.unknown()).optional()
});

/** Cotik shop reference embedded in each order */
export const CotikOrderShopRefSchema = z.object({
  _id: z.string().min(1),
  name: z.string().optional(),
  code: z.string().optional(),
  note: z.string().optional()
});

export const RawCotikOrderSchema = z.object({
  _id: z.string().optional(),
  apiOrderId: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? String(v) : undefined)),
  order_id: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? String(v) : undefined)),
  status: z.string().optional(),
  order_status: z.string().optional(),
  shipping_type: z.string().optional(),
  create_time: EpochSecondsSchema.optional(),
  update_time: EpochSecondsSchema.optional(),
  tracking_number: z.string().optional(),
  carrier: z.string().optional(),
  shipping_provider: z.string().optional(),
  line_items: z.array(RawCotikOrderItemSchema).optional(),
  items: z.array(RawCotikOrderItemSchema).optional(),
  shops: CotikOrderShopRefSchema.optional()
});

// Cotik GET /order/list returns: { status, data: { listorders: [...], totalsize: N } }
// The client strips the envelope and passes envelope.data to this schema.
export const CotikOrderListResponseSchema = z.object({
  listorders: z.array(RawCotikOrderSchema).optional().default([]),
  totalsize: z.number().optional().default(0)
}).passthrough();

export interface FetchCotikOrdersFilter {
  cotikShopId: string;
  createTimeFromMs?: number | undefined;
  createTimeToMs?: number | undefined;
  updateTimeFromMs?: number | undefined;
  updateTimeToMs?: number | undefined;
  pageSize?: number | undefined; // <= 100
  maxPages?: number | undefined;
}

/** Fail-closed: returns null for missing/invalid input instead of inventing current time. */
export function epochSecondsToDate(seconds?: number | string | null): Date | null {
  if (seconds == null) return null;
  const num = typeof seconds === "number" ? seconds : Number.parseInt(String(seconds).trim(), 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Cotik returns epoch seconds. If value looks like milliseconds (> 1e11), use directly.
  const ms = num > 1e11 ? num : num * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function parseCotikOrderItems(raw: z.infer<typeof RawCotikOrderSchema>): CotikOrderItemContract[] {
  const rawItems = raw.line_items ?? raw.items ?? [];
  if (rawItems.length === 0) {
    return [
      {
        sku: "UNKNOWN",
        skuName: "Standard Item",
        quantity: 1
      }
    ];
  }

  return rawItems.map((item) => {
    const sku = item.seller_sku || item.sku_id || "UNKNOWN";
    const skuName = item.sku_name || item.product_name || "Item";
    return {
      sku,
      skuName,
      refLink: item.ref_link ?? null,
      quantity: item.quantity,
      providerEvidence: item.provider_evidence ?? null
    };
  });
}

/**
 * PII keys that must NEVER be persisted per AGENTS.md rules.
 * Cotik order responses may include buyer name, address, phone, and payment details.
 */
const PII_KEYS_TO_STRIP: ReadonlySet<string> = new Set([
  "recipient_address",
  "buyer_message",
  "buyer_uid",
  "buyer_email",
  "phone_number",
  "payment",
  "buyer_info",
  "consignee_info"
]);

/**
 * Strips PII fields from a raw Cotik order object before storing as rawData.
 * Never persists buyer names, contact details, addresses, or payment info.
 */
export function stripPiiFromRawOrder(raw: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!PII_KEYS_TO_STRIP.has(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

export function normalizeRawToObservation(
  raw: z.infer<typeof RawCotikOrderSchema>,
  accountId: string,
  logicalShopId: string,
  cotikShopId: string,
  observedAt = new Date()
): CotikOrderObservationContract {
  const orderId = raw.apiOrderId || raw.order_id || "";
  if (!orderId) {
    throw new Error("Order missing orderId in Cotik response");
  }

  const orderStatus = raw.status || raw.order_status || "UNKNOWN";
  const orderCreateTime = epochSecondsToDate(raw.create_time) ?? new Date(0);
  const orderUpdateTime = epochSecondsToDate(raw.update_time) ?? new Date(0);
  const items = parseCotikOrderItems(raw);

  // Strip PII before storing rawData — AGENTS.md: never persist buyer names,
  // contact details, or shipping addresses.
  const safeRaw = stripPiiFromRawOrder(raw as Record<string, unknown>);

  return {
    accountId,
    logicalShopId,
    cotikShopId,
    orderId,
    orderStatus,
    orderCreateTime,
    orderUpdateTime,
    tracking: raw.tracking_number ?? null,
    carrier: raw.carrier ?? null,
    shippingProvider: raw.shipping_provider ?? null,
    items,
    rawData: safeRaw,
    observedAt
  };
}

export async function fetchCotikOrdersPage(
  client: MultiAccountCotikClient,
  filter: FetchCotikOrdersFilter,
  page: number
): Promise<{ observations: CotikOrderObservationContract[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 100, 1), 100);

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("sizeperpage", String(pageSize));
  queryParams.set("filter2", filter.cotikShopId);

  if (filter.createTimeFromMs !== undefined) {
    queryParams.set("filter9", String(filter.createTimeFromMs));
  }
  if (filter.createTimeToMs !== undefined) {
    queryParams.set("filter10", String(filter.createTimeToMs));
  }
  if (filter.updateTimeFromMs !== undefined) {
    queryParams.set("filter11", String(filter.updateTimeFromMs));
  }
  if (filter.updateTimeToMs !== undefined) {
    queryParams.set("filter12", String(filter.updateTimeToMs));
  }

  const path = `/order/list?${queryParams.toString()}`;
  // Cotik returns { listorders: [...], totalsize: N } inside envelope.data
  const response = await client.get(path, CotikOrderListResponseSchema);

  const observedAt = new Date();
  const observations: CotikOrderObservationContract[] = [];

  for (const raw of response.listorders) {
    try {
      const obs = normalizeRawToObservation(
        raw,
        client.accountId,
        "", // logicalShopId populated by sync orchestration
        filter.cotikShopId,
        observedAt
      );
      observations.push(obs);
    } catch {
      // Skip unparseable order without failing the whole batch
      continue;
    }
  }

  return {
    observations,
    total: response.totalsize
  };
}
