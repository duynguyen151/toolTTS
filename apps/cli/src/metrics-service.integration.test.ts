import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase, listKpiSnapshots, listShops, migrateDatabase, shops, upsertOrderBatch, type DatabaseContext } from "@shop-health/db";

import { calculateAndStoreReport } from "./metrics-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("objective shop-health history cadence", () => {
  let context: DatabaseContext;
  let shopId: string;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const profileNo = `OBJECTIVE-${randomUUID()}`;
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo,
      profileNo,
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning();
    shopId = shop!.id;
    const paidAt = new Date("2026-08-14T05:00:00.000Z");
    await upsertOrderBatch(context.db, [{
      shopId,
      sourceOrderId: `order-${randomUUID()}`,
      createdAt: paidAt,
      paidAt,
      sourceUpdatedAt: paidAt,
      readyToShipAt: null,
      latestDeliveryAt: null,
      sourceStatus: "DELIVERED",
      sourceSubStatus: null,
      canonicalStatus: "DELIVERED",
      grandTotal: "10.0000",
      currency: "USD",
      trackingNumber: "not-in-history",
      carrier: null,
      refundAmount: null,
      refundStatus: null,
      deliveryEligible: true,
      firstSeenAt: paidAt,
      lastSeenAt: paidAt,
      sourceHash: "c".repeat(64),
      sourceSchemaVersion: "seller-center-us-orders.v2",
      rawData: { buyerName: "not-in-history" },
    }]);
  });

  afterAll(async () => {
    if (context) await closeDatabase(context);
  });

  it("writes one privacy-minimized history snapshot for reports with different rolling endpoints in one Bangkok day", async () => {
    const shop = (await listShops(context.db)).find((candidate) => candidate.id === shopId);
    const first = new Date("2026-08-14T01:00:00.000Z");
    const second = new Date("2026-08-14T10:00:00.000Z");
    const report = (end: Date) => ({
      label: "Last 30 days vs previous 30 days",
      currentStart: new Date(end.getTime() - 30 * 86_400_000),
      currentEnd: end,
      previousStart: new Date(end.getTime() - 60 * 86_400_000),
      previousEnd: new Date(end.getTime() - 30 * 86_400_000),
    });

    await calculateAndStoreReport(context.db, shop!, report(first), first);
    await calculateAndStoreReport(context.db, shop!, report(second), second);

    const snapshots = await listKpiSnapshots(context.db, shopId);
    expect(snapshots).toHaveLength(1);
    const serialized = JSON.stringify(snapshots[0]!.metrics.objectiveHistory);
    expect(serialized).not.toMatch(/buyerName|trackingNumber|not-in-history/i);
  });
});
