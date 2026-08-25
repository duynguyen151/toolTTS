import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { shops } from "../schema.js";
import { upsertOrderBatch } from "./orders.js";
import { listOrderExplorerItems, summarizeOrderExplorerRecords } from "./order-explorer.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("order explorer PostgreSQL queries", () => {
  let context: DatabaseContext;
  let shopId: string;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const profileNo = `TEST-${randomUUID()}`;
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo, profileNo, displayName: "Order Explorer Test Shop", region: "US", locale: "en-US", currency: "USD",
    }).returning({ id: shops.id });
    shopId = shop!.id;
    const observedAt = new Date("2026-08-14T00:00:00.000Z");
    await upsertOrderBatch(context.db, [
      orderInput(shopId, "match-known", "DELIVERED", observedAt),
      orderInput(shopId, "match-unknown", "UNKNOWN", observedAt),
      orderInput(shopId, "outside", "CANCELED", new Date("2026-08-10T00:00:00.000Z")),
    ]);
  });

  afterAll(async () => {
    if (!context) return;
    await context.sql`delete from orders where shop_id = ${shopId}`;
    await context.sql`delete from shops where id = ${shopId}`;
    await closeDatabase(context);
  });

  it("uses the same filtered population for the minimized list and status distribution", async () => {
    const filter = { shopId, start: new Date("2026-08-13T17:00:00.000Z"), end: new Date("2026-08-14T17:00:00.000Z"), search: "match" };
    const [items, summary] = await Promise.all([
      listOrderExplorerItems(context.db, filter),
      summarizeOrderExplorerRecords(context.db, filter),
    ]);

    expect(items.map((item) => item.sourceOrderId)).toEqual(["match-known", "match-unknown"]);
    expect(items.every((item) => !("trackingNumber" in item))).toBe(true);
    expect(summary.total).toBe(items.length);
    expect(summary.statusDistribution).toEqual([
      { canonicalStatus: "DELIVERED", count: 1 },
      { canonicalStatus: "UNKNOWN", count: 1 },
    ]);
  });
});

function orderInput(shopId: string, sourceOrderId: string, canonicalStatus: "DELIVERED" | "UNKNOWN" | "CANCELED", paidAt: Date) {
  return {
    shopId, sourceOrderId, createdAt: paidAt, paidAt, sourceUpdatedAt: paidAt, readyToShipAt: null, latestDeliveryAt: null,
    sourceStatus: canonicalStatus, sourceSubStatus: null, canonicalStatus, grandTotal: "10.00", currency: "USD",
    trackingNumber: `${sourceOrderId}-tracking`, carrier: null, refundAmount: null, refundStatus: null, deliveryEligible: true,
    firstSeenAt: paidAt, lastSeenAt: paidAt, sourceHash: `${sourceOrderId}-hash`, sourceSchemaVersion: "test.v1", rawData: {},
  };
}
