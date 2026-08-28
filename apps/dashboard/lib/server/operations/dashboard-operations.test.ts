import { describe, expect, it } from "vitest";

import { SellerCenterError, type AdsPowerProfileSummary } from "@shop-health/seller-center";

import type { UpdateDataEvent } from "../../operations-contract.js";
import {
  createDashboardOperations,
  type DashboardOperationsAdapters,
  type DashboardOperationsShop,
} from "./dashboard-operations.js";

const profiles: AdsPowerProfileSummary[] = [
  { profileId: "internal-957", profileNo: "957", groupName: "Operators", tags: [], state: "CLOSED" },
  { profileId: "internal-958", profileNo: "958", groupName: null, tags: [], state: "OPEN" },
];

const shops: DashboardOperationsShop[] = [
  {
    id: "shop-957",
    profileId: "internal-957",
    profileNo: "957",
    displayName: "Tool TTS Shop",
  },
];

function completeSync(kind: "orders" | "finance") {
  return kind === "orders"
    ? {
        status: "SUCCEEDED" as const,
        complete: true,
        sourceCoverage: {
          source: "SELLER_CENTER" as const,
          window: "ROLLING_12_MONTHS" as const,
          completeWithinSourceWindow: true,
          lifetimeHistoryComplete: false as const,
        },
      }
    : {
        status: "SUCCEEDED" as const,
        complete: true,
        financeProof: {
          capturedAt: new Date("2026-08-15T00:00:00.000Z"),
          officialOnHoldAmount: "1200.0000",
          reasonTotalsReconcileToOfficialOnHold: true as const,
        },
      };
}

const completeDecisionCoverage = {
  coverageState: "COMPLETE" as const,
  persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
  source: "SELLER_CENTER" as const,
  provenSourceWindow: "ROLLING_12_MONTHS" as const,
  completeWithinSourceWindow: true,
  lifetimeHistoryComplete: false,
  ordersSourceComplete: true,
  financeRequiredSourceComplete: true,
  sourceReconciled: true,
  latestSuccessfulSyncAt: "2026-08-15T00:00:00.000Z",
  financeCapturedAt: "2026-08-15T00:00:00.000Z",
  freshness: "FRESH" as const,
};

