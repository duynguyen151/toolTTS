import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  CaptureSellerCenterNetworkInventoryOptions,
  NetworkInventoryReport,
} from "@shop-health/seller-center";

import type { CliRuntime } from "../runtime.js";
import { registerSyncExecutionCommands } from "./sync.js";

const mocks = vi.hoisted(() => ({
  findShopByProfileNo: vi.fn(),
  runShopSync: vi.fn(),
}));

vi.mock("@shop-health/db", () => ({
  findShopByProfileNo: mocks.findShopByProfileNo,
  requestShopSync: vi.fn(),
}));

vi.mock("@shop-health/seller-center", () => ({
  captureSellerCenterNetworkInventory: vi.fn(),
  createSellerCenterDataSource: vi.fn(),
}));

vi.mock("@shop-health/sync", () => ({ runShopSync: mocks.runShopSync }));

vi.mock("../db-runtime.js", () => ({
  withDatabase: async (_runtime: unknown, operation: (context: { db: object }) => Promise<unknown>) =>
    operation({ db: {} }),
}));

const runtime = {
  config: {
    DATABASE_URL: "postgres://test",
    ADSPOWER_BASE_URL: "http://127.0.0.1:50325",
    ADSPOWER_API_KEY: "test-api-key",
    DISPLAY_TIME_ZONE: "Asia/Bangkok",
    LOG_LEVEL: "silent",
  },
  logger: {},
} as unknown as CliRuntime;

const liveShop = {
  id: "shop-957",
  profileId: "adspower-profile-957",
  profileNo: "957",
  region: "US",
  locale: "en-US",
  dataOrigin: "LIVE",
};

const report: NetworkInventoryReport = {
  profileId: "adspower-profile-957",
  startedAt: new Date("2026-08-14T08:00:00.000Z"),
  finishedAt: new Date("2026-08-14T08:00:12.000Z"),
  durationMs: 12_000,
  pageUrls: ["https://seller-us.tiktok.com/order"],
  entries: [{
    method: "GET",
    host: "seller-us.tiktok.com",
    path: "/api/fulfillment/na/order/list",
    status: 200,
    contentType: "application/json",
    topLevelKeys: ["code", "data"],
    arrays: [{ path: "data.main_orders", count: 23 }],
    pagination: [{ path: "data.next_cursor", value: "PRESENT(length=32)" }],
    observations: 2,
  }],
};

type Capture = (
  config: {
    shopId: string;
    profileId: string;
    profileNo: string;
    region: "US";
    locale: "en-US";
  },
  options?: CaptureSellerCenterNetworkInventoryOptions,
) => Promise<NetworkInventoryReport>;

async function run(
  capture: Capture,
  args: string[],
): Promise<string> {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
  program.command("sync");
  let output = "";
  registerSyncExecutionCommands(program, runtime, {
    captureNetworkInventory: capture,
    write: (value) => { output += value; },
  });
  await program.parseAsync(["node", "shop-health", ...args]);
  return output;
}

