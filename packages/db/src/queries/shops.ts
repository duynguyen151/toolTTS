import { and, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { shops, type ShopRow } from "../schema.js";

export interface CreateShopInput {
  profileId: string;
  profileNo: string;
  tiktokShopId?: string | null;
  displayName?: string | null;
  region: string;
  locale: string;
  verificationStatus?: ShopRow["verificationStatus"];
  eligibilityStatus?: ShopRow["eligibilityStatus"];
  currency?: string;
  enabled?: boolean;
}

export async function createShop(db: Database, input: CreateShopInput): Promise<ShopRow> {
  const [shop] = await db
    .insert(shops)
    .values({
      profileId: input.profileId,
      profileNo: input.profileNo,
      tiktokShopId: input.tiktokShopId ?? null,
      displayName: input.displayName ?? null,
      region: input.region,
      locale: input.locale,
      verificationStatus: input.verificationStatus ?? "NOT_VERIFIED",
      eligibilityStatus: input.eligibilityStatus
        ?? (input.region === "US" && input.locale === "en-US" ? "ELIGIBLE" : "UNSUPPORTED_REGION"),
      currency: input.currency ?? "USD",
      enabled: input.enabled ?? true
    })
    .returning();

  if (!shop) {
    throw new Error("Failed to create shop");
  }

  return shop;
}

export async function findShopByProfileNo(
  db: Database,
  profileNo: string
): Promise<ShopRow | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.profileNo, profileNo)).limit(1);
  return shop ?? null;
}

export async function findShopById(db: Database, shopId: string): Promise<ShopRow | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  return shop ?? null;
}

export async function findShopByTikTokShopId(
  db: Database,
  tiktokShopId: string,
): Promise<ShopRow | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.tiktokShopId, tiktokShopId)).limit(1);
  return shop ?? null;
}

export interface SetShopVerificationStateInput {
  tiktokShopId?: string | null;
  verificationStatus: ShopRow["verificationStatus"];
  eligibilityStatus: ShopRow["eligibilityStatus"];
}

export async function setShopVerificationState(
  db: Database,
  shopId: string,
  input: SetShopVerificationStateInput,
): Promise<ShopRow> {
  const [shop] = await db
    .update(shops)
    .set({
      ...(input.tiktokShopId === undefined ? {} : { tiktokShopId: input.tiktokShopId }),
      verificationStatus: input.verificationStatus,
      eligibilityStatus: input.eligibilityStatus,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shopId))
    .returning();
  if (!shop) throw new Error(`Shop not found: ${shopId}`);
  return shop;
}

export async function listShops(db: Database): Promise<ShopRow[]> {
  return db.select().from(shops).orderBy(shops.profileNo);
}

export async function listEnabledShops(db: Database): Promise<ShopRow[]> {
  return db
    .select()
    .from(shops)
    .where(and(eq(shops.enabled, true), eq(shops.syncState, "ACTIVE")))
    .orderBy(shops.profileNo);
}

export type ShopSyncState = ShopRow["syncState"];

export async function setShopSyncState(
  db: Database,
  shopId: string,
  syncState: ShopSyncState,
  pauseReason: string | null = null
): Promise<ShopRow> {
  const [shop] = await db
    .update(shops)
    .set({ syncState, pauseReason, updatedAt: new Date() })
    .where(eq(shops.id, shopId))
    .returning();

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }

  return shop;
}

export async function requestShopSync(db: Database, shopId: string): Promise<void> {
  const result = await db
    .update(shops)
    .set({ syncRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(shops.id, shopId))
    .returning({ id: shops.id });

  if (result.length === 0) {
    throw new Error(`Shop not found: ${shopId}`);
  }
}

export async function markShopSynced(
  db: Database,
  shopId: string,
  kind: "orders" | "finance",
  syncedAt = new Date()
): Promise<void> {
  await db
    .update(shops)
    .set({
      ...(kind === "orders"
        ? { lastOrdersSyncedAt: syncedAt }
        : { lastFinanceSyncedAt: syncedAt }),
      syncRequestedAt: null,
      updatedAt: syncedAt
    })
    .where(eq(shops.id, shopId));
}
