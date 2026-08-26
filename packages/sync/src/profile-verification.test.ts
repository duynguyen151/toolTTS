import { beforeEach, describe, expect, it, vi } from "vitest";
import { SellerCenterError } from "@shop-health/seller-center";

const db = vi.hoisted(() => ({
  createAdsPowerProfile: vi.fn(),
  createShop: vi.fn(),
  findShopByProfileId: vi.fn(),
  findShopByTikTokShopId: vi.fn(),
  getAdsPowerProfile: vi.fn(),
  linkAdsPowerProfileToShop: vi.fn(),
  setShopVerificationState: vi.fn(),
  setAdsPowerProfileObservedStatus: vi.fn(),
  setAdsPowerProfileVerification: vi.fn(),
}));

vi.mock("@shop-health/db", () => db);

import { verifySelectedProfile } from "./profile-verification.js";

describe("verifySelectedProfile", () => {
  beforeEach(() => {
    for (const mock of Object.values(db)) mock.mockReset();
  });

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

  it("persists a sanitized deactive tag observation without changing identity semantics", async () => {
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: "shop-before" });
    db.findShopByProfileId.mockResolvedValue(null);
    db.findShopByTikTokShopId.mockResolvedValue(null);

    await verifySelectedProfile({} as never, {
      profileId: "profile-202",
      profileNo: "202",
      groupName: null,
      observedStatus: "deactive",
      state: "CLOSED",
    }, {
      verifyProfile: vi.fn().mockResolvedValue({ status: "IDENTIFIED", tiktokShopId: "shop-after" }),
    } as never);

    expect(db.setAdsPowerProfileObservedStatus).toHaveBeenCalledWith({}, "persisted-profile", expect.objectContaining({
      observedStatus: "deactive",
    }));
  });

  it("propagates a browser connection failure instead of requiring human Seller Center action", async () => {
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: null });

    await expect(verifySelectedProfile({} as never, {
      profileId: "profile-957",
      profileNo: "957",
      groupName: null,
      state: "OPEN",
    }, {
      verifyProfile: vi.fn().mockRejectedValue(new SellerCenterError(
        "BROWSER_DISCONNECTED",
        "AdsPower browser connection is unavailable",
      )),
    } as never)).rejects.toMatchObject({ failureType: "BROWSER_DISCONNECTED" });

    expect(db.setAdsPowerProfileVerification).not.toHaveBeenCalled();
  });

  it("fails closed when a profile-linked shop has no stored canonical identity", async () => {
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: null });
    db.findShopByProfileId.mockResolvedValue({
      id: "shop-957",
      profileId: "profile-957",
      profileNo: "957",
      tiktokShopId: null,
    });
    db.findShopByTikTokShopId.mockResolvedValue(null);
    db.setAdsPowerProfileVerification.mockResolvedValue({ id: "persisted-profile" });

    const result = await verifySelectedProfile({} as never, {
      profileId: "profile-957",
      profileNo: "957",
      groupName: null,
      state: "OPEN",
    }, {
      verifyProfile: vi.fn().mockResolvedValue({ status: "IDENTIFIED", tiktokShopId: "seller-957" }),
    } as never);

    expect(result).toEqual({ profileNo: "957", verificationState: "SHOP_IDENTITY_CHANGED", shop: null });
    expect(db.setShopVerificationState).not.toHaveBeenCalled();
    expect(db.createShop).not.toHaveBeenCalled();
    expect(db.linkAdsPowerProfileToShop).not.toHaveBeenCalled();
  });
});
