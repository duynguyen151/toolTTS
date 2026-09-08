import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route.js";

const mocks = vi.hoisted(() => ({
  closeDatabase: vi.fn(),
  createDatabase: vi.fn(),
  findCotikLogicalShopById: vi.fn(),
  stageCotikTracking: vi.fn(),
}));

vi.mock("@shop-health/db", () => ({
  closeDatabase: mocks.closeDatabase,
  createDatabase: mocks.createDatabase,
  findCotikLogicalShopById: mocks.findCotikLogicalShopById,
}));

vi.mock("@shop-health/sync", () => ({
  stageCotikTracking: mocks.stageCotikTracking,
}));

describe("/api/cotik/tracking POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
    mocks.createDatabase.mockReturnValue({ db: {} });
    mocks.closeDatabase.mockResolvedValue(undefined);
  });

  it("rejects malformed input before opening the database", async () => {
    const response = await POST(new Request("http://localhost:3000/api/cotik/tracking", {
      method: "POST",
      body: JSON.stringify({ logicalShopId: "not-a-uuid", orderId: "", tracking: "", provider: "", region: "US" }),
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(mocks.createDatabase).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(new Request("http://localhost:3000/api/cotik/tracking", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({
        logicalShopId: "00000000-0000-4000-8000-000000000001",
        orderId: "ORDER-1",
        tracking: "GFU123",
        provider: "7352739623900022544",
        region: "US",
      }),
    }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(mocks.createDatabase).not.toHaveBeenCalled();
  });

  it("rejects an unknown logical shop", async () => {
    mocks.findCotikLogicalShopById.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost:3000/api/cotik/tracking", {
      method: "POST",
      body: JSON.stringify({
        logicalShopId: "00000000-0000-4000-8000-000000000001",
        orderId: "ORDER-1",
        tracking: "GFU123",
        provider: "7352739623900022544",
        region: "US",
      }),
    }));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("LOGICAL_SHOP_NOT_FOUND");
    expect(mocks.stageCotikTracking).not.toHaveBeenCalled();
  });

  it("requires the submitted region to match the selected logical shop", async () => {
    mocks.findCotikLogicalShopById.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      maShopNoiBo: "SHOP-UK",
      region: "UK",
    });

    const response = await POST(new Request("http://localhost:3000/api/cotik/tracking", {
      method: "POST",
      body: JSON.stringify({
        logicalShopId: "00000000-0000-4000-8000-000000000001",
        orderId: "ORDER-1",
        tracking: "GFU123",
        provider: "7352739623900022544",
        region: "US",
      }),
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REGION_MISMATCH");
    expect(mocks.stageCotikTracking).not.toHaveBeenCalled();
  });

  it("stages dry preparation while the kill switch is off", async () => {
    mocks.findCotikLogicalShopById.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      maShopNoiBo: "SHOP-US",
      region: "US",
    });
    mocks.stageCotikTracking.mockResolvedValue({
      status: "STAGED",
      candidateId: "candidate-1",
      intentId: "intent-1",
    });
    const response = await POST(new Request("http://localhost:3000/api/cotik/tracking", {
      method: "POST",
      body: JSON.stringify({
        logicalShopId: "00000000-0000-4000-8000-000000000001",
        orderId: "ORDER-1",
        tracking: "GFU123",
        provider: "7352739623900022544",
        region: "US",
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "STAGED", candidateId: "candidate-1", intentId: "intent-1" });
    expect(mocks.stageCotikTracking).toHaveBeenCalledOnce();
  });

  it("stages tracking through the shared pipeline with the explicit provider", async () => {
    mocks.findCotikLogicalShopById.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      maShopNoiBo: "SHOP-US",
      region: "US",
    });
    mocks.stageCotikTracking.mockResolvedValue({
      status: "STAGED",
      candidateId: "candidate-1",
      intentId: "intent-1",
    });

    const response = await POST(new Request("http://localhost:3000/api/cotik/tracking", {
      method: "POST",
      body: JSON.stringify({
        logicalShopId: "00000000-0000-4000-8000-000000000001",
        orderId: "ORDER-1",
        tracking: "GFU123",
        provider: "7352739623900022544",
        region: "US",
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "STAGED",
      candidateId: "candidate-1",
      intentId: "intent-1",
    });
    expect(mocks.stageCotikTracking).toHaveBeenCalledWith({}, {
      logicalShopId: "00000000-0000-4000-8000-000000000001",
      orderId: "ORDER-1",
      tracking: "GFU123",
      provider: "7352739623900022544",
      region: "US",
    });
  });

  it("does not expose caught pipeline error details", async () => {
    mocks.findCotikLogicalShopById.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      maShopNoiBo: "SHOP-US",
      region: "US",
    });
    mocks.stageCotikTracking.mockRejectedValue(new Error("postgres://user:secret@db/raw SQL"));

    const response = await POST(new Request("http://localhost:3000/api/cotik/tracking", {
      method: "POST",
      body: JSON.stringify({
        logicalShopId: "00000000-0000-4000-8000-000000000001",
        orderId: "ORDER-1",
        tracking: "GFU123",
        provider: "7352739623900022544",
        region: "US",
      }),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "COTIK_TRACKING_STAGE_FAILED", message: "Tracking could not be staged." },
    });
  });
});
