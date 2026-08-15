import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createAdsPowerProfile: vi.fn(),
  createShop: vi.fn(),
  findShopByProfileId: vi.fn(),
  findShopByTikTokShopId: vi.fn(),
  getAdsPowerProfile: vi.fn(),
  linkAdsPowerProfileToShop: vi.fn(),
  setAdsPowerProfileVerification: vi.fn(),
}));

vi.mock("@shop-health/db", () => db);

import { verifySelectedProfile } from "./profile-verification.js";

describe("verifySelectedProfile", () => {
  it("marks conflicting Seller Center identities as changed without relinking", async () => {
    db.getAdsPowerProfile.mockResolvedValue({
      id: "persisted-profile",
      verifiedTiktokShopId: "shop-before",
    });
    db.findShopByProfileId.mockResolvedValue(null);
    db.findShopByTikTokShopId.mockResolvedValue(null);

    const result = await verifySelectedProfile({} as never, {
      profileId: "profile-202",
      profileNo: "202",
      groupName: null,
      state: "CLOSED",
    }, {
      verifyProfile: vi.fn().mockResolvedValue({ status: "IDENTIFIED", tiktokShopId: "shop-after" }),
    } as never);

    expect(result).toEqual({ profileNo: "202", verificationState: "SHOP_IDENTITY_CHANGED", shop: null });
    expect(db.setAdsPowerProfileVerification).toHaveBeenCalledWith({}, "persisted-profile", expect.objectContaining({
      verificationState: "SHOP_IDENTITY_CHANGED",
      activeShopId: null,
    }));
    expect(db.linkAdsPowerProfileToShop).not.toHaveBeenCalled();
  });
});
