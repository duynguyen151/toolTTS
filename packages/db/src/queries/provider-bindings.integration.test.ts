import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { shopProviderBindings, shops, type ShopRow } from "../schema.js";
import {
  findEnabledShopProviderBinding,
  listEnabledShopProviderBindings,
  upsertShopProviderBinding,
} from "./provider-bindings.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("shop provider binding PostgreSQL persistence", () => {
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

  it("upserts one enabled binding per (shop, provider), resolves it, and disables it in place", async () => {
    const shop = await createTestShop();

    const created = await upsertShopProviderBinding(context.db, {
      shopId: shop.id,
      provider: "COTIK",
      providerShopId: `cotik-${randomUUID()}`,
      provenance: { source: "COTIK", capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"] },
      checkpoint: { orderIdCursor: null },
    });
    expect(created.enabled).toBe(true);

    const updated = await upsertShopProviderBinding(context.db, {
      shopId: shop.id,
      provider: "COTIK",
      providerShopId: created.providerShopId!,
      provenance: { source: "COTIK", capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"] },
      checkpoint: { orderIdCursor: "cursor-2" },
    });
    expect(updated.id).toBe(created.id);
    expect(updated.checkpoint).toEqual({ orderIdCursor: "cursor-2" });

    await expect(
      findEnabledShopProviderBinding(context.db, shop.id, "COTIK"),
    ).resolves.toMatchObject({ id: created.id, enabled: true });
    await expect(listEnabledShopProviderBindings(context.db, shop.id)).resolves.toHaveLength(1);

    await upsertShopProviderBinding(context.db, {
      shopId: shop.id,
      provider: "COTIK",
      providerShopId: created.providerShopId!,
      enabled: false,
      provenance: { source: "COTIK", capabilities: ["ORDERS"] },
    });
    await expect(findEnabledShopProviderBinding(context.db, shop.id, "COTIK")).resolves.toBeNull();
    await expect(listEnabledShopProviderBindings(context.db, shop.id)).resolves.toHaveLength(0);
  });

  it("keeps one canonical shop supporting both SELLER_CENTER and COTIK bindings", async () => {
    const shop = await createTestShop();
    const tiktokShopId = `TIKTOK-${randomUUID()}`;

    await upsertShopProviderBinding(context.db, {
      shopId: shop.id,
      provider: "SELLER_CENTER",
      // Seller Center external identity mirrors the proven TikTok identity without replacing it.
      providerShopId: tiktokShopId,
      provenance: {
        source: "SELLER_CENTER",
        capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE", "OFFICIAL_ON_HOLD"],
      },
    });
    await upsertShopProviderBinding(context.db, {
      shopId: shop.id,
      provider: "COTIK",
      providerShopId: `cotik-${randomUUID()}`,
      provenance: { source: "COTIK", capabilities: ["ORDERS"] },
    });

    const bindings = await listEnabledShopProviderBindings(context.db, shop.id);
    expect(bindings.map((binding) => binding.provider)).toEqual(["COTIK", "SELLER_CENTER"]);

    // The external Seller Center identity mirrors, but never replaces, the canonical TikTok identity.
    const [refetchedShop] = await context.db.select().from(shops).where(eq(shops.id, shop.id));
    expect(refetchedShop!.tiktokShopId).toBe(tiktokShopId);
  });

  it("rejects one external provider identity bound to two shops", async () => {
    const shopA = await createTestShop();
    const shopB = await createTestShop();
    const sharedExternalId = `cotik-shared-${randomUUID()}`;

    await upsertShopProviderBinding(context.db, {
      shopId: shopA.id,
      provider: "COTIK",
      providerShopId: sharedExternalId,
      provenance: { source: "COTIK", capabilities: ["ORDERS"] },
    });
    await expect(
      upsertShopProviderBinding(context.db, {
        shopId: shopB.id,
        provider: "COTIK",
        providerShopId: sharedExternalId,
        provenance: { source: "COTIK", capabilities: ["ORDERS"] },
      }),
    ).rejects.toThrow(/shop_provider_bindings_provider_shop_id_unique/);
  });

  it("enforces uniqueness, capability, and identity checks at the SQL boundary", async () => {
    const shop = await createTestShop();

    await expect(
      context.db.insert(shopProviderBindings).values({
        shopId: shop.id,
        provider: "UNKNOWN_PROVIDER",
        providerShopId: "external-1",
        provenance: { source: "SELLER_CENTER", capabilities: ["ORDERS"] },
      }),
    ).rejects.toThrow(/shop_provider_bindings_provider_known/);

    await expect(
      context.db.insert(shopProviderBindings).values({
        shopId: shop.id,
        provider: "COTIK",
        providerShopId: "external-1",
        provenance: { source: "COTIK", capabilities: ["ORDERS", "OFFICIAL_ON_HOLD"] },
      }),
    ).rejects.toThrow(/shop_provider_bindings_cotik_no_official_on_hold/);

    await expect(
      context.db.insert(shopProviderBindings).values({
        shopId: shop.id,
        provider: "COTIK",
        providerShopId: null,
        enabled: true,
        provenance: { source: "COTIK", capabilities: ["ORDERS"] },
      }),
    ).rejects.toThrow(/shop_provider_bindings_enabled_requires_identity/);
  });

  it("persists rows whose projection contains no token or credential fields", async () => {
    const shop = await createTestShop();
    const binding = await upsertShopProviderBinding(context.db, {
      shopId: shop.id,
      provider: "COTIK",
      providerShopId: `cotik-${randomUUID()}`,
      provenance: { source: "COTIK", capabilities: ["ORDERS"] },
    });

    const allowedColumns = new Set([
      "id",
      "shopId",
      "provider",
      "providerShopId",
      "enabled",
      "provenance",
      "providerUpdatedAt",
      "collectedAt",
      "checkpoint",
      "createdAt",
      "updatedAt",
    ]);
    const rowKeys = Object.keys(binding);
    expect(rowKeys.every((key) => allowedColumns.has(key))).toBe(true);
    expect(
      rowKeys.filter((key) => /token|secret|password|cookie|credential|api[_-]?key/i.test(key)),
    ).toEqual([]);
  });
});
