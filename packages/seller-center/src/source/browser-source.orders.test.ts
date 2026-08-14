import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncRequest } from "@shop-health/domain";

const { connectOverCDP } = vi.hoisted(() => ({
  connectOverCDP: vi.fn(),
}));

vi.mock("playwright-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("playwright-core")>();
  return {
    ...original,
    chromium: { ...original.chromium, connectOverCDP },
  };
});

import { SellerCenterBrowserDataSource } from "./browser-source.js";

describe("SellerCenterBrowserDataSource order response capture", () => {
  beforeEach(() => connectOverCDP.mockReset());

  it("matches the POST order count response used by probe", async () => {
    const page = new FakeOrdersPage();
    const source = dataSource(page);

    const fingerprint = await source.probe(shopConfig());

    expect(fingerprint.value).toMatch(/^[a-f0-9]{64}$/);
    expect(page.matchedMethods).toEqual(["POST"]);
  });

  it("matches the bodyless All-orders request when a competing filtered response arrives first", async () => {
    const page = new FakeOrdersPage();
    const source = dataSource(page);

    const batches = [];
    for await (const batch of source.collectOrders(syncRequest())) batches.push(batch);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.orders).toHaveLength(9);
    expect(batches[0]?.orders[0]?.sourceOrderId).toBe("order-1");
    expect(batches[0]?.orders[8]?.sourceOrderId).toBe("order-9");
    expect(batches[0]?.checkpoint).toBeNull();
    expect(page.matchedMethods).toEqual(["POST"]);
    expect(page.gotoUrls[0]).toContain("selected_sort=6");
    expect(page.gotoUrls[0]).toContain("tab=all");
  });

  it.each([
    {
      name: "total_count is missing",
      response: orderListResponse(9, { totalCount: undefined }),
      message: "total_count",
    },
    {
      name: "pagination termination flags are missing",
      response: orderListResponse(9, { hasMore: undefined, searchNextHasMore: undefined }),
      message: "termination",
    },
    {
      name: "the row count differs from total_count",
      response: orderListResponse(8, { totalCount: 9 }),
      message: "reconciliation",
    },
    {
      name: "main_order_id values are duplicated",
      response: orderListResponse(9, { duplicateLastOrderId: true }),
      message: "duplicate",
    },
    {
      name: "has_more reports another page",
      response: orderListResponse(9, { hasMore: true }),
      message: "pagination",
    },
    {
      name: "search_next_has_more reports another page",
      response: orderListResponse(9, { searchNextHasMore: true }),
      message: "pagination",
    },
  ])("fails closed when $name", async ({ response, message }) => {
    const page = new FakeOrdersPage([
      new FakeResponse(
        "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
        "POST",
        response,
        null,
      ),
    ]);
    const source = dataSource(page);

    await expect(collectBatches(source)).rejects.toMatchObject({
      failureType: "LAYOUT_CHANGED",
      message: expect.stringContaining(message),
    });
  });
});

class FakeOrdersPage {
  readonly matchedMethods: string[] = [];
  readonly gotoUrls: string[] = [];
  private currentUrl = "about:blank";

  constructor(private readonly responses = defaultResponses()) {}

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.gotoUrls.push(url);
  }

  url(): string {
    return this.currentUrl;
  }

  async waitForResponse(
    predicate: (response: FakeResponse) => boolean,
  ): Promise<FakeResponse> {
    const response = this.responses.find(predicate);
    if (!response) throw new Error("No matching fake response");
    this.matchedMethods.push(response.request().method());
    return response;
  }

  locator(selector: string): { innerText(): Promise<string> } {
    if (selector !== "body") throw new Error(`Unexpected locator ${selector}`);
    return { innerText: async () => "Orders" };
  }

  async close(): Promise<void> {}
}

class FakeResponse {
  constructor(
    private readonly responseUrl: string,
    private readonly method: string,
    private readonly body: unknown,
    private readonly requestBody: unknown = {},
  ) {}

