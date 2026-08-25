import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { DecisionFinanceSnapshot } from "@shop-health/domain";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  financeCaptureItems,
  financeCaptures,
  financialSnapshots,
  settlementRecords,
  syncRuns,
  type FinanceCaptureItemRow,
  type FinancialSnapshotRow,
  type SettlementRecordRow
} from "../schema.js";
import type { UpsertBatchResult } from "./orders.js";
import { completeSyncRun } from "./sync-runs.js";

type DbExecutor = Database | DatabaseTransaction;

export interface DecisionFinanceSnapshotInput {
  capturedAt: Date | null;
  currency: string;
  availableBalance: string | null;
  frozenBalance: string | null;
  totalBalance: string | null;
  toSettleBalance: string | null;
  onHoldBalance: string | null;
  officialOnHoldAmount: string | null;
  settlements: ReadonlyArray<Pick<SettlementRecordRow, "settlementState" | "onHoldReason" | "expectedSettlementAmount">>;
  reasonSummary?: DecisionFinanceReasonSummary;
}

export interface DecisionFinanceReasonSummary {
  readonly statementCount: number;
  readonly onHoldCount: number;
  readonly waitingForPackageDeliveryAmount: string | null;
  readonly deliveredAwaitingSettlementAmount: string | null;
  readonly waitingForCompletedRefundReturnAmount: string | null;
  readonly unknownOnHoldReasonCount: number;
  readonly missingOnHoldExpectedAmountCount: number;
}

export function normalizeFinanceReasonSummary(
  summary: DecisionFinanceReasonSummary,
  currentPopulationCapturedAt?: Date | null,
): DecisionFinanceReasonSummary {
  if (currentPopulationCapturedAt === undefined || currentPopulationCapturedAt === null ||
      summary.unknownOnHoldReasonCount !== 0 || summary.missingOnHoldExpectedAmountCount !== 0) {
    return summary;
  }
  return {
    ...summary,
    waitingForPackageDeliveryAmount: summary.waitingForPackageDeliveryAmount ?? "0.0000",
    deliveredAwaitingSettlementAmount: summary.deliveredAwaitingSettlementAmount ?? "0.0000",
    waitingForCompletedRefundReturnAmount: summary.waitingForCompletedRefundReturnAmount ?? "0.0000",
  };
}

