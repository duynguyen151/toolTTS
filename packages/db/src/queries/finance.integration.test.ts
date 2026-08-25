import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import {
  financeCaptureItems,
  financeCaptures,
  financialSnapshots,
  settlementRecords,
  shops,
  syncRuns,
} from "../schema.js";
import { beginSyncRun, failSyncRun } from "./sync-runs.js";
import {
  finalizeFinanceSyncRun,
  getFinanceSummary,
  getLatestFinancialSnapshot,
  insertFinancialSnapshot,
  upsertSettlementBatch,
  type FinancialSnapshotInput,
  type SettlementUpsertInput,
} from "./finance.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase.sequential("finance immutable-capture PostgreSQL integration", () => {
  let context: DatabaseContext;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
  });

  afterAll(async () => {
    if (context) await closeDatabase(context);
  });

  // W0-T02 regression: immutable capture evidence must preserve capture A after mutable rows change.
  it("preserves changed and removed capture-time values after a later capture", async () => {
    const shopId = await createShop();
    const captureA = new Date("2026-08-18T00:00:00.000Z");
    const captureB = new Date("2026-08-19T00:00:00.000Z");
    await recordCapture(shopId, captureA, "snapshot-mutable-a", "534.2800", [
      settlement(shopId, "MUTABLE", "524.2800"),
      settlement(shopId, "REMOVED", "10.0000", { onHoldReason: "DELIVERED_AWAITING_SETTLEMENT" }),
    ]);
    await recordCapture(shopId, captureB, "snapshot-mutable-b", "100.0000", [
      settlement(shopId, "MUTABLE", "523.8700", {
        settlementState: "ELIGIBLE",
        sourceSettlementStatus: "ELIGIBLE",
        onHoldReason: null,
        sourceHash: hash("MUTABLE-hash-b"),
      }),
      settlement(shopId, "CURRENT", "100.0000", { onHoldReason: "WAITING_FOR_COMPLETED_REFUND_RETURN" }),
    ]);

    await expect(getFinanceSummary(context.db, shopId, captureA)).resolves.toMatchObject({
      proofStatus: "PROVEN",
      latestSnapshot: { officialOnHoldAmount: "534.2800", capturedAt: captureA },
      statementCount: 2,
      onHoldCount: 2,
      onHoldExpectedAmount: "534.2800",
      waitingForPackageDeliveryAmount: "524.2800",
      deliveredAwaitingSettlementAmount: "10.0000",
    });
    await expect(getFinanceSummary(context.db, shopId, captureB)).resolves.toMatchObject({
      proofStatus: "PROVEN",
      latestSnapshot: { officialOnHoldAmount: "100.0000", capturedAt: captureB },
      statementCount: 2,
      onHoldCount: 1,
      onHoldExpectedAmount: "100.0000",
      waitingForCompletedRefundReturnAmount: "100.0000",
    });
    const immutableRows = await context.db
      .select({
        capturedAt: financeCaptures.capturedAt,
        sourceId: financeCaptureItems.sourceStatementDetailId,
        amount: financeCaptureItems.expectedSettlementAmount,
        state: financeCaptureItems.settlementState,
        reason: financeCaptureItems.onHoldReason,
      })
      .from(financeCaptureItems)
      .innerJoin(financeCaptures, and(
        eq(financeCaptures.id, financeCaptureItems.captureId),
        eq(financeCaptures.shopId, financeCaptureItems.shopId),
      ))
      .where(and(
        eq(financeCaptures.shopId, shopId),
        eq(financeCaptureItems.sourceStatementDetailId, "MUTABLE"),
      ));
    expect(immutableRows).toEqual(expect.arrayContaining([
      { capturedAt: captureA, sourceId: "MUTABLE", amount: "524.2800", state: "ON_HOLD", reason: "WAITING_FOR_PACKAGE_DELIVERY" },
      { capturedAt: captureB, sourceId: "MUTABLE", amount: "523.8700", state: "ELIGIBLE", reason: null },
    ]));
    await expect(context.db.select({ id: settlementRecords.id }).from(settlementRecords)
      .where(eq(settlementRecords.shopId, shopId))).resolves.toHaveLength(3);
  });

  it("separates equal snapshot hashes by capture and rejects a second run for the same instant", async () => {
    const shopId = await createShop();
    const captureA = new Date("2026-08-20T00:00:00.000Z");
    const captureB = new Date("2026-08-21T00:00:00.000Z");
    await recordCapture(shopId, captureA, "equal-summary", "100.0000", [
      settlement(shopId, "FIRST", "100.0000"),
    ]);
    await recordCapture(shopId, captureB, "equal-summary", "100.0000", [
      settlement(shopId, "SECOND", "60.0000"),
      settlement(shopId, "THIRD", "40.0000"),
    ]);
    await expect(recordCapture(shopId, captureB, "equal-summary", "100.0000", [
      settlement(shopId, "SECOND", "60.0000"),
      settlement(shopId, "THIRD", "40.0000"),
    ])).rejects.toThrow();
    await expect(getFinanceSummary(context.db, shopId, captureB)).resolves.toMatchObject({
      proofStatus: "PROVEN",
      latestSnapshot: { capturedAt: captureB, snapshotHash: hash("equal-summary") },
      statementCount: 2,
      onHoldExpectedAmount: "100.0000",
    });
    await expect(getFinanceSummary(context.db, shopId, captureA)).resolves.toMatchObject({
      proofStatus: "PROVEN",
      latestSnapshot: { capturedAt: captureA },
      statementCount: 1,
      onHoldExpectedAmount: "100.0000",
    });
    await expect(getFinanceSummary(context.db, shopId, new Date(captureA.getTime() - 1))).resolves.toMatchObject({
      proofStatus: "PROOF_UNAVAILABLE",
      statementCount: 0,
      onHoldExpectedAmount: null,
    });
    await expect(getFinanceSummary(context.db, shopId, new Date(captureA.getTime() + 1))).resolves.toMatchObject({
      proofStatus: "PROOF_UNAVAILABLE",
      statementCount: 0,
      onHoldExpectedAmount: null,
    });
    await expect(context.db.select({ id: financeCaptures.id }).from(financeCaptures)
      .where(eq(financeCaptures.shopId, shopId))).resolves.toHaveLength(2);
    await expect(context.db.select({ id: financialSnapshots.id }).from(financialSnapshots)
      .where(eq(financialSnapshots.shopId, shopId))).resolves.toHaveLength(2);

    const conflictingRun = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: conflictingRun.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: financialSnapshot(shopId, captureB, "equal-summary", "100.0000"),
      settlements: [settlement(shopId, "CONFLICT", "100.0000")],
    }))).rejects.toThrow();
    await failSyncRun(context.db, { runId: conflictingRun.id, failureType: "TEST", failureMessage: "expected replay mismatch" });

    const conflictingSnapshotRun = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: conflictingSnapshotRun.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: financialSnapshot(shopId, captureB, "different-summary", "100.0000"),
      settlements: [
        settlement(shopId, "SECOND", "60.0000"),
        settlement(shopId, "THIRD", "40.0000"),
      ],
    }))).rejects.toThrow();
    await failSyncRun(context.db, { runId: conflictingSnapshotRun.id, failureType: "TEST", failureMessage: "expected snapshot mismatch" });
  });

  it("reads an empty reconciled capture as proven typed zero", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-21T12:00:00.000Z");
    await recordCapture(shopId, capturedAt, "empty", "0.0000", []);

    await expect(getFinanceSummary(context.db, shopId, capturedAt)).resolves.toMatchObject({
      proofStatus: "PROVEN",
      latestSnapshot: { capturedAt, officialOnHoldAmount: "0.0000" },
      statementCount: 0,
      onHoldCount: 0,
      onHoldExpectedAmount: null,
      waitingForPackageDeliveryAmount: "0.0000",
      deliveredAwaitingSettlementAmount: "0.0000",
      waitingForCompletedRefundReturnAmount: "0.0000",
    });
  });

  it("reports legacy snapshots without immutable items as proof unavailable", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-22T00:00:00.000Z");
    await upsertSettlementBatch(context.db, [settlement(shopId, "LEGACY", "75.0000")], capturedAt);
    await insertFinancialSnapshot(context.db, financialSnapshot(shopId, capturedAt, "legacy", "75.0000"));

    await expect(getFinanceSummary(context.db, shopId, capturedAt)).resolves.toMatchObject({
      proofStatus: "PROOF_UNAVAILABLE",
      latestSnapshot: { snapshotHash: hash("legacy") },
      statementCount: 0,
      onHoldCount: 0,
      onHoldExpectedAmount: null,
      waitingForPackageDeliveryAmount: null,
    });
  });

  it("rejects a capture population that does not reconcile to its official snapshot", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-23T00:00:00.000Z");
    const run = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });

    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: run.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: financialSnapshot(shopId, capturedAt, "mismatch", "80.0000"),
      settlements: [settlement(shopId, "MISMATCH", "79.0000")],
    }))).rejects.toThrow(/does not reconcile/i);
    await expect(context.db.select().from(financeCaptures).where(eq(financeCaptures.shopId, shopId)))
      .resolves.toHaveLength(0);
    await expect(context.db.select().from(financialSnapshots).where(eq(financialSnapshots.shopId, shopId)))
      .resolves.toHaveLength(0);
    await expect(context.db.select({ status: syncRuns.status }).from(syncRuns).where(eq(syncRuns.id, run.id)))
      .resolves.toEqual([{ status: "RUNNING" }]);
    await failSyncRun(context.db, { runId: run.id, failureType: "TEST", failureMessage: "expected mismatch" });
  });

  it("rejects missing On Hold amounts instead of treating them as zero", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-23T12:00:00.000Z");
    const run = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });

    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: run.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: financialSnapshot(shopId, capturedAt, "missing-amount", "0.0000"),
      settlements: [settlement(shopId, "MISSING", "0.0000", { expectedSettlementAmount: null })],
    }))).rejects.toThrow(/amount is unavailable/i);
    await expect(context.db.select().from(financeCaptures).where(eq(financeCaptures.shopId, shopId)))
      .resolves.toHaveLength(0);
    await failSyncRun(context.db, { runId: run.id, failureType: "TEST", failureMessage: "expected missing amount" });
  });

  it("commits evidence atomically with a complete run and never authorizes incomplete captures", async () => {
    const shopId = await createShop();
    const rollbackAt = new Date("2026-08-24T00:00:00.000Z");
    const rollbackRun = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await expect(context.db.transaction(async (transaction) => {
      await finalizeFinanceSyncRun(transaction, {
        runId: rollbackRun.id,
        shopId,
        checkpoint: null,
        rowsRead: 2,
        rowsWritten: 1,
        sourceComplete: true,
        sourceReconciled: true,
        snapshot: financialSnapshot(shopId, rollbackAt, "rollback", "50.0000"),
        settlements: [settlement(shopId, "ROLLBACK", "50.0000")],
      });
      throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    await expect(context.db.select().from(financeCaptures).where(eq(financeCaptures.shopId, shopId)))
      .resolves.toHaveLength(0);
    await expect(context.db.select({ status: syncRuns.status }).from(syncRuns).where(eq(syncRuns.id, rollbackRun.id)))
      .resolves.toEqual([{ status: "RUNNING" }]);
    await failSyncRun(context.db, { runId: rollbackRun.id, failureType: "TEST", failureMessage: "expected rollback" });

    for (const [suffix, sourceComplete, sourceReconciled] of [
      ["incomplete", false, true],
      ["unreconciled", true, false],
    ] as const) {
      const capturedAt = new Date(suffix === "incomplete" ? "2026-08-25T00:00:00.000Z" : "2026-08-26T00:00:00.000Z");
      const result = await recordCapture(shopId, capturedAt, suffix, "25.0000", [
        settlement(shopId, suffix, "25.0000"),
      ], { sourceComplete, sourceReconciled });
      expect(result.captureInserted).toBe(false);
      await expect(getFinanceSummary(context.db, shopId, capturedAt)).resolves.toMatchObject({
        proofStatus: "PROOF_UNAVAILABLE",
      });
    }
    await expect(context.db.select().from(financeCaptures).where(eq(financeCaptures.shopId, shopId)))
      .resolves.toHaveLength(0);
    await expect(context.db.select().from(financialSnapshots).where(eq(financialSnapshots.shopId, shopId)))
      .resolves.toHaveLength(2);
  });

  it("enforces append-only evidence and scoped shop/capture integrity", async () => {
    const shopId = await createShop();
    const otherShopId = await createShop();
    const capturedAt = new Date("2026-08-27T00:00:00.000Z");
    await recordCapture(shopId, capturedAt, "immutable", "40.0000", [
      settlement(shopId, "IMMUTABLE", "40.0000"),
    ]);
    const [capture] = await context.db.select().from(financeCaptures)
      .where(and(eq(financeCaptures.shopId, shopId), eq(financeCaptures.capturedAt, capturedAt)));

    await expect(context.db.update(financeCaptureItems).set({ expectedSettlementAmount: "41.0000" })
      .where(eq(financeCaptureItems.captureId, capture!.id))).rejects.toThrow();
    await expect(context.db.delete(financeCaptureItems)
      .where(eq(financeCaptureItems.captureId, capture!.id))).rejects.toThrow();
    await expect(context.db.update(financeCaptures).set({ populationHash: "changed" })
      .where(eq(financeCaptures.id, capture!.id))).rejects.toThrow();
    await expect(context.db.delete(financeCaptures)
      .where(eq(financeCaptures.id, capture!.id))).rejects.toThrow();
    await expect(context.db.insert(financeCaptureItems).values({
      captureId: capture!.id,
      shopId: otherShopId,
      sourceStatementDetailId: "CROSS-SHOP",
      expectedSettlementAmount: "1.0000",
      settledAmount: null,
      currency: "USD",
      sourceSettlementStatus: "ON_HOLD",
      settlementState: "ON_HOLD",
      onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
      sourceHash: hash("cross-shop"),
      sourceSchemaVersion: "integration.v1",
    })).rejects.toThrow();

    const otherRun = await beginSyncRun(context.db, { shopId: otherShopId, mode: "FINANCE" });
    await expect(context.db.insert(financeCaptures).values({
      shopId: shopId,
      syncRunId: otherRun.id,
      capturedAt: new Date("2026-08-27T00:00:01.000Z"),
      snapshotId: capture!.snapshotId,
      snapshotHash: capture!.snapshotHash,
      populationHash: capture!.populationHash,
      currency: capture!.currency,
      officialOnHoldAmount: capture!.officialOnHoldAmount,
      itemCount: capture!.itemCount,
      sourceSchemaVersion: capture!.sourceSchemaVersion,
    })).rejects.toThrow();
    await failSyncRun(context.db, { runId: otherRun.id, failureType: "TEST", failureMessage: "expected cross-shop capture rejection" });
  });

  it("rejects missing statement identity at the authoritative evidence boundary", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T00:00:00.000Z");
    const run = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });

    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: run.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: financialSnapshot(shopId, capturedAt, "missing-statement", "10.0000"),
      settlements: [settlement(shopId, "MISSING-STATEMENT", "10.0000", { rawData: {} })],
    }))).rejects.toThrow(/statement identity/i);
    await failSyncRun(context.db, { runId: run.id, failureType: "TEST", failureMessage: "expected missing identity" });
  });

  it("persists explicit statement identity and rejects a changed statement version replay", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T01:00:00.000Z");
    await recordCapture(shopId, capturedAt, "statement-version", "10.0000", [
      settlement(shopId, "STATEMENT", "10.0000", { rawData: statementRawData("statement-1", "1") }),
    ]);
    const [capture] = await context.db.select({ id: financeCaptures.id }).from(financeCaptures)
      .where(and(eq(financeCaptures.shopId, shopId), eq(financeCaptures.capturedAt, capturedAt)));

    await expect(context.db.select({
      statementId: financeCaptureItems.sourceStatementId,
      statementVersion: financeCaptureItems.sourceStatementVersion,
    }).from(financeCaptureItems).where(eq(financeCaptureItems.captureId, capture!.id))).resolves.toEqual([{
      statementId: "statement-1",
      statementVersion: "1",
    }]);

    const replayRun = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: replayRun.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: financialSnapshot(shopId, capturedAt, "statement-version", "10.0000"),
      settlements: [settlement(shopId, "STATEMENT", "10.0000", {
        rawData: statementRawData("statement-1", "2"),
      })],
    }))).rejects.toThrow();
    await failSyncRun(context.db, { runId: replayRun.id, failureType: "TEST", failureMessage: "expected version mismatch" });
  });

  it("compares every official snapshot field during same-identity replay", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T02:00:00.000Z");
    await recordCapture(shopId, capturedAt, "exact-snapshot", "10.0000", [
      settlement(shopId, "EXACT", "10.0000"),
    ]);
    const changedSnapshot = {
      ...financialSnapshot(shopId, capturedAt, "exact-snapshot", "10.0000"),
      availableBalance: "1.0000",
    };
    const replayRun = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });

    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: replayRun.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: changedSnapshot,
      settlements: [settlement(shopId, "EXACT", "10.0000")],
    }))).rejects.toThrow(/snapshot identity/i);
    await failSyncRun(context.db, { runId: replayRun.id, failureType: "TEST", failureMessage: "expected snapshot mismatch" });
  });

  it("rejects snapshot and evidence mutation and protects successful Finance run provenance", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T03:00:00.000Z");
    await recordCapture(shopId, capturedAt, "immutable-all", "30.0000", [
      settlement(shopId, "TAMPER", "30.0000"),
    ]);
    const [capture] = await context.db.select().from(financeCaptures)
      .where(and(eq(financeCaptures.shopId, shopId), eq(financeCaptures.capturedAt, capturedAt)));

    await expect(context.db.update(financialSnapshots).set({ availableBalance: "1.0000" })
      .where(eq(financialSnapshots.id, capture!.snapshotId))).rejects.toThrow();
    await expect(context.db.delete(financialSnapshots)
      .where(eq(financialSnapshots.id, capture!.snapshotId))).rejects.toThrow();
    await expect(context.db.update(syncRuns).set({ mode: "ORDERS" })
      .where(eq(syncRuns.id, capture!.syncRunId))).rejects.toThrow();
    await expect(context.db.update(syncRuns).set({ sourceComplete: false })
      .where(eq(syncRuns.id, capture!.syncRunId))).rejects.toThrow();
    await expect(context.db.insert(financeCaptureItems).values({
      captureId: capture!.id,
      shopId,
      sourceStatementDetailId: "LATE-ITEM",
      sourceStatementId: "late-statement",
      sourceStatementVersion: "1",
      expectedSettlementAmount: "0.0000",
      settledAmount: null,
      currency: "USD",
      sourceSettlementStatus: "ON_HOLD",
      settlementState: "ON_HOLD",
      onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
      sourceHash: hash("late-item"),
      sourceSchemaVersion: "integration.v1",
    })).rejects.toThrow();
    await expect(getFinanceSummary(context.db, shopId, capturedAt)).resolves.toMatchObject({ proofStatus: "PROVEN" });
  });

  it("rejects raw SQL evidence for wrong-mode or structurally invalid runs", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T04:00:00.000Z");
    const snapshot = await insertFinancialSnapshot(context.db, financialSnapshot(
      shopId,
      capturedAt,
      "raw-invalid",
      "10.0000",
    ));
    const wrongMode = await beginSyncRun(context.db, { shopId, mode: "ORDERS" });

    await expect(context.db.insert(financeCaptures).values({
      shopId,
      syncRunId: wrongMode.id,
      capturedAt,
      snapshotId: snapshot.row!.id,
      snapshotHash: "raw-invalid",
      populationHash: "a".repeat(64),
      currency: "USD",
      officialOnHoldAmount: "10.0000",
      itemCount: 0,
      sourceSchemaVersion: "integration.v1",
    })).rejects.toThrow();
    await failSyncRun(context.db, { runId: wrongMode.id, failureType: "TEST", failureMessage: "expected wrong mode" });

    const financeRun = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await expect(context.db.insert(financeCaptures).values({
      shopId,
      syncRunId: financeRun.id,
      capturedAt,
      snapshotId: snapshot.row!.id,
      snapshotHash: "not-a-sha256",
      populationHash: "also-invalid",
      currency: "usd",
      officialOnHoldAmount: "-1.0000",
      itemCount: -1,
      sourceSchemaVersion: " ",
    })).rejects.toThrow();
    await failSyncRun(context.db, { runId: financeRun.id, failureType: "TEST", failureMessage: "expected invalid capture" });
  });

  it("prevents coordinated raw inserts from completing structurally invalid evidence", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T04:30:00.000Z");
    const snapshot = await insertFinancialSnapshot(context.db, financialSnapshot(
      shopId,
      capturedAt,
      "coordinated-invalid",
      "10.0000",
    ));
    const run = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await context.db.insert(financeCaptures).values({
      shopId,
      syncRunId: run.id,
      capturedAt,
      snapshotId: snapshot.row!.id,
      snapshotHash: snapshot.row!.snapshotHash,
      populationHash: "d".repeat(64),
      currency: "USD",
      officialOnHoldAmount: "10.0000",
      itemCount: 0,
      sourceSchemaVersion: "integration.v1",
    });

    await expect(context.db.update(syncRuns).set({
      status: "SUCCEEDED",
      sourceComplete: true,
      sourceCapturedAt: capturedAt,
      finishedAt: new Date(),
    }).where(eq(syncRuns.id, run.id))).rejects.toThrow();
    await expect(getFinanceSummary(context.db, shopId, capturedAt)).resolves.toMatchObject({
      proofStatus: "PROOF_UNAVAILABLE",
    });
    await failSyncRun(context.db, { runId: run.id, failureType: "TEST", failureMessage: "expected structural mismatch" });
  });

  it("rejects raw evidence items without explicit statement identity", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T04:45:00.000Z");
    const snapshot = await insertFinancialSnapshot(context.db, financialSnapshot(
      shopId,
      capturedAt,
      "raw-missing-statement",
      "0.0000",
    ));
    const run = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    const [capture] = await context.db.insert(financeCaptures).values({
      shopId,
      syncRunId: run.id,
      capturedAt,
      snapshotId: snapshot.row!.id,
      snapshotHash: snapshot.row!.snapshotHash,
      populationHash: "e".repeat(64),
      currency: "USD",
      officialOnHoldAmount: "0.0000",
      itemCount: 1,
      sourceSchemaVersion: "integration.v1",
    }).returning({ id: financeCaptures.id });

    await expect(context.db.insert(financeCaptureItems).values({
      captureId: capture!.id,
      shopId,
      sourceStatementDetailId: "RAW-MISSING",
      sourceStatementId: null,
      sourceStatementVersion: null,
      expectedSettlementAmount: "0.0000",
      settledAmount: null,
      currency: "USD",
      sourceSettlementStatus: "ON_HOLD",
      settlementState: "ON_HOLD",
      onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
      sourceHash: hash("raw-missing"),
      sourceSchemaVersion: "integration.v1",
    })).rejects.toThrow();
    await failSyncRun(context.db, { runId: run.id, failureType: "TEST", failureMessage: "expected missing statement identity" });
  });

  it("rejects non-finite timestamps, negative money, malformed hashes, and over-scale values", async () => {
    const shopId = await createShop();
    const valid = financialSnapshot(shopId, new Date("2026-08-28T05:00:00.000Z"), "a".repeat(64), "1.0000");

    await expect(insertFinancialSnapshot(context.db, { ...valid, capturedAt: new Date(Number.NaN) }))
      .rejects.toThrow(/capturedAt/i);
    await expect(insertFinancialSnapshot(context.db, { ...valid, availableBalance: "-1.0000" }))
      .rejects.toThrow(/nonnegative/i);
    await expect(insertFinancialSnapshot(context.db, { ...valid, officialOnHoldAmount: "-1.0000" }))
      .rejects.toThrow(/nonnegative/i);
    await expect(insertFinancialSnapshot(context.db, { ...valid, availableBalance: "1.00001" }))
      .rejects.toThrow(/decimal/i);
    await expect(insertFinancialSnapshot(context.db, { ...valid, snapshotHash: "bad-hash" }))
      .rejects.toThrow(/hash/i);

    const run = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: run.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: valid,
      settlements: [settlement(shopId, "OVER-SCALE", "1.00001")],
    }))).rejects.toThrow(/decimal/i);
    await failSyncRun(context.db, { runId: run.id, failureType: "TEST", failureMessage: "expected over-scale" });

    const negativeRun = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    await expect(context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: negativeRun.id,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: { ...valid, capturedAt: new Date("2026-08-28T05:01:00.000Z") },
      settlements: [settlement(shopId, "NEGATIVE", "1.0000", { settledAmount: "-0.0001" })],
    }))).rejects.toThrow(/settled amount must be nonnegative/i);
    await failSyncRun(context.db, { runId: negativeRun.id, failureType: "TEST", failureMessage: "expected negative settled amount" });
  });

  it("uses a deterministic equal-time snapshot tie-break without substituting capture evidence", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T06:00:00.000Z");
    await recordCapture(shopId, capturedAt, "0".repeat(64), "10.0000", [
      settlement(shopId, "TIE", "10.0000"),
    ]);
    const legacy = await insertFinancialSnapshot(context.db, {
      ...financialSnapshot(shopId, capturedAt, "f".repeat(64), "999.0000"),
      createdAt: new Date("2026-08-28T06:00:01.000Z"),
    } as FinancialSnapshotInput);

    await expect(getLatestFinancialSnapshot(context.db, shopId)).resolves.toMatchObject({ id: legacy.row!.id });
    await expect(getFinanceSummary(context.db, shopId, capturedAt)).resolves.toMatchObject({
      proofStatus: "PROVEN",
      latestSnapshot: { snapshotHash: "0".repeat(64), officialOnHoldAmount: "10.0000" },
    });
  });

  it("allows only one concurrent finalizer to create authoritative capture evidence", async () => {
    const shopId = await createShop();
    const capturedAt = new Date("2026-08-28T07:00:00.000Z");
    const runs = await Promise.all([
      beginSyncRun(context.db, { shopId, mode: "FINANCE" }),
      beginSyncRun(context.db, { shopId, mode: "FINANCE" }),
    ]);
    const input = (runId: string): Parameters<typeof finalizeFinanceSyncRun>[1] => ({
      runId,
      shopId,
      checkpoint: null,
      rowsRead: 2,
      rowsWritten: 1,
      sourceComplete: true,
      sourceReconciled: true,
      snapshot: financialSnapshot(shopId, capturedAt, "c".repeat(64), "10.0000"),
      settlements: [settlement(shopId, "CONCURRENT", "10.0000")],
    });

    const results = await Promise.allSettled(runs.map((run) =>
      context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, input(run.id)))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(context.db.select().from(financeCaptures)
      .where(and(eq(financeCaptures.shopId, shopId), eq(financeCaptures.capturedAt, capturedAt))))
      .resolves.toHaveLength(1);
  });

  async function createShop(): Promise<string> {
    const [shop] = await context.db.insert(shops).values({
      profileId: `FINANCE-${randomUUID()}`,
      profileNo: `FINANCE-${randomUUID()}`,
      displayName: "Finance immutable-capture integration",
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning({ id: shops.id });
    return shop!.id;
  }

  async function recordCapture(
    shopId: string,
    capturedAt: Date,
    snapshotHash: string,
    officialOnHoldAmount: string,
    settlements: readonly SettlementUpsertInput[],
    options: { readonly sourceComplete?: boolean; readonly sourceReconciled?: boolean } = {},
  ) {
    const write = await upsertSettlementBatch(context.db, settlements, capturedAt);
    const run = await beginSyncRun(context.db, { shopId, mode: "FINANCE" });
    return context.db.transaction((transaction) => finalizeFinanceSyncRun(transaction, {
      runId: run.id,
      shopId,
      checkpoint: null,
      rowsRead: write.rowsRead + 1,
      rowsWritten: write.rowsWritten,
      sourceComplete: options.sourceComplete ?? true,
      sourceReconciled: options.sourceReconciled ?? true,
      snapshot: financialSnapshot(shopId, capturedAt, snapshotHash, officialOnHoldAmount),
      settlements,
    }));
  }
});

