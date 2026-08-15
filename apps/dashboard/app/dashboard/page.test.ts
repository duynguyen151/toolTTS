import { describe, expect, it, vi } from "vitest";

import { loadProfileOperationsPresentation } from "./page-data.js";

describe("loadProfileOperationsPresentation", () => {
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

  it("does not enable AdsPower operations when live dashboard data is unavailable", async () => {
    const listProfiles = vi.fn();

    await expect(loadProfileOperationsPresentation({ dataOrigin: "UNAVAILABLE" }, listProfiles)).resolves.toEqual({
      status: "READY",
      selectedProfileNo: null,
      profiles: [],
      error: null,
    });
    expect(listProfiles).not.toHaveBeenCalled();
  });

  it("lists AdsPower profiles for LIVE dashboard data", async () => {
    const listed = { status: "READY" as const, selectedProfileNo: "957", profiles: [], error: null };
    const listProfiles = vi.fn().mockResolvedValue(listed);

    await expect(loadProfileOperationsPresentation({ dataOrigin: "LIVE" }, listProfiles)).resolves.toBe(listed);
    expect(listProfiles).toHaveBeenCalledTimes(1);
  });
});