describe("sync discover command", () => {
  beforeEach(() => {
    mocks.findShopByProfileNo.mockReset();
    mocks.findShopByProfileNo.mockResolvedValue(liveShop);
    mocks.runShopSync.mockReset();
  });

  test("emits one stable JSON report without ready prompts", async () => {
    const capture = vi.fn<Capture>(async (_config, options) => {
      options?.onReady?.({
        pageUrls: ["https://seller-us.tiktok.com/order?token=secret#private"],
      });
      return report;
    });

    const output = await run(capture, [
      "sync", "discover", "957", "--duration", "12", "--json",
    ]);

    expect(capture).toHaveBeenCalledWith({
      shopId: "shop-957",
      profileId: "adspower-profile-957",
      profileNo: "957",
      region: "US",
      locale: "en-US",
    }, expect.objectContaining({
      durationMs: 12_000,
      baseUrl: "http://127.0.0.1:50325",
      apiKey: "test-api-key",
      onReady: expect.any(Function),
    }));
    expect(output).not.toContain("CAPTURE READY");
    expect(JSON.parse(output)).toEqual({
      schemaVersion: "seller-network-inventory.v1",
      profileNo: "957",
      ...JSON.parse(JSON.stringify(report)),
    });
  });

  test("uses the bounded 60 second default duration", async () => {
    const capture = vi.fn<Capture>(async () => report);

    await run(capture, ["sync", "discover", "957", "--json"]);

    expect(capture).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ durationMs: 60_000 }),
    );
  });

  test("prints sanitized ready URLs and a privacy-safe human inventory", async () => {
    const capture = vi.fn<Capture>(async (_config, options) => {
      options?.onReady?.({
        pageUrls: [
          "https://seller-us.tiktok.com/order?token=secret#private",
          "not-a-url",
        ],
      });
      return report;
    });

    const output = await run(capture, [
      "sync", "discover", "957", "--duration", "12",
    ]);

    expect(output).toContain("CAPTURE READY");
    expect(output).toContain("https://seller-us.tiktok.com/order");
    expect(output).not.toContain("token=secret");
    expect(output).not.toContain("#private");
    expect(output).not.toContain("not-a-url");
    expect(output).toContain("Keep the existing Seller Center pages open");
    expect(output).toContain("/api/fulfillment/na/order/list");
    expect(output).toContain("PRESENT(length=32)");
  });

  test.each(["4", "301", "10.5", "invalid"])(
    "rejects invalid duration %s before capture",
    async (duration) => {
      const capture = vi.fn<Capture>(async () => report);

      await expect(run(capture, [
        "sync", "discover", "957", "--duration", duration, "--json",
      ])).rejects.toThrow("duration");
      expect(capture).not.toHaveBeenCalled();
    },
  );

  test("rejects sanitized DEMO shops before capture", async () => {
    mocks.findShopByProfileNo.mockResolvedValue({
      ...liveShop,
      dataOrigin: "DEMO_SANITIZED",
    });
    const capture = vi.fn<Capture>(async () => report);

    await expect(run(capture, [
      "sync", "discover", "957", "--json",
    ])).rejects.toThrow("LIVE");
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("sync orders coverage output", () => {
  beforeEach(() => {
    mocks.findShopByProfileNo.mockReset();
    mocks.findShopByProfileNo.mockResolvedValue(liveShop);
    mocks.runShopSync.mockReset();
    mocks.runShopSync.mockResolvedValue(orderSyncResult());
  });

  test("JSON identifies completion as bounded to the rolling 12-month source window", async () => {
    const output = await captureStdout(() => run(vi.fn<Capture>(), [
      "sync", "orders", "957", "--json",
    ]));

    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: "sync-result.v1",
      profileNo: "957",
      kind: "orders",
      complete: true,
      sourceCoverage: {
        source: "SELLER_CENTER",
        window: "ROLLING_12_MONTHS",
        completeWithinWindow: true,
        lifetimeHistoryComplete: false,
      },
    });
  });

  test("human output avoids a lifetime-history completeness claim", async () => {
    const output = await captureStdout(() => run(vi.fn<Capture>(), [
      "sync", "orders", "957",
    ]));

    expect(output).toContain("Source window");
    expect(output).toContain("rolling 12 months");
    expect(output).toContain("Complete within source window");
    expect(output).toContain("Lifetime history complete");
    expect(output).toContain("false");
  });
});

async function captureStdout(operation: () => Promise<unknown>): Promise<string> {
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    await operation();
    return output;
  } finally {
    write.mockRestore();
  }
}

function orderSyncResult() {
  return {
    status: "SUCCEEDED" as const,
    syncRunId: "run-1",
    rowsRead: 9,
    rowsWritten: 9,
    checkpoint: null,
    complete: true,
    sourceCoverage: {
      source: "SELLER_CENTER" as const,
      window: "ROLLING_12_MONTHS" as const,
      completeWithinWindow: true,
      lifetimeHistoryComplete: false as const,
    },
  };
}
