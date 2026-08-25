import { describe, expect, it } from "vitest";

import { normalizeCotikOrder } from "./orders.js";

const OBSERVED_AT = new Date("2026-01-01T00:00:00.000Z");

describe("normalizeCotikOrder status mapping", () => {
  it.each([
    ["UNPAID", "UNPAID"],
    ["ON_HOLD", "ON_HOLD"],
    ["AWAITING_SHIPMENT", "AWAITING_SHIPMENT"],
    ["AWAITING_COLLECTION", "AWAITING_COLLECTION"],
    ["IN_TRANSIT", "IN_TRANSIT"],
    ["DELIVERED", "DELIVERED"],
    ["COMPLETED", "COMPLETED"],
    ["CANCELLED", "CANCELED"],
  ])("maps every documented COTIK source status %s to canonical %s", (source, expected) => {
    const normalized = normalizeCotikOrder(cotikOrder({ status: source }), "shop-1", OBSERVED_AT);

    expect(normalized.canonicalStatus).toBe(expected);
    expect(normalized.sourceStatus).toBe(source);
  });

  it("keeps an undocumented source status explicitly UNKNOWN", () => {
    const normalized = normalizeCotikOrder(
      cotikOrder({ status: "SOME_FUTURE_STATUS" }),
      "shop-1",
      OBSERVED_AT,
    );

    expect(normalized.canonicalStatus).toBe("UNKNOWN");
  });
});

