import { describe, expect, it, vi } from "vitest";

import { AdsPowerClient } from "@shop-health/seller-center/adspower";
import { SellerCenterError } from "@shop-health/seller-center/errors";

import { createDashboardOperationsRuntime } from "./runtime.js";

const runtimeMocks = vi.hoisted(() => ({
  closeDatabase: vi.fn(),
  createDatabase: vi.fn(),
  createSellerCenterDataSource: vi.fn(),
  findShopByProfileNo: vi.fn(),
  listShops: vi.fn(),
  runShopSync: vi.fn(),
  verifyAdsPowerBrowserConnection: vi.fn(),
}));

vi.mock("@shop-health/db", () => runtimeMocks);
vi.mock("@shop-health/seller-center/browser-source", () => ({
  createSellerCenterDataSource: runtimeMocks.createSellerCenterDataSource,
  verifyAdsPowerBrowserConnection: runtimeMocks.verifyAdsPowerBrowserConnection,
}));
vi.mock("@shop-health/sync", () => ({ runShopSync: runtimeMocks.runShopSync }));

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
        completeWithinWindow: false,
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
    expect(events.at(-1)).toMatchObject({ state: "PARTIAL", completedKinds: [] });
  });
});
