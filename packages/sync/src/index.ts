import {
  beginSyncRun,
  completeSyncRun,
  failSyncRun,
  insertFinancialSnapshot,
  getFullPersistedRiskOrderFacts,
  getRiskControlState,
  markShopSynced,
  setShopSyncState,
  saveRiskControlEvaluation,
  updateSyncCheckpoint,
  upsertOrderBatch,
  upsertSettlementBatch,
  withShopAdvisoryLock,
  withShopRiskControlLock,
  withTransactionalShopLock,
  type DatabaseContext,
  type ShopRow,
  type SyncMode
} from "@shop-health/db";
import {
  JsonObjectSchema,
  RISK_CONTROL_POLICY_V1,
  evaluateRiskControlFacts
} from "@shop-health/domain";
import type {
  RiskControlDecision,
  OrderSourceWindow,
  SellerDataSource,
  ShopSourceConfig,
  SyncRequest
} from "@shop-health/domain";
import { SellerCenterError } from "@shop-health/seller-center/errors";
import type { Logger } from "pino";

export type SyncKind = "orders" | "finance";

export interface RunSyncInput {
  readonly context: DatabaseContext;
  readonly source: SellerDataSource;
  readonly shop: ShopRow;
  readonly kind: SyncKind;
  readonly mode?: SyncRequest["mode"];
  readonly checkpoint?: string | null;
  readonly since?: Date | null;
  readonly until?: Date | null;
  readonly logger?: Logger;
}

export interface SyncResult {
  readonly status: "SUCCEEDED" | "SKIPPED";
  readonly syncRunId: string | null;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly checkpoint: string | null;
  readonly complete: boolean;
  readonly sourceCoverage?: {
    readonly source: "SELLER_CENTER";
    readonly window: "ROLLING_12_MONTHS";
    readonly completeWithinWindow: boolean;
    readonly lifetimeHistoryComplete: false;
  };
}

export async function evaluateAndStoreRiskControl(
  context: DatabaseContext,
  shop: ShopRow,
  evaluatedAt = new Date()
): Promise<RiskControlDecision> {
  return withShopRiskControlLock(context, shop.id, async (transaction) => {
    const [facts, previous] = await Promise.all([
      getFullPersistedRiskOrderFacts(transaction, shop.id),
      getRiskControlState(transaction, shop.id)
    ]);
    const decision = evaluateRiskControlFacts({
      facts,
      holidayModeCurrentlyEnabled: previous?.observedHolidayModeEnabled ?? null,
      consecutiveSafeCycles: previous?.consecutiveSafeCycles ?? 0
    });
    await saveRiskControlEvaluation(transaction, {
      shopId: shop.id,
      desiredState: decision.desiredState,
      consecutiveSafeCycles: decision.consecutiveSafeCycles,
      decision: JsonObjectSchema.parse(decision),
      policyVersion: RISK_CONTROL_POLICY_V1.version,
      evaluatedAt
    });
    return decision;
  });
}

function sourceConfig(shop: ShopRow): ShopSourceConfig {
  if (shop.region !== "US" || shop.locale !== "en-US") {
    throw new Error(`Unsupported market ${shop.region}/${shop.locale}`);
  }
  return {
    shopId: shop.id,
    profileId: shop.profileId,
    profileNo: shop.profileNo,
    region: "US",
    locale: "en-US"
  };
}

function syncMode(kind: SyncKind, mode: SyncRequest["mode"]): SyncMode {
  if (mode === "BACKFILL") return "BACKFILL";
  if (mode === "RECONCILE") return "RECONCILE";
  return kind === "orders" ? "ORDERS" : "FINANCE";
}

function pauseState(error: SellerCenterError): "PAUSED_LOGIN" | "PAUSED_CHALLENGE" | "PAUSED_LAYOUT" | null {
  if (error.failureType === "LOGIN_REQUIRED") return "PAUSED_LOGIN";
  if (error.failureType === "CHALLENGE_REQUIRED") return "PAUSED_CHALLENGE";
  if (error.failureType === "LAYOUT_CHANGED") return "PAUSED_LAYOUT";
  return null;
}

