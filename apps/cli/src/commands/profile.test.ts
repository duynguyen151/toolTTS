import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  openReady: vi.fn(),
  verifySelectedProfile: vi.fn(),
  listAdsPowerProfiles: vi.fn(),
  listReadyAdsPowerProfileShops: vi.fn(),
}));

vi.mock("@shop-health/db", () => ({
  getAdsPowerProfile: vi.fn(),
  listAdsPowerProfiles: mocks.listAdsPowerProfiles,
  listReadyAdsPowerProfileShops: mocks.listReadyAdsPowerProfileShops,
}));

vi.mock("@shop-health/seller-center", () => ({
  AdsPowerClient: class {
    listProfiles = mocks.listProfiles;
    openReady = mocks.openReady;
  },
  SellerCenterBrowserDataSource: class {},
}));

vi.mock("@shop-health/sync", () => ({
  runSequentialProfileQueue: vi.fn(),
  runShopSync: vi.fn(),
  verifySelectedProfile: mocks.verifySelectedProfile,
}));

vi.mock("../db-runtime.js", () => ({
  withDatabase: async (_runtime: unknown, operation: (context: { db: object }) => Promise<unknown>) => operation({ db: {} }),
}));

import { registerProfileCommands } from "./profile.js";

const runtime = {
  config: { ADSPOWER_BASE_URL: "http://127.0.0.1:50325", LOG_LEVEL: "silent" },
  logger: {},
} as never;

async function run(args: string[]): Promise<string> {
  const program = new Command().exitOverride();
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    registerProfileCommands(program, runtime);
    await program.parseAsync(["node", "shop-health", ...args]);
    return output;
  } finally {
    write.mockRestore();
  }
}

describe("profile commands", () => {
  beforeEach(() => {
    mocks.listProfiles.mockReset();
    mocks.openReady.mockReset();
    mocks.verifySelectedProfile.mockReset();
    mocks.listAdsPowerProfiles.mockReset();
    mocks.listReadyAdsPowerProfileShops.mockReset();
  });

  it("lists AdsPower profiles without verifying Seller Center sessions", async () => {
    mocks.listProfiles.mockResolvedValue([{ profileId: "p-101", profileNo: "101", groupName: null, state: "CLOSED" }]);
    mocks.listAdsPowerProfiles.mockResolvedValue([]);

    const output = await run(["profile", "list", "--json"]);

    expect(JSON.parse(output)).toMatchObject({ profiles: [{ profileNo: "101", verificationState: "UNVERIFIED" }] });
    expect(mocks.openReady).not.toHaveBeenCalled();
    expect(mocks.verifySelectedProfile).not.toHaveBeenCalled();
  });

  it("verifies only the explicitly selected arbitrary profile", async () => {
    mocks.listProfiles.mockResolvedValue([
      { profileId: "p-101", profileNo: "101", groupName: null, state: "CLOSED" },
      { profileId: "p-202", profileNo: "202", groupName: null, state: "OPEN" },
    ]);
    mocks.verifySelectedProfile.mockResolvedValue({ profileNo: "202", verificationState: "READY", shop: { id: "shop-202" } });

    const output = await run(["profile", "verify", "202", "--json"]);

    expect(mocks.verifySelectedProfile).toHaveBeenCalledWith({}, expect.objectContaining({ profileId: "p-202", profileNo: "202" }), expect.anything());
    expect(JSON.parse(output)).toMatchObject({ profileNo: "202", verificationState: "READY" });
  });
});
