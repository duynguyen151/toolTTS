import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ShopProviderBindingRow } from "../schema.js";
import {
  shopProviderBindingCheckpointSchema,
  updateShopProviderBindingCheckpoint,
} from "./provider-bindings.js";

describe("shop provider binding checkpoint parser", () => {
  it("accepts a plain JSON object checkpoint unchanged", () => {
    const checkpoint = {
      schemaVersion: "cotik-orders-checkpoint.v1",
      lastUpdatedAtMs: 1_700_000_000_000,
      nested: { cursor: "abc" },
    };
    expect(shopProviderBindingCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
  });

  it("rejects non-object checkpoints (arrays, scalars, null)", () => {
    expect(() => shopProviderBindingCheckpointSchema.parse(["not-an-object"])).toThrow();
    expect(() => shopProviderBindingCheckpointSchema.parse("cursor")).toThrow();
    expect(() => shopProviderBindingCheckpointSchema.parse(42)).toThrow();
    expect(() => shopProviderBindingCheckpointSchema.parse(null)).toThrow();
  });

  it("rejects token- or credential-shaped checkpoint keys", () => {
    expect(() =>
      shopProviderBindingCheckpointSchema.parse({ accessToken: "secret-value" }),
    ).toThrow(/accessToken/);
    expect(() =>
      shopProviderBindingCheckpointSchema.parse({ "al-token": "secret-value" }),
    ).toThrow();
    expect(() =>
      shopProviderBindingCheckpointSchema.parse({ api_key: "secret-value" }),
    ).toThrow();
  });

  it("keeps benign operational keys", () => {
    expect(() =>
      shopProviderBindingCheckpointSchema.parse({ orderIdCursor: "cursor-1" }),
    ).not.toThrow();
  });
});

describe("updateShopProviderBindingCheckpoint persistence delegation", () => {
  function fakeDb(returned: ShopProviderBindingRow[]) {
    const chain = {
      set: vi.fn((_values: Record<string, unknown>) => chain),
      where: vi.fn((_condition: unknown) => chain),
      returning: vi.fn(async () => returned),
    };
    return { update: vi.fn((_table: unknown) => chain), chain };
  }

  function bindingRow(): ShopProviderBindingRow {
    return {
      id: randomUUID(),
      shopId: randomUUID(),
      provider: "COTIK",
      providerShopId: "cotik-shop-1",
      enabled: true,
      provenance: { source: "COTIK", capabilities: ["ORDERS"] },
      providerUpdatedAt: null,
      collectedAt: new Date(0),
      checkpoint: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  it("updates only checkpoint bookkeeping columns and returns the fresh row", async () => {
    const row = bindingRow();
    const db = fakeDb([row]);
    const checkpoint = { schemaVersion: "cotik-orders-checkpoint.v1", lastUpdatedAtMs: 1 };

    const result = await updateShopProviderBindingCheckpoint(
      db as never,
      row.shopId,
      "COTIK",
      checkpoint,
    );

    expect(result).toBe(row);
    const setValues = db.chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(setValues).sort()).toEqual(["checkpoint", "collectedAt", "updatedAt"]);
    expect(setValues.checkpoint).toEqual(checkpoint);
    expect(setValues.updatedAt).toBeInstanceOf(Date);
    expect(setValues.collectedAt).toBeInstanceOf(Date);
    expect(db.chain.where).toHaveBeenCalledTimes(1);
    expect(db.chain.returning).toHaveBeenCalledTimes(1);
  });

  it("returns null when no enabled binding row matched", async () => {
    const db = fakeDb([]);
    const result = await updateShopProviderBindingCheckpoint(
      db as never,
      randomUUID(),
      "COTIK",
      { cursor: 1 },
    );
    expect(result).toBeNull();
  });

  it("honors an explicit collectedAt instead of defaulting to now", async () => {
    const row = bindingRow();
    const db = fakeDb([row]);
    const collectedAt = new Date(1_700_000_000_000);

    await updateShopProviderBindingCheckpoint(
      db as never,
      row.shopId,
      "COTIK",
      { cursor: 1 },
      collectedAt,
    );

    const setValues = db.chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setValues.collectedAt).toBe(collectedAt);
  });
});