export async function runShopSync(input: RunSyncInput): Promise<SyncResult> {
  const result = await withShopAdvisoryLock(input.context, input.shop.id, async () => {
    const mode = input.mode ?? "INCREMENTAL";
    const run = await beginSyncRun(input.context.db, {
      shopId: input.shop.id,
      mode: syncMode(input.kind, mode),
      checkpoint: input.checkpoint === undefined || input.checkpoint === null
        ? null
        : { cursor: input.checkpoint }
    });
    let rowsRead = 0;
    let rowsWritten = 0;
    let checkpoint = input.checkpoint ?? null;
    let complete = false;
    let orderSourceWindow: OrderSourceWindow | undefined;
    const request: SyncRequest = {
      shop: sourceConfig(input.shop),
      mode,
      checkpoint,
      since: input.since ?? null,
      until: input.until ?? null
    };

    try {
      if (input.kind === "orders") {
        for await (const batch of input.source.collectOrders(request)) {
          const write = await withTransactionalShopLock(input.context, input.shop.id, (transaction) =>
            upsertOrderBatch(transaction, batch.orders)
          );
          rowsRead += write.rowsRead;
          rowsWritten += write.rowsWritten;
          checkpoint = batch.checkpoint;
          complete = batch.complete;
          orderSourceWindow = batch.sourceWindow;
          await updateSyncCheckpoint(input.context.db, run.id, checkpoint === null ? null : { cursor: checkpoint }, rowsRead, rowsWritten);
        }
      } else {
        for await (const batch of input.source.collectFinancials(request)) {
          const write = await withTransactionalShopLock(input.context, input.shop.id, async (transaction) => {
            const settlement = await upsertSettlementBatch(transaction, batch.settlements);
            const snapshot = batch.snapshot === null
              ? { inserted: false }
              : await insertFinancialSnapshot(transaction, batch.snapshot);
            return {
              rowsRead: settlement.rowsRead + (batch.snapshot === null ? 0 : 1),
              rowsWritten: settlement.rowsWritten + (snapshot.inserted ? 1 : 0)
            };
          });
          rowsRead += write.rowsRead;
          rowsWritten += write.rowsWritten;
          checkpoint = batch.checkpoint;
          complete = batch.complete;
          await updateSyncCheckpoint(input.context.db, run.id, checkpoint === null ? null : { cursor: checkpoint }, rowsRead, rowsWritten);
        }
      }

      await completeSyncRun(input.context.db, {
        runId: run.id,
        checkpoint: checkpoint === null ? null : { cursor: checkpoint },
        rowsRead,
        rowsWritten
      });
      await markShopSynced(input.context.db, input.shop.id, input.kind);
      input.logger?.info({ shopId: input.shop.id, profileId: input.shop.profileId, syncRunId: run.id, operation: `sync.${input.kind}`, entity: input.kind, rowsRead, rowsWritten }, "Shop sync completed");
      const sourceCoverage = orderSourceWindow === undefined
        ? {}
        : {
            sourceCoverage: {
              source: orderSourceWindow.source,
              window: "ROLLING_12_MONTHS" as const,
              completeWithinWindow: complete,
              lifetimeHistoryComplete: false as const,
            },
          };
      return {
        status: "SUCCEEDED" as const,
        syncRunId: run.id,
        rowsRead,
        rowsWritten,
        checkpoint,
        complete,
        ...sourceCoverage,
      };
    } catch (error) {
      const failureType = error instanceof SellerCenterError ? error.failureType : "UNEXPECTED_ERROR";
      const message = error instanceof Error ? error.message : "Unknown sync failure";
      const state = error instanceof SellerCenterError ? pauseState(error) : null;
      try {
        await failSyncRun(input.context.db, {
          runId: run.id,
          failureType,
          failureMessage: message,
          paused: state !== null,
          checkpoint: checkpoint === null ? null : { cursor: checkpoint }
        });
        if (state !== null) {
          await setShopSyncState(input.context.db, input.shop.id, state, message);
        }
      } catch (recordError) {
        input.logger?.error({
          shopId: input.shop.id,
          profileId: input.shop.profileId,
          syncRunId: run.id,
          operation: `sync.${input.kind}.record_failure`,
          entity: input.kind,
          failureType: "FAILURE_RECORDING_ERROR",
          error: recordError instanceof Error ? recordError.message : "Unknown failure-recording error"
        }, "Could not persist sync failure metadata");
      }
      input.logger?.error({ shopId: input.shop.id, profileId: input.shop.profileId, syncRunId: run.id, operation: `sync.${input.kind}`, entity: input.kind, failureType, error: message }, "Shop sync failed");
      throw error;
    }
  });

  return result ?? {
    status: "SKIPPED",
    syncRunId: null,
    rowsRead: 0,
    rowsWritten: 0,
    checkpoint: input.checkpoint ?? null,
    complete: false
  };
}
