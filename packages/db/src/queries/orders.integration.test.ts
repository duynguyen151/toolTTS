import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { shops } from "../schema.js";
import { listOrders, upsertOrderBatch } from "./orders.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("order PostgreSQL persistence", () => {
  let context: DatabaseContext;
  let shopId: string;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const profileNo = `TEST-${randomUUID()}`;
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo,
      profileNo,
      displayName: "Ready-to-Ship Test Shop",
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning({ id: shops.id });
    shopId = shop!.id;
  });

  afterAll(async () => {
    if (!context) return;
    await context.sql`delete from orders where shop_id = ${shopId}`;
    await context.sql`delete from shops where id = ${shopId}`;
    await closeDatabase(context);
  });

  it("persists Ready-to-Ship without fabricating a delivery timestamp", async () => {
    const observedAt = new Date("2026-08-14T00:00:00.000Z");
    const readyToShipAt = new Date("2026-08-14T01:00:00.000Z");
    await upsertOrderBatch(context.db, [{
      shopId,
      sourceOrderId: "order-1",
      createdAt: observedAt,
      paidAt: observedAt,
      sourceUpdatedAt: observedAt,
      readyToShipAt,
      latestDeliveryAt: null,
      sourceStatus: "Awaiting shipment",
      sourceSubStatus: null,
      canonicalStatus: "AWAITING_SHIPMENT",
      grandTotal: "10.00",
      currency: "USD",
      trackingNumber: null,
      carrier: null,
      refundAmount: null,
      refundStatus: null,
      deliveryEligible: true,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      sourceHash: "order-hash-1",
      sourceSchemaVersion: "seller-center-orders.v1",
      rawData: {},
    }]);

    await expect(listOrders(context.db, { shopId })).resolves.toEqual([
      expect.objectContaining({
        readyToShipAt,
        latestDeliveryAt: null,
      }),
    ]);
  });
});
