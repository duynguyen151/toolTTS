import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  closeDatabase: vi.fn(), createDatabase: vi.fn(() => ({ db: {} })), findShopByProfileNo: vi.fn(),
  getOrderExplorerDetail: vi.fn(), listOrderExplorerItems: vi.fn(), summarizeOrderExplorerRecords: vi.fn(),
}));
vi.mock("@shop-health/db", () => db);
import OrderExplorerPage from "./page.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
describe("OrderExplorerPage", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://test";
    db.findShopByProfileNo.mockResolvedValue({ id: "shop-957", profileNo: "957", dataOrigin: "LIVE" });
    db.listOrderExplorerItems.mockResolvedValue([{ sourceOrderId: "order-1", canonicalStatus: "DELIVERED", paidAt: new Date("2026-01-10T00:00:00.000Z"), grandTotal: "19.99", currency: "USD" }]);
    db.summarizeOrderExplorerRecords.mockResolvedValue({ total: 1, coverage: { availableFrom: new Date("2026-01-01T00:00:00.000Z"), availableTo: new Date("2026-01-31T00:00:00.000Z") }, statusDistribution: [{ canonicalStatus: "DELIVERED", count: 1 }] });
    db.getOrderExplorerDetail.mockResolvedValue({ sourceOrderId: "order-1", canonicalStatus: "DELIVERED", paidAt: new Date("2026-01-10T00:00:00.000Z"), grandTotal: "19.99", currency: "USD", sourceStatus: "Delivered", sourceSubStatus: null, orderCreatedAt: null, sourceUpdatedAt: null, readyToShipAt: null, latestDeliveryAt: null, trackingNumber: "TRACK-1", carrier: "Carrier", refundAmount: null, refundStatus: null, deliveryEligible: true });
  });
  afterEach(() => { if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl; vi.clearAllMocks(); });
  it("renders filterable, paginated, privacy-minimized order inspection", async () => {
    const html = renderToStaticMarkup(await OrderExplorerPage({ searchParams: Promise.resolve({ profile: "957", period: "30D", status: "DELIVERED", search: "order", page: "2", order: "order-1" }) }));
    expect(html).toContain('aria-label="Order filters"');
    expect(html).toContain('aria-label="Order pagination"');
    expect(html).toContain("Persisted coverage: 2026-01-01 to 2026-01-31 (not a lifetime-history claim)");
    expect(html).toContain("Order detail");
    expect(html).toContain("TRACK-1");
    expect(html).toContain('href="/shops/957"');
    expect(html).toContain("Quay lại Chi tiết Cửa hàng / Shop Detail (Profile #957)");
    expect(html).not.toMatch(/recipient|buyer|phone|address/i);
  });
});
