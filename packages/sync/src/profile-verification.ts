import {
  createAdsPowerProfile,
  createShop,
  findShopByProfileId,
  findShopByTikTokShopId,
  getAdsPowerProfile,
  linkAdsPowerProfileToShop,
  setShopVerificationState,
  setAdsPowerProfileVerification,
  type Database,
  type ShopRow,
} from "@shop-health/db";
import type { AdsPowerProfileSummary, SellerCenterBrowserDataSource } from "@shop-health/seller-center";
import { SellerCenterError } from "@shop-health/seller-center";

export interface ProfileVerificationResult {
  readonly profileNo: string;
  readonly verificationState: "READY" | "LOGIN_REQUIRED" | "HUMAN_ACTION_REQUIRED" | "SHOP_SELECTION_REQUIRED" | "SHOP_IDENTITY_CHANGED" | "NOT_TIKTOK_SELLER" | "UNSUPPORTED_REGION";
  readonly shop: ShopRow | null;
}

export async function verifySelectedProfile(
  db: Database,
  profile: AdsPowerProfileSummary,
  source: Pick<SellerCenterBrowserDataSource, "verifyProfile">,
): Promise<ProfileVerificationResult> {
  const persisted = await getAdsPowerProfile(db, profile.profileId)
    ?? await createAdsPowerProfile(db, { profileId: profile.profileId, profileNo: profile.profileNo });
  let identity;
  try {
    identity = await source.verifyProfile({ profileId: profile.profileId });
  } catch (error) {
    if (!(error instanceof SellerCenterError)) throw error;
    const verificationState = error.failureType === "LOGIN_REQUIRED"
      ? "LOGIN_REQUIRED"
      : error.failureType === "CHALLENGE_REQUIRED"
        ? "HUMAN_ACTION_REQUIRED"
        : undefined;
    if (verificationState === undefined) throw error;
    await setAdsPowerProfileVerification(db, persisted.id, {
      verificationState,
      eligibilityStatus: "INELIGIBLE",
      verifiedTiktokShopId: null,
      verifiedShopDisplayName: null,
      activeShopId: null,
    });
    return { profileNo: profile.profileNo, verificationState, shop: null };
  }
  if (identity.status !== "IDENTIFIED") {
    const verificationState = identity.status === "AMBIGUOUS" || identity.status === "UNAVAILABLE"
      ? "SHOP_SELECTION_REQUIRED"
      : identity.status;
    await setAdsPowerProfileVerification(db, persisted.id, {
      verificationState,
      eligibilityStatus: verificationState === "UNSUPPORTED_REGION" ? "UNSUPPORTED_REGION" : "INELIGIBLE",
      verifiedTiktokShopId: null,
      verifiedShopDisplayName: null,
      activeShopId: null,
    });
    return { profileNo: profile.profileNo, verificationState, shop: null };
  }

  const [linkedShop, identityOwner] = await Promise.all([
    findShopByProfileId(db, profile.profileId),
    findShopByTikTokShopId(db, identity.tiktokShopId),
  ]);
  if (
    (persisted.verifiedTiktokShopId !== null && persisted.verifiedTiktokShopId !== identity.tiktokShopId)
    || (persisted.activeShopId !== null && persisted.activeShopId !== linkedShop?.id)
    || linkedShop?.tiktokShopId === null
    || (linkedShop?.tiktokShopId !== null
      && linkedShop?.tiktokShopId !== undefined
      && linkedShop.tiktokShopId !== identity.tiktokShopId)
    || (identityOwner !== null && identityOwner.profileId !== profile.profileId)
  ) {
    await setAdsPowerProfileVerification(db, persisted.id, {
      verificationState: "SHOP_IDENTITY_CHANGED",
      eligibilityStatus: "INELIGIBLE",
      verifiedTiktokShopId: null,
      verifiedShopDisplayName: null,
      activeShopId: null,
    });
    return { profileNo: profile.profileNo, verificationState: "SHOP_IDENTITY_CHANGED", shop: null };
  }

  const shop = linkedShop === null
    ? await createShop(db, {
      profileId: profile.profileId,
      profileNo: profile.profileNo,
      tiktokShopId: identity.tiktokShopId,
      displayName: null,
      region: "US",
      locale: "en-US",
      currency: "USD",
      verificationStatus: "VERIFIED",
      eligibilityStatus: "ELIGIBLE",
    })
    : await setShopVerificationState(db, linkedShop.id, {
      tiktokShopId: identity.tiktokShopId,
      verificationStatus: "VERIFIED",
      eligibilityStatus: "ELIGIBLE",
    });
  await setAdsPowerProfileVerification(db, persisted.id, {
    verificationState: "READY",
    eligibilityStatus: "ELIGIBLE",
    verifiedTiktokShopId: identity.tiktokShopId,
    verifiedShopDisplayName: shop.displayName,
  });
  await linkAdsPowerProfileToShop(db, persisted.id, shop.id);
  return { profileNo: profile.profileNo, verificationState: "READY", shop };
}