  url(): string {
    return this.responseUrl;
  }

  status(): number {
    return 200;
  }

  request(): { method(): string; url(): string; postDataJSON(): unknown } {
    return {
      method: () => this.method,
      url: () => this.responseUrl,
      postDataJSON: () => this.requestBody,
    };
  }

  async json(): Promise<unknown> {
    return this.body;
  }
}

function dataSource(page: FakeOrdersPage): SellerCenterBrowserDataSource {
  connectOverCDP.mockResolvedValue({
    contexts: () => [{ newPage: async () => page }],
    isConnected: () => true,
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  });
  return new SellerCenterBrowserDataSource({
    adsPowerClient: {
      open: vi.fn().mockResolvedValue({
        profileId: "profile-1",
        status: "Active",
        cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
      }),
    } as never,
  });
}

function shopConfig(): SyncRequest["shop"] {
  return {
    shopId: "shop-1",
    profileId: "profile-1",
    profileNo: "957",
    region: "US",
    locale: "en-US",
  };
}

function syncRequest(): SyncRequest {
  return {
    shop: shopConfig(),
    mode: "INCREMENTAL",
    checkpoint: null,
    since: null,
    until: null,
  };
}

interface OrderListResponseOptions {
  totalCount?: number | undefined;
  hasMore?: boolean | undefined;
  searchNextHasMore?: boolean | undefined;
  nextCursorToken?: string;
  searchNextCursor?: string;
  duplicateLastOrderId?: boolean;
}

function defaultResponses(): FakeResponse[] {
  return [
    new FakeResponse(
      "https://seller-us.tiktok.com/api/fulfillment/na/order/search_count",
      "POST",
      { code: 0, data: { count_map: { awaiting_shipment: 1 } } },
    ),
    new FakeResponse(
      "https://seller-us.tiktok.com/api/fulfillment/na/order/list?is_prefetch=1",
      "POST",
      orderListResponse(2),
      {
        count: 20,
        offset: 0,
        search_condition: { condition_list: { search_tab: { value: ["101"] } } },
      },
    ),
    new FakeResponse(
      "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
      "POST",
      orderListResponse(3),
      { search_condition: { condition_list: { order_status: { value: ["1"] } } } },
    ),
    new FakeResponse(
      "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
      "POST",
      orderListResponse(9, {
        nextCursorToken: "terminal-order-cursor",
        searchNextCursor: "terminal-search-cursor",
      }),
      null,
    ),
  ];
}

async function collectBatches(source: SellerCenterBrowserDataSource): Promise<unknown[]> {
  const batches = [];
  for await (const batch of source.collectOrders(syncRequest())) batches.push(batch);
  return batches;
}

function orderListResponse(
  count: number,
  options: OrderListResponseOptions = {},
): Record<string, unknown> {
  const totalCount = "totalCount" in options ? options.totalCount : count;
  const hasMore = "hasMore" in options ? options.hasMore : false;
  const searchNextHasMore = "searchNextHasMore" in options ? options.searchNextHasMore : false;
  const mainOrders = Array.from({ length: count }, (_, index) => ({
    main_order_id: options.duplicateLastOrderId === true && index === count - 1
      ? "order-1"
      : `order-${index + 1}`,
    trade_order_module: { create_time: 1_723_680_000 },
    order_status_module: [{ main_order_status: 101 }],
    price_module: {
      grand_total: { price_val: "25.00", currency: "USD" },
    },
  }));

  return {
    code: 0,
    data: {
      main_orders: mainOrders,
      ...(totalCount === undefined ? {} : { total_count: totalCount }),
      ...(hasMore === undefined ? {} : { has_more: hasMore }),
      ...(searchNextHasMore === undefined ? {} : { search_next_has_more: searchNextHasMore }),
      ...(options.nextCursorToken === undefined ? {} : { next_cursor_token: options.nextCursorToken }),
      ...(options.searchNextCursor === undefined ? {} : { search_next_cursor: options.searchNextCursor }),
    },
  };
}
