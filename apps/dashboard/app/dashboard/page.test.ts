import { describe, expect, it, vi } from "vitest";

import {
  loadProfileOperationsPresentation,
  normalizeRequestedShopProfileNo,
  shouldBindPersistedShop,
} from "./page-data.js";

describe("loadProfileOperationsPresentation", () => {
  it("distinguishes an absent shop query from an explicitly empty query", () => {
    expect(normalizeRequestedShopProfileNo(undefined)).toBeUndefined();
    expect(normalizeRequestedShopProfileNo("")).toBe("");
    expect(normalizeRequestedShopProfileNo("   ")).toBe("");
    expect(normalizeRequestedShopProfileNo([" 957 "])).toBe("957");
  });

  it("does not list AdsPower profiles for sanitized demo data", async () => {
    const listProfiles = vi.fn();

    await expect(loadProfileOperationsPresentation({ dataOrigin: "DEMO_SANITIZED" }, listProfiles)).resolves.toEqual({
      status: "READY",
      selectedProfileNo: null,
      profiles: [],
      error: null,
    });
    expect(listProfiles).not.toHaveBeenCalled();
  });

  it("lists AdsPower profiles when no LIVE shop has been selected yet", async () => {
    const listed = { status: "READY" as const, selectedProfileNo: "987", profiles: [], error: null };
    const listProfiles = vi.fn().mockResolvedValue(listed);

    await expect(loadProfileOperationsPresentation({ dataOrigin: "UNAVAILABLE" }, listProfiles)).resolves.toBe(listed);
    expect(listProfiles).toHaveBeenCalledTimes(1);
  });

  it("lists AdsPower profiles for LIVE dashboard data", async () => {
    const listed = { status: "READY" as const, selectedProfileNo: "957", profiles: [], error: null };
    const listProfiles = vi.fn().mockResolvedValue(listed);

    await expect(loadProfileOperationsPresentation({ dataOrigin: "LIVE" }, listProfiles)).resolves.toBe(listed);
    expect(listProfiles).toHaveBeenCalledTimes(1);
  });

  it("does not bind a different selected AdsPower profile to stale shop data", () => {
    expect(shouldBindPersistedShop("957", "957")).toBe(true);
    expect(shouldBindPersistedShop("957", "987")).toBe(false);
    expect(shouldBindPersistedShop("957", undefined)).toBe(true);
  });
});
