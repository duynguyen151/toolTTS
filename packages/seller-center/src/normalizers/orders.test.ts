import { describe, expect, it } from "vitest";

import { RawOrderSchema } from "../extractors/schemas.js";
import { normalizeOrder } from "./orders.js";

describe("normalizeOrder", () => {
  it("keeps only allowlisted operational data", () => {
    const raw = RawOrderSchema.parse({
      main_order_id: "order-1",
      trade_order_module: {
        create_time: "1700000000",
        payment_time: "1700000001",
        latest_delivery_time: "1700086400",
      },
      order_status_module: [{ main_order_status: 101, main_sub_order_status: 1 }],
      fulfillment_module: [{
        rts_time: "1700000001500",
        update_time: "1700000002000",
      }],
      delivery_module: [{
        tracking_no: "TRACK-1",
        logistics_service_info: { logistics_service_name: "Carrier", logistics_service_level: "Standard" },
      }],
      price_module: { grand_total: { price_val: "12.34", currency: "usd" } },
      buyer_info_module: { buyer_name: "must not persist" },
    });

    const normalized = normalizeOrder(raw, "shop-1", new Date("2026-01-01T00:00:00Z"));

    expect(normalized.canonicalStatus).toBe("AWAITING_SHIPMENT");
    expect(normalized.currency).toBe("USD");
    expect(normalized.readyToShipAt).toEqual(new Date("2023-11-14T22:13:21.500Z"));
    expect(normalized.trackingNumber).toBe("TRACK-1");
    expect(JSON.stringify(normalized.rawData)).not.toContain("must not persist");
  });

  it("does not guess unknown status codes", () => {
    const raw = RawOrderSchema.parse({
      main_order_id: "order-2",
      trade_order_module: {},
      order_status_module: [{ main_order_status: 9999 }],
      price_module: { grand_total: { price_val: "1", currency: "USD" } },
    });
    expect(normalizeOrder(raw, "shop-1").canonicalStatus).toBe("UNKNOWN");
  });

  it("maps the live Delivered source status confirmed by profile 957", () => {
    const raw = RawOrderSchema.parse({
      main_order_id: "order-delivered",
      trade_order_module: {},
      order_status_module: [{
        main_order_status: 102,
        main_sub_order_status: 310,
        sku_display_status: 122,
      }],
      price_module: { grand_total: { price_val: "1", currency: "USD" } },
    });

    expect(normalizeOrder(raw, "shop-1").canonicalStatus).toBe("DELIVERED");
  });

  it("maps the live Canceled source status confirmed by profile 957", () => {
    const raw = RawOrderSchema.parse({
      main_order_id: "order-canceled",
      trade_order_module: {},
      order_status_module: [{
        main_order_status: 104,
        main_sub_order_status: 0,
        sku_display_status: 140,
      }],
      price_module: { grand_total: { price_val: "1", currency: "USD" } },
    });

    expect(normalizeOrder(raw, "shop-1").canonicalStatus).toBe("CANCELED");
  });

  it("captures allowlisted reverse source codes and timestamps", () => {
    const raw = RawOrderSchema.parse(orderInput({
      reverse_module: [reverseModule()],
    }));

    const normalized = normalizeOrder(raw, "shop-1");

    expect(normalized.refundStatus).toBe(
      '{"source":"SELLER_CENTER_REVERSE","reverseStatus":"100","reverseTabStatus":"52","reverseType":"4","reverseFrom":"1"}',
    );
    expect(normalized.rawData).toMatchObject({
      reverse: {
        reverseStatus: "100",
        reverseTabStatus: "52",
        reverseType: "4",
        reverseFrom: "1",
        cancelledTime: "1700000100",
        refundTime: "1700000200",
        sellerAutoApproveTime: "1700000300",
      },
    });
  });

  it("strips reverse reason text and unapproved reverse fields", () => {
    const rawWithSensitiveReverse = RawOrderSchema.parse(orderInput({
      reverse_module: [{
        ...reverseModule(),
        reverse_reason: "buyer reason must not persist",
        order_line_ids: ["line-secret"],
        provider_payload: { internal_note: "provider secret" },
      }],
    }));

    const normalized = normalizeOrder(rawWithSensitiveReverse, "shop-1");
    const serialized = JSON.stringify(normalized.rawData);

    expect(serialized).not.toContain("buyer reason must not persist");
    expect(serialized).not.toContain("line-secret");
    expect(serialized).not.toContain("provider secret");
    expect(serialized).not.toContain("reverse_reason");
    expect(serialized).not.toContain("order_line_ids");
    expect(serialized).not.toContain("provider_payload");
  });

  it("keeps reverse-derived fields null when reverse_module is absent", () => {
    const normalized = normalizeOrder(RawOrderSchema.parse(orderInput()), "shop-1");

    expect(normalized.refundStatus).toBeNull();
    expect(normalized.refundAmount).toBeNull();
    expect(normalized.rawData).toMatchObject({ reverse: null });
  });

  it("keeps reverse-derived fields null when reverse_module is empty", () => {
    const normalized = normalizeOrder(RawOrderSchema.parse(orderInput({
      reverse_module: [],
    })), "shop-1");

    expect(normalized.refundStatus).toBeNull();
    expect(normalized.refundAmount).toBeNull();
    expect(normalized.rawData).toMatchObject({ reverse: null });
  });

  it("does not fabricate a refund amount from reverse metadata", () => {
    const normalized = normalizeOrder(RawOrderSchema.parse(orderInput({
      reverse_module: [reverseModule()],
    })), "shop-1");

    expect(normalized.refundAmount).toBeNull();
  });

  it("includes sanitized reverse codes in the source hash", () => {
    const first = normalizeOrder(RawOrderSchema.parse(orderInput({
      reverse_module: [reverseModule()],
    })), "shop-1");
    const second = normalizeOrder(RawOrderSchema.parse(orderInput({
      reverse_module: [reverseModule({ reverse_status: 101 })],
    })), "shop-1");

    expect(first.sourceHash).not.toBe(second.sourceHash);
  });

  it("rejects an unproven object-shaped reverse_module fallback", () => {
    expect(() => RawOrderSchema.parse(orderInput({
      reverse_module: reverseModule(),
    }))).toThrow();
  });

  it("rejects more than one reverse record until multi-reverse semantics are proven", () => {
    expect(() => RawOrderSchema.parse(orderInput({
      reverse_module: [reverseModule(), reverseModule({ reverse_status: 101 })],
    }))).toThrow();
  });

  it.each(["cancelled_time", "refund_time", "seller_auto_approve_time"])(
    "rejects non-epoch text in reverse timestamp field %s",
    (field) => {
      expect(() => RawOrderSchema.parse(orderInput({
        reverse_module: [reverseModule({ [field]: "provider text" })],
      }))).toThrow();
    },
  );

  it.each(["reverse_status", "reverse_tab_status", "reverse_type", "reverse_from"])(
    "rejects non-integer reverse source code %s",
    (field) => {
      expect(() => RawOrderSchema.parse(orderInput({
        reverse_module: [reverseModule({ [field]: 1.5 })],
      }))).toThrow();
    },
  );

  it("versions the expanded reverse-aware rawData contract as v2", () => {
    const normalized = normalizeOrder(RawOrderSchema.parse(orderInput()), "shop-1");

    expect(normalized.sourceSchemaVersion).toBe("seller-center-us-orders.v2");
  });
});

function orderInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    main_order_id: "order-reverse",
    trade_order_module: {},
    order_status_module: [{ main_order_status: 104, main_sub_order_status: 0 }],
    price_module: { grand_total: { price_val: "1", currency: "USD" } },
    ...overrides,
  };
}

function reverseModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reverse_status: 100,
    reverse_tab_status: 52,
    reverse_type: 4,
    reverse_from: 1,
    cancelled_time: "1700000100",
    refund_time: "1700000200",
    seller_auto_approve_time: "1700000300",
    ...overrides,
  };
}
