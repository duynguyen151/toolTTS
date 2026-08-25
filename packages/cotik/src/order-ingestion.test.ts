import { describe, expect, it, vi } from "vitest";

import type { CotikClient } from "./client.js";
import {
  buildCotikOrderListPath,
  INCREMENTAL_OVERLAP_MS,
  ingestCotikOrders,
  type CotikOrderIngestionInput,
} from "./order-ingestion.js";

const RUN_NOW = new Date("2026-03-01T12:00:00.000Z");
const SHOP_ID = "11111111-2222-4333-8444-555555555555";
const COTIK_SHOP_ID = "66b0cotikshop";

function cotikOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const apiOrderId = overrides.apiOrderId ?? "order-default";
  return {
    _id: `cotik-${apiOrderId}`,
    apiOrderId,
    status: "AWAITING_SHIPMENT",
    order_status: "new",
    shipping_type: "SELLER",
    tracking_number: `TRACK-${apiOrderId}`,
    create_time: 1724140800,
    update_time: 1724141000,
    payment: { currency: "USD", total_amount: "19.99", sub_total: "19.99", shipping_fee: "0.00" },
    line_items: [
      { product_id: "p1", product_name: "Secret Product Name", sku_id: "s1", sku_name: "Secret SKU Name", seller_sku: "SKU-1", sale_price: "19.99", currency: "USD" },
    ],
    shops: { _id: COTIK_SHOP_ID },
    // PII bait: must never survive into normalized output.
    recipient_address: { name: "Pii Recipient", address_line1: "1 PII Street", phone_number: "5550100000" },
    buyer_message: "please wrap as gift",
    ...overrides,
  };
}

function page(rows: unknown[], totalsize: number) {
  return { listorders: rows, totalsize };
}

function stubClient(responses: Array<{ listorders: unknown[]; totalsize: number }>, events: string[]) {
  const requests: string[] = [];
  const get = vi.fn(async (path: string) => {
    requests.push(path);
    events.push(`fetch:${requests.length}`);
    const next = responses[requests.length - 1];
    if (next === undefined) throw new Error(`unexpected fetch #${requests.length}: ${path}`);
    return next;
  });
  return { client: { get } as unknown as CotikClient, requests, get };
}

function enabledBinding(overrides: Record<string, unknown> = {}) {
  return { provider: "COTIK", enabled: true, providerShopId: COTIK_SHOP_ID, checkpoint: null, ...overrides };
}

function ingestionInput(
  overrides: Partial<CotikOrderIngestionInput> & Record<string, unknown> = {},
  events: string[] = [],
) {
  return {
    client: overrides.client ?? stubClient([], events).client,
    shopId: SHOP_ID,
    binding: enabledBinding(),
    persistOrders: async () => undefined,
    saveCheckpoint: async () => undefined,
    now: () => RUN_NOW,
    ...overrides,
  } as CotikOrderIngestionInput;
}

describe("buildCotikOrderListPath", () => {
  it("builds the documented GET path with page, sizeperpage, and filter2 shop scoping", () => {
    expect(buildCotikOrderListPath({ page: 2, sizePerPage: 100, cotikShopId: "abc 123" })).toBe(
      "/order/list?page=2&sizeperpage=100&filter2=abc%20123",
    );
  });

  it("omits filter2 without a shop id", () => {
    expect(buildCotikOrderListPath({ page: 1, sizePerPage: 50 })).toBe("/order/list?page=1&sizeperpage=50");
  });

  it.each([
    ["zero page", { page: 0, sizePerPage: 100 }],
    ["fractional page", { page: 1.5, sizePerPage: 100 }],
    ["zero size", { page: 1, sizePerPage: 0 }],
    ["size over the documented 100 cap", { page: 1, sizePerPage: 101 }],
  ])("rejects %s at the boundary", (_label, params) => {
    expect(() => buildCotikOrderListPath(params)).toThrow(/page|size/i);
  });
});

