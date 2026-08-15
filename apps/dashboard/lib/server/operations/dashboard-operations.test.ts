import { describe, expect, it } from "vitest";

import { SellerCenterError, type AdsPowerProfileSummary } from "@shop-health/seller-center";

import type { UpdateDataEvent } from "../../operations-contract.js";
import {
  createDashboardOperations,
  type DashboardOperationsAdapters,
  type DashboardOperationsShop,
} from "./dashboard-operations.js";

const profiles: AdsPowerProfileSummary[] = [
  { profileId: "internal-957", profileNo: "957", groupName: "Operators", state: "CLOSED" },
  { profileId: "internal-958", profileNo: "958", groupName: null, state: "OPEN" },
];

const shops: DashboardOperationsShop[] = [
  {
    id: "shop-957",
    profileId: "internal-957",
    profileNo: "957",
    displayName: "Tool TTS Shop",
  },
];

function adapters(overrides: Partial<DashboardOperationsAdapters> = {}): DashboardOperationsAdapters {
  return {
    listAdsPowerProfiles: async () => profiles,
    listShops: async () => shops,
    ensureAdsPowerReady: async () => undefined,
    openReady: async () => undefined,
    checkSellerCenterHealth: async () => ({
      status: "HEALTHY" as const,
      checkedAt: new Date(),
      detail: null,
    }),
    runSync: async () => ({ status: "SUCCEEDED", complete: true }),
    evaluateRisk: async () => undefined,
    ...overrides,
  };
}

async function collectUpdate(
  operations: ReturnType<typeof createDashboardOperations>,
  profileNo = "957",
): Promise<UpdateDataEvent[]> {
  const events: UpdateDataEvent[] = [];
  await operations.updateData(profileNo, (event) => { events.push(event); });
  return events;
}

