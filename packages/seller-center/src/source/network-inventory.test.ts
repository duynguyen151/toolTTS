import { describe, expect, it, vi } from "vitest";

import type { ShopSourceConfig } from "@shop-health/domain";

import {
  captureSellerCenterNetworkInventoryWithDependencies,
  createNetworkInventoryAccumulator,
  summarizeNetworkObservation,
  type InventoryBrowser,
  type InventoryContext,
  type InventoryPage,
  type InventoryResponse,
} from "./network-inventory.js";

const config: ShopSourceConfig = {
  shopId: "shop-1",
  profileId: "profile-1",
  profileNo: "P001",
  region: "US",
  locale: "en-US",
};

describe("network inventory summarization", () => {
  it("keeps only response shape metadata and redacts pagination strings", () => {
    const entry = summarizeNetworkObservation({
      method: "post",
      url: "https://seller-us.tiktok.com/api/orders?token=query-secret&buyer=alice",
      status: 200,
      contentType: "application/json; charset=utf-8",
      payload: {
        token: "payload-secret",
        buyer: { name: "Alice", phone: "+1-555-0100" },
        items: [
          { id: "buyer-1", variants: [{ sku: "SKU-SECRET" }] },
          { id: "buyer-2", variants: [] },
        ],
        data: {
          orders: [{ order_id: "order-secret" }],
          next_cursor: "cursor-secret",
          page: 2,
          has_more: true,
          note: "private note",
        },
      },
    });

    expect(entry).toEqual({
      method: "POST",
      host: "seller-us.tiktok.com",
      path: "/api/orders",
      status: 200,
      contentType: "application/json",
      topLevelKeys: ["buyer", "data", "items", "token"],
      arrays: [
        { path: "data.orders", count: 1 },
        { path: "items", count: 2 },
        { path: "items[].variants", count: 1 },
      ],
      pagination: [
        { path: "data.has_more", value: true },
        { path: "data.next_cursor", value: "PRESENT(length=13)" },
        { path: "data.page", value: 2 },
      ],
      observations: 1,
    });

    const serialized = JSON.stringify(entry);
    for (const forbidden of [
      "query-secret",
      "payload-secret",
      "Alice",
      "+1-555-0100",
      "buyer-1",
      "SKU-SECRET",
      "order-secret",
      "cursor-secret",
      "private note",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("detects the proven Seller Center pagination field names", () => {
    const entry = summarizeNetworkObservation({
      method: "get",
      url: "https://seller-us.tiktok.com/api/v1/pay/statement/order/list",
      status: 200,
      contentType: "application/json",
      payload: {
        data: {
          search_next_has_more: false,
          search_next_cursor: "statement-cursor",
          next_cursor_token: "order-cursor",
          total_record: 8,
        },
      },
    });

    expect(entry.pagination).toEqual([
      { path: "data.next_cursor_token", value: "PRESENT(length=12)" },
      { path: "data.search_next_cursor", value: "PRESENT(length=16)" },
      { path: "data.search_next_has_more", value: false },
      { path: "data.total_record", value: 8 },
    ]);
  });

  it("deduplicates matching response shapes while counting observations", () => {
    const accumulator = createNetworkInventoryAccumulator();
    accumulator.add(summarizeNetworkObservation({
      method: "GET",
      url: "https://seller-us.tiktok.com/api/orders?page=1",
      status: 200,
      contentType: "application/json",
      payload: { data: { rows: [{ id: "one" }], cursor: "first-cursor", page: 1 } },
    }));
    accumulator.add(summarizeNetworkObservation({
      method: "GET",
      url: "https://seller-us.tiktok.com/api/orders?page=2",
      status: 200,
      contentType: "application/json",
      payload: {
        data: {
          rows: [{ id: "two" }, { id: "three" }],
          cursor: "second-cursor",
          page: 2,
        },
      },
    }));

    expect(accumulator.entries()).toEqual([{
      method: "GET",
      host: "seller-us.tiktok.com",
      path: "/api/orders",
      status: 200,
      contentType: "application/json",
      topLevelKeys: ["data"],
      arrays: [{ path: "data.rows", count: 2 }],
      pagination: [
        { path: "data.cursor", value: "PRESENT(length=13)" },
        { path: "data.page", value: 2 },
      ],
      observations: 2,
    }]);
  });
});

describe("captureSellerCenterNetworkInventory", () => {
  it("fails explicitly without opening or connecting when the profile is inactive", async () => {
    const connect = vi.fn();
    const active = vi.fn().mockResolvedValue(null);

    await expect(captureSellerCenterNetworkInventoryWithDependencies(config, { durationMs: 1_000 }, {
      createAdsPowerClient: () => ({ active }),
      connectOverCdp: connect,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      sleep: vi.fn(),
    })).rejects.toMatchObject({
      name: "SellerCenterError",
      failureType: "BROWSER_DISCONNECTED",
    });

    expect(active).toHaveBeenCalledWith("profile-1");
    expect(connect).not.toHaveBeenCalled();
  });

  it("observes existing and future pages, then removes listeners and disconnects", async () => {
    const existingPage = new FakePage("https://seller-us.tiktok.com/home?token=secret");
    const futurePage = new FakePage("https://seller-us.tiktok.com/orders?shop_id=private");
    const context = new FakeContext([existingPage]);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const pageClose = vi.spyOn(existingPage, "close");
    const contextClose = vi.spyOn(context, "close");
    const onReady = vi.fn();

    const capture = captureSellerCenterNetworkInventoryWithDependencies(config, {
      durationMs: 1_000,
      onReady,
    }, {
      createAdsPowerClient: () => ({
        active: vi.fn().mockResolvedValue({
          profileId: "profile-1",
          status: "Active",
          cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
        }),
      }),
      connectOverCdp: vi.fn().mockResolvedValue({
        browser: new FakeBrowser([context]),
        disconnect,
      }),
      now: sequentialClock(
        new Date("2026-08-14T00:00:00.000Z"),
        new Date("2026-08-14T00:00:01.000Z"),
      ),
      sleep: async () => {
        context.emitPage(futurePage);
        existingPage.emitResponse(jsonResponse("https://seller-us.tiktok.com/api/a?token=one"));
        futurePage.emitResponse(jsonResponse("https://seller-us.tiktok.com/api/b?token=two"));
        await Promise.resolve();
      },
    });

    const report = await capture;

    expect(report.pageUrls).toEqual([
      "https://seller-us.tiktok.com/home",
      "https://seller-us.tiktok.com/orders",
    ]);
    expect(report.entries.map((entry) => entry.path)).toEqual(["/api/a", "/api/b"]);
    expect(onReady).toHaveBeenCalledWith({
      pageUrls: ["https://seller-us.tiktok.com/home"],
    });
    expect(existingPage.listenerCount("response")).toBe(0);
    expect(futurePage.listenerCount("response")).toBe(0);
    expect(context.listenerCount("page")).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(pageClose).not.toHaveBeenCalled();
    expect(contextClose).not.toHaveBeenCalled();
  });

  it("cleans up and disconnects when capture fails", async () => {
    const page = new FakePage("https://seller-us.tiktok.com/home");
    const context = new FakeContext([page]);
    const disconnect = vi.fn().mockResolvedValue(undefined);

    await expect(captureSellerCenterNetworkInventoryWithDependencies(config, undefined, {
      createAdsPowerClient: () => ({
        active: vi.fn().mockResolvedValue({
          profileId: "profile-1",
          status: "Active",
          cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
        }),
      }),
      connectOverCdp: vi.fn().mockResolvedValue({
        browser: new FakeBrowser([context]),
        disconnect,
      }),
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      sleep: async () => {
        throw new Error("capture interrupted");
      },
    })).rejects.toThrow("capture interrupted");

    expect(page.listenerCount("response")).toBe(0);
    expect(context.listenerCount("page")).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("reads bodies only for JSON xhr or fetch responses on Seller domains", async () => {
    const page = new FakePage("https://seller-us.tiktok.com/home");
    const context = new FakeContext([page]);
    const documentBody = vi.fn().mockResolvedValue({ secret: "document" });
    const foreignBody = vi.fn().mockResolvedValue({ secret: "foreign" });
    const htmlBody = vi.fn().mockResolvedValue({ secret: "html" });
    const validBody = vi.fn().mockResolvedValue({ data: { rows: [] } });

    const report = await captureSellerCenterNetworkInventoryWithDependencies(config, {
      durationMs: 999_999,
    }, {
      createAdsPowerClient: activeClient,
      connectOverCdp: vi.fn().mockResolvedValue({
        browser: new FakeBrowser([context]),
        disconnect: vi.fn().mockResolvedValue(undefined),
      }),
      now: sequentialClock(
        new Date("2026-08-14T00:00:00.000Z"),
        new Date("2026-08-14T00:00:00.500Z"),
      ),
      sleep: async (durationMs) => {
        expect(durationMs).toBe(300_000);
        page.emitResponse(responseFixture({ resourceType: "document", json: documentBody }));
        page.emitResponse(responseFixture({
          url: "https://example.com/api/orders?token=secret",
          json: foreignBody,
        }));
        page.emitResponse(responseFixture({ contentType: "text/html", json: htmlBody }));
        page.emitResponse(responseFixture({
          url: "https://seller-us.tiktok.com/api/orders?token=secret",
          json: validBody,
        }));
        await Promise.resolve();
      },
    });

    expect(documentBody).not.toHaveBeenCalled();
    expect(foreignBody).not.toHaveBeenCalled();
    expect(htmlBody).not.toHaveBeenCalled();
    expect(validBody).toHaveBeenCalledOnce();
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.path).toBe("/api/orders");
  });
});

class FakePage implements InventoryPage {
  private readonly responseListeners = new Set<(response: InventoryResponse) => void>();

  constructor(private readonly pageUrl: string) {}

  url(): string {
    return this.pageUrl;
  }

  on(event: "response", listener: (response: InventoryResponse) => void): this {
    if (event === "response") this.responseListeners.add(listener);
    return this;
  }

  off(event: "response", listener: (response: InventoryResponse) => void): this {
    if (event === "response") this.responseListeners.delete(listener);
    return this;
  }

  emitResponse(response: InventoryResponse): void {
    for (const listener of this.responseListeners) listener(response);
  }

  listenerCount(event: "response"): number {
    return event === "response" ? this.responseListeners.size : 0;
  }

  async close(): Promise<void> {}
}

class FakeContext implements InventoryContext {
  private readonly pageListeners = new Set<(page: InventoryPage) => void>();

  constructor(private readonly currentPages: InventoryPage[]) {}

  pages(): InventoryPage[] {
    return [...this.currentPages];
  }

  on(event: "page", listener: (page: InventoryPage) => void): this {
    if (event === "page") this.pageListeners.add(listener);
    return this;
  }

  off(event: "page", listener: (page: InventoryPage) => void): this {
    if (event === "page") this.pageListeners.delete(listener);
    return this;
  }

  emitPage(page: InventoryPage): void {
    this.currentPages.push(page);
    for (const listener of this.pageListeners) listener(page);
  }

  listenerCount(event: "page"): number {
    return event === "page" ? this.pageListeners.size : 0;
  }

  async close(): Promise<void> {}
}

class FakeBrowser implements InventoryBrowser {
  constructor(private readonly currentContexts: InventoryContext[]) {}

  contexts(): InventoryContext[] {
    return [...this.currentContexts];
  }
}

function jsonResponse(url: string): InventoryResponse {
  return responseFixture({ url });
}

function responseFixture(overrides: {
  url?: string;
  resourceType?: string;
  contentType?: string;
  json?: () => Promise<unknown>;
} = {}): InventoryResponse {
  return {
    request: () => ({
      method: () => "GET",
      resourceType: () => overrides.resourceType ?? "xhr",
    }),
    url: () => overrides.url ?? "https://seller-us.tiktok.com/api/default",
    status: () => 200,
    headers: () => ({
      "content-type": overrides.contentType ?? "application/json; charset=utf-8",
    }),
    json: overrides.json ?? (async () => ({ data: { rows: [] } })),
  };
}

function activeClient(): { active: () => Promise<{
  profileId: string;
  status: string;
  cdpEndpoint: string;
}> } {
  return {
    active: async () => ({
      profileId: "profile-1",
      status: "Active",
      cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
    }),
  };
}

function sequentialClock(...dates: Date[]): () => Date {
  let index = 0;
  return () => dates[Math.min(index++, dates.length - 1)] ?? new Date(0);
}
