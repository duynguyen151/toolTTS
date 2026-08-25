import { describe, expect, it } from "vitest";

import {
  buildOrderExplorerSummary,
  listOrderExplorerItems,
  toOrderExplorerDetail,
  toOrderExplorerListItem,
  type OrderExplorerRecord,
} from "./order-explorer.js";

const observedAt = new Date("2026-08-14T00:00:00.000Z");

function record(overrides: Partial<OrderExplorerRecord> = {}): OrderExplorerRecord {
  return {
    sourceOrderId: "order-1",
    sourceStatus: "Awaiting shipment",
    sourceSubStatus: null,
    canonicalStatus: "AWAITING_SHIPMENT",
    orderCreatedAt: observedAt,
    paidAt: observedAt,
    sourceUpdatedAt: observedAt,
    readyToShipAt: null,
    latestDeliveryAt: null,
    grandTotal: "19.99",
    currency: "USD",
    trackingNumber: "TRACK-1",
    carrier: "Carrier",
    refundAmount: null,
    refundStatus: null,
    deliveryEligible: true,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    ...overrides,
  };
}

describe("Order Explorer read projections", () => {
  it("returns a privacy-minimized list-query interface", () => {
    expect(listOrderExplorerItems).toBeTypeOf("function");
  });

  it("keeps list items privacy-minimized through an explicit allowlist", () => {
    const item = toOrderExplorerListItem({ ...record(), recipientName: "Buyer Name", phone: "555-0100", address: "1 Private Street", buyerMessage: "private message" } as OrderExplorerRecord);

    expect(item).toEqual({
      sourceOrderId: "order-1",
      canonicalStatus: "AWAITING_SHIPMENT",
      paidAt: observedAt,
      grandTotal: "19.99",
      currency: "USD",
    });
    expect(JSON.stringify(item)).not.toMatch(/Buyer Name|555-0100|Private Street|private message/);
  });

  it("keeps operational detail allowlisted without raw customer data", () => {
    const detail = toOrderExplorerDetail({ ...record(), recipientName: "Buyer Name", phone: "555-0100", address: "1 Private Street", buyerMessage: "private message" } as OrderExplorerRecord);

    expect(detail).toMatchObject({
      sourceOrderId: "order-1",
      trackingNumber: "TRACK-1",
      carrier: "Carrier",
      sourceStatus: "Awaiting shipment",
      deliveryEligible: true,
    });
    expect(JSON.stringify(detail)).not.toMatch(/Buyer Name|555-0100|Private Street|private message/);
  });

  it("reconciles every status including UNKNOWN with the filtered population", () => {
    const summary = buildOrderExplorerSummary([
      record({ sourceOrderId: "known", canonicalStatus: "DELIVERED" }),
      record({ sourceOrderId: "unknown", canonicalStatus: "UNKNOWN" }),
      record({ sourceOrderId: "unknown-2", canonicalStatus: "UNKNOWN" }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.coverage).toEqual({ availableFrom: observedAt, availableTo: observedAt });
    expect(summary.statusDistribution).toEqual([
      { canonicalStatus: "DELIVERED", count: 1 },
      { canonicalStatus: "UNKNOWN", count: 2 },
    ]);
    expect(summary.statusDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(summary.total);
  });
});