describe("DashboardOperations", () => {
  it("lists all AdsPower profiles and joins linked shops by server-only profile ID", async () => {
    const presentation = await createDashboardOperations(adapters()).listProfiles("958");

    expect(presentation).toEqual({
      status: "READY",
      selectedProfileNo: "958",
      profiles: [
        {
          profileNo: "957",
          state: "CLOSED",
          linkState: "LINKED",
          linkedShop: { profileNo: "957", displayName: "Tool TTS Shop" },
        },
        {
          profileNo: "958",
          state: "OPEN",
          linkState: "UNLINKED",
          linkedShop: null,
        },
      ],
      error: null,
    });
    expect(JSON.stringify(presentation)).not.toMatch(/internal-957|profileId|groupName/);
  });

  it("opens an unlinked AdsPower profile without exposing its internal ID", async () => {
    const opened: string[] = [];
    const ensured: string[] = [];
    const result = await createDashboardOperations(adapters({
      listAdsPowerProfiles: async () => profiles.map((profile) => profile.profileNo === "958"
        ? { ...profile, state: "CLOSED" }
        : profile),
      openReady: async (profileId) => { opened.push(profileId); },
      ensureAdsPowerReady: async () => { ensured.push("ready"); },
    })).openProfile("958");

    expect(ensured).toEqual(["ready"]);
    expect(opened).toEqual(["internal-958"]);
    expect(result).toEqual({ ok: true, profileNo: "958", state: "OPEN" });
    expect(JSON.stringify(result)).not.toContain("internal-958");
  });

  it("verifies an already open profile through openReady", async () => {
    const opened: string[] = [];
    const result = await createDashboardOperations(adapters({
      openReady: async (profileId) => { opened.push(profileId); },
    })).openProfile("958");

    expect(opened).toEqual(["internal-958"]);
    expect(result).toEqual({ ok: true, profileNo: "958", state: "OPEN" });
  });

  it("opens a closed linked profile then syncs orders, finance, and risk in order", async () => {
    const calls: string[] = [];
    const operations = createDashboardOperations(adapters({
      openReady: async () => { calls.push("open"); },
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return { status: "SUCCEEDED", complete: true };
      },
      evaluateRisk: async () => { calls.push("risk"); },
    }));

    const events = await collectUpdate(operations);

    expect(calls).toEqual(["open", "orders", "finance", "risk"]);
    expect(events.map((event) => event.state)).toEqual([
      "OPENING_PROFILE",
      "CONNECTING",
      "SYNCING_ORDERS",
      "SYNCING_FINANCE",
      "RECONCILING",
      "SUCCESS",
    ]);
    expect(events.at(-1)).toMatchObject({
      terminal: true,
      completedKinds: ["orders", "finance"],
      error: null,
    });
  });

  it("ensures readiness, reuses an open session, and checks health before syncing", async () => {
    const calls: string[] = [];
    const openProfile = profiles[1];
    if (openProfile === undefined) throw new Error("test profile missing");
    const shop: DashboardOperationsShop = {
      id: "shop-958",
      profileId: openProfile.profileId,
      profileNo: openProfile.profileNo,
      displayName: "Tool TTS Shop 958",
    };
    const events = await collectUpdate(createDashboardOperations(adapters({
      listAdsPowerProfiles: async () => [openProfile],
      listShops: async () => [shop],
      ensureAdsPowerReady: async () => { calls.push("ensure"); },
      openReady: async () => { calls.push("open"); },
      checkSellerCenterHealth: async () => {
        calls.push("health");
        return { status: "HEALTHY", checkedAt: new Date(), detail: null };
      },
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return { status: "SUCCEEDED", complete: true };
      },
      evaluateRisk: async () => { calls.push("risk"); },
    })), "958");

    expect(calls).toEqual(["ensure", "open", "health", "orders", "finance", "risk"]);
    expect(events.map((event) => event.state)).not.toContain("OPENING_PROFILE");
    expect(events.at(-1)).toMatchObject({ state: "SUCCESS", completedKinds: ["orders", "finance"] });
  });

  it("rejects Update Data for an unlinked profile", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters()), "958");

    expect(events).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      state: "ERROR",
      terminal: true,
      completedKinds: [],
      error: { code: "SHOP_NOT_LINKED" },
    });
  });

  it("keeps profile opening available when Tool_TTS links cannot be read", async () => {
    const presentation = await createDashboardOperations(adapters({
      listShops: async () => { throw new Error("database offline"); },
    })).listProfiles("957");

    expect(presentation).toMatchObject({
      status: "READY",
      selectedProfileNo: "957",
      error: { code: "DATABASE_UNAVAILABLE" },
    });
    expect(presentation.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileNo: "957", linkState: "UNKNOWN" }),
    ]));
  });

  it.each([
    ["LOGIN_REQUIRED", "LOGIN_REQUIRED"],
    ["CHALLENGE_REQUIRED", "SECURITY_CHECK_REQUIRED"],
  ] as const)("maps %s to the operator state %s", async (failureType, expectedState) => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async () => { throw new SellerCenterError(failureType, "private upstream detail"); },
    })));

    expect(events.at(-1)).toMatchObject({
      state: "HUMAN_ACTION_REQUIRED",
      terminal: true,
      completedKinds: [],
      error: { code: expectedState === "LOGIN_REQUIRED" ? "LOGIN_REQUIRED" : "SECURITY_CHALLENGE_REQUIRED" },
    });
    expect(events.at(-1)?.message).not.toContain("private upstream detail");
  });

  it("preserves completed orders when finance encounters a layout change", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        if (kind === "finance") throw new SellerCenterError("LAYOUT_CHANGED", "private selector detail");
        return { status: "SUCCEEDED", complete: true };
      },
    })));

    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: ["orders"],
      error: { code: "LAYOUT_CHANGED" },
    });
  });

  it("maps an advisory-lock skip without claiming success", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
    runSync: async () => ({ status: "SKIPPED", complete: false }),
    })));

    expect(events.at(-1)).toMatchObject({
      state: "ERROR",
      terminal: true,
      completedKinds: [],
      error: { code: "SYNC_SKIPPED" },
    });
  });

  it("stops after an incomplete orders sync without reconciling risk", async () => {
    const calls: string[] = [];
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return {
          status: "SUCCEEDED",
          complete: false,
          sourceCoverage: {
            source: "SELLER_CENTER" as const,
            window: "ROLLING_12_MONTHS" as const,
            completeWithinWindow: false,
            lifetimeHistoryComplete: false as const,
          },
        };
      },
      evaluateRisk: async () => { calls.push("risk"); },
    })));

    expect(calls).toEqual(["orders"]);
    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: [],
      error: { code: "SYNC_PARTIAL" },
    });
    expect(events.at(-1)?.message).toContain("incomplete");
  });

  it("does not reconcile risk when finance sync is incomplete", async () => {
    const calls: string[] = [];
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return { status: "SUCCEEDED", complete: kind === "orders" };
      },
      evaluateRisk: async () => { calls.push("risk"); },
    })));

    expect(calls).toEqual(["orders", "finance"]);
    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: ["orders"],
      error: { code: "SYNC_PARTIAL" },
    });
    expect(events.at(-1)?.message).toContain("incomplete");
  });

  it.each([
    ["LOGIN_REQUIRED", "LOGIN_REQUIRED", "Open the profile and complete Seller Center login, then retry Update Data."],
    ["CHALLENGE_REQUIRED", "SECURITY_CHALLENGE_REQUIRED", "Open the profile and complete the security check, then retry Update Data."],
  ] as const)("stops before sync when Seller Center reports %s", async (status, errorCode, message) => {
    let syncCalls = 0;
    const events = await collectUpdate(createDashboardOperations(adapters({
      checkSellerCenterHealth: async () => ({ status, checkedAt: new Date(), detail: "private detail" }),
      runSync: async () => {
        syncCalls += 1;
        return { status: "SUCCEEDED", complete: true };
      },
    })));

    expect(syncCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      state: "HUMAN_ACTION_REQUIRED",
      terminal: true,
      error: { code: errorCode },
      message,
    });
  });

  it("maps a layout health result to an explicit layout failure", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      checkSellerCenterHealth: async () => ({
        status: "LAYOUT_CHANGED",
        checkedAt: new Date(),
        detail: "private selector detail",
      }),
    })));

    expect(events.at(-1)).toMatchObject({
      state: "ERROR",
      terminal: true,
      error: { code: "LAYOUT_CHANGED" },
    });
  });

  it("maps an initially open profile timeout to CDP unavailability", async () => {
    const openProfile = profiles[1];
    if (openProfile === undefined) throw new Error("test profile missing");
    const shop: DashboardOperationsShop = {
      id: "shop-958",
      profileId: openProfile.profileId,
      profileNo: openProfile.profileNo,
      displayName: "Tool TTS Shop 958",
    };
    const events = await collectUpdate(createDashboardOperations(adapters({
      listAdsPowerProfiles: async () => [openProfile],
      listShops: async () => [shop],
      openReady: async () => { throw new SellerCenterError("SOURCE_TIMEOUT", "private timeout"); },
    })), "958");

    expect(events.at(-1)).toMatchObject({
      state: "ERROR",
      terminal: true,
      error: { code: "CDP_UNAVAILABLE" },
    });
  });

  it("reports reconciliation failure as partial after both syncs complete", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      evaluateRisk: async () => { throw new Error("private database detail"); },
    })));

    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: ["orders", "finance"],
      error: { code: "UNEXPECTED_ERROR" },
    });
    expect(events.at(-1)?.message).not.toContain("private database detail");
  });

  it.each([
    [new SellerCenterError("ADSPOWER_UNAVAILABLE", "private API detail"), "ADSPOWER_NOT_RUNNING"],
    [new SellerCenterError("PROFILE_START_FAILED", "private start detail"), "PROFILE_OPEN_FAILED"],
    [new SellerCenterError("SOURCE_TIMEOUT", "private timeout detail"), "PROFILE_NOT_READY"],
    [new SellerCenterError("BROWSER_DISCONNECTED", "private CDP detail"), "PROFILE_NOT_READY"],
  ] as const)("maps profile operation errors to %s", async (failure, expectedCode) => {
    const result = await createDashboardOperations(adapters({
      openReady: async () => { throw failure; },
    })).openProfile("957");

    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(JSON.stringify(result)).not.toContain(failure.message);
  });
});
