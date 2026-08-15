export type SellerIdentityResult =
  | { readonly status: "IDENTIFIED"; readonly tiktokShopId: string }
  | { readonly status: "AMBIGUOUS" | "UNAVAILABLE" | "NOT_TIKTOK_SELLER" | "UNSUPPORTED_REGION"; readonly tiktokShopId: null };

export function sellerIdentityFromFinanceRequestUrl(requestUrl: string): SellerIdentityResult {
  const url = new URL(requestUrl);
  const sellerId = url.searchParams.get("seller_id")?.trim() || null;
  const oecSellerId = url.searchParams.get("oec_seller_id")?.trim() || null;
  if (sellerId !== null && oecSellerId !== null && sellerId !== oecSellerId) {
    return { status: "AMBIGUOUS", tiktokShopId: null };
  }
  const tiktokShopId = sellerId ?? oecSellerId;
  return tiktokShopId === null
    ? { status: "UNAVAILABLE", tiktokShopId: null }
    : { status: "IDENTIFIED", tiktokShopId };
}
