import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { shopProviderBindings, shops, type ShopRow } from "../schema.js";
import { upsertShopProviderBinding } from "./provider-bindings.js";
import {
  shopProviderBindingCheckpointSchema,
  updateShopProviderBindingCheckpoint,
} from "./provider-bindings.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("shop provider binding checkpoint PostgreSQL persistence", () => {
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
      checkpoint: { orderIdCursor: "prior" },
    });
  }

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
  });

  afterAll(async () => {
    if (!context) return;
    for (const shopId of createdShopIds) {
      await context.sql`delete from shop_provider_bindings where shop_id = ${shopId}`;
      await context.sql`delete from shops where id = ${shopId}`;
    }
    await closeDatabase(context);
  });

  it("updates only the enabled binding checkpoint and returns the fresh row", async () => {
    const shop = await createTestShop();
    await createCotikBinding(shop.id);
    const [before] = await context.db
      .select()
      .from(shopProviderBindings)
      .where(eq(shopProviderBindings.shopId, shop.id));
    const checkpoint = { schemaVersion: "cotik-orders-checkpoint.v1", lastUpdatedAtMs: 123 };

    const updated = await updateShopProviderBindingCheckpoint(
      context.db,
      shop.id,
      "COTIK",
      checkpoint,
    );

    expect(updated).not.toBeNull();
    expect(updated!.checkpoint).toEqual(checkpoint);
    expect(updated!.id).toBe(before!.id);
    // Binding identity/provenance columns are never rewritten by a checkpoint update.
    expect(updated!.providerShopId).toBe(before!.providerShopId);
    expect(updated!.provenance).toEqual(before!.provenance);
    expect(updated!.enabled).toBe(true);

    const [reread] = await context.db
      .select()
      .from(shopProviderBindings)
      .where(eq(shopProviderBindings.shopId, shop.id));
    expect(reread!.checkpoint).toEqual(checkpoint);
    expect(reread!.updatedAt >= before!.updatedAt).toBe(true);

    const [canonicalShop] = await context.db.select().from(shops).where(eq(shops.id, shop.id));
    expect(canonicalShop!.profileId).toBe(shop.profileId);
    expect(canonicalShop!.tiktokShopId).toBe(shop.tiktokShopId);
  });

  it("advances collectedAt to the collection instant (default now, explicit honored)", async () => {
    const shop = await createTestShop();
    await createCotikBinding(shop.id);
    const explicit = new Date("2024-05-01T10:00:00.000Z");

    const updated = await updateShopProviderBindingCheckpoint(
      context.db,
      shop.id,
      "COTIK",
      { cursor: 2 },
      explicit,
    );
    expect(updated!.collectedAt.toISOString()).toBe(explicit.toISOString());

    const defaulted = await updateShopProviderBindingCheckpoint(
      context.db,
      shop.id,
      "COTIK",
      { cursor: 3 },
    );
    expect(defaulted!.collectedAt.valueOf()).toBeGreaterThan(explicit.valueOf());
  });

  it("returns null and preserves the prior checkpoint for disabled or missing bindings", async () => {
    const shop = await createTestShop();
    await createCotikBinding(shop.id);
    await upsertShopProviderBinding(context.db, {
      shopId: shop.id,
      provider: "COTIK",
      providerShopId: `cotik-${randomUUID()}`,
      enabled: false,
      provenance: { source: "COTIK", capabilities: ["ORDERS"] },
      checkpoint: { orderIdCursor: "prior" },
    });

    const checkpoint = { schemaVersion: "v", lastUpdatedAtMs: 5 };
    await expect(
      updateShopProviderBindingCheckpoint(context.db, shop.id, "COTIK", checkpoint),
    ).resolves.toBeNull();

    const [row] = await context.db
      .select()
      .from(shopProviderBindings)
      .where(eq(shopProviderBindings.shopId, shop.id));
    expect(row!.checkpoint).toEqual({ orderIdCursor: "prior" });

    await expect(
      updateShopProviderBindingCheckpoint(context.db, randomUUID(), "COTIK", checkpoint),
    ).resolves.toBeNull();
  });

  it("rejects credential-shaped checkpoints before any database write", async () => {
    const shop = await createTestShop();
    await createCotikBinding(shop.id);

    expect(() =>
      shopProviderBindingCheckpointSchema.parse({ accessToken: "secret" }),
    ).toThrow(/accessToken/);
    await expect(
      updateShopProviderBindingCheckpoint(
        context.db,
        shop.id,
        "COTIK",
        { accessToken: "secret" } as never,
      ),
    ).rejects.toThrow();

    const [row] = await context.db
      .select()
      .from(shopProviderBindings)
      .where(eq(shopProviderBindings.shopId, shop.id));
    expect(row!.checkpoint).toEqual({ orderIdCursor: "prior" });
  });
});
