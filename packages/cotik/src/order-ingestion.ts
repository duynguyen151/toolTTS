import { z } from "zod";

import type { NormalizedOrder } from "@shop-health/domain";

import type { CotikClient } from "./client.js";
import { normalizeCotikOrder } from "./orders.js";

/**
 * Guide §7.3 prescribes update-time polling via filter11/filter12 from the last
 * successful poll but prescribes NO overlap amount. Operational ruling: a fixed
 * conservative 60-second overlap re-reads recent updates to absorb clock skew
 * and mid-run resorting; persistence upserts make the replay idempotent. This
 * is an overlap window only — it makes no lifetime-completeness claim.
 */
export const INCREMENTAL_OVERLAP_MS = 60_000;

/** Guide §7.2: Orders page size ≤ 100. */
const PAGE_SIZE_MAX = 100;
const ORDER_LIST_PATH = "/order/list";
export const COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION = "cotik-orders-checkpoint.v1";

export type CotikOrderIngestionMode = "INITIAL_ALL_AVAILABLE" | "INCREMENTAL_UPDATE";

export type CotikOrderIngestionErrorCode =
  | "BINDING_INVALID"
  | "CHECKPOINT_INVALID"
  | "PAGINATION_MISMATCH"
  | "EMPTY_PAGE";

export class CotikOrderIngestionError extends Error {
  readonly code: CotikOrderIngestionErrorCode;

  constructor(code: CotikOrderIngestionErrorCode, message: string) {
    super(message);
    this.name = "CotikOrderIngestionError";
    this.code = code;
  }
}

/**
 * The guarded slice of the W1 binding row this seam needs. The caller resolves
 * it from `shop_provider_bindings`; validation happens here before any fetch.
 */
export interface CotikOrdersBinding {
  readonly provider: string;
  readonly enabled: boolean;
  readonly providerShopId: string | null;
  readonly checkpoint: Record<string, unknown> | null;
}

export interface CotikOrderIngestionInput {
  /** Guarded COTIK read client (GET only; this module performs no writes). */
  readonly client: CotikClient;
  /** Canonical shop id attached to every normalized order. */
  readonly shopId: string;
  readonly binding: CotikOrdersBinding;
  /** Persistence callback invoked sequentially, once per fetched page of new orders. */
  readonly persistOrders: (orders: readonly NormalizedOrder[]) => Promise<void>;
  /** Checkpoint-save callback; called exactly once, only after ALL pages succeed. */
  readonly saveCheckpoint: (checkpoint: Record<string, unknown>) => Promise<void>;
  readonly now?: () => Date;
  readonly pageSize?: number;
}

export interface CotikOrdersCheckpoint {
  readonly schemaVersion: typeof COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION;
  readonly lastUpdatedAtMs: number;
}

export interface CotikOrderIngestionResult {
  readonly mode: CotikOrderIngestionMode;
  readonly pagesFetched: number;
  readonly ordersPersisted: number;
  readonly checkpoint: CotikOrdersCheckpoint;
}

const OrderListDataSchema = z.object({
  listorders: z.array(z.unknown()),
  totalsize: z.number().int().nonnegative(),
});

type OrderListData = z.infer<typeof OrderListDataSchema>;

const CheckpointSchema = z.strictObject({
  schemaVersion: z.literal(COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION),
  lastUpdatedAtMs: z.number().int().nonnegative(),
});

/**
 * Builds the documented GET `/order/list` request path. The bound COTIK shop id
 * travels as the guide-documented `filter2` param (guide §3.1: use `shops._id`
 * for order shop scoping); it is percent-encoded at this trust boundary.
 */
export function buildCotikOrderListPath(params: {
  page: number;
  sizePerPage: number;
  cotikShopId?: string | null;
}): string {
  assertPageIndex(params.page, "page");
  assertPageIndex(params.sizePerPage, "sizeperpage");
  if (params.sizePerPage > PAGE_SIZE_MAX) {
    throw new RangeError(`sizeperpage ${params.sizePerPage} exceeds the documented maximum of ${PAGE_SIZE_MAX}`);
  }
  let path = `${ORDER_LIST_PATH}?page=${params.page}&sizeperpage=${params.sizePerPage}`;
  const cotikShopId = params.cotikShopId?.trim();
  if (cotikShopId) path += `&filter2=${encodeURIComponent(cotikShopId)}`;
  return path;
}

