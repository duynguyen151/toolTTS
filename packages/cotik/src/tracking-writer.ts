import { z } from "zod";

import type { MultiAccountCotikClient } from "./multi-account-client.js";

export const MAX_TRACKING_BATCH_SIZE = 50;

export interface CotikTrackingItem {
  orderId: string;
  tracking: string;
  providerId: string;
}

export interface PostCotikTrackingBatchInput {
  client: MultiAccountCotikClient;
  items: CotikTrackingItem[];
  isPostAuthorized: () => Promise<boolean>;
}

export const CotikLogUpdateItemSchema = z.object({
  apiOrderId: z.union([z.string(), z.number()]).transform(String),
  status: z.string().optional().default("")
}).passthrough();

export const CotikPostTrackingResponseSchema = z.object({
  logUpdate: z.array(CotikLogUpdateItemSchema).optional().default([])
}).passthrough();

export const CotikReadbackOrderSchema = z.object({
  apiOrderId: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? String(v) : undefined)),
  order_id: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? String(v) : undefined)),
  status: z.string().optional(),
  tracking_number: z.string().optional(),
  tracking: z.string().optional(),
  shipping_type: z.string().optional(),
  order_status: z.string().optional()
}).passthrough();

export const CotikReadbackResponseSchema = z.object({
  listorders: z.array(CotikReadbackOrderSchema).optional(),
  data: z.union([
    z.array(CotikReadbackOrderSchema),
    z.object({
      listorders: z.array(CotikReadbackOrderSchema).optional(),
      data: z.array(CotikReadbackOrderSchema).optional()
    }).passthrough()
  ]).optional()
}).passthrough();

export interface PostCotikTrackingResult {
  status:
    | "CONFIRMED"
    | "REFUSED_KILL_SWITCH"
    | "REJECTED_INVALID_PROVIDER"
    | "FAILED"
    | "UNCONFIRMED"
    | "PARTIALLY_CONFIRMED";
  sentItemsCount: number;
  confirmedOrders: string[];
  unconfirmedOrders: string[];
  failedOrders: Array<{ orderId: string; error: string }>;
  rejectedItems: Array<{ orderId: string; reason: string }>;
  logUpdate: Array<{ apiOrderId: string; status: string }>;
  error?: string | undefined;
}

/**
 * Extracts order list from Cotik readback response structure
 */
function extractReadbackOrders(response: z.infer<typeof CotikReadbackResponseSchema>): Array<z.infer<typeof CotikReadbackOrderSchema>> {
  if (response.listorders && Array.isArray(response.listorders)) {
    return response.listorders;
  }
  if (response.data) {
    if (Array.isArray(response.data)) {
      return response.data;
    }
    if (response.data.listorders && Array.isArray(response.data.listorders)) {
      return response.data.listorders;
    }
    if (response.data.data && Array.isArray(response.data.data)) {
      return response.data.data;
    }
  }
  return [];
}

/**
 * Performs exact readback on Cotik to verify if tracking was successfully updated
 */
export async function confirmOrderTrackingReadback(
  client: MultiAccountCotikClient,
  orderId: string,
  expectedTracking: string
): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(orderId.trim());
    const path = `/order/list?page=1&sizeperpage=10&search=${encoded}`;
    const response = await client.get(path, CotikReadbackResponseSchema);
    const orders = extractReadbackOrders(response);

    const match = orders.find(
      (o) => (o.apiOrderId === orderId || o.order_id === orderId)
    );

    if (!match || !match.tracking_number) {
      return false;
    }

    return match.tracking_number.trim().toUpperCase() === expectedTracking.trim().toUpperCase();
  } catch {
    return false;
  }
}

/**
 * Performs the bounded read preflight required before a tracking write.
 */
export async function checkOrderTrackingReady(
  client: MultiAccountCotikClient,
  orderId: string,
  expectedTracking: string
): Promise<boolean> {
  const requestedOrderId = orderId.trim();
  const normalizedTracking = expectedTracking.trim().toUpperCase();
  if (!requestedOrderId || !normalizedTracking) return false;

  try {
    const encoded = encodeURIComponent(requestedOrderId);
    const path = `/order/list?page=1&sizeperpage=10&search=${encoded}`;
    const response = await client.get(path, CotikReadbackResponseSchema);
    const orders = extractReadbackOrders(response);
    const matches = orders.filter(
      (order) => order.apiOrderId === requestedOrderId || order.order_id === requestedOrderId
    );
    if (matches.length !== 1) return false;

    const match = matches[0]!;
    const operationalStatus = [match.status, match.order_status]
      .find((status): status is string => status !== undefined && status.trim().length > 0)
      ?.trim()
      .toUpperCase() ?? "";
    if (!new Set(["AWAITING_SHIPMENT", "AWAITING_COLLECTION", "NEW"]).has(operationalStatus)) return false;

    const existingTrackings = [match.tracking_number, match.tracking]
      .filter((tracking): tracking is string => tracking !== undefined)
      .map((tracking) => tracking.trim().toUpperCase())
      .filter((tracking) => tracking.length > 0);
    return existingTrackings.every((tracking) => tracking === normalizedTracking);
  } catch {
    return false;
  }
}

