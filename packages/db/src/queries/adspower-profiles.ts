import { and, asc, eq, gte, isNotNull } from "drizzle-orm";
import { RefreshObservedStatusSchema } from "@shop-health/domain";
import { z } from "zod";

import type { Database } from "../client.js";
import { adspowerProfiles, shops, type AdsPowerProfileRow, type ShopRow } from "../schema.js";

const profileIdentitySchema = z.object({
  profileId: z.string().trim().min(1),
  profileNo: z.string().trim().min(1),
});

const observedStatusInputSchema = z.object({
  observedStatus: RefreshObservedStatusSchema.nullable(),
  observedAt: z.coerce.date(),
});

const verificationInputSchema = z.object({
  verificationState: z.enum([
    "UNVERIFIED",
    "LOGIN_REQUIRED",
    "HUMAN_ACTION_REQUIRED",
    "NOT_TIKTOK_SELLER",
    "UNSUPPORTED_REGION",
    "SHOP_SELECTION_REQUIRED",
    "SHOP_IDENTITY_CHANGED",
    "READY",
  ]),
  eligibilityStatus: z.enum(["ELIGIBLE", "INELIGIBLE", "UNSUPPORTED_REGION"]),
  verifiedTiktokShopId: z.string().trim().min(1).nullable().optional(),
  verifiedShopDisplayName: z.string().trim().min(1).nullable().optional(),
  activeShopId: z.string().uuid().nullable().optional(),
  lastVerifiedAt: z.coerce.date().optional(),
});

export type CreateAdsPowerProfileInput = z.infer<typeof profileIdentitySchema>;
export type SetAdsPowerProfileVerificationInput = z.infer<typeof verificationInputSchema>;
export type SetAdsPowerProfileObservedStatusInput = z.input<typeof observedStatusInputSchema>;

export async function createAdsPowerProfile(
  db: Database,
  input: CreateAdsPowerProfileInput,
): Promise<AdsPowerProfileRow> {
  const parsed = profileIdentitySchema.parse(input);
  const [profile] = await db.insert(adspowerProfiles).values(parsed).returning();
  if (!profile) throw new Error("Failed to create AdsPower profile");
  return profile;
}

export async function getAdsPowerProfile(
  db: Database,
  profileId: string,
): Promise<AdsPowerProfileRow | null> {
  const [profile] = await db.select().from(adspowerProfiles)
    .where(eq(adspowerProfiles.profileId, profileId)).limit(1);
  return profile ?? null;
}

export async function listAdsPowerProfiles(db: Database): Promise<AdsPowerProfileRow[]> {
  return db.select().from(adspowerProfiles).orderBy(asc(adspowerProfiles.profileNo));
}

export async function listReadyAdsPowerProfileShops(db: Database): Promise<ShopRow[]> {
  const rows = await db.select({ shop: shops }).from(adspowerProfiles)
    .innerJoin(shops, eq(adspowerProfiles.activeShopId, shops.id))
    .where(and(
      eq(adspowerProfiles.verificationState, "READY"),
      eq(adspowerProfiles.eligibilityStatus, "ELIGIBLE"),
      eq(shops.enabled, true),
      eq(shops.syncState, "ACTIVE"),
      eq(shops.verificationStatus, "VERIFIED"),
      eq(shops.eligibilityStatus, "ELIGIBLE"),
    ))
    .orderBy(asc(adspowerProfiles.profileNo));
  return rows.map((row) => row.shop);
}

export const ADSPOWER_OBSERVED_STATUS_MAX_AGE_MS = 10 * 60 * 1000;

/** Automatic claims require a fresh explicit active tag observation. */
export async function listAutomaticRefreshEligibleAdsPowerProfileShops(
  db: Database,
  now: Date = new Date(),
): Promise<ShopRow[]> {
  const observedStatusCutoff = new Date(now.getTime() - ADSPOWER_OBSERVED_STATUS_MAX_AGE_MS);
  const rows = await db.select({ shop: shops }).from(adspowerProfiles)
    .innerJoin(shops, eq(adspowerProfiles.activeShopId, shops.id))
    .where(and(
      eq(adspowerProfiles.verificationState, "READY"),
      eq(adspowerProfiles.eligibilityStatus, "ELIGIBLE"),
      eq(adspowerProfiles.observedStatus, "active"),
      isNotNull(adspowerProfiles.observedStatusAt),
      gte(adspowerProfiles.observedStatusAt, observedStatusCutoff),
      eq(shops.enabled, true),
      eq(shops.syncState, "ACTIVE"),
      eq(shops.verificationStatus, "VERIFIED"),
      eq(shops.eligibilityStatus, "ELIGIBLE"),
    ))
    .orderBy(asc(adspowerProfiles.profileNo));
  return rows.map((row) => row.shop);
}

export async function setAdsPowerProfileObservedStatus(
  db: Database,
  profileId: string,
  input: SetAdsPowerProfileObservedStatusInput,
): Promise<AdsPowerProfileRow> {
  const parsed = observedStatusInputSchema.parse(input);
  const [profile] = await db.update(adspowerProfiles).set({
    observedStatus: parsed.observedStatus,
    observedStatusAt: parsed.observedStatus === null ? null : parsed.observedAt,
    updatedAt: parsed.observedAt,
  }).where(eq(adspowerProfiles.id, profileId)).returning();
  if (!profile) throw new Error(`AdsPower profile not found: ${profileId}`);
  return profile;
}

export async function setAdsPowerProfileVerification(
  db: Database,
  profileId: string,
  input: SetAdsPowerProfileVerificationInput,
): Promise<AdsPowerProfileRow> {
  const parsed = verificationInputSchema.parse(input);
  const [profile] = await db.update(adspowerProfiles).set({
    ...parsed,
    lastVerifiedAt: parsed.lastVerifiedAt ?? new Date(),
    updatedAt: new Date(),
  }).where(eq(adspowerProfiles.id, profileId)).returning();
  if (!profile) throw new Error(`AdsPower profile not found: ${profileId}`);
  return profile;
}

export async function linkAdsPowerProfileToShop(
  db: Database,
  adspowerProfileId: string,
  shopId: string,
): Promise<AdsPowerProfileRow> {
  const [profileRows, shopRows] = await Promise.all([
    db.select().from(adspowerProfiles).where(eq(adspowerProfiles.id, adspowerProfileId)).limit(1),
    db.select().from(shops).where(eq(shops.id, shopId)).limit(1),
  ]);
  const profile = profileRows[0];
  const shop = shopRows[0];
  if (!profile) throw new Error(`AdsPower profile not found: ${adspowerProfileId}`);
  if (!shop) throw new Error(`Shop not found: ${shopId}`);
  if (profile.verificationState !== "READY" || profile.eligibilityStatus !== "ELIGIBLE") {
    throw new Error("AdsPower profile must be READY and ELIGIBLE before linking a shop");
  }
  if (profile.verifiedTiktokShopId !== shop.tiktokShopId) {
    throw new Error("Verified TikTok Shop identity does not match the selected shop");
  }
  const [linked] = await db.update(adspowerProfiles).set({
    activeShopId: shop.id,
    updatedAt: new Date(),
  }).where(eq(adspowerProfiles.id, profile.id)).returning();
  if (!linked) throw new Error(`AdsPower profile not found: ${adspowerProfileId}`);
  return linked;
}