function scaledMoney(value: string | null): bigint {
  if (value === null) return 0n;
  const match = /^([+-]?)(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (match === null) throw new Error(`Finance money must be a decimal with at most 4 fractional digits: ${value}`);
  const magnitude = BigInt(match[2]!) * 10_000n + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -magnitude : magnitude;
}

function formatMoney(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 10_000n;
  const fraction = (magnitude % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function buildDecisionFinanceSnapshot(
  input: DecisionFinanceSnapshotInput,
): DecisionFinanceSnapshot {
  const onHold = input.settlements.filter((row) => row.settlementState === "ON_HOLD");
  const waiting = onHold
    .filter((row) => row.onHoldReason === "WAITING_FOR_PACKAGE_DELIVERY")
    .reduce((sum, row) => sum + scaledMoney(row.expectedSettlementAmount), 0n);
  const delivered = onHold
    .filter((row) => row.onHoldReason === "DELIVERED_AWAITING_SETTLEMENT")
    .reduce((sum, row) => sum + scaledMoney(row.expectedSettlementAmount), 0n);
  const refundReturn = onHold
    .filter((row) => row.onHoldReason === "WAITING_FOR_COMPLETED_REFUND_RETURN")
    .reduce((sum, row) => sum + scaledMoney(row.expectedSettlementAmount), 0n);
  const reasonSummary = input.reasonSummary;
  const missingExpectedAmountCount = reasonSummary?.missingOnHoldExpectedAmountCount ??
    onHold.filter((row) => row.expectedSettlementAmount === null).length;
  const waitingAmount = missingExpectedAmountCount > 0
    ? null
    : reasonSummary?.waitingForPackageDeliveryAmount === undefined
      ? formatMoney(waiting)
      : reasonSummary.waitingForPackageDeliveryAmount === null
        ? null
        : formatMoney(scaledMoney(reasonSummary.waitingForPackageDeliveryAmount));
  const deliveredAmount = missingExpectedAmountCount > 0
    ? null
    : reasonSummary?.deliveredAwaitingSettlementAmount === undefined
      ? formatMoney(delivered)
      : reasonSummary.deliveredAwaitingSettlementAmount === null
        ? null
        : formatMoney(scaledMoney(reasonSummary.deliveredAwaitingSettlementAmount));
  const refundReturnAmount = missingExpectedAmountCount > 0
    ? null
    : reasonSummary?.waitingForCompletedRefundReturnAmount === undefined
      ? formatMoney(refundReturn)
      : reasonSummary.waitingForCompletedRefundReturnAmount === null
        ? null
        : formatMoney(scaledMoney(reasonSummary.waitingForCompletedRefundReturnAmount));
  const unknownReasonCount = reasonSummary?.unknownOnHoldReasonCount ??
    (onHold.filter((row) => row.onHoldReason !== "WAITING_FOR_PACKAGE_DELIVERY" && row.onHoldReason !== "DELIVERED_AWAITING_SETTLEMENT" && row.onHoldReason !== "WAITING_FOR_COMPLETED_REFUND_RETURN").length);
  const official = input.officialOnHoldAmount === null ? null : formatMoney(scaledMoney(input.officialOnHoldAmount));

  return {
    capturedAt: input.capturedAt?.toISOString() ?? null,
    currency: input.currency,
    availableBalance: input.availableBalance,
    frozenBalance: input.frozenBalance,
    totalBalance: input.totalBalance,
    toSettleBalance: input.toSettleBalance,
    onHoldBalance: input.onHoldBalance,
    officialOnHoldAmount: official,
    waitingForPackageDeliveryAmount: waitingAmount,
    deliveredAwaitingSettlementAmount: deliveredAmount,
    waitingForCompletedRefundReturnAmount: refundReturnAmount,
    reasonTotalsReconcileToOfficialOnHold: official !== null && unknownReasonCount === 0 &&
      missingExpectedAmountCount === 0 && waitingAmount !== null && deliveredAmount !== null && refundReturnAmount !== null &&
      scaledMoney(waitingAmount) + scaledMoney(deliveredAmount) + scaledMoney(refundReturnAmount) === scaledMoney(official),
    missingOnHoldExpectedAmountCount: missingExpectedAmountCount,
    settlementCount: reasonSummary?.statementCount ?? input.settlements.length,
    onHoldSettlementCount: reasonSummary?.onHoldCount ?? onHold.length,
  };
}

export interface SettlementUpsertInput {
  shopId: string;
  sourceStatementDetailId: string;
  tradeOrderId: string | null;
  placedAt: Date | null;
  deliveredAt: Date | null;
  estimatedSettlementAt: Date | null;
  earningAmount: string | null;
  feeAmount: string | null;
  shippingAmount: string | null;
  expectedSettlementAmount: string | null;
  eligibleSettlementAmount: string | null;
  settledAmount: string | null;
  currency: string;
  sourceSettlementStatus: string;
  settlementState: SettlementRecordRow["settlementState"];
  onHoldReason: string | null;
  sourceHash: string;
  sourceSchemaVersion: string;
  rawData: Record<string, unknown>;
}

export async function upsertSettlementBatch(
  executor: DbExecutor,
  batch: readonly SettlementUpsertInput[],
  capturedAt?: Date | null
): Promise<UpsertBatchResult> {
  if (batch.length === 0) {
    return { rowsRead: 0, rowsWritten: 0 };
  }

  const uniqueBatch = [
    ...new Map(
      batch.map((record) => [
        `${record.shopId}\u0000${record.sourceStatementDetailId}`,
        record
      ])
    ).values()
  ];
  const now = new Date();
  const lastSeenAt = capturedAt ?? now;
  const written = await executor
    .insert(settlementRecords)
    .values(uniqueBatch.map((record) => ({ ...record, firstSeenAt: now, lastSeenAt })))
    .onConflictDoUpdate({
      target: [settlementRecords.shopId, settlementRecords.sourceStatementDetailId],
      set: {
        tradeOrderId: sql`excluded.trade_order_id`,
        placedAt: sql`excluded.placed_at`,
        deliveredAt: sql`excluded.delivered_at`,
        estimatedSettlementAt: sql`excluded.estimated_settlement_at`,
        earningAmount: sql`excluded.earning_amount`,
        feeAmount: sql`excluded.fee_amount`,
        shippingAmount: sql`excluded.shipping_amount`,
        expectedSettlementAmount: sql`excluded.expected_settlement_amount`,
        eligibleSettlementAmount: sql`excluded.eligible_settlement_amount`,
        settledAmount: sql`excluded.settled_amount`,
        currency: sql`excluded.currency`,
        sourceSettlementStatus: sql`excluded.source_settlement_status`,
        settlementState: sql`excluded.settlement_state`,
        onHoldReason: sql`excluded.on_hold_reason`,
        sourceHash: sql`excluded.source_hash`,
        sourceSchemaVersion: sql`excluded.source_schema_version`,
        rawData: sql`excluded.raw_data`,
        lastSeenAt,
        updatedAt: now
      },
      setWhere: sql`
        ${settlementRecords.lastSeenAt} < excluded.last_seen_at
        or ${settlementRecords.sourceHash} is distinct from excluded.source_hash
      `
    })
    .returning({ id: settlementRecords.id });

  return { rowsRead: batch.length, rowsWritten: written.length };
}

export interface FinancialSnapshotInput {
  shopId: string;
  capturedAt: Date;
  currency: string;
  availableBalance: string | null;
  frozenBalance: string | null;
  totalBalance: string | null;
  toSettleBalance: string | null;
  onHoldBalance: string | null;
  officialOnHoldAmount?: string | null;
  settlementPeriodDays?: number | null;
  settlementPeriodType?: string | null;
  reserveRatio: number | null;
  reserveDays: number | null;
  reserveLevel: string | null;
  snapshotHash: string;
  sourceSchemaVersion: string;
  rawData: Record<string, unknown>;
}

export async function insertFinancialSnapshot(
  executor: DbExecutor,
  snapshot: FinancialSnapshotInput
): Promise<{ inserted: boolean; row: FinancialSnapshotRow | null }> {
  validateFinancialSnapshot(snapshot);
  const [row] = await executor
    .insert(financialSnapshots)
    .values({
      ...snapshot,
      officialOnHoldAmount: snapshot.officialOnHoldAmount ?? null,
      settlementPeriodDays: snapshot.settlementPeriodDays ?? null,
      settlementPeriodType: snapshot.settlementPeriodType ?? null,
      reserveRatio: snapshot.reserveRatio === null ? null : String(snapshot.reserveRatio)
    })
    .onConflictDoNothing({
      target: [financialSnapshots.shopId, financialSnapshots.capturedAt, financialSnapshots.snapshotHash]
    })
    .returning();

  return { inserted: row !== undefined, row: row ?? null };
}

type FinanceCaptureItemInput = Pick<
  SettlementUpsertInput,
  | "shopId"
  | "sourceStatementDetailId"
  | "expectedSettlementAmount"
  | "settledAmount"
  | "currency"
  | "sourceSettlementStatus"
  | "settlementState"
  | "onHoldReason"
  | "sourceHash"
  | "sourceSchemaVersion"
  | "rawData"
>;

type AuthoritativeFinanceCaptureItem = Omit<FinanceCaptureItemInput, "rawData"> & {
  readonly sourceStatementId: string;
  readonly sourceStatementVersion: string;
};

export interface FinalizeFinanceSyncRunInput {
  readonly runId: string;
  readonly shopId: string;
  readonly checkpoint: Record<string, unknown> | null;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly sourceComplete: boolean;
  readonly sourceReconciled: boolean;
  readonly snapshot: FinancialSnapshotInput | null;
  readonly settlements: readonly FinanceCaptureItemInput[];
}

export interface FinalizeFinanceSyncRunResult {
  readonly snapshotInserted: boolean;
  readonly captureInserted: boolean;
  readonly evidenceItemsInserted: number;
}

export async function finalizeFinanceSyncRun(
  transaction: DatabaseTransaction,
  input: FinalizeFinanceSyncRunInput,
): Promise<FinalizeFinanceSyncRunResult> {
  const authoritative = input.sourceComplete && input.sourceReconciled &&
    input.snapshot !== null && input.snapshot.officialOnHoldAmount !== null;
  if (!authoritative) {
    const snapshotWrite = input.snapshot === null
      ? { inserted: false }
      : await insertFinancialSnapshot(transaction, input.snapshot);
    await completeSyncRun(transaction, {
      runId: input.runId,
      checkpoint: input.checkpoint,
      rowsRead: input.rowsRead,
      rowsWritten: input.rowsWritten + (snapshotWrite.inserted ? 1 : 0),
      sourceComplete: false,
      sourceCapturedAt: input.snapshot?.capturedAt ?? null,
    });
    return {
      snapshotInserted: snapshotWrite.inserted,
      captureInserted: false,
      evidenceItemsInserted: 0,
    };
  }
  if (input.snapshot.shopId !== input.shopId || input.settlements.some((item) => item.shopId !== input.shopId)) {
    throw new Error("Finance capture evidence shop does not match the sync run shop");
  }
  validateFinancialSnapshot(input.snapshot);

  const snapshotInput = {
    ...input.snapshot,
    officialOnHoldAmount: input.snapshot.officialOnHoldAmount!,
  };
  const uniqueItems = uniqueCaptureItems(input.settlements.map(authoritativeCaptureItem));
  assertFinanceCaptureReconciled(snapshotInput, uniqueItems);
  const populationHash = financePopulationHash(uniqueItems);
  const snapshotWrite = await insertFinancialSnapshot(transaction, input.snapshot);
  const snapshot = snapshotWrite.row ?? await getFinancialSnapshotAt(
    transaction,
    input.shopId,
    input.snapshot.capturedAt,
    input.snapshot.snapshotHash,
  );
  if (snapshot === null || !snapshotMatchesInput(snapshot, input.snapshot)) {
    throw new Error("Finance capture snapshot identity does not match its persisted snapshot");
  }

  const [capture] = await transaction
    .insert(financeCaptures)
    .values({
      shopId: input.shopId,
      syncRunId: input.runId,
      capturedAt: input.snapshot.capturedAt,
      snapshotId: snapshot.id,
      snapshotHash: input.snapshot.snapshotHash,
      populationHash,
      currency: input.snapshot.currency,
      officialOnHoldAmount: snapshotInput.officialOnHoldAmount,
      itemCount: uniqueItems.length,
      sourceSchemaVersion: input.snapshot.sourceSchemaVersion,
    })
    .onConflictDoNothing({
      target: [financeCaptures.shopId, financeCaptures.capturedAt],
    })
    .returning({ id: financeCaptures.id });
  const persistedCapture = await getFinanceCaptureAt(
    transaction,
    input.shopId,
    input.snapshot.capturedAt,
  );
  if (persistedCapture === null ||
      persistedCapture.snapshotId !== snapshot.id ||
      persistedCapture.snapshotHash !== input.snapshot.snapshotHash ||
      persistedCapture.populationHash !== populationHash ||
      persistedCapture.currency !== input.snapshot.currency ||
      persistedCapture.officialOnHoldAmount !== formatMoney(scaledMoney(snapshotInput.officialOnHoldAmount)) ||
      persistedCapture.itemCount !== uniqueItems.length ||
      persistedCapture.sourceSchemaVersion !== input.snapshot.sourceSchemaVersion) {
    throw new Error("Finance capture replay does not match immutable evidence");
  }

  let evidenceItemsInserted = 0;
  if (capture !== undefined && uniqueItems.length > 0) {
    const evidence = await transaction.insert(financeCaptureItems).values(uniqueItems.map((item) => ({
      captureId: capture.id,
      ...item,
    }))).returning({ id: financeCaptureItems.id });
    evidenceItemsInserted = evidence.length;
  }
  if (capture === undefined) {
    const evidence = await listFinanceCaptureItems(transaction, persistedCapture.id, input.shopId);
    if (!captureItemsEqual(evidence, uniqueItems)) {
      throw new Error("Finance capture replay population does not match immutable evidence");
    }
    throw new Error("Finance capture instant already has authoritative evidence");
  }

  const rowsWritten = input.rowsWritten + (snapshotWrite.inserted ? 1 : 0);
  await completeSyncRun(transaction, {
    runId: input.runId,
    checkpoint: input.checkpoint,
    rowsRead: input.rowsRead,
    rowsWritten,
    sourceComplete: true,
    sourceCapturedAt: input.snapshot.capturedAt,
  });
  return {
    snapshotInserted: snapshotWrite.inserted,
    captureInserted: capture !== undefined,
    evidenceItemsInserted,
  };
}

function validateFinancialSnapshot(snapshot: FinancialSnapshotInput): void {
  if (!Number.isFinite(snapshot.capturedAt.getTime())) throw new Error("Finance snapshot capturedAt must be finite");
  if (!/^[A-Z]{3}$/.test(snapshot.currency)) throw new Error("Finance snapshot currency is invalid");
  if (!/^[0-9a-f]{64}$/.test(snapshot.snapshotHash)) throw new Error("Finance snapshot hash must be lowercase SHA-256");
  if (snapshot.sourceSchemaVersion.trim().length === 0) throw new Error("Finance snapshot source schema version is required");
  for (const [name, value] of Object.entries({
    availableBalance: snapshot.availableBalance,
    frozenBalance: snapshot.frozenBalance,
    totalBalance: snapshot.totalBalance,
    toSettleBalance: snapshot.toSettleBalance,
    onHoldBalance: snapshot.onHoldBalance,
    officialOnHoldAmount: snapshot.officialOnHoldAmount ?? null,
  })) {
    if (value !== null && scaledMoney(value) < 0n) throw new Error(`Finance snapshot ${name} must be nonnegative`);
  }
}

function authoritativeCaptureItem(item: FinanceCaptureItemInput): AuthoritativeFinanceCaptureItem {
  const statement = item.rawData.statement;
  if (typeof statement !== "object" || statement === null || Array.isArray(statement)) {
    throw new Error("Finance capture statement identity is unavailable");
  }
  const sourceStatementId = sourceIdentityPart((statement as Record<string, unknown>).id);
  const sourceStatementVersion = sourceIdentityPart((statement as Record<string, unknown>).version);
  if (sourceStatementId === null || sourceStatementVersion === null) {
    throw new Error("Finance capture statement identity is unavailable");
  }
  if (item.sourceStatementDetailId.trim().length === 0) throw new Error("Finance capture statement detail identity is unavailable");
  if (!/^[A-Z]{3}$/.test(item.currency)) throw new Error("Finance capture item currency is invalid");
  if (!/^[0-9a-f]{64}$/.test(item.sourceHash)) throw new Error("Finance capture source hash must be lowercase SHA-256");
  if (item.sourceSchemaVersion.trim().length === 0 || item.sourceSettlementStatus.trim().length === 0) {
    throw new Error("Finance capture source provenance is unavailable");
  }
  if (item.expectedSettlementAmount !== null && scaledMoney(item.expectedSettlementAmount) < 0n) {
    throw new Error("Finance capture expected settlement amount must be nonnegative");
  }
  if (item.settledAmount !== null && scaledMoney(item.settledAmount) < 0n) {
    throw new Error("Finance capture settled amount must be nonnegative");
  }
  const { rawData: _rawData, ...persisted } = item;
  return { ...persisted, sourceStatementId, sourceStatementVersion };
}

function sourceIdentityPart(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized.length === 0 ? null : normalized;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalNullableMoney(value: string | null): string | null {
  return value === null ? null : formatMoney(scaledMoney(value));
}

function canonicalReserveRatio(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Finance reserve ratio is invalid");
  return value.toFixed(6);
}

function ownedJsonEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return canonicalOwnedJson(left) === canonicalOwnedJson(right);
}

function canonicalOwnedJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalOwnedJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalOwnedJson(child)}`)
    .join(",")}}`;
}

function hasPersistedStatementIdentity(item: FinanceCaptureItemRow): item is FinanceCaptureItemRow & {
  sourceStatementId: string;
  sourceStatementVersion: string;
} {
  return item.sourceStatementId !== null && item.sourceStatementId.trim().length > 0 &&
    item.sourceStatementVersion !== null && item.sourceStatementVersion.trim().length > 0;
}

function uniqueCaptureItems(items: readonly AuthoritativeFinanceCaptureItem[]): AuthoritativeFinanceCaptureItem[] {
  const unique = new Map<string, AuthoritativeFinanceCaptureItem>();
  for (const item of items) {
    const previous = unique.get(item.sourceStatementDetailId);
    if (previous !== undefined && captureItemIdentity(previous) !== captureItemIdentity(item)) {
      throw new Error(`Finance capture contains conflicting source ID ${item.sourceStatementDetailId}`);
    }
    unique.set(item.sourceStatementDetailId, item);
  }
  return [...unique.values()].sort((left, right) =>
    compareCodePoints(left.sourceStatementDetailId, right.sourceStatementDetailId));
}

function assertFinanceCaptureReconciled(
  snapshot: FinancialSnapshotInput & { officialOnHoldAmount?: string | null },
  items: readonly AuthoritativeFinanceCaptureItem[],
): void {
  if (snapshot.officialOnHoldAmount === undefined || snapshot.officialOnHoldAmount === null) {
    throw new Error("Finance capture official On Hold amount is unavailable");
  }
  if (items.some((item) => item.currency !== snapshot.currency)) {
    throw new Error("Finance capture item currency does not match its official snapshot");
  }
  if (items.some((item) => item.settlementState === "ON_HOLD" && item.expectedSettlementAmount === null)) {
    throw new Error("Finance capture On Hold amount is unavailable");
  }
  const onHoldAmount = items
    .filter((item) => item.settlementState === "ON_HOLD")
    .reduce((sum, item) => sum + scaledMoney(item.expectedSettlementAmount), 0n);
  if (onHoldAmount !== scaledMoney(snapshot.officialOnHoldAmount)) {
    throw new Error("Finance capture population does not reconcile to its official snapshot");
  }
}

function captureItemIdentity(item: AuthoritativeFinanceCaptureItem): string {
  return [
    item.shopId,
    item.sourceStatementId,
    item.sourceStatementVersion,
    item.sourceStatementDetailId,
    item.expectedSettlementAmount === null ? "" : formatMoney(scaledMoney(item.expectedSettlementAmount)),
    item.settledAmount === null ? "" : formatMoney(scaledMoney(item.settledAmount)),
    item.currency,
    item.sourceSettlementStatus,
    item.settlementState,
    item.onHoldReason ?? "",
    item.sourceHash,
    item.sourceSchemaVersion,
  ].join("\u0000");
}

function financePopulationHash(items: readonly AuthoritativeFinanceCaptureItem[]): string {
  return createHash("sha256")
    .update(items.map(captureItemIdentity).join("\n"))
    .digest("hex");
}

function snapshotMatchesInput(row: FinancialSnapshotRow, input: FinancialSnapshotInput): boolean {
  return row.shopId === input.shopId &&
    row.capturedAt.getTime() === input.capturedAt.getTime() &&
    row.snapshotHash === input.snapshotHash &&
    row.currency === input.currency &&
    row.availableBalance === canonicalNullableMoney(input.availableBalance) &&
    row.frozenBalance === canonicalNullableMoney(input.frozenBalance) &&
    row.totalBalance === canonicalNullableMoney(input.totalBalance) &&
    row.toSettleBalance === canonicalNullableMoney(input.toSettleBalance) &&
    row.onHoldBalance === canonicalNullableMoney(input.onHoldBalance) &&
    row.officialOnHoldAmount === canonicalNullableMoney(input.officialOnHoldAmount ?? null) &&
    row.settlementPeriodDays === (input.settlementPeriodDays ?? null) &&
    row.settlementPeriodType === (input.settlementPeriodType ?? null) &&
    row.reserveRatio === canonicalReserveRatio(input.reserveRatio) &&
    row.reserveDays === input.reserveDays &&
    row.reserveLevel === input.reserveLevel &&
    row.sourceSchemaVersion === input.sourceSchemaVersion &&
    ownedJsonEqual(row.rawData, input.rawData);
}

async function getFinancialSnapshotAt(
  executor: DbExecutor,
  shopId: string,
  capturedAt: Date,
  snapshotHash: string,
): Promise<FinancialSnapshotRow | null> {
  const [row] = await executor.select().from(financialSnapshots).where(and(
    eq(financialSnapshots.shopId, shopId),
    eq(financialSnapshots.capturedAt, capturedAt),
    eq(financialSnapshots.snapshotHash, snapshotHash),
  )).limit(1);
  return row ?? null;
}

async function getFinanceCaptureAt(
  executor: DbExecutor,
  shopId: string,
  capturedAt: Date,
) {
  const [row] = await executor.select().from(financeCaptures).where(and(
    eq(financeCaptures.shopId, shopId),
    eq(financeCaptures.capturedAt, capturedAt),
  )).limit(1);
  return row ?? null;
}

async function listFinanceCaptureItems(
  executor: DbExecutor,
  captureId: string,
  shopId: string,
): Promise<FinanceCaptureItemRow[]> {
  const rows = await executor.select().from(financeCaptureItems).where(and(
    eq(financeCaptureItems.captureId, captureId),
    eq(financeCaptureItems.shopId, shopId),
  )).orderBy(asc(financeCaptureItems.id));
  return rows.sort((left, right) => compareCodePoints(
    left.sourceStatementDetailId,
    right.sourceStatementDetailId,
  ));
}

function captureItemsEqual(
  persisted: readonly FinanceCaptureItemRow[],
  expected: readonly AuthoritativeFinanceCaptureItem[],
): boolean {
  return persisted.length === expected.length && persisted.every((row, index) => {
    const item = expected[index]!;
    return row.shopId === item.shopId &&
      row.sourceStatementId === item.sourceStatementId &&
      row.sourceStatementVersion === item.sourceStatementVersion &&
      row.sourceStatementDetailId === item.sourceStatementDetailId &&
      row.expectedSettlementAmount === (item.expectedSettlementAmount === null
        ? null
        : formatMoney(scaledMoney(item.expectedSettlementAmount))) &&
      row.settledAmount === (item.settledAmount === null
        ? null
        : formatMoney(scaledMoney(item.settledAmount))) &&
      row.currency === item.currency &&
      row.sourceSettlementStatus === item.sourceSettlementStatus &&
      row.settlementState === item.settlementState &&
      row.onHoldReason === item.onHoldReason &&
      row.sourceHash === item.sourceHash &&
      row.sourceSchemaVersion === item.sourceSchemaVersion;
  });
}

export async function getLatestFinancialSnapshot(
  db: Database,
  shopId: string
): Promise<FinancialSnapshotRow | null> {
  const [row] = await db
    .select()
    .from(financialSnapshots)
    .where(eq(financialSnapshots.shopId, shopId))
    .orderBy(desc(financialSnapshots.capturedAt), desc(financialSnapshots.createdAt), desc(financialSnapshots.id))
    .limit(1);
  return row ?? null;
}

export async function getLatestFinancialSnapshotAtOrBefore(
  db: Database,
  shopId: string,
  capturedAt: Date,
): Promise<FinancialSnapshotRow | null> {
  const [row] = await db
    .select()
    .from(financialSnapshots)
    .where(and(
      eq(financialSnapshots.shopId, shopId),
      lte(financialSnapshots.capturedAt, capturedAt),
    ))
    .orderBy(desc(financialSnapshots.capturedAt), desc(financialSnapshots.createdAt), desc(financialSnapshots.id))
    .limit(1);
  return row ?? null;
}

export async function listOnHoldSettlements(
  db: Database,
  shopId: string,
  limit = 100
): Promise<SettlementRecordRow[]> {
  return db
    .select()
    .from(settlementRecords)
    .where(and(eq(settlementRecords.shopId, shopId), eq(settlementRecords.settlementState, "ON_HOLD")))
    .orderBy(desc(settlementRecords.placedAt))
    .limit(Math.min(Math.max(limit, 1), 1000));
}

export async function listSettlementsForMetrics(
  db: Database,
  shopId: string,
  start: Date,
  end: Date
): Promise<SettlementRecordRow[]> {
  return db
    .select()
    .from(settlementRecords)
    .where(
      and(
        eq(settlementRecords.shopId, shopId),
        gte(settlementRecords.placedAt, start),
        lt(settlementRecords.placedAt, end)
      )
    )
    .orderBy(settlementRecords.placedAt);
}

export interface FinanceSummary {
  proofStatus: "PROVEN" | "PROOF_UNAVAILABLE";
  latestSnapshot: FinancialSnapshotRow | null;
  statementCount: number;
  onHoldCount: number;
  expectedSettlementAmount: string | null;
  onHoldExpectedAmount: string | null;
  settledAmount: string | null;
  waitingForPackageDeliveryAmount: string | null;
  deliveredAwaitingSettlementAmount: string | null;
  waitingForCompletedRefundReturnAmount: string | null;
  unknownOnHoldReasonCount: number;
  missingOnHoldExpectedAmountCount: number;
}

export async function getFinanceSummary(
  db: Database,
  shopId: string,
  currentPopulationCapturedAt?: Date | null
): Promise<FinanceSummary> {
  const fallbackSnapshot = currentPopulationCapturedAt === undefined
    ? await getLatestFinancialSnapshot(db, shopId)
    : currentPopulationCapturedAt === null
      ? null
      : await getLatestFinancialSnapshotAtOrBefore(db, shopId, currentPopulationCapturedAt);
  const selectedAt = currentPopulationCapturedAt === undefined
    ? fallbackSnapshot?.capturedAt ?? null
    : currentPopulationCapturedAt;
  const [capture] = selectedAt === null
    ? []
    : await db
      .select({
        id: financeCaptures.id,
        capturedAt: financeCaptures.capturedAt,
        snapshotId: financeCaptures.snapshotId,
        snapshotHash: financeCaptures.snapshotHash,
        populationHash: financeCaptures.populationHash,
        currency: financeCaptures.currency,
        officialOnHoldAmount: financeCaptures.officialOnHoldAmount,
        itemCount: financeCaptures.itemCount,
        sourceSchemaVersion: financeCaptures.sourceSchemaVersion,
        runMode: syncRuns.mode,
        runStatus: syncRuns.status,
        runSourceComplete: syncRuns.sourceComplete,
        runSourceCapturedAt: syncRuns.sourceCapturedAt,
      })
      .from(financeCaptures)
      .innerJoin(syncRuns, and(
        eq(syncRuns.id, financeCaptures.syncRunId),
        eq(syncRuns.shopId, financeCaptures.shopId),
      ))
      .where(and(
        eq(financeCaptures.shopId, shopId),
        eq(financeCaptures.capturedAt, selectedAt),
      ))
      .limit(1);
  if (capture === undefined) return unavailableFinanceSummary(fallbackSnapshot);

  const [latestSnapshot, [summary]] = await Promise.all([
    db.select().from(financialSnapshots).where(and(
      eq(financialSnapshots.id, capture.snapshotId),
      eq(financialSnapshots.shopId, shopId),
    )).limit(1).then(([row]) => row ?? null),
    db
      .select({
        statementCount: sql<number>`count(*)::int`,
        onHoldCount: sql<number>`count(*) filter (where ${financeCaptureItems.settlementState} = 'ON_HOLD')::int`,
        expectedSettlementAmount: sql<string | null>`sum(${financeCaptureItems.expectedSettlementAmount})`,
        onHoldExpectedAmount: sql<string | null>`sum(${financeCaptureItems.expectedSettlementAmount}) filter (where ${financeCaptureItems.settlementState} = 'ON_HOLD')`,
        settledAmount: sql<string | null>`sum(${financeCaptureItems.settledAmount})`,
        waitingForPackageDeliveryAmount: sql<string | null>`sum(${financeCaptureItems.expectedSettlementAmount}) filter (where ${financeCaptureItems.settlementState} = 'ON_HOLD' and ${financeCaptureItems.onHoldReason} = 'WAITING_FOR_PACKAGE_DELIVERY')`,
        deliveredAwaitingSettlementAmount: sql<string | null>`sum(${financeCaptureItems.expectedSettlementAmount}) filter (where ${financeCaptureItems.settlementState} = 'ON_HOLD' and ${financeCaptureItems.onHoldReason} = 'DELIVERED_AWAITING_SETTLEMENT')`,
        waitingForCompletedRefundReturnAmount: sql<string | null>`sum(${financeCaptureItems.expectedSettlementAmount}) filter (where ${financeCaptureItems.settlementState} = 'ON_HOLD' and ${financeCaptureItems.onHoldReason} = 'WAITING_FOR_COMPLETED_REFUND_RETURN')`,
        unknownOnHoldReasonCount: sql<number>`count(*) filter (where ${financeCaptureItems.settlementState} = 'ON_HOLD' and (${financeCaptureItems.onHoldReason} is null or ${financeCaptureItems.onHoldReason} not in ('WAITING_FOR_PACKAGE_DELIVERY', 'DELIVERED_AWAITING_SETTLEMENT', 'WAITING_FOR_COMPLETED_REFUND_RETURN')))::int`,
        missingOnHoldExpectedAmountCount: sql<number>`count(*) filter (where ${financeCaptureItems.settlementState} = 'ON_HOLD' and ${financeCaptureItems.expectedSettlementAmount} is null)::int`
      })
      .from(financeCaptureItems)
      .where(and(
        eq(financeCaptureItems.captureId, capture.id),
        eq(financeCaptureItems.shopId, shopId),
      )),
  ]);
  const evidenceItems = await listFinanceCaptureItems(db, capture.id, shopId);
  const captureValid = latestSnapshot !== null &&
    capture.runMode === "FINANCE" &&
    capture.runStatus === "SUCCEEDED" &&
    capture.runSourceComplete === true &&
    capture.runSourceCapturedAt?.getTime() === capture.capturedAt.getTime() &&
    latestSnapshot.capturedAt.getTime() === capture.capturedAt.getTime() &&
    latestSnapshot.snapshotHash === capture.snapshotHash &&
    (evidenceItems.every(hasPersistedStatementIdentity)
      ? financePopulationHash(evidenceItems) === capture.populationHash
      : false) &&
    latestSnapshot.currency === capture.currency &&
    latestSnapshot.officialOnHoldAmount === capture.officialOnHoldAmount &&
    latestSnapshot.sourceSchemaVersion === capture.sourceSchemaVersion &&
    summary?.statementCount === capture.itemCount &&
    (summary.onHoldCount === 0
      ? scaledMoney(capture.officialOnHoldAmount) === 0n
      : summary.onHoldExpectedAmount !== null &&
        scaledMoney(summary.onHoldExpectedAmount) === scaledMoney(capture.officialOnHoldAmount));
  if (!captureValid) return unavailableFinanceSummary(latestSnapshot ?? fallbackSnapshot);

  const normalizedSummary = normalizeFinanceReasonSummary({
    statementCount: summary.statementCount,
    onHoldCount: summary.onHoldCount,
    waitingForPackageDeliveryAmount: summary.waitingForPackageDeliveryAmount,
    deliveredAwaitingSettlementAmount: summary.deliveredAwaitingSettlementAmount,
    waitingForCompletedRefundReturnAmount: summary.waitingForCompletedRefundReturnAmount,
    unknownOnHoldReasonCount: summary.unknownOnHoldReasonCount,
    missingOnHoldExpectedAmountCount: summary.missingOnHoldExpectedAmountCount,
  }, capture.capturedAt);
  return {
    proofStatus: "PROVEN",
    latestSnapshot,
    statementCount: normalizedSummary.statementCount,
    onHoldCount: normalizedSummary.onHoldCount,
    expectedSettlementAmount: summary.expectedSettlementAmount,
    onHoldExpectedAmount: summary.onHoldExpectedAmount,
    settledAmount: summary.settledAmount,
    waitingForPackageDeliveryAmount: normalizedSummary.waitingForPackageDeliveryAmount,
    deliveredAwaitingSettlementAmount: normalizedSummary.deliveredAwaitingSettlementAmount,
    waitingForCompletedRefundReturnAmount: normalizedSummary.waitingForCompletedRefundReturnAmount,
    unknownOnHoldReasonCount: normalizedSummary.unknownOnHoldReasonCount,
    missingOnHoldExpectedAmountCount: normalizedSummary.missingOnHoldExpectedAmountCount,
  };
}

function unavailableFinanceSummary(latestSnapshot: FinancialSnapshotRow | null): FinanceSummary {
  return {
    proofStatus: "PROOF_UNAVAILABLE",
    latestSnapshot,
    statementCount: 0,
    onHoldCount: 0,
    expectedSettlementAmount: null,
    onHoldExpectedAmount: null,
    settledAmount: null,
    waitingForPackageDeliveryAmount: null,
    deliveredAwaitingSettlementAmount: null,
    waitingForCompletedRefundReturnAmount: null,
    unknownOnHoldReasonCount: 0,
    missingOnHoldExpectedAmountCount: 0,
  };
}
