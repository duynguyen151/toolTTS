import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findShopByProfileNo: vi.fn(),
  upsertShopProviderBinding: vi.fn(),
  findEnabledShopProviderBinding: vi.fn(),
  disableShopProviderBinding: vi.fn(),
  createCotikClient: vi.fn(),
  cotikGet: vi.fn(),
}));

vi.mock("@shop-health/db", () => ({
  createShop: vi.fn(),
  findShopByProfileNo: mocks.findShopByProfileNo,
  listShops: vi.fn(),
  setShopSyncState: vi.fn(),
  upsertShopProviderBinding: mocks.upsertShopProviderBinding,
  findEnabledShopProviderBinding: mocks.findEnabledShopProviderBinding,
  disableShopProviderBinding: mocks.disableShopProviderBinding,
}));

vi.mock("@shop-health/cotik", () => ({
  createCotikClient: mocks.createCotikClient,
}));

vi.mock("../db-runtime.js", () => ({
  withDatabase: async (_runtime: unknown, operation: (context: { db: object }) => Promise<unknown>) =>
    operation({ db: {} }),
}));

import { registerShopCommands } from "./shop.js";

const candidates = [
  { _id: "cotik-shop-1", name: "My Shop", code: "SHOP01" },
  { _id: "cotik-shop-2", name: "Other Shop", code: "SHOP02" },
];

const canonicalShop = {
  id: "11111111-1111-1111-1111-111111111111",
  profileId: "adspower-profile-957",
  profileNo: "957",
};

const enabledBinding = {
  shopId: canonicalShop.id,
  provider: "COTIK",
  providerShopId: "cotik-shop-1",
  enabled: true,
};

function runtimeWith(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      DATABASE_URL: "postgres://test",
      COTIK_TOKEN: "test-cotik-token",
      LOG_LEVEL: "silent",
      ...overrides,
    },
    logger: {},
  } as never;
}

let runtime: ReturnType<typeof runtimeWith>;

async function run(args: string[]): Promise<string> {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    registerShopCommands(program, runtime);
    await program.parseAsync(["node", "shop-health", ...args]);
    return output;
  } finally {
    write.mockRestore();
  }
}