/**
 * Strictly controlled Cotik tracking write adapter.
 *
 * Rules:
 * 1. Dual kill switch cotikPostEnabled MUST be true. If false, fails closed with REFUSED_KILL_SWITCH.
 * 2. Every item MUST already contain an explicit provider ID resolved from operator input.
 * 3. Max 50 orders per batch.
 * 4. After POST, verifies tracking via readback confirmation on the same account.
 * 5. Handles timeouts/errors idempotently by reading back before declaring failure.
 */
export async function postCotikTrackingBatch(
  input: PostCotikTrackingBatchInput
): Promise<PostCotikTrackingResult> {
  // RULE 3: Max batch size check
  if (input.items.length > MAX_TRACKING_BATCH_SIZE) {
    throw new Error(
      `Batch size ${input.items.length} exceeds maximum allowed of ${MAX_TRACKING_BATCH_SIZE}`
    );
  }

  if (input.items.length === 0) {
    return {
      status: "CONFIRMED",
      sentItemsCount: 0,
      confirmedOrders: [],
      unconfirmedOrders: [],
      failedOrders: [],
      rejectedItems: [],
      logUpdate: []
    };
  }

  // RULE 2: Explicit provider verification. Provider selection happens during staging
  // from the operator-supplied Sheets AC value; POST never infers it from tracking.
  const eligibleItems: CotikTrackingItem[] = [];
  const rejectedItems: Array<{ orderId: string; reason: string }> = [];

  for (const item of input.items) {
    if (!/^\d+$/.test(item.providerId.trim())) {
      rejectedItems.push({
        orderId: item.orderId,
        reason: "INVALID_PROVIDER_ID"
      });
    } else {
      eligibleItems.push(item);
    }
  }

  if (eligibleItems.length === 0) {
    return {
      status: "REJECTED_INVALID_PROVIDER",
      sentItemsCount: 0,
      confirmedOrders: [],
      unconfirmedOrders: [],
      failedOrders: [],
      rejectedItems,
      logUpdate: [],
      error: "All tracking items are missing an explicit provider ID"
    };
  }

  const payload = {
    list: eligibleItems.map((item) => ({
      apiOrderId: item.orderId,
      tracking_number: item.tracking,
      provider: item.providerId
    }))
  };

  // RULE 1: Re-read the persisted dual kill switch immediately before the
  // transport call. Authorization failures are fail-closed and never reach
  // the COTIK POST endpoint.
  let authorized = false;
  try {
    authorized = await input.isPostAuthorized();
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return {
      status: "REFUSED_KILL_SWITCH",
      sentItemsCount: 0,
      confirmedOrders: [],
      unconfirmedOrders: [],
      failedOrders: [],
      rejectedItems,
      logUpdate: [],
      error: "Persisted Cotik POST authorization is OFF or unavailable. No tracking write allowed."
    };
  }

  let logUpdate: Array<{ apiOrderId: string; status: string }> = [];
  const confirmedOrders: string[] = [];
  const unconfirmedOrders: string[] = [];
  const failedOrders: Array<{ orderId: string; error: string }> = [];

  try {
    const response = await input.client.post(
      "/order/import-tracking-v2",
      payload,
      CotikPostTrackingResponseSchema
    );

    logUpdate = response.logUpdate ?? [];

    const failedOrderIds = new Set(logUpdate.map((l) => l.apiOrderId));
    for (const log of logUpdate) {
      failedOrders.push({ orderId: log.apiOrderId, error: log.status || "Unknown Cotik failure" });
    }

    const acceptedItems = eligibleItems.filter((i) => !failedOrderIds.has(i.orderId));

    // Readback confirmation for accepted orders
    for (const item of acceptedItems) {
      const confirmed = await confirmOrderTrackingReadback(
        input.client,
        item.orderId,
        item.tracking
      );

      if (confirmed) {
        confirmedOrders.push(item.orderId);
      } else {
        unconfirmedOrders.push(item.orderId);
      }
    }

    const overallStatus: PostCotikTrackingResult["status"] =
      confirmedOrders.length > 0 && (failedOrders.length > 0 || unconfirmedOrders.length > 0)
        ? "PARTIALLY_CONFIRMED"
        : failedOrders.length > 0 || unconfirmedOrders.length > 0
          ? "FAILED"
          : "CONFIRMED";

    return {
      status: overallStatus,
      sentItemsCount: eligibleItems.length,
      confirmedOrders,
      unconfirmedOrders,
      failedOrders,
      rejectedItems,
      logUpdate
    };
  } catch (error) {
    // Timeout or network error: attempt readback confirmation before failing
    const errorMessage = error instanceof Error ? error.message : String(error);

    for (const item of eligibleItems) {
      const confirmed = await confirmOrderTrackingReadback(
        input.client,
        item.orderId,
        item.tracking
      );

      if (confirmed) {
        confirmedOrders.push(item.orderId);
      } else {
        unconfirmedOrders.push(item.orderId);
        failedOrders.push({ orderId: item.orderId, error: errorMessage });
      }
    }

    return {
      status: confirmedOrders.length > 0 ? "PARTIALLY_CONFIRMED" : "FAILED",
      sentItemsCount: eligibleItems.length,
      confirmedOrders,
      unconfirmedOrders,
      failedOrders,
      rejectedItems,
      logUpdate,
      error: errorMessage
    };
  }
}
