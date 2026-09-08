import {
  createCotikTrackingReplayRun,
  ensureCotikWorkflowSettings,
  findCotikAccountById,
  findCotikLogicalShopByMaShopNoiBo,
  findPostIntentForTracking,
  getDecryptedCotikToken,
  LEGACY_COTIK_TRACKING_RUN_ID,
  setCotikWorkflowSettings
} from "@shop-health/db";
import {
  confirmOrderTrackingReadback,
  createMultiAccountCotikClient
} from "@shop-health/cotik";
import {
  readCotikTrackingSheetBatch,
  groupCotikTrackingRows,
  stageCotikTracking,
  writeCotikTrackingSheetResults
} from "@shop-health/sync";
import { runCotikWorkerCycle } from "@shop-health/worker/cycle";

import { withDatabase } from "./db-runtime.js";
import { CliError } from "./errors.js";
import type { CliRuntime } from "./runtime.js";

export const AUTO_TRACKING_CAPABILITY = "auto_tracking" as const;
export const AUTO_TRACKING_SCHEMA_VERSION = "auto-tracking-capability.v1" as const;

export interface AutoTrackingSheetInput {
  readonly spreadsheetId: string;
  readonly tab: string;
  readonly range: string;
  readonly region: "US";
  readonly targetDate?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly dateFormat?: "MDY" | "DMY" | undefined;
  readonly writeback?: boolean | undefined;
  readonly relay?: boolean | undefined;
}

interface AutoTrackingDateSelector {
  readonly targetDate?: string | undefined;
  readonly fromDate?: string | undefined;
}

type AutoTrackingGroup = ReturnType<typeof groupCotikTrackingRows>[number];

interface AutoTrackingSheetSnapshot {
  readonly dateSelector: AutoTrackingDateSelector;
  readonly batch: Awaited<ReturnType<typeof readCotikTrackingSheetBatch>>;
  readonly groups: readonly AutoTrackingGroup[];
}

export interface AutoTrackingStageResult {
  readonly schemaVersion: "cotik-tracking-stage-sheet-date.v1";
  readonly targetDate?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly rowsRead: number;
  readonly rowsEligible: number;
  readonly rowsSkipped: number;
  readonly rowsStaged: number;
  readonly postBatchCount: number;
  readonly trackingRunId?: string | undefined;
  readonly skipped: readonly { rowNumber: number; reason: string }[];
  readonly results: readonly Record<string, unknown>[];
}

export interface AutoTrackingReconcileResult {
  readonly schemaVersion: "cotik-tracking-reconcile-sheet-date.v1";
  readonly targetDate?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly rowsRead: number;
  readonly rowsEligible: number;
  readonly rowsSkipped: number;
  readonly writeCandidates: number;
  readonly writeback: readonly { rowNumber: number; status: "WRITTEN" }[];
  readonly skipped: readonly { rowNumber: number; reason: string }[];
  readonly results: readonly Record<string, unknown>[];
}

export interface AutoTrackingSettings {
  readonly cotikSyncEnabled: boolean;
  readonly cotikPostEnabled: boolean;
  readonly deploymentId: string | null;
  readonly lastResetAt: Date | null;
  readonly updatedAt: Date;
}

export interface AutoTrackingStatusResponse {
  readonly schemaVersion: typeof AUTO_TRACKING_SCHEMA_VERSION;
  readonly capability: typeof AUTO_TRACKING_CAPABILITY;
  readonly action: "status";
  readonly settings: AutoTrackingSettings;
}

export interface AutoTrackingStopResponse {
  readonly schemaVersion: typeof AUTO_TRACKING_SCHEMA_VERSION;
  readonly capability: typeof AUTO_TRACKING_CAPABILITY;
  readonly action: "stop";
  readonly settings: AutoTrackingSettings;
}

export interface AutoTrackingExecuteResponse {
  readonly schemaVersion: typeof AUTO_TRACKING_SCHEMA_VERSION;
  readonly capability: typeof AUTO_TRACKING_CAPABILITY;
  readonly action: "execute";
  readonly stage: AutoTrackingStageResult;
  readonly worker: Awaited<ReturnType<typeof runCotikWorkerCycle>>;
  readonly reconcile: AutoTrackingReconcileResult;
}

export interface AutoTrackingCapability {
  status(): Promise<AutoTrackingStatusResponse>;
  execute(input: AutoTrackingSheetInput): Promise<AutoTrackingExecuteResponse>;
  stop(): Promise<AutoTrackingStopResponse>;
}

function requireGoogleSheetsAccessToken(): string {
  const token = process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new CliError({
      failureType: "GOOGLE_SHEETS_NOT_CONFIGURED",
      message: "GOOGLE_SHEETS_ACCESS_TOKEN is required for this command"
    });
  }
  return token;
}

