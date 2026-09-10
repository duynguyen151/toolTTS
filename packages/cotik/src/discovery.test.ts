import { describe, expect, it, vi } from "vitest";
import {
  DiscoveredShopRawSchema,
  deriveMaShopNoiBo,
  discoverAccountShops,
  normalizeShopRegion
} from "./discovery.js";
import type { MultiAccountCotikClient } from "./multi-account-client.js";

describe("Shop Discovery (2A)", () => {
  it("normalizes shop region properly", () => {
    expect(normalizeShopRegion("UK")).toBe("UK");
    expect(normalizeShopRegion("GB")).toBe("UK");
    expect(normalizeShopRegion(undefined, undefined, "GBP")).toBe("UK");
    expect(normalizeShopRegion("US")).toBe("US");
    expect(normalizeShopRegion(undefined, undefined, "USD")).toBe("US");
    // Fail-closed: unknown regions return null, not US
    expect(normalizeShopRegion("anything_else")).toBeNull();
    expect(normalizeShopRegion(undefined)).toBeNull();
  });

  it("derives maShopNoiBo only from leading numeric note identity", () => {
    // Note with leading digits -> extract digits
    expect(deriveMaShopNoiBo("123 My Shop US", "12345")).toBe("123");
    expect(deriveMaShopNoiBo("456789", "12345")).toBe("456789");
    expect(deriveMaShopNoiBo("Best Shop US", "12345")).toBeNull();
    expect(deriveMaShopNoiBo("", "998877")).toBeNull();
    expect(deriveMaShopNoiBo(undefined, "998877")).toBeNull();
    expect(deriveMaShopNoiBo("---", "998877")).toBeNull();
  });

  it("returns COMPLETE state when shopsFound equals total", async () => {
    const mockClient: MultiAccountCotikClient = {
      accountId: "acc-123",
      async get() {
        return {
          data: [
            { shop_id: "shop-1", shop_name: "Shop One", note: "100 Shop One", region: "US" },
            { shop_id: "shop-2", shop_name: "Shop Two", note: "200 Shop Two", region: "UK" }
          ],
          total: 2
        };
      },
      diagnoseHealth() {
        return { state: "ACTIVE", message: "ok" };
      }
    };

    const result = await discoverAccountShops(mockClient);
    expect(result.state).toBe("COMPLETE");
    expect(result.totalReported).toBe(2);
    expect(result.shopsFound).toBe(2);
    expect(result.shops).toHaveLength(2);
    expect(result.shops[0]!.region).toBe("US");
    expect(result.shops[1]!.region).toBe("UK");
  });

  it("accepts the current Cotik shop response shape", async () => {
    let requestedPath = "";
    const mockClient: MultiAccountCotikClient = {
      accountId: "acc-123",
      async get(path) {
        requestedPath = path;
        return {
          data: [
            DiscoveredShopRawSchema.parse({ _id: "shop-1", name: "Shop One", note: "714US-hoang", region: "US" })
          ],
          total: 1
        };
      },
      diagnoseHealth() {
        return { state: "ACTIVE", message: "ok" };
      }
    };

    const result = await discoverAccountShops(mockClient);

    expect(result.state).toBe("COMPLETE");
    expect(requestedPath).toBe("/analytic/shop?limit=100");
    expect(result.shops).toMatchObject([
      { cotikShopId: "shop-1", shopName: "Shop One", maShopNoiBo: "714", region: "US" }
    ]);
  });

  it("expands the request when Cotik reports more shops than the initial response", async () => {
    const requestedPaths: string[] = [];
    const shops = Array.from({ length: 101 }, (unused, index) => ({
      shop_id: `shop-${index + 1}`,
      shop_name: `Shop ${index + 1}`,
      note: `${index + 1} Shop ${index + 1}`,
      region: "US"
    }));
    const mockClient: MultiAccountCotikClient = {
      accountId: "acc-123",
      async get(path) {
        requestedPaths.push(path);
        return {
          data: path.endsWith("limit=100") ? shops.slice(0, 100) : shops,
          total: shops.length
        };
      },
      diagnoseHealth() {
        return { state: "ACTIVE", message: "ok" };
      }
    };

    const result = await discoverAccountShops(mockClient);

    expect(requestedPaths).toEqual(["/analytic/shop?limit=100", "/analytic/shop?limit=101"]);
    expect(result.state).toBe("COMPLETE");
    expect(result.totalReported).toBe(101);
    expect(result.shops).toHaveLength(101);
  });

  it("returns DISCOVERY_INCOMPLETE state when total mismatch", async () => {
    const mockClient: MultiAccountCotikClient = {
      accountId: "acc-123",
      async get() {
        return {
          data: [
            { shop_id: "shop-1", shop_name: "Shop One", note: "100 Shop One", region: "US" }
          ],
          total: 5 // Expected 5, but got only 1
        };
      },
      diagnoseHealth() {
        return { state: "ACTIVE", message: "ok" };
      }
    };

    const result = await discoverAccountShops(mockClient);
    expect(result.state).toBe("DISCOVERY_INCOMPLETE");
    expect(result.totalReported).toBe(5);
    expect(result.shopsFound).toBe(1);
  });

  it("skips shops with unrecognized region (fail-closed)", async () => {
    const warnSpy = vi.fn();
    const logger = { warn: warnSpy };
    const mockClient: MultiAccountCotikClient = {
      accountId: "acc-123",
      async get() {
        return {
          data: [
            { shop_id: "shop-1", shop_name: "Shop One", note: "100 Shop One", region: "US" },
            { shop_id: "shop-2", shop_name: "Shop Unknown", note: "200 Shop Unknown", region: "XX" }, // unknown
            { shop_id: "shop-3", shop_name: "Shop UK", note: "300 Shop UK", region: "UK" }
          ],
          total: 3
        };
      },
      diagnoseHealth() {
        return { state: "ACTIVE", message: "ok" };
      }
    };

    const result = await discoverAccountShops(mockClient, logger);
    // shop-2 with unknown region "XX" must be skipped
    expect(result.shops).toHaveLength(2);
    expect(result.state).toBe("DISCOVERY_INSUFFICIENT");
    expect(result.shops.map(s => s.cotikShopId)).toEqual(["shop-1", "shop-3"]);
    // Warning must be logged for skipped shop
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatchObject({ cotikShopId: "shop-2" });
  });

  it("marks discovery insufficient and skips shops without numeric identity notes", async () => {
    const warnSpy = vi.fn();
    const mockClient: MultiAccountCotikClient = {
      accountId: "acc-123",
      async get() {
        return {
          data: [{ shop_id: "shop-1", shop_name: "Shop One", note: "Best Shop", region: "US" }],
          total: 1
        };
      },
      diagnoseHealth() {
        return { state: "ACTIVE", message: "ok" };
      }
    };

    const result = await discoverAccountShops(mockClient, { warn: warnSpy });

    expect(result.state).toBe("DISCOVERY_INSUFFICIENT");
    expect(result.shops).toEqual([]);
    expect(result.shopsFound).toBe(0);
    expect(warnSpy.mock.calls[0]).toEqual([
      expect.objectContaining({ cotikShopId: "shop-1" }),
      expect.stringMatching(/numeric.*identity/i)
    ]);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("Best Shop");
  });
});