function adapters(overrides: Partial<DashboardOperationsAdapters> = {}): DashboardOperationsAdapters {
  return {
    listAdsPowerProfiles: async () => profiles,
    listShops: async () => shops,
    listEligibleShops: async () => shops,
    ensureAdsPowerReady: async () => undefined,
    openReady: async () => undefined,
    checkSellerCenterHealth: async () => ({
      status: "HEALTHY" as const,
      checkedAt: new Date(),
      detail: null,
    }),
    runSync: async (_profileNo, kind) => completeSync(kind),
    evaluateRisk: async () => completeDecisionCoverage,
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
  it("syncSelected invokes COTIK normal path and does not call AdsPower or Seller Center", async () => {
    const calls: string[] = [];
    const result = await createDashboardOperations(adapters({
      ensureAdsPowerReady: async () => { calls.push("ensureAdsPowerReady"); },
      openReady: async () => { calls.push("openReady"); },
      checkSellerCenterHealth: async () => {
        calls.push("checkSellerCenterHealth");
        return { status: "HEALTHY", checkedAt: new Date(), detail: null };
      },
      runSync: async (_profileNo, kind) => {
        calls.push(`runSync:${kind}`);
        return completeSync(kind);
      },
      syncCotik: async (profileNo) => {
        calls.push(`syncCotik:${profileNo}`);
        return {
          status: "SUCCEEDED",
          orders: { status: "SUCCEEDED", rowsWritten: 10 },
          finance: { status: "SUCCEEDED", rowsWritten: 3 },
        };
      },
    })).syncSelected(["957"]);

    expect(calls).toEqual(["syncCotik:957"]);
    expect(result).toEqual([{ profileNo: "957", status: "SUCCEEDED", error: null }]);
  });

  it("syncSelected fails closed when COTIK sync result is SKIPPED or fails and does not invoke AdsPower", async () => {
    const calls: string[] = [];
    const result = await createDashboardOperations(adapters({
      openReady: async () => { calls.push("openReady"); },
      runSync: async () => { calls.push("runSync"); return completeSync("orders"); },
      syncCotik: async (profileNo) => {
        calls.push(`syncCotik:${profileNo}`);
        return {
          status: "SKIPPED",
          skipReason: "COTIK_BINDING_INACTIVE",
          orders: null,
          finance: null,
        };
      },
    })).syncSelected(["957"]);

    expect(calls).toEqual(["syncCotik:957"]);
    expect(result).toEqual([
      { profileNo: "957", status: "FAILED", error: "COTIK synchronization skipped: COTIK_BINDING_INACTIVE" },
    ]);
  });

  it("syncAllEligible uses bound COTIK shops without calling AdsPower openReady or Seller Center runSync", async () => {
    const calls: string[] = [];
    const nonReadyAdsPowerShop: DashboardOperationsShop = {
      id: "shop-unverified-adspower",
      profileId: "internal-unverified",
      profileNo: "999",
      displayName: "Non Ready AdsPower Shop",
    };
    const result = await createDashboardOperations(adapters({
      listEligibleShops: async () => shops, // AdsPower READY only returns 957
      listCotikEligibleShops: async () => [nonReadyAdsPowerShop], // COTIK bound includes 999
      openReady: async () => { calls.push("openReady"); },
      runSync: async () => { calls.push("runSync"); return completeSync("orders"); },
      syncCotik: async (profileNo) => {
        calls.push(`syncCotik:${profileNo}`);
        return {
          status: "SUCCEEDED",
          orders: { status: "SUCCEEDED", rowsWritten: 5 },
          finance: { status: "SUCCEEDED", rowsWritten: 2 },
        };
      },
    })).syncAllEligible();

    expect(calls).toEqual(["syncCotik:999"]);
    expect(result).toEqual([{ profileNo: "999", status: "SUCCEEDED", error: null }]);
  });

  it("explicit updateData still runs the authoritative Seller Center path via AdsPower", async () => {
    const calls: string[] = [];
    const events = await collectUpdate(createDashboardOperations(adapters({
      listAdsPowerProfiles: async () => [
        { profileId: "internal-957", profileNo: "957", groupName: "Operators", tags: [], state: "OPEN" },
      ],
      ensureAdsPowerReady: async () => { calls.push("ensureAdsPowerReady"); },
      openReady: async () => { calls.push("openReady"); },
      checkSellerCenterHealth: async () => {
        calls.push("checkSellerCenterHealth");
        return { status: "HEALTHY", checkedAt: new Date(), detail: null };
      },
      runSync: async (_profileNo, kind) => {
        calls.push(`runSync:${kind}`);
        return completeSync(kind);
      },
      syncCotik: async () => {
        calls.push("syncCotik");
        return { status: "SUCCEEDED", orders: null, finance: null };
      },
    })));

    expect(calls).toEqual(["openReady", "checkSellerCenterHealth", "runSync:orders", "runSync:finance"]);
    expect(events.at(-1)).toMatchObject({ state: "SUCCESS" });
    expect(calls).not.toContain("syncCotik");
  });

  it("verifies only the explicitly selected profile", async () => {
    const verified: string[] = [];
    const result = await createDashboardOperations(adapters({
      verifyProfile: async (profile) => {
        verified.push(profile.profileNo);
        return { verificationState: "READY", shop: shops[0] ?? null };
      },
    })).verifyProfile("958");

    expect(verified).toEqual(["958"]);
    expect(result).toMatchObject({ ok: true, profileNo: "958", verificationState: "READY" });
  });

  it("runs selected profiles sequentially and continues after a failure", async () => {
    const calls: string[] = [];
    const result = await createDashboardOperations(adapters({
      syncCotik: async (profileNo) => {
        calls.push(`${profileNo}:cotik`);
        if (profileNo === "957" && calls.filter((call) => call === "957:cotik").length === 2) {
          throw new Error("COTIK sync failed");
        }
        return {
          status: "SUCCEEDED" as const,
          orders: { status: "SUCCEEDED" as const, rowsWritten: 5 },
          finance: { status: "SUCCEEDED" as const, rowsWritten: 2 },
        };
      },
    })).syncSelected(["957", "957", "957"]);

    expect(calls).toEqual(["957:cotik", "957:cotik", "957:cotik"]);
    expect(result).toEqual([
      { profileNo: "957", status: "SUCCEEDED", error: null },
      { profileNo: "957", status: "FAILED", error: "COTIK sync failed" },
      { profileNo: "957", status: "SUCCEEDED", error: null },
    ]);
  });

  it("reuses the selected sync inventory instead of immediately re-querying AdsPower", async () => {
    let inventoryReads = 0;
    const result = await createDashboardOperations(adapters({
      listAdsPowerProfiles: async () => {
        inventoryReads += 1;
        return profiles;
      },
    })).syncSelected(["957"]);

    expect(result).toEqual([{ profileNo: "957", status: "SUCCEEDED", error: null }]);
    expect(inventoryReads).toBe(1);
  });

  it("bootstraps an unlinked selected profile through VERIFY before its first sync", async () => {
    const calls: string[] = [];
    let verified = false;
    const selectedShop: DashboardOperationsShop = {
      id: "shop-958",
      profileId: "internal-958",
      profileNo: "958",
      displayName: "Tool TTS Shop 958",
    };
    const result = await createDashboardOperations(adapters({
      listShops: async () => verified ? [...shops, selectedShop] : shops,
      listEligibleShops: async () => verified ? [...shops, selectedShop] : shops,
      verifyProfile: async (profile) => {
        calls.push(`verify:${profile.profileNo}`);
        verified = true;
        return { verificationState: "READY", shop: selectedShop };
      },
      openReady: async () => { calls.push("open"); },
      checkSellerCenterHealth: async () => {
        calls.push("health");
        return { status: "HEALTHY", checkedAt: new Date(), detail: null };
      },
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return completeSync(kind);
      },
      evaluateRisk: async () => { calls.push("risk"); return completeDecisionCoverage; },
    })).syncSelected(["958"]);

    expect(calls).toEqual(["verify:958", "open", "health", "orders", "finance", "risk"]);
    expect(result).toEqual([{ profileNo: "958", status: "SUCCEEDED", error: null }]);
  });

  it("syncs only dynamically discovered eligible profiles", async () => {
    const synced: string[] = [];
    const result = await createDashboardOperations(adapters({
      listEligibleShops: async () => shops,
      runSync: async (profileNo, kind) => { if (kind === "orders") synced.push(profileNo); return completeSync(kind); },
    })).syncAllEligible();

    expect(synced).toEqual(["957"]);
    expect(result).toEqual([
      { profileNo: "957", status: "SUCCEEDED", error: null },
    ]);
  });

  it("fails closed when the canonical eligible-shop query is unavailable", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      listEligibleShops: async () => { throw new Error("private database detail"); },
    })));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      state: "ERROR",
      terminal: true,
      error: { code: "DATABASE_UNAVAILABLE" },
    });
    expect(JSON.stringify(events)).not.toContain("private database detail");
  });

  it.each([
    ["unverified", []],
    ["disabled shop", []],
    ["paused shop", []],
    ["ineligible shop", []],
  ] as const)("rejects Update Data when the canonical query excludes a %s", async (_label, eligibleShops) => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      listEligibleShops: async () => eligibleShops,
    })));

    expect(events.at(-1)).toMatchObject({
      state: "ERROR",
      terminal: true,
      error: { code: "PROFILE_NOT_ELIGIBLE" },
    });
  });

  it("revalidates each selected profile against dynamic inventory and isolates failures", async () => {
    const eligibleByCall = [shops, [], shops];
    const synced: string[] = [];
    const result = await createDashboardOperations(adapters({
      listAdsPowerProfiles: async () => profiles,
      listShops: async () => [...shops, {
        id: "shop-958", profileId: "internal-958", profileNo: "958", displayName: "Tool TTS Shop 958",
      }],
      listEligibleShops: async () => eligibleByCall.shift() ?? [],
      runSync: async (profileNo, kind) => {
        if (kind === "orders") synced.push(profileNo);
        return completeSync(kind);
      },
    })).syncSelected(["957", "958", "957"]);

    expect(synced).toEqual(["957", "957"]);
    expect(result).toEqual([
      { profileNo: "957", status: "SUCCEEDED", error: null },
      { profileNo: "958", status: "FAILED", error: "The selected profile is not READY and ELIGIBLE." },
      { profileNo: "957", status: "SUCCEEDED", error: null },
    ]);
  });

  it("serializes update and batch operations through one global guard", async () => {
    let active = 0;
    let maximumActive = 0;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { release = resolve; });
    const operations = createDashboardOperations(adapters({
      listEligibleShops: async () => shops,
      openReady: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await started;
        active -= 1;
      },
    }));
    const first = operations.updateData("957", () => undefined);
    const second = operations.syncSelected(["957"]);
    const third = operations.syncAllEligible();
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(maximumActive).toBe(1);
    release?.();
    await Promise.all([first, second, third]);
    expect(maximumActive).toBe(1);
  });

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
        return completeSync(kind);
      },
      evaluateRisk: async () => { calls.push("risk"); return completeDecisionCoverage; },
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

  it("reuses an open profile without a redundant application readiness probe", async () => {
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
      listEligibleShops: async () => [shop],
      ensureAdsPowerReady: async () => {
        throw new SellerCenterError("ADSPOWER_UNAVAILABLE", "private readiness request detail");
      },
      openReady: async () => { calls.push("open"); },
      checkSellerCenterHealth: async () => {
        calls.push("health");
        return { status: "HEALTHY", checkedAt: new Date(), detail: null };
      },
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return completeSync(kind);
      },
      evaluateRisk: async () => { calls.push("risk"); return completeDecisionCoverage; },
    })), "958");

    expect(calls).toEqual(["open", "health", "orders", "finance", "risk"]);
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

  it("maps structurally typed sync failures across the server bundle boundary", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async () => { throw { failureType: "LOGIN_REQUIRED" }; },
    })));

    expect(events.at(-1)).toMatchObject({
      state: "HUMAN_ACTION_REQUIRED",
      error: { code: "LOGIN_REQUIRED" },
    });
  });

  it("preserves completed orders when finance encounters a layout change", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        if (kind === "finance") throw new SellerCenterError("LAYOUT_CHANGED", "private selector detail");
        return completeSync(kind);
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
            completeWithinSourceWindow: false,
            lifetimeHistoryComplete: false as const,
          },
        };
      },
      evaluateRisk: async () => { calls.push("risk"); return completeDecisionCoverage; },
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

  it("requires typed source-window coverage before accepting a complete orders sync", async () => {
    const calls: string[] = [];
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return { status: "SUCCEEDED", complete: true };
      },
      evaluateRisk: async () => { calls.push("risk"); return completeDecisionCoverage; },
    })));

    expect(calls).toEqual(["orders"]);
    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: [],
      error: { code: "SYNC_PARTIAL" },
    });
  });

  it("does not reconcile risk when finance sync is incomplete", async () => {
    const calls: string[] = [];
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return kind === "orders" ? completeSync(kind) : { status: "SUCCEEDED", complete: false };
      },
      evaluateRisk: async () => { calls.push("risk"); return completeDecisionCoverage; },
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

  it("requires official captured and reconciled Finance evidence before success", async () => {
    const calls: string[] = [];
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        calls.push(kind);
        return kind === "orders" ? completeSync(kind) : { status: "SUCCEEDED", complete: true };
      },
      evaluateRisk: async () => { calls.push("risk"); return completeDecisionCoverage; },
    })));

    expect(calls).toEqual(["orders", "finance"]);
    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: ["orders"],
      error: { code: "SYNC_PARTIAL" },
    });
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

  it("presents an API schema change as a paused Seller Center source contract", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      runSync: async (_profileNo, kind) => {
        if (kind === "finance") throw new SellerCenterError("API_SCHEMA_CHANGED", "private upstream detail");
        return completeSync(kind);
      },
    })));

    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: ["orders"],
      error: { code: "LAYOUT_CHANGED" },
    });
  });

  it("warns when the selected profile proxy times out before any data sync", async () => {
    let syncCalls = 0;
    const events = await collectUpdate(createDashboardOperations(adapters({
      checkSellerCenterHealth: async () => ({
        status: "PROXY_TIMEOUT",
        checkedAt: new Date(),
        detail: "private-proxy.example:8080",
      }),
      runSync: async () => {
        syncCalls += 1;
        return completeSync("orders");
      },
    })));

    expect(syncCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      state: "ERROR",
      terminal: true,
      error: { code: "PROFILE_PROXY_TIMEOUT" },
      message: "The selected profile proxy did not respond. Check the profile proxy and retry.",
    });
    expect(JSON.stringify(events)).not.toContain("private-proxy.example");
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
      listEligibleShops: async () => [shop],
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

  it("requires persisted Decision Case coverage before reporting success", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      evaluateRisk: async () => ({
        ...completeDecisionCoverage,
        coverageState: "PARTIAL",
        sourceReconciled: false,
      }),
    })));

    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: ["orders", "finance"],
      error: { code: "SYNC_PARTIAL" },
    });
  });

  it("treats historical Decision Cases without coverage as partial", async () => {
    const events = await collectUpdate(createDashboardOperations(adapters({
      evaluateRisk: async () => undefined,
    })));

    expect(events.at(-1)).toMatchObject({
      state: "PARTIAL",
      terminal: true,
      completedKinds: ["orders", "finance"],
      error: { code: "SYNC_PARTIAL" },
    });
  });

  it.each([
    [new SellerCenterError("ADSPOWER_UNAVAILABLE", "private API detail"), "ADSPOWER_UNAVAILABLE"],
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

  it("maps structurally typed CDP failures across the server bundle boundary", async () => {
    const result = await createDashboardOperations(adapters({
      openReady: async () => { throw { failureType: "BROWSER_DISCONNECTED" }; },
    })).openProfile("957");

    expect(result).toMatchObject({ ok: false, error: { code: "PROFILE_NOT_READY" } });
  });
});