function validateSheetInput(input: AutoTrackingSheetInput): AutoTrackingDateSelector {
  if ((input.targetDate === undefined) === (input.fromDate === undefined)) {
    throw new CliError({
      failureType: "INVALID_ARGUMENT",
      message: "exactly one of --target-date or --from-date is required"
    });
  }
  if (input.dateFormat !== undefined && input.dateFormat !== "MDY" && input.dateFormat !== "DMY") {
    throw new CliError({ failureType: "INVALID_ARGUMENT", message: "date-format must be MDY or DMY" });
  }
  if (input.targetDate !== undefined) return { targetDate: input.targetDate };
  return { fromDate: input.fromDate! };
}

function settingsView(settings: Awaited<ReturnType<typeof ensureCotikWorkflowSettings>>): AutoTrackingSettings {
  return {
    cotikSyncEnabled: settings.cotikSyncEnabled,
    cotikPostEnabled: settings.cotikPostEnabled,
    deploymentId: settings.deploymentId,
    lastResetAt: settings.lastResetAt,
    updatedAt: settings.updatedAt
  };
}

function sheetResultForPause(reason: string | undefined): string {
  if (reason === "EXISTING_TRACKING_CONFLICT") return "ĐÃ tồn tại 1 track khác trên Shop";
  if (reason === "COTIK_POST_DISABLED" || reason === "AUTO_DISABLED") return "Chưa add do dừng chế độ AUTO";
  return "Lỗi Cotik chưa nhận track";
}

async function readAutoTrackingSheetSnapshot(
  input: AutoTrackingSheetInput
): Promise<AutoTrackingSheetSnapshot> {
  const dateSelector = validateSheetInput(input);
  const batch = await readCotikTrackingSheetBatch(
    {
      spreadsheetId: input.spreadsheetId,
      tabTitle: input.tab,
      range: input.range,
      ...dateSelector,
      ...(input.dateFormat === undefined ? {} : { dateFormat: input.dateFormat })
    },
    { accessToken: requireGoogleSheetsAccessToken() }
  );
  return { dateSelector, batch, groups: groupCotikTrackingRows(batch.rows, batch.groupRows) };
}

function groupMaShopNoiBo(group: AutoTrackingGroup): string | null {
  const values = new Set(
    group.rows
       .map((row) => row.account)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim())
  );
  return values.size === 1 ? [...values][0]! : null;
}

async function resolveGroupLogicalShopId(
  db: Parameters<typeof findCotikLogicalShopByMaShopNoiBo>[0],
  group: AutoTrackingGroup,
  region: "US"
): Promise<string | null> {
  const maShopNoiBo = groupMaShopNoiBo(group);
  if (maShopNoiBo === null) return null;
  const shop = await findCotikLogicalShopByMaShopNoiBo(db, maShopNoiBo);
  return shop?.region === region ? shop.id : null;
}

export async function stageAutoTrackingSheet(
  runtime: CliRuntime,
  input: AutoTrackingSheetInput
): Promise<AutoTrackingStageResult> {
  return await stageAutoTrackingSheetSnapshot(runtime, input, await readAutoTrackingSheetSnapshot(input));
}

async function stageAutoTrackingSheetSnapshot(
  runtime: CliRuntime,
  input: AutoTrackingSheetInput,
  snapshot: AutoTrackingSheetSnapshot
): Promise<AutoTrackingStageResult> {
  const { batch, dateSelector } = snapshot;
  const results = await withDatabase(runtime, async ({ db }) => {
    const trackingRunId = input.relay === true
      ? (await createCotikTrackingReplayRun(db, { sourceRunId: LEGACY_COTIK_TRACKING_RUN_ID })).id
      : undefined;
    const staged: Array<Record<string, unknown>> = [];
    const skippedRows: Array<{ rowNumber: number; reason: string }> = batch.skippedRows
      .map(({ rowNumber, reason }) => ({ rowNumber, reason }));
    let rowsStaged = 0;
    let groupsStaged = 0;
    const intentIds: string[] = [];
    for (const group of snapshot.groups) {
      if (group.status === "PAUSED") {
        for (const row of group.rows) {
          staged.push({ rowNumber: row.rowNumber, orderId: group.orderId, status: "PAUSED", reason: group.reason });
          skippedRows.push({ rowNumber: row.rowNumber, reason: group.reason ?? "SPLIT_ORDER_REVIEW_REQUIRED" });
        }
        continue;
      }
      const logicalShopId = await resolveGroupLogicalShopId(db, group, input.region);
      if (logicalShopId === null) {
        for (const row of group.rows) {
          staged.push({ rowNumber: row.rowNumber, orderId: group.orderId, status: "PAUSED", reason: "SHOP_IDENTITY_OR_REGION_UNPROVEN" });
          skippedRows.push({ rowNumber: row.rowNumber, reason: "SHOP_IDENTITY_OR_REGION_UNPROVEN" });
        }
        continue;
      }
      const result = await stageCotikTracking(db, {
        logicalShopId,
        orderId: group.orderId,
        tracking: group.tracking!,
        provider: group.providerNote!,
        region: input.region,
        ...(trackingRunId === undefined ? {} : { runId: trackingRunId })
      });
      if (result.status === "STAGED") {
        groupsStaged++;
        rowsStaged += group.rows.length;
        intentIds.push(result.intentId);
      }
      for (const groupRow of group.rows) {
        staged.push({
          rowNumber: groupRow.rowNumber,
          orderId: group.orderId,
          status: result.status,
          ...(result.status === "STAGED"
            ? { candidateId: result.candidateId, intentId: result.intentId }
            : { reason: result.reason })
        });
      }
    }
    return { staged, skippedRows, rowsStaged, groupsStaged, trackingRunId, intentIds };
  });
  return {
    schemaVersion: "cotik-tracking-stage-sheet-date.v1",
    ...dateSelector,
    rowsRead: batch.rows.length + batch.skippedRows.length,
    rowsEligible: batch.rows.length,
    rowsSkipped: results.skippedRows.length,
    rowsStaged: results.rowsStaged,
    postBatchCount: Math.ceil(results.groupsStaged / 50),
    ...(results.trackingRunId === undefined ? {} : { trackingRunId: results.trackingRunId }),
    skipped: results.skippedRows,
    results: results.staged
  };
}

