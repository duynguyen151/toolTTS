import { beforeEach, describe, expect, it, vi } from "vitest";

import { COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION, CotikClientError, type CotikClient } from "@shop-health/cotik";
import type { DatabaseContext, ShopProviderBindingRow, ShopRow } from "@shop-health/db";

const db = vi.hoisted(() => ({
  findEnabledShopProviderBinding: vi.fn(),
  updateShopProviderBindingCheckpoint: vi.fn(),
  upsertOrderBatch: vi.fn(),
  withShopAdvisoryLock: vi.fn(async (_context: unknown, _shopId: string, operation: () => Promise<unknown>) => operation()),
  withTransactionalShopLock: vi.fn(async (_context: unknown, _shopId: string, operation: (tx: unknown) => Promise<unknown>) => operation({})),
}));

vi.mock("@shop-health/db", () => db);

import { runCotikOrdersSync } from "./cotik-orders.js";

const FIXED_NOW = new Date("2024-06-01T12:00:00.000Z");
const now = () => new Date(FIXED_NOW);

beforeEach(() => {
  // Negative assertions count calls across tests; reset history and re-arm the
  // default pass-through lock implementations before every case.
  vi.clearAllMocks();
  db.withShopAdvisoryLock.mockImplementation(async (_c: unknown, _s: string, op: () => Promise<unknown>) => op());
  db.withTransactionalShopLock.mockImplementation(async (_c: unknown, _s: string, op: (tx: unknown) => Promise<unknown>) => op({}));
});

