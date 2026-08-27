import {
  findEnabledShopProviderBinding,
  upsertCotikSupplementaryPaymentBatch,
  upsertCotikSupplementaryStatementBatch,
  withShopAdvisoryLock,
  withTransactionalShopLock,
  type DatabaseContext,
  type ShopRow,
} from "@shop-health/db";
import {
  ingestCotikSupplementaryFinance,
  type CotikClient,
} from "@shop-health/cotik";
import type { Logger } from "pino";

export interface RunCotikSupplementaryFinanceSyncInput {
  readonly context: DatabaseContext;
  readonly shop: ShopRow;
  /** GET-only COTIK client; this entrypoint contains no COTIK business write. */
  readonly client: CotikClient;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly pageSize?: number;
}

export type CotikSupplementaryFinanceSyncSkipReason =
  | "SHOP_SYNC_LOCK_BUSY"
  | "COTIK_SUPPLEMENTARY_FINANCE_UNAVAILABLE";

export interface CotikSupplementaryFinanceSyncResult {
  readonly status: "SUCCEEDED" | "SKIPPED";
  readonly skipReason: CotikSupplementaryFinanceSyncSkipReason | null;
  readonly classification: "SUPPLEMENTARY_FINANCE" | null;
  readonly officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN" | null;
  readonly statementPagesFetched: number;
  readonly paymentPagesFetched: number;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

/**
 * Binding-driven COTIK statement/payment persistence. This only calls the two
 * isolated supplementary upserts; it does not create a sync run, capture,
 * snapshot, settlement, reconciliation, freshness, or authoritative Rule fact.
 */
export async function runCotikSupplementaryFinanceSync(
  input: RunCotikSupplementaryFinanceSyncInput,
): Promise<CotikSupplementaryFinanceSyncResult> {
  const completed = await withShopAdvisoryLock(input.context, input.shop.id, async () => {
    const binding = await findEnabledShopProviderBinding(input.context.db, input.shop.id, "COTIK");
    if (binding === null || !binding.provenance.capabilities.includes("SUPPLEMENTARY_FINANCE")) {
      input.logger?.warn(
        { shopId: input.shop.id, operation: "sync.cotik-supplementary-finance", entity: "supplementary-finance" },
        "COTIK supplementary Finance sync skipped: capability unavailable",
      );
      return skippedResult("COTIK_SUPPLEMENTARY_FINANCE_UNAVAILABLE");
    }
    let rowsRead = 0;
    let rowsWritten = 0;
    const result = await ingestCotikSupplementaryFinance({
      client: input.client,
      shopId: input.shop.id,
      cotikShopId: binding.providerShopId!,
      persistStatements: async (records) => {
        const write = await withTransactionalShopLock(input.context, input.shop.id, (transaction) =>
          upsertCotikSupplementaryStatementBatch(transaction, records),
        );
        rowsRead += write.rowsRead;
        rowsWritten += write.rowsWritten;
      },
      persistPayments: async (records) => {
        const write = await withTransactionalShopLock(input.context, input.shop.id, (transaction) =>
          upsertCotikSupplementaryPaymentBatch(transaction, records),
        );
        rowsRead += write.rowsRead;
        rowsWritten += write.rowsWritten;
      },
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
    });
    input.logger?.info(
      {
        shopId: input.shop.id,
        operation: "sync.cotik-supplementary-finance",
        entity: "supplementary-finance",
        statementPagesFetched: result.statementPagesFetched,
        paymentPagesFetched: result.paymentPagesFetched,
        rowsRead,
        rowsWritten,
      },
      "COTIK supplementary Finance sync completed",
    );
    return {
      status: "SUCCEEDED" as const,
      skipReason: null,
      classification: result.classification,
      officialOnHoldCapabilityStatus: result.officialOnHoldCapabilityStatus,
      statementPagesFetched: result.statementPagesFetched,
      paymentPagesFetched: result.paymentPagesFetched,
      rowsRead,
      rowsWritten,
    };
  });
  if (completed !== null) return completed;
  input.logger?.warn(
    { shopId: input.shop.id, operation: "sync.cotik-supplementary-finance", entity: "supplementary-finance" },
    "COTIK supplementary Finance sync skipped: shop sync lock busy",
  );
  return skippedResult("SHOP_SYNC_LOCK_BUSY");
}

function skippedResult(skipReason: CotikSupplementaryFinanceSyncSkipReason): CotikSupplementaryFinanceSyncResult {
  return {
    status: "SKIPPED",
    skipReason,
    classification: null,
    officialOnHoldCapabilityStatus: null,
    statementPagesFetched: 0,
    paymentPagesFetched: 0,
    rowsRead: 0,
    rowsWritten: 0,
  };
}
