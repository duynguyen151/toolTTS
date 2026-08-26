export function selectAutomaticOrdersShops<TShop extends { readonly id: string }>(
  readyShops: readonly TShop[],
  automaticRefreshShops: readonly TShop[],
): readonly TShop[] {
  const automaticShopIds = new Set(automaticRefreshShops.map((shop) => shop.id));
  return readyShops.filter((shop) => automaticShopIds.has(shop.id));
}