describe("runCotikOrdersSync binding-driven COTIK order sync", () => {
  it("resolves the enabled binding, persists each page in order, and checkpoints exactly once afterwards", async () => {
    const events: string[] = [];
    const context = {} as DatabaseContext;
    const shop = shopRow();
    const binding = cotikBinding();
    const client = pageClient([
      { listorders: [rawCotikOrder("o1")], totalsize: 2 },
      { listorders: [rawCotikOrder("o2")], totalsize: 2 },
    ]);

    db.withShopAdvisoryLock.mockImplementation(async (_c: unknown, id: string, op: () => Promise<unknown>) => {
      events.push(`lock:${id}`);
      return op();
    });
    db.findEnabledShopProviderBinding.mockImplementation(async () => {
      events.push("find");
      return binding;
    });
    db.upsertOrderBatch.mockImplementation(async (_tx: unknown, batch: Array<{ sourceOrderId: string }>) => {
      events.push(`persist:${batch[0]!.sourceOrderId}`);
      return { rowsRead: batch.length, rowsWritten: batch.length };
    });
    db.updateShopProviderBindingCheckpoint.mockImplementation(async (_d: unknown, _s: string, _p: string, checkpoint: Record<string, unknown>) => {
      events.push("checkpoint");
      return { ...binding, checkpoint };
    });

    const result = await runCotikOrdersSync({ context, shop, client: client as unknown as CotikClient, now, pageSize: 1 });

    expect(events).toEqual([`lock:${shop.id}`, "find", "persist:o1", "persist:o2", "checkpoint"]);
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(db.upsertOrderBatch).toHaveBeenCalledTimes(2);
    expect(db.updateShopProviderBindingCheckpoint).toHaveBeenCalledTimes(1);
    expect(db.updateShopProviderBindingCheckpoint).toHaveBeenCalledWith(
      context.db,
      shop.id,
      "COTIK",
      { schemaVersion: COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION, lastUpdatedAtMs: FIXED_NOW.valueOf() },
    );
    expect(result).toMatchObject({
      status: "SUCCEEDED",
      mode: "INITIAL_ALL_AVAILABLE",
      pagesFetched: 2,
      rowsRead: 2,
      rowsWritten: 2,
      checkpoint: { schemaVersion: COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION, lastUpdatedAtMs: FIXED_NOW.valueOf() },
    });
    expect(result.binding).not.toBeNull();
    expect(result.binding!.checkpoint).toEqual(result.checkpoint ? { ...result.checkpoint } : null);
  });

  it("threads the stored binding checkpoint into incremental update polling", async () => {
    const stored = { schemaVersion: COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION, lastUpdatedAtMs: FIXED_NOW.valueOf() - 5_000 };
    db.findEnabledShopProviderBinding.mockResolvedValue(cotikBinding(stored));
    db.upsertOrderBatch.mockResolvedValue({ rowsRead: 1, rowsWritten: 1 });
    db.updateShopProviderBindingCheckpoint.mockResolvedValue(cotikBinding());
    const client = pageClient([{ listorders: [rawCotikOrder("o1")], totalsize: 1 }]);

    const result = await runCotikOrdersSync({ context: {} as DatabaseContext, shop: shopRow(), client: client as unknown as CotikClient, now });

    expect(result.mode).toBe("INCREMENTAL_UPDATE");
    const path = client.get.mock.calls[0]![0]!;
    expect(path).toContain("filter11=");
    expect(path).toContain("filter12=");
  });

  it("fails closed without fetching when no enabled COTIK binding exists", async () => {
    db.findEnabledShopProviderBinding.mockResolvedValue(null);
    const client = pageClient([]);

    const result = await runCotikOrdersSync({ context: {} as DatabaseContext, shop: shopRow(), client: client as unknown as CotikClient, now });

    expect(result).toMatchObject({
      status: "SKIPPED",
      skipReason: "COTIK_BINDING_INACTIVE",
      binding: null,
      checkpoint: null,
      rowsRead: 0,
      rowsWritten: 0,
    });
    expect(client.get).not.toHaveBeenCalled();
    expect(db.upsertOrderBatch).not.toHaveBeenCalled();
    expect(db.updateShopProviderBindingCheckpoint).not.toHaveBeenCalled();
  });

  it("skips without touching bindings when the shop sync lock is busy", async () => {
    db.withShopAdvisoryLock.mockResolvedValue(null);
    const client = pageClient([{ listorders: [rawCotikOrder("o1")], totalsize: 1 }]);

    const result = await runCotikOrdersSync({ context: {} as DatabaseContext, shop: shopRow(), client: client as unknown as CotikClient, now });

    expect(result).toMatchObject({ status: "SKIPPED", skipReason: "SHOP_SYNC_LOCK_BUSY" });
    expect(db.findEnabledShopProviderBinding).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
  });

  it("propagates mid-pagination failures before any checkpoint write so prior pages replay safely", async () => {
    db.findEnabledShopProviderBinding.mockResolvedValue(cotikBinding());
    db.upsertOrderBatch.mockResolvedValue({ rowsRead: 1, rowsWritten: 1 });
    const failingGet = vi.fn()
      .mockResolvedValueOnce({ listorders: [rawCotikOrder("o1")], totalsize: 2 })
      .mockRejectedValueOnce(new CotikClientError("TRANSIENT", "rate limited"));
    const client: CotikClient = { get: failingGet };

    await expect(
      runCotikOrdersSync({ context: {} as DatabaseContext, shop: shopRow(), client, now, pageSize: 1 }),
    ).rejects.toMatchObject({ code: "TRANSIENT" });

    // Page one was already persisted and stays persisted for idempotent replay...
    expect(db.upsertOrderBatch).toHaveBeenCalledTimes(1);
    // ...but the binding checkpoint callback never fired.
    expect(db.updateShopProviderBindingCheckpoint).not.toHaveBeenCalled();
  });
});

function shopRow(): ShopRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    profileId: "profile-1",
    profileNo: "957",
    tiktokShopId: "seller-957",
    region: "US",
    locale: "en-US",
  } as ShopRow;
}

function cotikBinding(checkpoint: Record<string, unknown> | null = null): ShopProviderBindingRow {
  return {
    id: "00000000-0000-0000-0000-0000000000c0",
    shopId: "00000000-0000-0000-0000-000000000001",
    provider: "COTIK",
    providerShopId: "cotik-shop-957",
    enabled: true,
    provenance: { source: "COTIK", capabilities: ["ORDERS"] },
    providerUpdatedAt: null,
    collectedAt: new Date(0),
    checkpoint,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function pageClient(pages: Array<{ listorders: unknown[]; totalsize: number }>) {
  let page = 0;
  return {
    get: vi.fn(async (_path: string) => {
      const current = pages[page];
      page += 1;
      if (!current) throw new Error(`unexpected extra COTIK page fetch ${page}`);
      return current;
    }),
  };
}

function rawCotikOrder(id: string): Record<string, unknown> {
  return {
    apiOrderId: id,
    status: "DELIVERED",
    payment: { currency: "USD", total_amount: "10.00" },
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
  };
}