describe("normalizeCotikOrder preservation", () => {
  it("normalizes each supplied source order one-to-one without dropping any", () => {
    const sources = [
      cotikOrder({ apiOrderId: "order-a", status: "UNPAID" }),
      cotikOrder({ apiOrderId: "order-b", status: "CANCELLED" }),
      cotikOrder({ apiOrderId: "order-c", status: "MYSTERY" }),
    ];

    const normalized = sources.map((source) => normalizeCotikOrder(source, "shop-1", OBSERVED_AT));

    expect(normalized.map((order) => order.sourceOrderId)).toEqual(["order-a", "order-b", "order-c"]);
  });

  it("reconciles the status distribution total across documented and unknown statuses", () => {
    const statuses = [
      "UNPAID",
      "ON_HOLD",
      "AWAITING_SHIPMENT",
      "AWAITING_COLLECTION",
      "IN_TRANSIT",
      "DELIVERED",
      "COMPLETED",
      "CANCELLED",
      "TOTALLY_UNDOCUMENTED",
    ];

    const normalized = statuses.map((status, index) =>
      normalizeCotikOrder(cotikOrder({ apiOrderId: `order-${index}`, status }), "shop-1", OBSERVED_AT));
    const distribution = new Map<string, number>();
    for (const order of normalized) {
      distribution.set(order.canonicalStatus, (distribution.get(order.canonicalStatus) ?? 0) + 1);
    }

    const total = [...distribution.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(statuses.length);
    expect(distribution.size).toBe(statuses.length);
    expect(distribution.get("UNKNOWN")).toBe(1);
    expect(distribution.get("CANCELED")).toBe(1);
  });
});

describe("normalizeCotikOrder field normalization", () => {
  it("normalizes non-PII operational values from the documented payload", () => {
    const normalized = normalizeCotikOrder(cotikOrder(), "shop-1", OBSERVED_AT);

    expect(normalized.grandTotal).toBe("19.99");
    expect(normalized.currency).toBe("USD");
    expect(normalized.createdAt).toEqual(new Date(1724140800 * 1000));
    expect(normalized.sourceUpdatedAt).toEqual(new Date(1724141000 * 1000));
    expect(normalized.latestDeliveryAt).toBeNull();
    expect(normalized.trackingNumber).toBe("TRACK-1");
    expect(normalized.sourceSubStatus).toBe("new");
    expect(normalized.deliveryEligible).toBeNull();
  });

  it("uppercases lowercase source currency without inventing a default", () => {
    const raw = cotikOrder();
    raw.payment.currency = "usd";

    expect(normalizeCotikOrder(raw, "shop-1", OBSERVED_AT).currency).toBe("USD");
  });

  it("maps absent optional fields and zero sentinel timestamps to null", () => {
    const raw = cotikOrder();
    delete raw._id;
    delete raw.order_status;
    delete raw.shipping_type;
    delete raw.tracking_number;
    delete raw.update_time;
    delete raw.line_items;
    delete raw.shops;
    raw.delivery_time = 0;
    raw.cancel_time = 0;

    const normalized = normalizeCotikOrder(raw, "shop-1", OBSERVED_AT);

    expect(normalized.sourceSubStatus).toBeNull();
    expect(normalized.trackingNumber).toBeNull();
    expect(normalized.carrier).toBeNull();
    expect(normalized.paidAt).toBeNull();
    expect(normalized.readyToShipAt).toBeNull();
    expect(normalized.latestDeliveryAt).toBeNull();
    expect(normalized.refundAmount).toBeNull();
    expect(normalized.refundStatus).toBeNull();
    expect(normalized.sourceUpdatedAt).toBeNull();
    expect(normalized.rawData).toMatchObject({
      cotikId: null,
      workStatus: null,
      shippingType: null,
      trackingNumber: null,
      updatedAt: null,
      // Raw sentinel zeros stay preserved in rawData; only normalized fields become null.
      deliveredAt: 0,
      canceledAt: 0,
      cotikShopId: null,
      lineItemSummaries: [],
    });
  });

  it.each([
    ["a missing apiOrderId", cotikOrder({ apiOrderId: undefined })],
    ["a missing status", cotikOrder({ status: undefined })],
    ["a non-decimal payment total", cotikOrder({}, { total_amount: "free" })],
    ["a negative payment total", cotikOrder({}, { total_amount: "-5.00" })],
  ])("rejects %s instead of inventing values", (_label, raw) => {
    expect(() => normalizeCotikOrder(raw, "shop-1", OBSERVED_AT)).toThrow();
  });
});

describe("normalizeCotikOrder privacy minimization", () => {
  it("keeps an allowlisted rawData with no customer, recipient, address, phone, or name fields", () => {
    const normalized = normalizeCotikOrder(cotikOrder(), "shop-1", OBSERVED_AT);

    expect(Object.keys(normalized.rawData).sort()).toEqual([
      "canceledAt",
      "cotikId",
      "cotikShopId",
      "createdAt",
      "deliveredAt",
      "lineItemSummaries",
      "rtsSlaAt",
      "shippingType",
      "status",
      "trackingNumber",
      "ttsSlaAt",
      "updatedAt",
      "workStatus",
      "payment",
    ].sort());

    const serialized = JSON.stringify(normalized.rawData);
    for (const forbidden of [
      "Pii Recipient",
      "1 PII Street",
      "5550100",
      "please wrap as gift",
      "My Shop Name",
      "SHOP01",
      "Secret Product Name",
      "Secret SKU Name",
      "recipient",
      "buyer",
      "phone",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("summarizes line items as product/SKU operational values only", () => {
    const normalized = normalizeCotikOrder(cotikOrder(), "shop-1", OBSERVED_AT);

    expect(normalized.rawData.lineItemSummaries).toEqual([{
      productId: "172900000000000000",
      skuId: "172900000000999999",
      sellerSku: "SELLER-SKU-1",
      salePrice: "19.99",
      currency: "USD",
    }]);
    expect(JSON.stringify(normalized.rawData)).not.toContain("Secret Product Name");
  });
});

describe("normalizeCotikOrder determinism", () => {
  it("derives a sha256 sourceHash independent of observation time", () => {
    const raw = cotikOrder();

    const first = normalizeCotikOrder(raw, "shop-1", new Date("2026-01-01T00:00:00Z"));
    const second = normalizeCotikOrder(raw, "shop-1", new Date("2027-02-02T12:34:56Z"));

    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the sourceHash when operational content changes", () => {
    const first = normalizeCotikOrder(cotikOrder(), "shop-1", OBSERVED_AT);
    const second = normalizeCotikOrder(cotikOrder({ status: "DELIVERED" }), "shop-1", OBSERVED_AT);

    expect(first.sourceHash).not.toBe(second.sourceHash);
  });

  it("versions the COTIK rawData contract as v1", () => {
    expect(normalizeCotikOrder(cotikOrder(), "shop-1", OBSERVED_AT).sourceSchemaVersion).toBe(
      "cotik-us-orders.v1",
    );
  });
});

function cotikOrder(
  overrides: Record<string, unknown> = {},
  paymentOverrides: Record<string, unknown> = {},
): any {
  return {
    _id: "66c1f0aabbccddeeff001122",
    apiOrderId: "576461234567890123",
    status: "AWAITING_SHIPMENT",
    order_status: "new",
    shipping_type: "SELLER",
    tracking_number: "TRACK-1",
    create_time: 1724140800,
    update_time: 1724141000,
    tts_sla_time: 1724400000,
    rts_sla_time: 1724400000,
    delivery_time: 0,
    cancel_time: 0,
    recipient_address: {
      name: "Pii Recipient",
      address_line1: "1 PII Street",
      city: "Austin",
      state: "TX",
      postal_code: "73301",
      region_code: "US",
      phone_number: "5550100000",
    },
    line_items: [{
      id: "577600000000000000",
      product_id: "172900000000000000",
      product_name: "Secret Product Name",
      sku_id: "172900000000999999",
      sku_name: "Secret SKU Name",
      seller_sku: "SELLER-SKU-1",
      sale_price: "19.99",
      currency: "USD",
    }],
    payment: {
      currency: "USD",
      total_amount: "19.99",
      sub_total: "19.99",
      shipping_fee: "0.00",
      ...paymentOverrides,
    },
    shops: { _id: "66b0c0000000000000aa1122", name: "My Shop Name", code: "SHOP01", note: "" },
    buyer_message: "please wrap as gift",
    is_sample_order: false,
    is_replacement_order: false,
    ...overrides,
  };
}
