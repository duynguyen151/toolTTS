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
      tags: [],
      state: "CLOSED",
    }, {
      verifyProfile: vi.fn().mockResolvedValue({ status: "IDENTIFIED", tiktokShopId: "shop-after" }),
    } as never);

    expect(result).toEqual({ profileNo: "202", verificationState: "SHOP_IDENTITY_CHANGED", shop: null });
    expect(db.setAdsPowerProfileObservedStatus).toHaveBeenCalledWith({}, "persisted-profile", expect.objectContaining({
      observedStatus: null,
    }));
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
      tags: [{ name: "DEACTIVE" }],
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
      tags: [],
      state: "OPEN",
    }, {
      verifyProfile: vi.fn().mockRejectedValue(new SellerCenterError(
        "BROWSER_DISCONNECTED",
        "AdsPower browser connection is unavailable",
      )),
    } as never)).rejects.toMatchObject({ failureType: "BROWSER_DISCONNECTED" });

    expect(db.setAdsPowerProfileVerification).not.toHaveBeenCalled();
  });

  it("reports credentials required when login is needed and safe autofill is unavailable", async () => {
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: null });
    db.setAdsPowerProfileVerification.mockResolvedValue({ id: "persisted-profile" });

    const result = await verifySelectedProfile({} as never, {
      profileId: "profile-957",
      profileNo: "957",
      groupName: null,
      tags: [],
      state: "OPEN",
    }, {
      verifyProfile: vi.fn().mockRejectedValue(new SellerCenterError("LOGIN_REQUIRED", "Seller Center login is required")),
      credentialCapability: vi.fn().mockResolvedValue({ status: "MISSING", mechanism: null, reference: null }),
    } as never);

    expect(result).toEqual({ profileNo: "957", verificationState: "CREDENTIALS_REQUIRED", shop: null });
    expect(db.setAdsPowerProfileVerification).toHaveBeenCalledWith({}, "persisted-profile", expect.objectContaining({
      verificationState: "CREDENTIALS_REQUIRED",
      activeShopId: null,
    }));
  });

  it("requires canonical identity re-verification after manual bootstrap before marking the profile ready", async () => {
    const profile = {
      profileId: "profile-957",
      profileNo: "957",
      groupName: null,
      tags: [],
      state: "OPEN",
    } as const;
    const source = {
      verifyProfile: vi.fn()
        .mockRejectedValueOnce(new SellerCenterError("LOGIN_REQUIRED", "Seller Center login is required"))
        .mockResolvedValueOnce({ status: "IDENTIFIED", tiktokShopId: "seller-957" }),
      credentialCapability: vi.fn().mockResolvedValue({ status: "MISSING", mechanism: null, reference: null }),
    };
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: null, activeShopId: "shop-957" });
    db.findShopByProfileId.mockResolvedValue({ id: "shop-957", tiktokShopId: "seller-957" });
    db.findShopByTikTokShopId.mockResolvedValue(null);
    db.setAdsPowerProfileVerification.mockResolvedValue({ id: "persisted-profile" });
    db.setShopVerificationState.mockResolvedValue({ id: "shop-957" });

    await expect(verifySelectedProfile({} as never, profile, source as never)).resolves.toEqual({
      profileNo: "957",
      verificationState: "CREDENTIALS_REQUIRED",
      shop: null,
    });

    await expect(verifySelectedProfile({} as never, profile, source as never)).resolves.toMatchObject({
      profileNo: "957",
      verificationState: "READY",
      shop: { id: "shop-957" },
    });
    expect(db.setShopVerificationState).toHaveBeenCalledWith({}, "shop-957", expect.objectContaining({
      tiktokShopId: "seller-957",
      verificationStatus: "VERIFIED",
      eligibilityStatus: "ELIGIBLE",
    }));
  });

  it("keeps legacy sources without a credential capability on the login-required state", async () => {
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: null });
    db.setAdsPowerProfileVerification.mockResolvedValue({ id: "persisted-profile" });

    const result = await verifySelectedProfile({} as never, {
      profileId: "profile-957",
      profileNo: "957",
      groupName: null,
      tags: [],
      state: "OPEN",
    }, {
      verifyProfile: vi.fn().mockRejectedValue(new SellerCenterError("LOGIN_REQUIRED", "Seller Center login is required")),
    } as never);

    expect(result).toEqual({ profileNo: "957", verificationState: "LOGIN_REQUIRED", shop: null });
  });

  it("keeps a Seller Center challenge actionable without consulting credential capability", async () => {
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: null });
    db.setAdsPowerProfileVerification.mockResolvedValue({ id: "persisted-profile" });
    const credentialCapability = vi.fn().mockResolvedValue({
      status: "AVAILABLE",
      mechanism: "ADSPOWER_AUTOFILL",
      reference: "SELLER_CENTER_AUTOFILL",
    });

    const result = await verifySelectedProfile({} as never, {
      profileId: "profile-957",
      profileNo: "957",
      groupName: null,
      tags: [],
      state: "OPEN",
    }, {
      verifyProfile: vi.fn().mockRejectedValue(new SellerCenterError("CHALLENGE_REQUIRED", "Seller Center challenge requires manual action")),
      credentialCapability,
    } as never);

    expect(result).toEqual({ profileNo: "957", verificationState: "HUMAN_ACTION_REQUIRED", shop: null });
    expect(credentialCapability).not.toHaveBeenCalled();
  });

  it("persists an explicit normal-login failure as auth failed", async () => {
    db.getAdsPowerProfile.mockResolvedValue({ id: "persisted-profile", verifiedTiktokShopId: null });
    db.setAdsPowerProfileVerification.mockResolvedValue({ id: "persisted-profile" });

    const result = await verifySelectedProfile({} as never, {
      profileId: "profile-957",
      profileNo: "957",
      groupName: null,
      tags: [],
      state: "OPEN",
    }, {
      verifyProfile: vi.fn().mockRejectedValue(new SellerCenterError("AUTH_FAILED" as never, "Seller Center login failed")),
    } as never);

    expect(result).toEqual({ profileNo: "957", verificationState: "AUTH_FAILED", shop: null });
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
      tags: [],
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