function settlement(
  shopId: string,
  id: string,
  amount: string,
  overrides: Partial<SettlementUpsertInput> = {},
): SettlementUpsertInput {
  return {
    shopId,
    sourceStatementDetailId: id,
    tradeOrderId: null,
    placedAt: null,
    deliveredAt: null,
    estimatedSettlementAt: null,
    earningAmount: amount,
    feeAmount: null,
    shippingAmount: null,
    expectedSettlementAmount: amount,
    eligibleSettlementAmount: null,
    settledAmount: null,
    currency: "USD",
    sourceSettlementStatus: "ON_HOLD",
    settlementState: "ON_HOLD",
    onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
    sourceHash: hash(`${id}-hash`),
    sourceSchemaVersion: "integration.v1",
    rawData: statementRawData(`statement-${id}`, "1"),
    ...overrides,
  };
}

function financialSnapshot(
  shopId: string,
  capturedAt: Date,
  snapshotHash: string,
  officialOnHoldAmount: string,
): FinancialSnapshotInput {
  return {
    shopId,
    capturedAt,
    currency: "USD",
    availableBalance: "0.0000",
    frozenBalance: "0.0000",
    totalBalance: "0.0000",
    toSettleBalance: officialOnHoldAmount,
    onHoldBalance: officialOnHoldAmount,
    officialOnHoldAmount,
    settlementPeriodDays: null,
    settlementPeriodType: null,
    reserveRatio: null,
    reserveDays: null,
    reserveLevel: null,
    snapshotHash: /^[0-9a-f]{64}$/.test(snapshotHash) ? snapshotHash : hash(snapshotHash),
    sourceSchemaVersion: "integration.v1",
    rawData: {},
  };
}

function statementRawData(id: string, version: string): Record<string, unknown> {
  return { statement: { id, version } };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