function assertPageIndex(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

/**
 * Ingests COTIK orders for one enabled COTIK binding.
 *
 * - Null binding checkpoint runs an initial All Available backfill through
 *   `totalsize`; a valid checkpoint runs incremental update polling via
 *   documented `filter11`/`filter12` milliseconds minus {@link INCREMENTAL_OVERLAP_MS}.
 * - Every source order passes through the W2 normalizer; pages are normalized,
 *   deduplicated by order id within the run, and persisted page-wise in order.
 * - Traversal reconciles distinct delivered ids against `totalsize`; mismatch,
 *   early-empty/no-progress, malformed payloads, exhausted 429s, and
 *   persistence throws all propagate BEFORE the checkpoint callback, so the
 *   previous checkpoint stands and a retry replays safely (idempotent upserts).
 * - The checkpoint advances exactly once, after all pages succeeded, watermarked
 *   at run start. Initial backfill covers what COTIK currently exposes — no
 *   lifetime-completeness claim.
 */
export async function ingestCotikOrders(input: CotikOrderIngestionInput): Promise<CotikOrderIngestionResult> {
  if (!input.shopId.trim()) throw new Error("Canonical shop id is required");
  const binding = input.binding;
  if (binding.provider !== "COTIK") {
    throw new CotikOrderIngestionError("BINDING_INVALID", `Binding provider ${binding.provider} is not COTIK`);
  }
  if (!binding.enabled) {
    throw new CotikOrderIngestionError("BINDING_INVALID", "COTIK binding is disabled");
  }
  if (!binding.providerShopId?.trim()) {
    throw new CotikOrderIngestionError("BINDING_INVALID", "COTIK binding has no provider shop id");
  }

  const runStartMs = (input.now ?? (() => new Date()))().getTime();
  const initial = binding.checkpoint === null;
  let sinceMs = 0;
  if (!initial) {
    const parsed = CheckpointSchema.safeParse(binding.checkpoint);
    if (!parsed.success) {
      throw new CotikOrderIngestionError(
        "CHECKPOINT_INVALID",
        "COTIK orders checkpoint is missing or malformed; refusing to guess a polling window",
      );
    }
    sinceMs = Math.max(parsed.data.lastUpdatedAtMs - INCREMENTAL_OVERLAP_MS, 0);
  }

  const pageSize = input.pageSize ?? PAGE_SIZE_MAX;
  const seen = new Set<string>();
  let expectedTotal: number | null = null;
  let pagesFetched = 0;

  while (true) {
    pagesFetched += 1;
    let path = buildCotikOrderListPath({
      page: pagesFetched,
      sizePerPage: pageSize,
      cotikShopId: binding.providerShopId,
    });
    if (!initial) path = appendUpdateWindow(path, sinceMs, runStartMs);
    const data: OrderListData = await input.client.get(path, OrderListDataSchema);

    if (expectedTotal === null) expectedTotal = data.totalsize;
    else if (data.totalsize !== expectedTotal) {
      throw new CotikOrderIngestionError(
        "PAGINATION_MISMATCH",
        `totalsize changed from ${expectedTotal} to ${data.totalsize} during traversal`,
      );
    }
    if (data.listorders.length > pageSize) {
      throw new CotikOrderIngestionError(
        "PAGINATION_MISMATCH",
        `page ${pagesFetched} returned ${data.listorders.length} rows exceeding sizeperpage ${pageSize}`,
      );
    }

    const batch: NormalizedOrder[] = [];
    for (const raw of data.listorders) {
      const order = normalizeCotikOrder(raw, input.shopId, new Date(runStartMs));
      if (seen.has(order.sourceOrderId)) continue; // in-run overlap stays idempotent
      seen.add(order.sourceOrderId);
      batch.push(order);
    }
    if (batch.length > 0) await input.persistOrders(batch);

    if (data.listorders.length === 0 && seen.size < expectedTotal) {
      throw new CotikOrderIngestionError(
        "EMPTY_PAGE",
        `page ${pagesFetched} returned no orders with ${seen.size}/${expectedTotal} ingested`,
      );
    }
    if (batch.length === 0 && seen.size < expectedTotal) {
      throw new CotikOrderIngestionError(
        "PAGINATION_MISMATCH",
        `page ${pagesFetched} delivered only duplicate ids with ${seen.size}/${expectedTotal} ingested`,
      );
    }
    if (data.listorders.length < pageSize || seen.size >= expectedTotal) break;
  }

  if (seen.size !== expectedTotal) {
    throw new CotikOrderIngestionError(
      "PAGINATION_MISMATCH",
      `traversal delivered ${seen.size} distinct orders but totalsize was ${expectedTotal}`,
    );
  }

  const checkpoint: CotikOrdersCheckpoint = {
    schemaVersion: COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION,
    lastUpdatedAtMs: runStartMs,
  };
  await input.saveCheckpoint({ ...checkpoint });

  return {
    mode: initial ? "INITIAL_ALL_AVAILABLE" : "INCREMENTAL_UPDATE",
    pagesFetched,
    ordersPersisted: seen.size,
    checkpoint,
  };
}

function appendUpdateWindow(path: string, sinceMs: number, untilMs: number): string {
  return `${path}&filter11=${sinceMs}&filter12=${untilMs}`;
}
