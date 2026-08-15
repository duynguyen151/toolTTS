import { afterEach, describe, expect, it, vi } from "vitest";

import { AdsPowerClient } from "@shop-health/seller-center/adspower";
import { SellerCenterError } from "@shop-health/seller-center/errors";

import { createAdsPowerApplicationLauncher } from "./application-launch.js";
import { createDashboardOperationsRuntime } from "./runtime.js";

const runtimeMocks = vi.hoisted(() => ({
  closeDatabase: vi.fn(),
  createBaselineAiClientFromConfig: vi.fn(),
  createPersistedDecisionWorkflow: vi.fn(),
  createDatabase: vi.fn(),
  createSellerCenterDataSource: vi.fn(),
  evaluateAndStoreRiskControl: vi.fn(),
  findShopByProfileNo: vi.fn(),
  listShops: vi.fn(),
  runShopSync: vi.fn(),
  readBaselineAiConfig: vi.fn(),
  verifyAdsPowerBrowserConnection: vi.fn(),
}));

vi.mock("@shop-health/db", () => runtimeMocks);
vi.mock("@shop-health/seller-center/browser-source", () => ({
  createSellerCenterDataSource: runtimeMocks.createSellerCenterDataSource,
  verifyAdsPowerBrowserConnection: runtimeMocks.verifyAdsPowerBrowserConnection,
}));
vi.mock("@shop-health/sync", () => ({
  evaluateAndStoreRiskControl: runtimeMocks.evaluateAndStoreRiskControl,
  runShopSync: runtimeMocks.runShopSync,
}));
vi.mock("@shop-health/decision-ai", () => ({
  createBaselineAiClientFromConfig: runtimeMocks.createBaselineAiClientFromConfig,
  readBaselineAiConfig: runtimeMocks.readBaselineAiConfig,
}));
vi.mock("@shop-health/decision-workflow", () => ({
  createPersistedDecisionWorkflow: runtimeMocks.createPersistedDecisionWorkflow,
}));

afterEach(() => {
  vi.clearAllMocks();
});

const unusedSource = {
  health: async () => ({ status: "UNAVAILABLE" as const, checkedAt: new Date(), detail: "unused" }),
  probe: async () => ({ value: "unused", capturedAt: new Date() }),
  async *collectOrders() {},
  async *collectFinancials() {},
};

const healthySource = {
  ...unusedSource,
  health: async () => ({ status: "HEALTHY" as const, checkedAt: new Date(), detail: null }),
};

function adsPowerClient(state: "OPEN" | "CLOSED"): AdsPowerClient {
  return new AdsPowerClient({
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      return new Response(JSON.stringify(path.endsWith("/user/list")
        ? {
            code: 0,
            data: {
              list: [{
                user_id: "internal-profile-id",
                serial_number: "957",
                group_name: null,
              }],
            },
          }
        : path.endsWith("/browser/active") && state === "OPEN"
          ? {
              code: 0,
              data: { status: "Active", ws: { puppeteer: "ws://private-test" } },
            }
          : {
            code: 0,
            data: {
              list: state === "OPEN" ? [{ user_id: "internal-profile-id" }] : [],
            },
          }));
    },
  });
}

