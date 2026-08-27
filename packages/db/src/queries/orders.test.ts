import { describe, expect, it, vi } from "vitest";

import { getFullPersistedRiskOrderFacts } from "./orders.js";

function databaseReturning(rows: readonly Record<string, unknown>[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.groupBy.mockReturnValue(query);
  query.orderBy.mockResolvedValue(rows);
  return {
    select: vi.fn(() => query),
  };
}

describe("persisted risk-order provenance", () => {
  it("fails closed for a mixed persisted Seller Center and COTIK order population", async () => {
    const db = databaseReturning([{
      canonicalStatus: "DELIVERED",
      currency: "USD",
      orderCount: 5,
      totalValue: "50.0000",
      firstObservedAt: new Date("2026-08-14T00:00:00.000Z"),
      lastObservedAt: new Date("2026-08-14T00:00:00.000Z"),
      sourceSchemaVersions: ["seller-center-us-orders.v2", "cotik-us-orders.v1"],
    }]);

    const facts = await getFullPersistedRiskOrderFacts(db as never, "shop-1");

    expect((facts[0] as unknown as { deliverySource?: unknown }).deliverySource).toBeNull();
  });

  it("does not classify unknown persisted order schemas as Seller Center evidence", async () => {
    const db = databaseReturning([{
      canonicalStatus: "DELIVERED",
      currency: "USD",
      orderCount: 5,
      totalValue: "50.0000",
      firstObservedAt: new Date("2026-08-14T00:00:00.000Z"),
      lastObservedAt: new Date("2026-08-14T00:00:00.000Z"),
      sourceSchemaVersions: ["legacy-orders.v1"],
    }]);

    const facts = await getFullPersistedRiskOrderFacts(db as never, "shop-1");

    expect((facts[0] as unknown as { deliverySource?: unknown }).deliverySource).toBeNull();
  });
});