export async function reconcileAutoTrackingSheet(
  runtime: CliRuntime,
  input: AutoTrackingSheetInput
): Promise<AutoTrackingReconcileResult> {
  return await reconcileAutoTrackingSheetSnapshot(runtime, input, await readAutoTrackingSheetSnapshot(input));
}

async function reconcileAutoTrackingSheetSnapshot(
  runtime: CliRuntime,
  input: AutoTrackingSheetInput,
  snapshot: AutoTrackingSheetSnapshot,
  trackingRunId?: string
): Promise<AutoTrackingReconcileResult> {
  const { batch, dateSelector } = snapshot;
  const reconciliation = await withDatabase(runtime, async ({ db }) => {
    const results: Array<Record<string, unknown>> = [];
    const writeResults: Array<{ rowNumber: number; result: string }> = batch.skippedRows.map(({ rowNumber, reason }) => ({
      rowNumber,
      result: sheetResultForPause(reason)
    }));
    const skippedRows: Array<{ rowNumber: number; reason: string }> = batch.skippedRows
      .map(({ rowNumber, reason }) => ({ rowNumber, reason }));
    const appendGroupResult = (group: AutoTrackingGroup, details: Record<string, unknown>) => {
      for (const row of group.rows) results.push({ rowNumber: row.rowNumber, orderId: group.orderId, ...details });
    };
    for (const group of snapshot.groups) {
      if (group.status === "PAUSED") {
        appendGroupResult(group, { status: "PAUSED", reason: group.reason });
        for (const row of group.rows) writeResults.push({ rowNumber: row.rowNumber, result: sheetResultForPause(group.reason) });
        for (const row of group.rows) skippedRows.push({ rowNumber: row.rowNumber, reason: group.reason ?? "SPLIT_ORDER_REVIEW_REQUIRED" });
        continue;
      }
      const logicalShopId = await resolveGroupLogicalShopId(db, group, input.region);
      if (logicalShopId === null) {
        appendGroupResult(group, { status: "PAUSED", reason: "SHOP_IDENTITY_OR_REGION_UNPROVEN" });
        for (const row of group.rows) writeResults.push({ rowNumber: row.rowNumber, result: "Lỗi Cotik chưa nhận track" });
        for (const row of group.rows) skippedRows.push({ rowNumber: row.rowNumber, reason: "SHOP_IDENTITY_OR_REGION_UNPROVEN" });
        continue;
      }
      const intent = await findPostIntentForTracking(db, {
        logicalShopId,
        orderId: group.orderId,
        tracking: group.tracking!,
        region: input.region,
        ...(trackingRunId === undefined ? {} : { runId: trackingRunId })
      });
      if (!intent) {
        appendGroupResult(group, { status: "PAUSED", reason: "INTENT_NOT_FOUND" });
        for (const row of group.rows) writeResults.push({ rowNumber: row.rowNumber, result: "Lỗi Cotik chưa nhận track" });
        continue;
      }
      if (intent.status === "PENDING" || intent.status === "IN_PROGRESS") {
        appendGroupResult(group, { status: "DEFERRED", intentStatus: intent.status, attemptCount: intent.attemptCount });
        for (const row of group.rows) writeResults.push({ rowNumber: row.rowNumber, result: "Lỗi Cotik chưa nhận track" });
        continue;
      }
      if (intent.status !== "CONFIRMED" && intent.status !== "FAILED" && intent.status !== "ABORTED") continue;

      const account = await findCotikAccountById(db, intent.accountId);
      const token = account?.status === "ACTIVE" ? await getDecryptedCotikToken(db, intent.accountId) : null;
      if (!token) {
        appendGroupResult(group, { status: "PAUSED", reason: "ACCOUNT_TOKEN_UNAVAILABLE" });
        continue;
      }
      const client = createMultiAccountCotikClient({ accountId: intent.accountId, token });
      const confirmed = await confirmOrderTrackingReadback(client, intent.orderId, intent.tracking);
      if (intent.status === "CONFIRMED") {
        if (!confirmed) {
          appendGroupResult(group, { status: "PAUSED", reason: "READBACK_NOT_CONFIRMED", attemptCount: intent.attemptCount });
          continue;
        }
        for (const groupRow of group.rows) writeResults.push({ rowNumber: groupRow.rowNumber, result: "Add track DONE" });
        appendGroupResult(group, { status: "CONFIRMED", readback: "OK", attemptCount: intent.attemptCount });
        continue;
      }

      const readback = confirmed ? "CONFLICT" : "NOT_CONFIRMED";
      const result = intent.status === "FAILED"
        ? (readback === "CONFLICT" ? "Track đã được add." : "Lỗi Cotik chưa nhận track")
        : (readback === "CONFLICT" ? "Track đã được add." : "Chưa add do dừng chế độ AUTO");
      for (const groupRow of group.rows) writeResults.push({ rowNumber: groupRow.rowNumber, result });
      appendGroupResult(group, { status: intent.status, readback, attemptCount: intent.attemptCount });
    }
    return { results, writeResults, skippedRows };
  });
  const writeback = input.writeback === false
    ? []
    : reconciliation.writeResults.length === 0
    ? []
    : await writeCotikTrackingSheetResults(
        { spreadsheetId: input.spreadsheetId, tabTitle: input.tab, results: reconciliation.writeResults },
        { accessToken: requireGoogleSheetsAccessToken() }
      );
  return {
    schemaVersion: "cotik-tracking-reconcile-sheet-date.v1",
    ...dateSelector,
    rowsRead: batch.rows.length + batch.skippedRows.length,
    rowsEligible: batch.rows.length,
    rowsSkipped: reconciliation.skippedRows.length,
    writeCandidates: reconciliation.writeResults.length,
    writeback,
    skipped: reconciliation.skippedRows,
    results: reconciliation.results
  };
}

