import { describe, expect, it } from "vitest";

import { CanonicalOrderStatusSchema, NormalizedOrderBatchSchema, NormalizedOrderSchema } from "./orders.js";

describe("CanonicalOrderStatusSchema", () => {
  it.each(["UNPAID", "ON_HOLD", "AWAITING_COLLECTION"])(
    "accepts the additive COTIK-era status %s",
    (status) => {
      expect(CanonicalOrderStatusSchema.parse(status)).toBe(status);
    },
  );

  it.each(["PENDING", "CANCELED", "UNKNOWN"])("keeps the pre-existing status %s", (status) => {
    expect(CanonicalOrderStatusSchema.parse(status)).toBe(status);
  });
});

describe("NormalizedOrderSchema", () => {
  it("keeps Ready-to-Ship separate from delivery timestamps", () => {
    const readyToShipAt = new Date("2026-08-14T01:00:00.000Z");
    const order = NormalizedOrderSchema.parse(orderInput({ readyToShipAt }));

    expect(order.readyToShipAt).toEqual(readyToShipAt);
    expect(order.latestDeliveryAt).toBeNull();
  });

  it("preserves an unobserved Ready-to-Ship timestamp as null", () => {
    expect(NormalizedOrderSchema.parse(orderInput()).readyToShipAt).toBeNull();
  });
});

describe("NormalizedOrderBatchSchema", () => {
  it("preserves the explicit non-lifetime Seller Center source window", () => {
    const batch = NormalizedOrderBatchSchema.parse({
      orders: [],
      checkpoint: null,
      complete: true,
      sourceWindow: {
        source: "SELLER_CENTER",
        kind: "ROLLING_MONTHS",
        months: 12,
        lifetimeHistory: false,
      },
    });

    expect(batch).toMatchObject({
      complete: true,
      sourceWindow: {
        source: "SELLER_CENTER",
        kind: "ROLLING_MONTHS",
        months: 12,
        lifetimeHistory: false,
      },
    });
  });
});

function orderInput(overrides: Record<string, unknown> = {}) {
  const observedAt = new Date("2026-08-14T00:00:00.000Z");
  return {
    shopId: "shop-1",
    sourceOrderId: "order-1",
    createdAt: observedAt,
    paidAt: observedAt,
    sourceUpdatedAt: observedAt,
    latestDeliveryAt: null,
    sourceStatus: "Awaiting shipment",
    sourceSubStatus: null,
    canonicalStatus: "AWAITING_SHIPMENT",
    grandTotal: "10.00",
    currency: "USD",
    trackingNumber: null,
    carrier: null,
    refundAmount: null,
    refundStatus: null,
    deliveryEligible: true,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    sourceHash: "order-hash-1",
    sourceSchemaVersion: "seller-center-orders.v1",
    rawData: {},
    ...overrides,
  };
}
