import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  closeDatabase,
  createDatabase,
  disableShopProviderBinding,
  findEnabledShopProviderBinding,
  migrateDatabase,
  shops,
  upsertShopProviderBinding,
  type DatabaseContext,
  type ShopRow,
} from "@shop-health/db";
import { CotikClientError, type CotikClient } from "@shop-health/cotik";

import { runCotikOrdersSync } from "./cotik-orders.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("runCotikOrdersSync PostgreSQL persistence", () => {
  let context: DatabaseContext;
  const createdShopIds: string[] = [];

  async function createTestShop(): Promise<ShopRow> {
    const [shop] = await context.db
      .insert(shops)
      .values({
        profileId: `PROFILE-${randomUUID()}`,
        profileNo: `PROFILE-NO-${randomUUID()}`,
        tiktokShopId: `TIKTOK-${randomUUID()}`,
        region: "US",
        locale: "en-US",
      })
      .returning();
    createdShopIds.push(shop!.id);
    return shop!;
  }

  async function createCotikBinding(shopId: string): Promise<void> {
    await upsertShopProviderBinding(context.db, {
      shopId,
      provider: "COTIK",
      providerShopId: `cotik-${randomUUID()}`,
      provenance: { source: "COTIK", capabilities: ["ORDERS"] },
    });
  }

  async function countOrders(shopId: string): Promise<number> {
    const [row] = await context.sql`
      select count(*)::int as count from orders where shop_id = ${shopId}
    `;
    return row!.count;
  }

  async function orderFacts(shopId: string): Promise<Array<{ id: string; status: string }>> {
    return context.sql`
      select source_order_id as id, canonical_status as status
      from orders where shop_id = ${shopId} order by source_order_id
    `;
  }

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
  });

  afterAll(async () => {
    if (!context) return;
    for (const shopId of createdShopIds) {
      await context.sql`delete from orders where shop_id = ${shopId}`;
      await context.sql`delete from shop_provider_bindings where shop_id = ${shopId}`;
      await context.sql`delete from shops where id = ${shopId}`;
    }
    await closeDatabase(context);
  });

  it("persists all pages through upsertOrderBatch and checkpoints the binding only after completion", async () => {
    const shop = await createTestShop();
    await createCotikBinding(shop.id);
    const client = pageClient([
      { listorders: [rawCotikOrder("o1")], totalsize: 2 },
      { listorders: [rawCotikOrder("o2")], totalsize: 2 },
    ]);

    const result = await runCotikOrdersSync({ context, shop, client: client as unknown as CotikClient, pageSize: 1 });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.pagesFetched).toBe(2);
    expect(result.rowsRead).toBe(2);
    expect(result.rowsWritten).toBe(2);
    expect(await countOrders(shop.id)).toBe(2);

    // Binding checkpoint readback matches what the run reported.
    const binding = await findEnabledShopProviderBinding(context.db, shop.id, "COTIK");
    expect(binding!.checkpoint).toEqual(
      result.checkpoint === null ? null : { ...result.checkpoint },
    );
    expect(result.binding!.id).toBe(binding!.id);
    expect(result.binding!.checkpoint).toEqual(binding!.checkpoint);

    // Canonical order facts came through the real normalizer.
    const persisted = await orderFacts(shop.id);
    expect(persisted.map((row) => row.id)).toEqual(["o1", "o2"]);
    expect(persisted.every((row) => row.status === "DELIVERED")).toBe(true);
  });

  it("keeps the prior checkpoint and already-persisted pages replayable when a mid-pagination page fails", async () => {
    const shop = await createTestShop();
    await createCotikBinding(shop.id);
    const failingGet = vi.fn()
      .mockResolvedValueOnce({ listorders: [rawCotikOrder("r1")], totalsize: 2 })
      .mockRejectedValueOnce(new CotikClientError("TRANSIENT", "rate limited"));

    await expect(
      runCotikOrdersSync({ context, shop, client: { get: failingGet }, pageSize: 1 }),
    ).rejects.toMatchObject({ code: "TRANSIENT" });

    // Prior checkpoint unchanged (still null), page one safely persisted for replay.
    expect(await countOrders(shop.id)).toBe(1);
    let binding = await findEnabledShopProviderBinding(context.db, shop.id, "COTIK");
    expect(binding!.checkpoint).toBeNull();

    // Replay run with a healthy client converges without duplicating facts.
    const replayClient = pageClient([
      { listorders: [rawCotikOrder("r1")], totalsize: 2 },
      { listorders: [rawCotikOrder("r2")], totalsize: 2 },
    ]);
    const result = await runCotikOrdersSync({ context, shop, client: replayClient as unknown as CotikClient, pageSize: 1 });
    expect(result.status).toBe("SUCCEEDED");
    expect(await countOrders(shop.id)).toBe(2);
    binding = await findEnabledShopProviderBinding(context.db, shop.id, "COTIK");
    expect(binding!.checkpoint).not.toBeNull();
  });

  it("does not fetch COTIK when the binding is disabled or missing", async () => {
    const disabledShop = await createTestShop();
    await createCotikBinding(disabledShop.id);
    await disableShopProviderBinding(context.db, disabledShop.id, "COTIK");
    const missingShop = await createTestShop();
    const disabledClient = pageClient([{ listorders: [], totalsize: 0 }]);
    const missingClient = pageClient([{ listorders: [], totalsize: 0 }]);

    const disabledResult = await runCotikOrdersSync({
      context,
      shop: disabledShop,
      client: disabledClient as unknown as CotikClient,
    });
    const missingResult = await runCotikOrdersSync({
      context,
      shop: missingShop,
      client: missingClient as unknown as CotikClient,
    });

    expect(disabledResult).toMatchObject({ status: "SKIPPED", skipReason: "COTIK_BINDING_INACTIVE" });
    expect(missingResult).toMatchObject({ status: "SKIPPED", skipReason: "COTIK_BINDING_INACTIVE" });
    expect(disabledClient.get).not.toHaveBeenCalled();
    expect(missingClient.get).not.toHaveBeenCalled();
    expect(await countOrders(disabledShop.id)).toBe(0);
    expect(await countOrders(missingShop.id)).toBe(0);
  });
});

function pageClient(pages: Array<{ listorders: unknown[]; totalsize: number }>) {
  let page = 0;
  return {
    get: vi.fn(async (_path: string) => {
      const current = pages[page];
      page += 1;
      if (!current) throw new Error(`unexpected extra COTIK page fetch ${page}`);
      return current;
    }),
  };
}

function rawCotikOrder(id: string): Record<string, unknown> {
  return {
    apiOrderId: id,
    status: "DELIVERED",
    payment: { currency: "USD", total_amount: "10.00" },
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
  };
}