describe("ingestCotikOrders initial All Available backfill", () => {
  it("pages through totalsize and persists each page sequentially before saving the checkpoint once", async () => {
    const events: string[] = [];
    const responses = [
      page(Array.from({ length: 100 }, (_, i) => cotikOrder({ apiOrderId: `ord-${i}` })), 150),
      page(Array.from({ length: 50 }, (_, i) => cotikOrder({ apiOrderId: `ord-${i + 100}` })), 150),
    ];
    const { client, requests } = stubClient(responses, events);
    const persisted: string[] = [];
    const saveCheckpoint = vi.fn(async () => undefined);

    const result = await ingestCotikOrders(ingestionInput({
      client,
      persistOrders: async (orders) => {
        events.push(`persist:${orders.map((order) => order.sourceOrderId).join(",")}`);
        persisted.push(...orders.map((order) => order.sourceOrderId));
      },
      saveCheckpoint,
    }, events));

    expect(result.mode).toBe("INITIAL_ALL_AVAILABLE");
    expect(result.ordersPersisted).toBe(150);
    expect(result.pagesFetched).toBe(2);
    expect(persisted).toHaveLength(150);
    expect(new Set(persisted).size).toBe(150);
    // Page-wise sequencing: every page is fetched then fully persisted before the next fetch.
    expect(events).toEqual([
      "fetch:1",
      `persist:${Array.from({ length: 100 }, (_, i) => `ord-${i}`).join(",")}`,
      "fetch:2",
      `persist:${Array.from({ length: 50 }, (_, i) => `ord-${i + 100}`).join(",")}`,
    ]);
    // Documented /order/list traversal scoped to the bound COTIK shop.
    expect(requests).toEqual([
      `/order/list?page=1&sizeperpage=100&filter2=${COTIK_SHOP_ID}`,
      `/order/list?page=2&sizeperpage=100&filter2=${COTIK_SHOP_ID}`,
    ]);
    // Exactly one checkpoint, only after ALL pages succeeded, watermarked at run start.
    expect(saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(saveCheckpoint).toHaveBeenCalledWith({
      schemaVersion: "cotik-orders-checkpoint.v1",
      lastUpdatedAtMs: RUN_NOW.getTime(),
    });
    expect(result.checkpoint).toEqual({
      schemaVersion: "cotik-orders-checkpoint.v1",
      lastUpdatedAtMs: RUN_NOW.getTime(),
    });
  });

  it("confirms a totalsize of zero with a single empty fetch and still advances the checkpoint", async () => {
    const events: string[] = [];
    const { client } = stubClient([page([], 0)], events);
    const persistOrders = vi.fn(async () => undefined);
    const saveCheckpoint = vi.fn(async () => undefined);

    const result = await ingestCotikOrders(ingestionInput({ client, persistOrders, saveCheckpoint }, events));

    expect(result.ordersPersisted).toBe(0);
    expect(result.pagesFetched).toBe(1);
    expect(persistOrders).not.toHaveBeenCalled();
    expect(saveCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("keeps an undocumented source status explicitly UNKNOWN end to end", async () => {
    const { client } = stubClient([page([cotikOrder({ apiOrderId: "odd-1", status: "MYSTERY" })], 1)], []);
    const persisted: Array<{ canonicalStatus: string; sourceStatus: string }> = [];

    await ingestCotikOrders(ingestionInput({
      client,
      persistOrders: async (orders) => persisted.push(...orders),
    }));

    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.canonicalStatus).toBe("UNKNOWN");
    expect(persisted[0]!.sourceStatus).toBe("MYSTERY");
  });

  it("persists only normalized allowlisted data with no PII even when the payload carries it", async () => {
    const { client } = stubClient([page([cotikOrder({ apiOrderId: "pii-1" })], 1)], []);
    const persisted: Array<Record<string, unknown>> = [];

    await ingestCotikOrders(ingestionInput({
      client,
      persistOrders: async (orders) => persisted.push(...orders),
    }));

    const serialized = JSON.stringify(persisted);
    for (const forbidden of ["Pii Recipient", "1 PII Street", "5550100000", "please wrap as gift", "Secret Product Name", "Secret SKU Name"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("ingestCotikOrders totalsize reconciliation", () => {
  it("dedups an order re-delivered across pages and reconciles distinct ids against totalsize", async () => {
    // totalsize 3 unique orders; page 2 re-delivers ord-b because it moved after an update.
    const { client } = stubClient([
      page([cotikOrder({ apiOrderId: "ord-a" }), cotikOrder({ apiOrderId: "ord-b" })], 3),
      page([cotikOrder({ apiOrderId: "ord-b" }), cotikOrder({ apiOrderId: "ord-c" })], 3),
    ], []);
    const persisted: string[] = [];
    const saveCheckpoint = vi.fn(async () => undefined);

    const result = await ingestCotikOrders(ingestionInput(
      {
        client,
        pageSize: 2,
        persistOrders: async (orders) => persisted.push(...orders.map((order) => order.sourceOrderId)),
        saveCheckpoint,
      },
    ));

    expect(result.ordersPersisted).toBe(3);
    expect(persisted).toEqual(["ord-a", "ord-b", "ord-c"]);
    expect(saveCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("throws on a totalsize that changes between pages without calling the checkpoint", async () => {
    const events: string[] = [];
    const { client, requests } = stubClient([
      page([cotikOrder({ apiOrderId: "ord-a" }), cotikOrder({ apiOrderId: "ord-b" })], 5),
      page([], 9),
    ], events);
    const persistOrders = vi.fn(async () => undefined);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({ client, pageSize: 2, persistOrders, saveCheckpoint }, events)))
      .rejects.toMatchObject({ code: "PAGINATION_MISMATCH" });

    expect(requests).toHaveLength(2); // detected on the second page, no further fetching
    expect(persistOrders).toHaveBeenCalledTimes(1); // earlier valid pages stay persisted
    expect(saveCheckpoint).not.toHaveBeenCalled(); // but the checkpoint never advances
  });

  it("throws when traversal ends short of totalsize", async () => {
    const { client } = stubClient([
      page([cotikOrder({ apiOrderId: "ord-a" }), cotikOrder({ apiOrderId: "ord-b" })], 4),
      page([cotikOrder({ apiOrderId: "ord-c" })], 4), // short final page, only 3 of 4 delivered
    ], []);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({ client, pageSize: 2, saveCheckpoint })))
      .rejects.toMatchObject({ code: "PAGINATION_MISMATCH" });
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it("throws on an empty page before totalsize is reached", async () => {
    const events: string[] = [];
    const { client, requests } = stubClient([
      page([cotikOrder({ apiOrderId: "ord-a" }), cotikOrder({ apiOrderId: "ord-b" })], 4),
      page([], 4),
    ], events);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({ client, pageSize: 2, saveCheckpoint }, events)))
      .rejects.toMatchObject({ code: "EMPTY_PAGE" });
    expect(saveCheckpoint).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
  });

  it("throws when a page returns more rows than the requested page size", async () => {
    const { client } = stubClient([page([cotikOrder(), cotikOrder({ apiOrderId: "extra" })], 2)], []);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({ client, pageSize: 1, saveCheckpoint })))
      .rejects.toMatchObject({ code: "PAGINATION_MISMATCH" });
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});

describe("ingestCotikOrders incremental update polling", () => {
  const checkpoint = { schemaVersion: "cotik-orders-checkpoint.v1", lastUpdatedAtMs: RUN_NOW.getTime() - 3_600_000 };

  it("queries documented filter11/filter12 in milliseconds with the conservative overlap and saves the advanced watermark", async () => {
    const events: string[] = [];
    const { client, requests } = stubClient([page([cotikOrder({ apiOrderId: "upd-1" })], 1)], events);
    const saveCheckpoint = vi.fn(async () => undefined);

    const result = await ingestCotikOrders(ingestionInput({
      client,
      binding: enabledBinding({ checkpoint }),
      saveCheckpoint,
    }, events));

    expect(result.mode).toBe("INCREMENTAL_UPDATE");
    const url = new URL(requests[0]!, "https://cotik.app");
    expect(url.pathname).toBe("/order/list");
    expect(url.searchParams.get("filter11")).toBe(String(checkpoint.lastUpdatedAtMs - INCREMENTAL_OVERLAP_MS));
    expect(url.searchParams.get("filter12")).toBe(String(RUN_NOW.getTime()));
    expect(url.searchParams.get("filter2")).toBe(COTIK_SHOP_ID);
    expect(saveCheckpoint).toHaveBeenCalledWith({
      schemaVersion: "cotik-orders-checkpoint.v1",
      lastUpdatedAtMs: RUN_NOW.getTime(),
    });
  });

  it("pins the operational overlap ruling at one minute (guide prescribes update-time polling but no amount)", () => {
    // docs/integrations/cotik/public-api-guide.md §7.3 mandates filter11/filter12 from the last
    // successful poll but prescribes no overlap; this repo rules 60s conservatively.
    expect(INCREMENTAL_OVERLAP_MS).toBe(60_000);
  });

  it("clamps filter11 at zero when the watermark predates the overlap", async () => {
    const { client, requests } = stubClient([page([], 0)], []);

    await ingestCotikOrders(ingestionInput({
      client,
      binding: enabledBinding({ checkpoint: { schemaVersion: "cotik-orders-checkpoint.v1", lastUpdatedAtMs: 500 } }),
    }));

    expect(new URL(requests[0]!, "https://cotik.app").searchParams.get("filter11")).toBe("0");
  });

  it.each([
    ["a non-object checkpoint", "not-an-object"],
    ["a checkpoint without lastUpdatedAtMs", { schemaVersion: "cotik-orders-checkpoint.v1" }],
    ["a checkpoint with a non-numeric lastUpdatedAtMs", { schemaVersion: "cotik-orders-checkpoint.v1", lastUpdatedAtMs: "soon" }],
    ["a foreign checkpoint schema", { schemaVersion: "someone-else.v9", lastUpdatedAtMs: 123 }],
  ])("rejects %s before fetching", async (_label, badCheckpoint) => {
    const events: string[] = [];
    const { client, requests } = stubClient([page([], 0)], events);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({
      client,
      binding: enabledBinding({ checkpoint: badCheckpoint as Record<string, unknown> }),
      saveCheckpoint,
    }, events))).rejects.toMatchObject({ code: "CHECKPOINT_INVALID" });

    expect(requests).toHaveLength(0);
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});

describe("ingestCotikOrders binding validation happens before any fetch", () => {
  it.each([
    ["a disabled binding", enabledBinding({ enabled: false })],
    ["a non-COTIK binding", enabledBinding({ provider: "SELLER_CENTER" })],
    ["a binding without a provider shop id", enabledBinding({ providerShopId: null })],
    ["a binding with a blank provider shop id", enabledBinding({ providerShopId: "   " })],
  ])("rejects %s without fetching or persisting", async (_label, badBinding) => {
    const events: string[] = [];
    const { client, requests } = stubClient([page([], 0)], events);
    const persistOrders = vi.fn(async () => undefined);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({
      client,
      binding: badBinding as typeof enabledBinding,
      persistOrders,
      saveCheckpoint,
    }, events))).rejects.toMatchObject({ code: "BINDING_INVALID" });

    expect(requests).toHaveLength(0);
    expect(persistOrders).not.toHaveBeenCalled();
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});

describe("ingestCotikOrders failures leave the checkpoint untouched", () => {
  it("propagates a client error such as exhausted 429 retries before any persistence or checkpoint", async () => {
    const events: string[] = [];
    const failingGet = vi.fn(async () => {
      throw Object.assign(new Error("COTIK request was rejected"), { name: "CotikClientError", code: "TRANSIENT", httpStatus: 429 });
    });
    const persistOrders = vi.fn(async () => undefined);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({
      client: { get: failingGet } as unknown as CotikClient,
      persistOrders,
      saveCheckpoint,
    }, events))).rejects.toThrow(/rejected/);

    expect(failingGet).toHaveBeenCalledTimes(1);
    expect(persistOrders).not.toHaveBeenCalled();
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it("propagates a malformed source order from the normalizer and keeps earlier persisted pages but no checkpoint", async () => {
    const events: string[] = [];
    const { client } = stubClient([
      page([cotikOrder({ apiOrderId: "good-1" })], 2),
      page([{ apiOrderId: "broken", status: "COMPLETED" /* payment missing */ }], 2),
    ], events);
    const persisted: string[] = [];
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({
      client,
      pageSize: 1,
      persistOrders: async (orders) => persisted.push(...orders.map((order) => order.sourceOrderId)),
      saveCheckpoint,
    }, events))).rejects.toThrow();

    expect(persisted).toEqual(["good-1"]); // page 1 stayed persisted; replay upserts it again safely
    expect(saveCheckpoint).not.toHaveBeenCalled(); // no checkpoint advance means the retry replays safely
  });

  it("propagates a persistence callback throw and never calls the checkpoint", async () => {
    const events: string[] = [];
    const { client, requests } = stubClient([page([cotikOrder()], 2)], events);
    const saveCheckpoint = vi.fn(async () => undefined);

    await expect(ingestCotikOrders(ingestionInput({
      client,
      pageSize: 1,
      persistOrders: async () => {
        throw new Error("database unavailable");
      },
      saveCheckpoint,
    }, events))).rejects.toThrow(/database unavailable/);

    expect(saveCheckpoint).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1); // no progress past the failed page
  });

  it("propagates a checkpoint-save throw after all pages succeeded", async () => {
    const { client } = stubClient([page([cotikOrder()], 1)], []);
    const persisted: string[] = [];

    await expect(ingestCotikOrders(ingestionInput({
      client,
      persistOrders: async (orders) => persisted.push(...orders.map((order) => order.sourceOrderId)),
      saveCheckpoint: async () => {
        throw new Error("binding row locked");
      },
    }))).rejects.toThrow(/binding row locked/);

    expect(persisted).toEqual(["order-default"]); // all pages were persisted before the checkpoint attempt
  });
});
