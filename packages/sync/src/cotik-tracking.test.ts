import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@shop-health/db";

const mocks = vi.hoisted(() => ({
  findCotikLogicalShopById: vi.fn(), findCotikOrderById: vi.fn(),
  listActiveCotikAccounts: vi.fn(), listCotikAccountShopsByLogicalShop: vi.fn(),
  listObservationsForOrder: vi.fn(), listProviderCatalog: vi.fn(),
  createTrackingCandidate: vi.fn(), createOrGetPostIntent: vi.fn()
}));
vi.mock("@shop-health/db", () => mocks);
import { stageCotikTracking, resolveCotikTrackingInput } from "./cotik-tracking.js";

const input = { logicalShopId: "shop", orderId: "order", tracking: "JJD1234567890123456", provider: "DHL", region: "UK" as const };
const transaction = vi.fn();
const db = { transaction } as unknown as Database;
const tx = {} as Database;

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (operation) => operation(tx));
  mocks.findCotikLogicalShopById.mockResolvedValue({ id: "shop", maShopNoiBo: "123", region: "UK" });
  mocks.findCotikOrderById.mockResolvedValue({ winnerAccountId: "older", orderStatus: "AWAITING_SHIPMENT", tracking: null });
  mocks.listActiveCotikAccounts.mockResolvedValue([
    { id: "older", lastSeenAt: new Date("2026-09-01"), status: "ACTIVE" },
    { id: "latest", lastSeenAt: new Date("2026-09-07"), status: "ACTIVE" }
  ]);
  mocks.listCotikAccountShopsByLogicalShop.mockResolvedValue([
    { accountId: "older", discoveryState: "DISCOVERED" }, { accountId: "latest", discoveryState: "DISCOVERED" }
  ]);
  mocks.listObservationsForOrder.mockResolvedValue([
    { accountId: "older", orderStatus: "AWAITING_SHIPMENT", tracking: null, orderUpdateTime: new Date("2026-09-07") },
    { accountId: "latest", orderStatus: "AWAITING_SHIPMENT", tracking: null, orderUpdateTime: new Date("2026-09-01") }
  ]);
  mocks.listProviderCatalog.mockResolvedValue([{ region: "UK", providerId: "dhl", carrierName: "DHL", isActive: true }]);
  mocks.createTrackingCandidate.mockResolvedValue({ id: "candidate" });
  mocks.createOrGetPostIntent.mockResolvedValue({ id: "intent", status: "PENDING" });
});

describe("tracking staging boundary", () => {
  it.each(["CONFIRMED", "FAILED", "ABORTED", "IN_PROGRESS"])("does not report a %s intent as queued", async (status) => {
    mocks.createOrGetPostIntent.mockResolvedValue({ id: "intent", status });
    expect(await stageCotikTracking(db, input)).toEqual({ status: "PAUSED", reason: `INTENT_${status}` });
  });
  it("stages candidate and intent from the explicit provider without inferring from tracking", async () => {
    expect(await stageCotikTracking(db, input)).toEqual({ status: "STAGED", candidateId: "candidate", intentId: "intent" });
    expect(mocks.createOrGetPostIntent).toHaveBeenCalledWith(tx, { ...input, accountId: "latest", providerId: "dhl" });
    expect(mocks.createTrackingCandidate).toHaveBeenCalledWith(tx, { ...input, accountId: "latest", providerId: "dhl" });
  });
  it.each([null, { id: "shop", maShopNoiBo: "SHOP_1", region: "UK" }, { id: "shop", maShopNoiBo: "123", region: "US" }])("pauses absent/invalid/mismatched shop", async (shop) => {
    mocks.findCotikLogicalShopById.mockResolvedValue(shop);
    expect((await stageCotikTracking(db, input)).status).toBe("PAUSED");
    expect(mocks.createTrackingCandidate).not.toHaveBeenCalled();
  });
  it("pauses absent orders", async () => {
    mocks.findCotikOrderById.mockResolvedValue(null);
    expect((await stageCotikTracking(db, input)).status).toBe("PAUSED");
  });
  it("pauses unknown/cancelled statuses rather than inferring eligibility", async () => {
    mocks.listObservationsForOrder.mockResolvedValue([{ accountId: "latest", orderStatus: "UNKNOWN" }]);
    expect((await stageCotikTracking(db, input)).status).toBe("PAUSED");
  });
  it.each(["AWAITING_COLLECTION", "new"])("accepts Cotik tracking-write status %s", async (orderStatus) => {
    mocks.listObservationsForOrder.mockResolvedValue([{ accountId: "latest", orderStatus, tracking: null }]);
    expect(await resolveCotikTrackingInput(db, input)).toMatchObject({ status: "RESOLVED" });
  });
  it("pauses conflicting existing tracking", async () => {
    mocks.listObservationsForOrder.mockResolvedValue([{ accountId: "latest", orderStatus: "AWAITING_SHIPMENT", tracking: "OTHER" }]);
    expect((await stageCotikTracking(db, input)).status).toBe("PAUSED");
  });
  it("does not route through disconnected or unseen accounts", async () => {
    mocks.listCotikAccountShopsByLogicalShop.mockResolvedValue([]);
    expect((await stageCotikTracking(db, input)).status).toBe("PAUSED");
    mocks.listCotikAccountShopsByLogicalShop.mockResolvedValue([{ accountId: "latest", discoveryState: "DISCOVERED" }]);
    mocks.listActiveCotikAccounts.mockResolvedValue([{ id: "latest", lastSeenAt: null }]);
    expect((await stageCotikTracking(db, input)).status).toBe("PAUSED");
  });
  it("refuses an explicit provider that is not in the active catalog", async () => {
    mocks.listProviderCatalog.mockResolvedValue([]);
    expect((await stageCotikTracking(db, input)).status).toBe("PAUSED");
    expect(mocks.createTrackingCandidate).not.toHaveBeenCalled();
  });
  it("does not infer a provider alias from the explicit sheet value", async () => {
    mocks.listProviderCatalog.mockResolvedValue([{ region: "UK", providerId: "dhl", carrierName: "DHL", isActive: true }]);
    expect((await stageCotikTracking(db, { ...input, provider: "DHL Express" })).status).toBe("PAUSED");
    expect(mocks.createTrackingCandidate).not.toHaveBeenCalled();
  });
  it("propagates intent failure to roll back the candidate transaction", async () => {
    mocks.createOrGetPostIntent.mockRejectedValue(new Error("intent unavailable"));
    await expect(stageCotikTracking(db, input)).rejects.toThrow("intent unavailable");
    expect(transaction).toHaveBeenCalledOnce();
  });
  it("resolves without creating candidates or sending requests", async () => {
    expect(await resolveCotikTrackingInput(db, input)).toMatchObject({ status: "RESOLVED", input: { accountId: "latest", region: "UK" } });
    expect(mocks.createTrackingCandidate).not.toHaveBeenCalled();
  });
  it("rejects control characters and unsupported region before database access", async () => {
    expect((await stageCotikTracking(db, { ...input, tracking: "bad\nvalue" })).status).toBe("PAUSED");
    expect(mocks.findCotikLogicalShopById).not.toHaveBeenCalled();
  });
});
