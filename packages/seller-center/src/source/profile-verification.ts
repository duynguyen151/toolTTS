import type { SellerProfileIdentity } from "@shop-health/domain";

export type SellerIdentityResult = SellerProfileIdentity;

export function sellerIdentityFromFinanceRequestUrl(requestUrl: string): SellerIdentityResult {
  const url = new URL(requestUrl);
  const sellerIdValues = url.searchParams.getAll("seller_id");
  const oecSellerIdValues = url.searchParams.getAll("oec_seller_id");
  // Canonical Seller Center Finance requests carry each identity parameter exactly
  // once. Duplicates make the derived shop identity ambiguous even when the repeated
  // values agree, so fail closed instead of silently trusting the first value.
  if (sellerIdValues.length > 1 || oecSellerIdValues.length > 1) {
    return { status: "AMBIGUOUS", tiktokShopId: null };
  }
  const sellerId = sellerIdValues[0]?.trim() || null;
  const oecSellerId = oecSellerIdValues[0]?.trim() || null;
  if (sellerId !== null && oecSellerId !== null && sellerId !== oecSellerId) {
    return { status: "AMBIGUOUS", tiktokShopId: null };
  }
  const tiktokShopId = sellerId ?? oecSellerId;
  return tiktokShopId === null
    ? { status: "UNAVAILABLE", tiktokShopId: null }
    : { status: "IDENTIFIED", tiktokShopId };
}