describe("createDashboardOperationsRuntime", () => {
  it("launches AdsPower, opens the exact closed profile, and completes a safe live update without leaking server data", async () => {
    const calls: string[] = [];
    let applicationReady = false;
    let profileStarted = false;
    const adsPower = new AdsPowerClient({
      apiKey: "private-api-key",
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/status") {
          calls.push(applicationReady ? "application-ready" : "application-not-ready");
          return new Response(JSON.stringify({ code: applicationReady ? 0 : 1 }));
        }
        if (path === "/api/v1/user/list") {
          calls.push("list-profiles");
          return new Response(JSON.stringify({
            code: 0,
            data: { list: [{ user_id: "internal-profile-id", serial_number: "957", group_name: null }] },
          }));
        }
        if (path === "/api/v1/browser/local-active") {
          calls.push("list-active-profiles");
          return new Response(JSON.stringify({ code: 0, data: { list: [] } }));
        }
        if (path === "/api/v1/browser/active") {
          calls.push(profileStarted ? "profile-cdp-ready" : "profile-closed");
          return new Response(JSON.stringify(profileStarted
            ? { code: 0, data: { status: "Active", ws: { puppeteer: "ws://private-cdp" } } }
            : { code: 0, data: { status: "Inactive" } }));
        }
        if (path === "/api/v1/browser/start") {
          calls.push("start-exact-profile");
          profileStarted = true;
          return new Response(JSON.stringify({ code: 0, data: { status: "Starting" } }));
        }
        throw new Error(`Unexpected AdsPower path: ${path}`);
      },
    });
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: () => adsPower.probeReadiness(),
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 100,
      pollIntervalMs: 0,
      launch: async () => {
        calls.push("launch-application");
        applicationReady = true;
      },
    });
    const linkedShop = {
      id: "shop-957",
      profileId: "internal-profile-id",
      profileNo: "957",
      displayName: "Tool TTS Shop",
    };
    runtimeMocks.createDatabase.mockReturnValue({ db: {} });
    runtimeMocks.closeDatabase.mockResolvedValue(undefined);
    runtimeMocks.listShops.mockResolvedValue([linkedShop]);
    runtimeMocks.findShopByProfileNo.mockResolvedValue(linkedShop);
    runtimeMocks.runShopSync.mockImplementation(async (_input: unknown) => {
      const kind = calls.includes("orders-sync") ? "finance" : "orders";
      calls.push(kind === "orders" ? "orders-sync" : "finance-sync");
      return kind === "orders"
        ? {
            status: "SUCCEEDED",
            complete: true,
            sourceCoverage: {
              source: "SELLER_CENTER",
              window: "ROLLING_12_MONTHS",
              completeWithinSourceWindow: true,
              lifetimeHistoryComplete: false,
            },
          }
        : {
            status: "SUCCEEDED",
            complete: true,
            financeProof: {
              capturedAt: new Date("2026-08-15T00:00:00.000Z"),
              officialOnHoldAmount: "1200.0000",
              reasonTotalsReconcileToOfficialOnHold: true,
            },
          };
    });
    runtimeMocks.evaluateAndStoreRiskControl.mockImplementation(async () => { calls.push("reconcile-risk"); });
    runtimeMocks.readBaselineAiConfig.mockReturnValue({ provider: "9router" });
    runtimeMocks.createBaselineAiClientFromConfig.mockReturnValue("baseline-ai-client");
    runtimeMocks.createPersistedDecisionWorkflow.mockReturnValue({
      startReview: async () => {
        calls.push("persist-decision-case-and-ai");
        return {
          coverageSnapshot: {
            coverageState: "COMPLETE",
            persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
            source: "SELLER_CENTER",
            provenSourceWindow: "ROLLING_12_MONTHS",
            completeWithinSourceWindow: true,
            lifetimeHistoryComplete: false,
            ordersSourceComplete: true,
            financeRequiredSourceComplete: true,
            sourceReconciled: true,
            latestSuccessfulSyncAt: "2026-08-15T00:00:00.000Z",
            financeCapturedAt: "2026-08-15T00:00:00.000Z",
            freshness: "FRESH",
          },
        };
      },
    });
    const events: Array<{ state: string; completedKinds: readonly string[] }> = [];
    const operations = createDashboardOperationsRuntime({
      environment: { DATABASE_URL: "postgres://dashboard-test" },
      adsPower,
      applicationLauncher: launcher,
      source: {
        ...healthySource,
        health: async () => {
          calls.push("authenticated-health");
          return { status: "HEALTHY" as const, checkedAt: new Date(), detail: null };
        },
      },
      verifyCdpConnection: async () => { calls.push("verify-cdp"); },
    });
    await operations.updateData("957", (event) => { events.push(event); });

    expect(calls).toEqual([
      "application-not-ready",
      "launch-application",
      "application-ready",
      "list-profiles",
      "list-active-profiles",
      "profile-closed",
      "start-exact-profile",
      "profile-cdp-ready",
      "verify-cdp",
      "authenticated-health",
      "orders-sync",
      "finance-sync",
      "reconcile-risk",
      "persist-decision-case-and-ai",
    ]);
    expect(events.map((event) => event.state)).toEqual([
      "OPENING_PROFILE",
      "CONNECTING",
      "SYNCING_ORDERS",
      "SYNCING_FINANCE",
      "RECONCILING",
      "SUCCESS",
    ]);
    expect(events.at(-1)).toMatchObject({
      completedKinds: ["orders", "finance"],
      terminal: true,
      error: null,
    });
    expect(JSON.stringify(events)).not.toMatch(/internal-profile-id|private-cdp|private-api-key/i);
  });

  it.each(["OPEN", "CLOSED"] as const)("verifies %s profile CDP before reporting Open Profile success", async (state) => {
    const openReady = vi.fn().mockResolvedValue({
      profileId: "internal-profile-id",
      status: "Active",
      cdpEndpoint: "ws://private-test",
    });
    const verifyCdpConnection = vi.fn().mockRejectedValue(new SellerCenterError(
      "BROWSER_DISCONNECTED",
      "private stale endpoint",
    ));
    const operations = createDashboardOperationsRuntime({
      environment: {},
      applicationLauncher: { ensureReady: async () => undefined },
      adsPower: {
        listProfiles: async () => [{
          profileId: "internal-profile-id",
          profileNo: "957",
          groupName: null,
          state,
        }],
        openReady,
      } as never,
      verifyCdpConnection,
    });

    await expect(operations.openProfile("957")).resolves.toMatchObject({
      ok: false,
      error: { code: state === "OPEN" ? "CDP_UNAVAILABLE" : "PROFILE_NOT_READY" },
    });
    expect(openReady).toHaveBeenCalledWith("internal-profile-id");
    expect(verifyCdpConnection).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "internal-profile-id",
    }));
  });

  it("keeps AdsPower profiles available with unknown links when DATABASE_URL is absent", async () => {
    const operations = createDashboardOperationsRuntime({
      environment: {},
      adsPower: adsPowerClient("CLOSED"),
      source: unusedSource,
    });

    const presentation = await operations.listProfiles("957");

    expect(presentation).toMatchObject({
      status: "READY",
      selectedProfileNo: "957",
      profiles: [{ profileNo: "957", linkState: "UNKNOWN" }],
      error: { code: "DATABASE_UNAVAILABLE" },
    });
    expect(JSON.stringify(presentation)).not.toMatch(/internal-profile-id|server-only/);
  });

  it("uses the injected AdsPower client for the default Seller Center source", async () => {
    const injected = adsPowerClient("OPEN");

    const operations = createDashboardOperationsRuntime({
      environment: {},
      adsPower: injected,
    });

    const presentation = await operations.listProfiles("957");

    expect(presentation.profiles).toEqual([{
      profileNo: "957",
      state: "OPEN",
      linkState: "UNKNOWN",
      linkedShop: null,
    }]);
  });

  it("passes the injected AdsPower client to the default source and preserves incomplete sync results", async () => {
    const injected = adsPowerClient("OPEN");
    const linkedShop = {
      id: "shop-957",
      profileId: "internal-profile-id",
      profileNo: "957",
      displayName: "Tool TTS Shop",
    };
    const source = healthySource;
    runtimeMocks.createDatabase.mockReturnValue({ db: {} });
    runtimeMocks.closeDatabase.mockResolvedValue(undefined);
    runtimeMocks.findShopByProfileNo.mockResolvedValue(linkedShop);
    runtimeMocks.listShops.mockResolvedValue([linkedShop]);
    runtimeMocks.createSellerCenterDataSource.mockImplementation((options: { adsPowerClient: AdsPowerClient }) => {
      expect(options.adsPowerClient).toBe(injected);
      return source;
    });
    runtimeMocks.runShopSync.mockResolvedValue({
      status: "SUCCEEDED",
      complete: false,
      sourceCoverage: {
        source: "SELLER_CENTER",
        window: "ROLLING_12_MONTHS",
        completeWithinSourceWindow: false,
        lifetimeHistoryComplete: false,
      },
    });

    const operations = createDashboardOperationsRuntime({
      environment: { DATABASE_URL: "postgres://dashboard-test" },
      adsPower: injected,
      applicationLauncher: { ensureReady: async () => undefined },
    });
    const events: Array<{ state: string; completedKinds: readonly string[] }> = [];

    await operations.updateData("957", (event) => {
      events.push({ state: event.state, completedKinds: event.completedKinds });
    });

    expect(runtimeMocks.createSellerCenterDataSource).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.verifyAdsPowerBrowserConnection).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "internal-profile-id",
      cdpEndpoint: "ws://private-test",
    }));
    expect(runtimeMocks.runShopSync).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.createPersistedDecisionWorkflow).not.toHaveBeenCalled();
    expect(runtimeMocks.createBaselineAiClientFromConfig).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ state: "PARTIAL", completedKinds: [] });
  });
});
