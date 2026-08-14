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
      fulfillment_module: [{ update_time: "1700000002000" }],
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
});