export function createAutoTrackingCapability(runtime: CliRuntime): AutoTrackingCapability {
  return {
    async status() {
      const settings = await withDatabase(runtime, ({ db }) => ensureCotikWorkflowSettings(db));
      return {
        schemaVersion: AUTO_TRACKING_SCHEMA_VERSION,
        capability: AUTO_TRACKING_CAPABILITY,
        action: "status",
        settings: settingsView(settings)
      };
    },

    async execute(input) {
      const snapshot = await readAutoTrackingSheetSnapshot(input);
      const stage = await stageAutoTrackingSheetSnapshot(runtime, input, snapshot);
      const stagedIntentIds = [...new Set(stage.results
        .map((result) => typeof result.intentId === "string" ? result.intentId : null)
        .filter((intentId): intentId is string => intentId !== null))];
      const workerRuns: Array<Awaited<ReturnType<typeof runCotikWorkerCycle>>> = [];
      for (let offset = 0; offset < Math.max(stagedIntentIds.length, 1); offset += 50) {
        workerRuns.push(await withDatabase(runtime, (context) => runCotikWorkerCycle({
          context,
          logger: runtime.logger,
          skipDiscovery: true,
          skipOrderSync: true,
          ...(stage.trackingRunId === undefined ? {} : { trackingRunId: stage.trackingRunId }),
          trackingIntentIds: stagedIntentIds.slice(offset, offset + 50)
        })));
      }
      const worker = workerRuns[workerRuns.length - 1]!;
      const reconcile = await reconcileAutoTrackingSheetSnapshot(runtime, input, snapshot, stage.trackingRunId);
      return {
        schemaVersion: AUTO_TRACKING_SCHEMA_VERSION,
        capability: AUTO_TRACKING_CAPABILITY,
        action: "execute",
        stage,
        worker,
        reconcile
      };
    },

    async stop() {
      const settings = await withDatabase(runtime, ({ db }) => setCotikWorkflowSettings(db, {
        cotikSyncEnabled: false,
        cotikPostEnabled: false
      }));
      return {
        schemaVersion: AUTO_TRACKING_SCHEMA_VERSION,
        capability: AUTO_TRACKING_CAPABILITY,
        action: "stop",
        settings: settingsView(settings)
      };
    }
  };
}
