import { randomUUID } from "node:crypto";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { shopProviderBindings } from "../schema.js";
import { upsertShopProviderBindingValuesSchema } from "./provider-bindings.js";

const validInput = {
  shopId: randomUUID(),
  provider: "COTIK",
  providerShopId: "  cotik-shop-1  ",
  provenance: {
    source: "COTIK",
    capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"],
  },
} as const;

describe("shop provider binding input validation", () => {
  it("parses a valid binding input into persisted insert values", () => {
    const values = upsertShopProviderBindingValuesSchema.parse(validInput);

    expect(values.providerShopId).toBe("cotik-shop-1");
    expect(values.enabled).toBe(true);
    expect(values.provenance).toEqual({
      source: "COTIK",
      capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"],
    });
    expect(values.collectedAt).toBeInstanceOf(Date);
    expect(Object.keys(values).sort()).toEqual(
      [
        "checkpoint",
        "collectedAt",
        "enabled",
        "provider",
        "providerShopId",
        "provenance",
        "providerUpdatedAt",
        "shopId",
      ].sort(),
    );
  });

  it("rejects unknown input fields so token-shaped fields cannot enter persistence", () => {
    expect(() =>
      upsertShopProviderBindingValuesSchema.parse({
        ...validInput,
        accessToken: "secret-token-value",
      }),
    ).toThrow(ZodError);
  });

  it("rejects a blank provider shop identity", () => {
    expect(() =>
      upsertShopProviderBindingValuesSchema.parse({ ...validInput, providerShopId: "   " }),
    ).toThrow(ZodError);
  });

  it("rejects a provenance source that contradicts the binding provider", () => {
    expect(() =>
      upsertShopProviderBindingValuesSchema.parse({
        ...validInput,
        provider: "SELLER_CENTER",
      }),
    ).toThrow(ZodError);
  });

  it("delegates capability rules so COTIK cannot claim OFFICIAL_ON_HOLD", () => {
    expect(() =>
      upsertShopProviderBindingValuesSchema.parse({
        ...validInput,
        provenance: { source: "COTIK", capabilities: ["ORDERS", "OFFICIAL_ON_HOLD"] },
      }),
    ).toThrow(ZodError);
  });

  it("allows SELLER_CENTER to declare OFFICIAL_ON_HOLD", () => {
    const values = upsertShopProviderBindingValuesSchema.parse({
      ...validInput,
      provider: "SELLER_CENTER",
      provenance: {
        source: "SELLER_CENTER",
        capabilities: ["ORDERS", "OFFICIAL_ON_HOLD"],
      },
    });
    expect(values.provider).toBe("SELLER_CENTER");
  });

  it("rejects a non-object checkpoint payload", () => {
    expect(() =>
      upsertShopProviderBindingValuesSchema.parse({ ...validInput, checkpoint: ["not-an-object"] }),
    ).toThrow(ZodError);
  });
});

describe("shop provider bindings persisted projection", () => {
  /** The exact persisted surface; any addition must be an explicit, reviewed decision. */
  const allowedColumns = new Set([
    "id",
    "shopId",
    "provider",
    "providerShopId",
    "enabled",
    "provenance",
    "providerUpdatedAt",
    "collectedAt",
    "checkpoint",
    "createdAt",
    "updatedAt",
  ]);

  it("defines exactly the allowed columns and no token or credential fields", () => {
    const columns = Object.keys(getTableColumns(shopProviderBindings));
    expect(new Set(columns)).toEqual(allowedColumns);
    expect(
      columns.filter((column) =>
        /token|secret|password|cookie|credential|api[_-]?key/i.test(column),
      ),
    ).toEqual([]);
  });
});