describe("shop cotik commands", () => {
  beforeEach(() => {
    runtime = runtimeWith();
    mocks.findShopByProfileNo.mockReset().mockResolvedValue(canonicalShop);
    mocks.upsertShopProviderBinding.mockReset();
    mocks.findEnabledShopProviderBinding.mockReset().mockResolvedValue(enabledBinding);
    mocks.disableShopProviderBinding.mockReset();
    mocks.createCotikClient.mockReset().mockReturnValue({ get: mocks.cotikGet });
    mocks.cotikGet.mockReset().mockResolvedValue({ list_shop: candidates.map((candidate) => ({ ...candidate })) });
  });

  describe("list", () => {
    it("projects fetched candidates onto exactly id, name, and code", async () => {
      // Honor the real client contract: get(path, schema) validates through the supplied schema.
      mocks.cotikGet.mockImplementation(async (_path: string, schema: { parse: (value: unknown) => unknown }) =>
        schema.parse({
          list_shop: [{ _id: "cotik-shop-1", name: "My Shop", code: "SHOP01", internalFlag: "drop-me" }],
        }),
      );

      const output = await run(["shop", "cotik", "list", "--json"]);

      expect(JSON.parse(output)).toEqual({
        schemaVersion: "cotik-shop-list.v1",
        shops: [{ _id: "cotik-shop-1", name: "My Shop", code: "SHOP01" }],
      });
    });

    it("fetches through the shared guarded read client", async () => {
      await run(["shop", "cotik", "list"]);

      expect(mocks.createCotikClient).toHaveBeenCalledWith({ token: "test-cotik-token" });
      expect(mocks.cotikGet).toHaveBeenCalledWith("/statements/", expect.anything());
    });

    it("fails closed before any fetch when COTIK_TOKEN is missing", async () => {
      runtime = runtimeWith({ COTIK_TOKEN: undefined });

      await expect(run(["shop", "cotik", "list", "--json"])).rejects.toMatchObject({
        payload: { failureType: "COTIK_NOT_CONFIGURED" },
      });
      expect(mocks.createCotikClient).not.toHaveBeenCalled();
      expect(mocks.cotikGet).not.toHaveBeenCalled();
    });
  });

  describe("bind", () => {
    it("binds exactly the operator-supplied candidate id with Orders and supplementary-finance provenance, then resolves the enabled binding", async () => {
      mocks.upsertShopProviderBinding.mockResolvedValue(enabledBinding);

      const output = await run(["shop", "cotik", "bind", "957", "--shop-id", "cotik-shop-1", "--json"]);

      expect(mocks.upsertShopProviderBinding).toHaveBeenCalledWith({}, {
        shopId: canonicalShop.id,
        provider: "COTIK",
        providerShopId: "cotik-shop-1",
        provenance: { source: "COTIK", capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"] },
      });
      expect(mocks.findEnabledShopProviderBinding).toHaveBeenCalledTimes(1);
      const [writeAt, readbackAt] = [
        mocks.upsertShopProviderBinding.mock.invocationCallOrder[0],
        mocks.findEnabledShopProviderBinding.mock.invocationCallOrder[0],
      ];
      expect(writeAt).toBeDefined();
      expect(readbackAt).toBeDefined();
      expect(writeAt!).toBeLessThan(readbackAt!);
      expect(JSON.parse(output)).toEqual({ schemaVersion: "cotik-binding.v1", binding: enabledBinding });
    });

    it("rejects a shop id that is absent from the fetched candidates without writing", async () => {
      await expect(run(["shop", "cotik", "bind", "957", "--shop-id", "missing-id", "--json"]))
        .rejects.toMatchObject({ payload: { failureType: "COTIK_SHOP_NOT_FOUND" } });
      expect(mocks.cotikGet).toHaveBeenCalledTimes(1);
      expect(mocks.upsertShopProviderBinding).not.toHaveBeenCalled();
      expect(mocks.findEnabledShopProviderBinding).not.toHaveBeenCalled();
    });

    it("never matches candidates implicitly by name or code", async () => {
      await expect(run(["shop", "cotik", "bind", "957", "--shop-id", "My Shop", "--json"]))
        .rejects.toMatchObject({ payload: { failureType: "COTIK_SHOP_NOT_FOUND" } });

      await expect(run(["shop", "cotik", "bind", "957", "--shop-id", "SHOP02", "--json"]))
        .rejects.toMatchObject({ payload: { failureType: "COTIK_SHOP_NOT_FOUND" } });
      expect(mocks.upsertShopProviderBinding).not.toHaveBeenCalled();
    });

    it("reports an ambiguous candidate list instead of guessing between duplicate ids", async () => {
      mocks.cotikGet.mockResolvedValue({
        list_shop: [
          { _id: "cotik-shop-1", name: "My Shop", code: "SHOP01" },
          { _id: "cotik-shop-1", name: "My Shop", code: "SHOP01" },
        ],
      });

      await expect(run(["shop", "cotik", "bind", "957", "--shop-id", "cotik-shop-1", "--json"]))
        .rejects.toMatchObject({ payload: { failureType: "COTIK_CANDIDATE_AMBIGUOUS" } });
      expect(mocks.upsertShopProviderBinding).not.toHaveBeenCalled();
    });

    it("propagates a duplicate external identity error from persistence without a readback", async () => {
      mocks.upsertShopProviderBinding.mockRejectedValue(
        new Error('duplicate key value violates unique constraint "shop_provider_bindings_provider_shop_id_unique"'),
      );

      await expect(run(["shop", "cotik", "bind", "957", "--shop-id", "cotik-shop-2", "--json"]))
        .rejects.toThrow(/shop_provider_bindings_provider_shop_id_unique/);
      expect(mocks.findEnabledShopProviderBinding).not.toHaveBeenCalled();
    });

    it("keeps rebinding the same exact id idempotent", async () => {
      mocks.upsertShopProviderBinding.mockResolvedValue(enabledBinding);

      await run(["shop", "cotik", "bind", "957", "--shop-id", "cotik-shop-1", "--json"]);
      await run(["shop", "cotik", "bind", "957", "--shop-id", "cotik-shop-1", "--json"]);

      expect(mocks.upsertShopProviderBinding).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = mocks.upsertShopProviderBinding.mock.calls;
      expect(secondCall).toEqual(firstCall);
    });

    it("requires the configured candidate fetch before binding", async () => {
      runtime = runtimeWith({ COTIK_TOKEN: undefined });

      await expect(run(["shop", "cotik", "bind", "957", "--shop-id", "cotik-shop-1", "--json"]))
        .rejects.toMatchObject({ payload: { failureType: "COTIK_NOT_CONFIGURED" } });
      expect(mocks.cotikGet).not.toHaveBeenCalled();
      expect(mocks.upsertShopProviderBinding).not.toHaveBeenCalled();
    });
  });

  describe("unbind", () => {
    it("disables only the COTIK binding of the canonical shop", async () => {
      mocks.disableShopProviderBinding.mockResolvedValue({ ...enabledBinding, enabled: false });

      const output = await run(["shop", "cotik", "unbind", "957", "--json"]);

      expect(mocks.disableShopProviderBinding).toHaveBeenCalledWith({}, canonicalShop.id, "COTIK");
      expect(mocks.upsertShopProviderBinding).not.toHaveBeenCalled();
      expect(mocks.findEnabledShopProviderBinding).not.toHaveBeenCalled();
      expect(JSON.parse(output)).toEqual({
        schemaVersion: "cotik-binding.v1",
        binding: { ...enabledBinding, enabled: false },
      });
    });

    it("reports when no active COTIK binding exists", async () => {
      mocks.disableShopProviderBinding.mockResolvedValue(null);

      const output = await run(["shop", "cotik", "unbind", "957", "--json"]);

      expect(JSON.parse(output)).toEqual({ schemaVersion: "cotik-binding.v1", binding: null });
    });

    it("works without a COTIK token because no fetch is involved", async () => {
      runtime = runtimeWith({ COTIK_TOKEN: undefined });
      mocks.disableShopProviderBinding.mockResolvedValue(null);

      await expect(run(["shop", "cotik", "unbind", "957", "--json"])).resolves.toBeDefined();
      expect(mocks.cotikGet).not.toHaveBeenCalled();
    });
  });

  it("rejects an unconfigured profile before fetching candidates", async () => {
    mocks.findShopByProfileNo.mockResolvedValue(null);

    await expect(run(["shop", "cotik", "bind", "404", "--shop-id", "cotik-shop-1", "--json"]))
      .rejects.toMatchObject({ payload: { failureType: "SHOP_NOT_FOUND" } });
    expect(mocks.cotikGet).not.toHaveBeenCalled();
    expect(mocks.upsertShopProviderBinding).not.toHaveBeenCalled();
  });
});
