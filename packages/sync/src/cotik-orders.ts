import {
  findEnabledShopProviderBinding,
  updateShopProviderBindingCheckpoint,
  upsertOrderBatch,
  withShopAdvisoryLock,
  withTransactionalShopLock,
  type DatabaseContext,
  type ShopProviderBindingRow,
  type ShopRow
} from "@shop-health/db";
import {
  ingestCotikOrders,
  type CotikClient,
  type CotikOrderIngestionMode,
  type CotikOrdersCheckpoint
} from "@shop-health/cotik";
import type { Logger } from "pino";

/**
 * W2-T02 binding-driven COTIK Orders route. This is the bound default entrypoint
 * for COTIK order collection — Seller Center `runShopSync` stays untouched.
 *
 * Contract: resolves the shop's ENABLED `COTIK` binding via
 * `findEnabledShopProviderBinding` (missing/disabled binding fails closed with a
 * SKIPPED result and zero fetches), serializes on the shop session advisory
 * lock, persists each fetched page through the existing `upsertOrderBatch`
 * inside the same per-page transactional lock convention as `runShopSync`, and
 * advances the binding checkpoint exactly once — only after every page
 * succeeded — via `updateShopProviderBindingCheckpoint`, whose returned row is
 * the binding readback reported here. On any fetch/normalize/persist failure the
 * error propagates before that single checkpoint write, so the previous
 * checkpoint stands while already-persisted pages replay idempotently through
 * `upsertOrderBatch` upsert semantics on retry.
 */

export interface RunCotikOrdersSyncInput {
  /** Database context owning both the Drizzle client and the pooled sql used by advisory locking. */
  readonly context: DatabaseContext;
  /** Canonical shop whose COTIK binding drives the run. */
  readonly shop: ShopRow;
  /** Guarded COTIK read client (GET-only; this module performs no COTIK writes). */
  readonly client: CotikClient;
  readonly logger?: Logger;
  /** Deterministic clock for tests; defaults to wall time. */
  readonly now?: () => Date;
  readonly pageSize?: number;
}

export type CotikOrdersSyncSkipReason = "SHOP_SYNC_LOCK_BUSY" | "COTIK_BINDING_INACTIVE";

export interface CotikOrdersSyncResult {
  readonly status: "SUCCEEDED" | "SKIPPED";
  readonly skipReason: CotikOrdersSyncSkipReason | null;
  readonly mode: CotikOrderIngestionMode | null;
  readonly pagesFetched: number;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  /** Checkpoint committed to the binding; null unless status is SUCCEEDED. */
  readonly checkpoint: CotikOrdersCheckpoint | null;
  /** Enabled binding row read back after the checkpoint commit. */
  readonly binding: ShopProviderBindingRow | null;
}

export async function runCotikOrdersSync(input: RunCotikOrdersSyncInput): Promise<CotikOrdersSyncResult> {
  const { context, shop, client } = input;

  const completed = await withShopAdvisoryLock(context, shop.id, async () => {
    // Fail closed: an unbound or disabled COTIK shop never triggers a fetch.
    const binding = await findEnabledShopProviderBinding(context.db, shop.id, "COTIK");
    if (binding === null) {
      input.logger?.warn(
        { shopId: shop.id, operation: "sync.cotik-orders", entity: "orders" },
        "COTIK orders sync skipped: no enabled COTIK provider binding",
      );
      return skippedResult("COTIK_BINDING_INACTIVE");
    }

    let rowsRead = 0;
    let rowsWritten = 0;
    let savedBinding: ShopProviderBindingRow | null = null;

    const ingestion = await ingestCotikOrders({
      client,
      shopId: shop.id,
      binding: {
        provider: binding.provider,
        enabled: binding.enabled,
        providerShopId: binding.providerShopId,
        checkpoint: binding.checkpoint
      },
      persistOrders: async (orders) => {
        // Per-page short transaction under the transactional shop lock — the
        // same convention as runShopSync — so each page's facts commit even if
        // a later page fails, and replays upsert idempotently.
        const write = await withTransactionalShopLock(context, shop.id, (transaction) =>
          upsertOrderBatch(transaction, orders)
        );
        rowsRead += write.rowsRead;
        rowsWritten += write.rowsWritten;
      },
      // ingestCotikOrders invokes this exactly once, after ALL pages succeed.
      saveCheckpoint: async (checkpoint) => {
        savedBinding = await updateShopProviderBindingCheckpoint(context.db, shop.id, "COTIK", checkpoint);
        if (savedBinding === null) {
          throw new Error("COTIK binding became inactive before its checkpoint could be committed");
        }
      },
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize })
    });

    input.logger?.info(
      {
        shopId: shop.id,
        operation: "sync.cotik-orders",
        entity: "orders",
        mode: ingestion.mode,
        pagesFetched: ingestion.pagesFetched,
        rowsRead,
        rowsWritten
      },
      "COTIK orders sync completed",
    );

    return {
      status: "SUCCEEDED" as const,
      skipReason: null,
      mode: ingestion.mode,
      pagesFetched: ingestion.pagesFetched,
      rowsRead,
      rowsWritten,
      checkpoint: ingestion.checkpoint,
      binding: savedBinding
    };
  });

  if (completed !== null) return completed;

  input.logger?.warn(
    { shopId: shop.id, operation: "sync.cotik-orders", entity: "orders" },
    "COTIK orders sync skipped: shop sync lock busy",
  );
  return skippedResult("SHOP_SYNC_LOCK_BUSY");
}

function skippedResult(skipReason: CotikOrdersSyncSkipReason): CotikOrdersSyncResult {
  return {
    status: "SKIPPED",
    skipReason,
    mode: null,
    pagesFetched: 0,
    rowsRead: 0,
    rowsWritten: 0,
    checkpoint: null,
    binding: null
  };
}
