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

const financeRoute = "https://seller-us.tiktok.com/finance/bills?tab=overview&subTab=on-hold";
const irrelevantOverviewUrl = [
  "https://seller-us.tiktok.com/api/v1/pay/statement/order/list",
  "?locale=en-US&language=en&oec_seller_id=seller-private&seller_id=seller-private",
  "&pagination_type=1&from=0&size=5&terminal_type=1&page_type=10",
  "&need_total_amount=false&no_need_sku_record=false&statement_version=1",
].join("");
const pageOneUrl = [
  "https://seller-us.tiktok.com/api/v1/pay/statement/order/list",
  "?locale=en-US&language=en&oec_seller_id=seller-private&seller_id=seller-private",
  "&pagination_type=1&from=0&size=5&terminal_type=1&page_type=10",
  "&settlement_status=1&no_need_sku_record=false",
  "&statement_version=1&token=secret-token&sign=secret-sign",
].join("");
describe("SellerCenterBrowserDataSource.collectFinancials", () => {
  beforeEach(() => connectOverCDP.mockReset());

  it("collects the direct On hold route into one complete 8-row batch", async () => {
    const page = new FakeFinancePage();
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    connectOverCDP.mockResolvedValue({
      contexts: () => [{ newPage: async () => page }],
      isConnected: () => true,
      once: vi.fn(),
      close: closeBrowser,
    });
    const source = new SellerCenterBrowserDataSource({
      adsPowerClient: {
        open: vi.fn().mockResolvedValue({
          profileId: "profile-1",
          status: "Active",
          cdpEndpoint: "ws://127.0.0.1/devtools/browser/test",
        }),
      } as never,
    });

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(page.goto).toHaveBeenNthCalledWith(1, financeRoute, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.fetchUrls).toHaveLength(1);
    const pageTwoUrl = new URL(page.fetchUrls[0] ?? "");
    expect(pageTwoUrl.searchParams.get("from")).toBe("5");
    expect(pageTwoUrl.searchParams.get("token")).toBeNull();
    expect(pageTwoUrl.searchParams.get("sign")).toBeNull();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      complete: true,
      checkpoint: null,
      snapshot: { onHoldBalance: "310.16", currency: "USD" },
    });
    expect(batches[0]?.settlements).toHaveLength(8);
    expect(new Set(batches[0]?.settlements.map((row) => row.sourceStatementDetailId)).size).toBe(8);
    const byReason = new Map<string | null, NonNullable<typeof batches[0]>["settlements"]>();
    for (const row of batches[0]?.settlements ?? []) {
      const group = byReason.get(row.onHoldReason) ?? [];
      group.push(row);
      byReason.set(row.onHoldReason, group);
    }
    expect(byReason.get("WAITING_FOR_PACKAGE_DELIVERY")).toHaveLength(5);
    expect(sumExpected(byReason.get("WAITING_FOR_PACKAGE_DELIVERY") ?? [])).toBe("177.33");
    expect(byReason.get("DELIVERED_AWAITING_SETTLEMENT")).toHaveLength(3);
    expect(sumExpected(byReason.get("DELIVERED_AWAITING_SETTLEMENT") ?? [])).toBe("132.83");
    expect(JSON.stringify(batches[0])).not.toContain("seller-private");
    expect(JSON.stringify(batches[0])).not.toContain("secret-token");
    expect(JSON.stringify(batches[0])).not.toContain("Alice Private");
    expect(page.close).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("accepts exact decimal reconciliation without binary floating-point drift", async () => {
    const page = new FakeFinancePage({
      statBody: statResponse({
        totalAmount: "0.30",
        reasons: [{ reason: 1, amount: "0.30" }],
      }),
      firstPageBody: pageResponseRows([
        statementRow(0, "0.10"),
        statementRow(1, "0.20"),
      ], 2, false),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    const batches = [];
    for await (const batch of source.collectFinancials(syncRequest())) batches.push(batch);

    expect(batches[0]).toMatchObject({ complete: true });
    expect(batches[0]?.settlements).toHaveLength(2);
  });

  it("fails closed when collected On hold rows do not reconcile to the official breakdown", async () => {
    const page = new FakeFinancePage({
      nextPageBody: pageResponseRows([
        statementRow(5),
        statementRow(6),
        statementRow(7, "44.82"),
      ], 8, false),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // The collector must reject before yielding an incomplete batch.
      }
    }).rejects.toThrow(/On hold reconciliation/i);
  });

  it("fails closed when official and collected On hold currencies differ", async () => {
    const page = new FakeFinancePage({
      statBody: statResponse({ currency: "EUR" }),
    });
    connectOverCDP.mockResolvedValue(browserFor(page));
    const source = sourceFor(page);

    await expect(async () => {
      for await (const _batch of source.collectFinancials(syncRequest())) {
        // The collector must reject before yielding an incomplete batch.
      }
    }).rejects.toThrow(/currenc/i);
  });
});

function browserFor(page: FakeFinancePage) {
  return {
    contexts: () => [{ newPage: async () => page }],
    isConnected: () => true,
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function sourceFor(_page: FakeFinancePage): SellerCenterBrowserDataSource {
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

interface FakeFinancePageOptions {
  readonly statBody?: unknown;
  readonly firstPageBody?: unknown;
  readonly nextPageBody?: unknown;
}

class FakeFinancePage {
  readonly goto = vi.fn(async (url: string) => {
    this.currentUrl = url;
  });
  readonly close = vi.fn().mockResolvedValue(undefined);
  readonly fetchUrls: string[] = [];
  private currentUrl = "about:blank";

  constructor(private readonly options: FakeFinancePageOptions = {}) {}

  url(): string {
    return this.currentUrl;
  }

  async waitForResponse(
    predicate: (response: FakeResponse) => boolean,
  ): Promise<FakeResponse> {
    const responses = [
      new FakeResponse(
        "https://seller-us.tiktok.com/api/v1/pay/statement/stat/info?amount_stat_type=1&statement_version=1",
        this.options.statBody ?? statResponse(),
      ),
      new FakeResponse(irrelevantOverviewUrl, pageResponse(0, 0, 0, false)),
      new FakeResponse(pageOneUrl, this.options.firstPageBody ?? pageResponse(0, 5, 8, true)),
    ];
    const response = responses.find(predicate);
    if (!response) throw new Error("No matching fake response");
    return response;
  }

  locator(selector: string): {
    innerText?: () => Promise<string>;
  } {
    if (selector === "body") return { innerText: async () => "Finance On hold" };
    throw new Error(`Unexpected locator ${selector}`);
  }

  async evaluate(_callback: unknown, url: string): Promise<unknown> {
    this.fetchUrls.push(url);
    return this.options.nextPageBody ?? pageResponse(5, 3, 8, false);
  }
}

class FakeResponse {
  constructor(
    private readonly responseUrl: string,
    private readonly body: unknown,
  ) {}

  url(): string {
    return this.responseUrl;
  }

  status(): number {
    return 200;
  }

  request(): { method(): string; url(): string } {
    return {
      method: () => "GET",
      url: () => this.responseUrl,
    };
  }

  async json(): Promise<unknown> {
    return this.body;
  }
}

function syncRequest(): SyncRequest {
  return {
    shop: {
      shopId: "shop-1",
      profileId: "profile-1",
      profileNo: "957",
      region: "US",
      locale: "en-US",
    },
    mode: "INCREMENTAL",
    checkpoint: null,
    since: null,
    until: null,
  };
}

function statResponse(options: {
  readonly totalAmount?: string;
  readonly currency?: string;
  readonly reasons?: ReadonlyArray<{ readonly reason: 1 | 3; readonly amount: string }>;
} = {}): Record<string, unknown> {
  const currency = options.currency ?? "USD";
  return {
    code: 0,
    data: {
      to_settle_amount_stat: {
        amount: { amount: options.totalAmount ?? "310.16", currency },
        reasons_detail: (options.reasons ?? [
          { reason: 1, amount: "177.33" },
          { reason: 3, amount: "132.83" },
        ]).map((reason) => ({
          reason: reason.reason,
          amount: { amount: reason.amount, currency },
        })),
      },
    },
  };
}

function pageResponse(
  offset: number,
  count: number,
  totalRecord: number,
  hasMore: boolean,
): Record<string, unknown> {
  return pageResponseRows(
    Array.from({ length: count }, (_, index) => statementRow(offset + index)),
    totalRecord,
    hasMore,
  );
}

function pageResponseRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  totalRecord: number,
  hasMore: boolean,
): Record<string, unknown> {
  return {
    code: 0,
    data: {
      total_record: totalRecord,
      search_next_has_more: hasMore,
      order_records: rows,
    },
  };
}

function statementRow(index: number, amount?: string): Record<string, unknown> {
  const reason = index < 5 ? 1 : 3;
  const settlementAmount = amount ?? (reason === 1
    ? (index === 4 ? "37.33" : "35.00")
    : (index === 7 ? "44.83" : "44.00"));
  return {
    statement_detail_id: `detail-${index}`,
    reference_id: `reference-${index}`,
    trade_order_id: `order-${index}`,
    placed_time: 1_723_680_000_000 + index,
    trade_type: 1,
    settlement_amount: { amount: settlementAmount, currency: "USD" },
    earning_amount: { amount: "50.00", currency: "USD" },
    fees: { amount: "-5.00", currency: "USD" },
    settlement_status: 1,
    to_settle_reason: reason,
    ...(reason === 3
      ? { estimate_settle_time: 1_724_198_400_000 + index }
      : {}),
    delivery_time: 1_723_939_200_000 + index,
    estimate_settle_time_not_delivery: {
      starling_key: "finance_on_hold_waiting",
      starling_text: "Package not delivered for 31 days",
      params: ["31"],
    },
    statement_id: "statement-1",
    statement_version: 1,
    source_page_types: [{
      starling_key: "finance_page_type_order",
      starling_text: "Order",
    }],
    buyer_name: "Alice Private",
  };
}

function sumExpected(rows: Array<{ expectedSettlementAmount: string | null }>): string {
  return rows
    .reduce((total, row) => total + Number(row.expectedSettlementAmount ?? 0), 0)
    .toFixed(2);
}
