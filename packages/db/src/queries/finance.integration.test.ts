import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { financialSnapshots, settlementRecords, shops } from "../schema.js";
import { getFinanceSummary, insertFinancialSnapshot, upsertSettlementBatch, type FinancialSnapshotInput, type SettlementUpsertInput } from "./finance.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("finance current-population PostgreSQL integration", () => {
  let context: DatabaseContext;
  let shopId: string;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const [shop] = await context.db.insert(shops).values({
      profileId: `FINANCE-${randomUUID()}`,
      profileNo: `FINANCE-${randomUUID()}`,
      displayName: "Finance current-population integration",
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning({ id: shops.id });
    shopId = shop!.id;
  });

  afterAll(async () => {
    if (!context) return;
    if (shopId) {
      await context.db.delete(settlementRecords).where(eq(settlementRecords.shopId, shopId));
      await context.db.delete(financialSnapshots).where(eq(financialSnapshots.shopId, shopId));
      await context.db.delete(shops).where(eq(shops.id, shopId));
    }
    await closeDatabase(context);
  });

  it("uses only rows seen in the latest complete capture while retaining omitted historical rows", async () => {
    const captureA = new Date("2026-08-14T00:00:00.000Z");
    const captureB = new Date("2026-08-15T00:00:00.000Z");

    await upsertSettlementBatch(context.db, [
      settlement(shopId, "STALE", "100.0000"),
      settlement(shopId, "CURRENT", "250.0000"),
    ], captureA);
    await upsertSettlementBatch(
      context.db,
      [settlement(shopId, "CURRENT", "250.0000")],
      captureB,
    );
    await insertFinancialSnapshot(context.db, financialSnapshot(shopId, captureA, "snapshot-a"));
    await expect(insertFinancialSnapshot(context.db, financialSnapshot(shopId, captureB, "snapshot-a")))
      .resolves.toMatchObject({ inserted: false });

    await expect(getFinanceSummary(context.db, shopId, captureB)).resolves.toMatchObject({
      statementCount: 1,
      onHoldCount: 1,
      onHoldExpectedAmount: "250.0000",
      waitingForPackageDeliveryAmount: "250.0000",
    });
    await expect(getFinanceSummary(context.db, shopId, captureA)).resolves.toMatchObject({
      latestSnapshot: { snapshotHash: "snapshot-a" },
    });
    await expect(getFinanceSummary(context.db, shopId, captureB)).resolves.toMatchObject({
      latestSnapshot: { snapshotHash: "snapshot-a", capturedAt: captureA },
    });
    await expect(context.db.select({ id: settlementRecords.id }).from(settlementRecords)
      .where(eq(settlementRecords.shopId, shopId))).resolves.toHaveLength(2);
    await expect(getFinanceSummary(context.db, shopId, null)).resolves.toMatchObject({
      statementCount: 0,
      onHoldCount: 0,
      onHoldExpectedAmount: null,
    });
  });

  it("reconciles a proven empty current population as typed zero without reusing historical rows", async () => {
    const emptyCapture = new Date("2026-08-16T00:00:00.000Z");
    await insertFinancialSnapshot(
      context.db,
      financialSnapshot(shopId, emptyCapture, "snapshot-empty"),
    );

    await expect(getFinanceSummary(context.db, shopId, emptyCapture)).resolves.toMatchObject({
      latestSnapshot: {
        snapshotHash: "snapshot-empty",
        officialOnHoldAmount: "0.0000",
      },
      statementCount: 0,
      onHoldCount: 0,
      waitingForPackageDeliveryAmount: "0.0000",
      deliveredAwaitingSettlementAmount: "0.0000",
      waitingForCompletedRefundReturnAmount: "0.0000",
      unknownOnHoldReasonCount: 0,
      missingOnHoldExpectedAmountCount: 0,
    });
  });

  it("stores signed expected settlement amounts without weakening other money checks", async () => {
    const capturedAt = new Date("2026-08-17T00:00:00.000Z");
    await upsertSettlementBatch(
      context.db,
      [settlement(shopId, "SIGNED", "-0.4100", "0.0000")],
      capturedAt,
    );

    await expect(context.db
      .select({ expectedSettlementAmount: settlementRecords.expectedSettlementAmount })
      .from(settlementRecords)
      .where(eq(settlementRecords.sourceStatementDetailId, "SIGNED")))
      .resolves.toEqual([{ expectedSettlementAmount: "-0.4100" }]);
  });

  // W0-T02 diagnostic: current mutable rows cannot prove capture A after capture B overwrites the same ID.
  it.fails("preserves a prior capture's amount and state when its statement ID is overwritten later", async () => {
    const captureA = new Date("2026-08-18T00:00:00.000Z");
    const captureB = new Date("2026-08-19T00:00:00.000Z");
    await upsertSettlementBatch(context.db, [settlement(shopId, "MUTABLE", "524.2800")], captureA);
    await insertFinancialSnapshot(context.db, {
      ...financialSnapshot(shopId, captureA, "snapshot-mutable-a"),
      officialOnHoldAmount: "524.2800",
    });
    await upsertSettlementBatch(context.db, [{
      ...settlement(shopId, "MUTABLE", "523.8700"),
      settlementState: "ELIGIBLE",
      sourceSettlementStatus: "ELIGIBLE",
      onHoldReason: null,
      sourceHash: "MUTABLE-hash-b",
    }], captureB);
    await insertFinancialSnapshot(context.db, {
      ...financialSnapshot(shopId, captureB, "snapshot-mutable-b"),
      officialOnHoldAmount: "523.8700",
    });

    await expect(getFinanceSummary(context.db, shopId, captureA)).resolves.toMatchObject({
      latestSnapshot: { officialOnHoldAmount: "524.2800" },
      onHoldCount: 1,
      onHoldExpectedAmount: "524.2800",
    });
  });
});

function settlement(shopId: string, id: string, amount: string, earningAmount = amount): SettlementUpsertInput {
  return {
    shopId,
    sourceStatementDetailId: id,
    tradeOrderId: null,
    placedAt: null,
    deliveredAt: null,
    estimatedSettlementAt: null,
    earningAmount,
    feeAmount: null,
    shippingAmount: null,
    expectedSettlementAmount: amount,
    eligibleSettlementAmount: null,
    settledAmount: null,
    currency: "USD",
    sourceSettlementStatus: "ON_HOLD",
    settlementState: "ON_HOLD",
    onHoldReason: "WAITING_FOR_PACKAGE_DELIVERY",
    sourceHash: `${id}-hash`,
    sourceSchemaVersion: "integration.v1",
    rawData: {},
  };
}

function financialSnapshot(shopId: string, capturedAt: Date, snapshotHash: string): FinancialSnapshotInput {
  return {
    shopId,
    capturedAt,
    currency: "USD",
    availableBalance: "0.0000",
    frozenBalance: "0.0000",
    totalBalance: "0.0000",
    toSettleBalance: "0.0000",
    onHoldBalance: "0.0000",
    officialOnHoldAmount: "0.0000",
    settlementPeriodDays: null,
    settlementPeriodType: null,
    reserveRatio: null,
    reserveDays: null,
    reserveLevel: null,
    snapshotHash,
    sourceSchemaVersion: "integration.v1",
    rawData: {},
  };
}
