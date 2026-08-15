import { describe, expect, it } from "vitest";

import { sellerIdentityFromFinanceRequestUrl } from "./profile-verification.js";

describe("sellerIdentityFromFinanceRequestUrl", () => {
  it("accepts the matching seller identity from the proven Finance request", () => {
    expect(sellerIdentityFromFinanceRequestUrl(
      "https://seller-us.tiktok.com/api/v1/pay/statement/order/list?seller_id=shop-101&oec_seller_id=shop-101",
    )).toEqual({ status: "IDENTIFIED", tiktokShopId: "shop-101" });
  });

  it("requires manual shop selection when Seller Center returns conflicting identities", () => {
    expect(sellerIdentityFromFinanceRequestUrl(
      "https://seller-us.tiktok.com/api/v1/pay/statement/order/list?seller_id=shop-101&oec_seller_id=shop-202",
    )).toEqual({ status: "AMBIGUOUS", tiktokShopId: null });
  });

  it("fails closed when the request has no stable seller identity", () => {
    expect(sellerIdentityFromFinanceRequestUrl(
      "https://seller-us.tiktok.com/api/v1/pay/statement/order/list?locale=en-US",
    )).toEqual({ status: "UNAVAILABLE", tiktokShopId: null });
  });
});
