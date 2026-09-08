import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkOrderTrackingReady,
  postCotikTrackingBatch,
  type CotikTrackingItem
} from "./tracking-writer.js";
import type { MultiAccountCotikClient } from "./multi-account-client.js";

describe("postCotikTrackingBatch", () => {
  let mockClient: MultiAccountCotikClient;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGet = vi.fn();
    mockPost = vi.fn();
    mockClient = {
      accountId: "acc-1",
      get: mockGet,
      post: mockPost,
      diagnoseHealth: vi.fn()
    };
  });

  it("fails closed when persisted authorization is OFF without making any network call", async () => {
    const items: CotikTrackingItem[] = [
      {
        orderId: "ord-1",
        tracking: "GFU123456789012345",
        providerId: "7352739623900022544"
      }
    ];

    const result = await postCotikTrackingBatch({
      client: mockClient,
      items,
      isPostAuthorized: vi.fn().mockResolvedValue(false)
    });

    expect(result.status).toBe("REFUSED_KILL_SWITCH");
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.confirmedOrders).toHaveLength(0);
  });

  it("rejects items without an explicit resolved provider without posting", async () => {
    const items: CotikTrackingItem[] = [
      {
        orderId: "ord-unproven",
        tracking: "UNKNOWN123456789",
        providerId: ""
      },
      {
        orderId: "ord-wrong-provider",
        tracking: "GFU123456789012345",
        providerId: "wrong-id"
      }
    ];

    const result = await postCotikTrackingBatch({
      client: mockClient,
      items,
      isPostAuthorized: vi.fn().mockResolvedValue(true)
    });

    expect(result.status).toBe("REJECTED_INVALID_PROVIDER");
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.rejectedItems).toHaveLength(2);
  });

  it("posts valid batch, checks logUpdate, and confirms tracking via readback", async () => {
    const items: CotikTrackingItem[] = [
      {
        orderId: "ord-valid",
        tracking: "GFU123456789012345",
        providerId: "7352739623900022544"
      }
    ];

    mockPost.mockResolvedValue({ logUpdate: [] });
    // Readback confirmation returns matching tracking
    mockGet.mockResolvedValue({
      listorders: [
        {
          apiOrderId: "ord-valid",
          tracking_number: "GFU123456789012345"
        }
      ]
    });

    const result = await postCotikTrackingBatch({
      client: mockClient,
      items,
      isPostAuthorized: vi.fn().mockResolvedValue(true)
    });

    expect(result.status).toBe("CONFIRMED");
    expect(mockPost).toHaveBeenCalledWith(
      "/order/import-tracking-v2",
      {
        list: [
          {
            apiOrderId: "ord-valid",
            tracking_number: "GFU123456789012345",
            provider: "7352739623900022544"
          }
        ]
      },
      expect.anything()
    );
    expect(result.confirmedOrders).toEqual(["ord-valid"]);
    expect(result.failedOrders).toHaveLength(0);
  });

  it("records failed orders reported by logUpdate without readback confirmation", async () => {
    const items: CotikTrackingItem[] = [
      {
        orderId: "ord-fail",
        tracking: "GFU123456789012345",
        providerId: "7352739623900022544"
      }
    ];

    mockPost.mockResolvedValue({
      logUpdate: [{ apiOrderId: "ord-fail", status: "Order is already fulfilled" }]
    });

    const result = await postCotikTrackingBatch({
      client: mockClient,
      items,
      isPostAuthorized: vi.fn().mockResolvedValue(true)
    });

    expect(result.status).toBe("FAILED");
    expect(result.failedOrders).toEqual([
      { orderId: "ord-fail", error: "Order is already fulfilled" }
    ]);
    expect(result.confirmedOrders).toHaveLength(0);
    // Did not attempt readback for failed orders
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("recovers and confirms if POST threw timeout/5xx but tracking was actually updated", async () => {
    const items: CotikTrackingItem[] = [
      {
        orderId: "ord-timeout",
        tracking: "GFU123456789012345",
        providerId: "7352739623900022544"
      }
    ];

    mockPost.mockRejectedValue(new Error("Gateway Timeout 504"));
    // Readback shows tracking was in fact committed!
    mockGet.mockResolvedValue({
      data: [
        {
          apiOrderId: "ord-timeout",
          tracking_number: "GFU123456789012345"
        }
      ]
    });

    const result = await postCotikTrackingBatch({
      client: mockClient,
      items,
      isPostAuthorized: vi.fn().mockResolvedValue(true)
    });

    expect(result.status).toBe("PARTIALLY_CONFIRMED");
    expect(result.confirmedOrders).toEqual(["ord-timeout"]);
    expect(result.unconfirmedOrders).toHaveLength(0);
  });

  it("fails closed when the authorization callback errors immediately before POST", async () => {
    const result = await postCotikTrackingBatch({
      client: mockClient,
      items: [{
        orderId: "ord-auth-error",
        tracking: "GFU123456789012345",
        providerId: "7352739623900022544"
      }],
      isPostAuthorized: vi.fn().mockRejectedValue(new Error("database unavailable"))
    });

    expect(result.status).toBe("REFUSED_KILL_SWITCH");
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("checks authorization after provider validation and immediately before the POST", async () => {
    const order: string[] = [];
    const isPostAuthorized = vi.fn().mockImplementation(async () => {
      order.push("authorize");
      return true;
    });
    mockPost.mockImplementation(async () => {
      order.push("post");
      return { logUpdate: [] };
    });
    mockGet.mockResolvedValue({ listorders: [{ apiOrderId: "ord-order", tracking_number: "GFU123456789012345" }] });

    await postCotikTrackingBatch({
      client: mockClient,
      items: [{ orderId: "ord-order", tracking: "GFU123456789012345", providerId: "7352739623900022544" }],
      isPostAuthorized
    });

    expect(order).toEqual(["authorize", "post"]);
    expect(isPostAuthorized).toHaveBeenCalledOnce();
  });
});

describe("checkOrderTrackingReady", () => {
  let mockClient: MultiAccountCotikClient;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGet = vi.fn();
    mockPost = vi.fn();
    mockClient = {
      accountId: "acc-ready",
      get: mockGet,
      post: mockPost,
      diagnoseHealth: vi.fn()
    };
  });

  it.each([
    ["status", { apiOrderId: "ord-ready", status: "AWAITING_SHIPMENT", tracking_number: "" }],
    ["order_status", { order_id: "ord-ready", order_status: "AWAITING_SHIPMENT", tracking_number: "GFU123456789012345" }],
    ["combined lifecycle fields", { apiOrderId: "ord-ready", status: "AWAITING_SHIPMENT", order_status: "new", tracking_number: "" }],
    ["awaiting collection", { apiOrderId: "ord-ready", status: "AWAITING_COLLECTION", tracking_number: "" }],
    ["new", { apiOrderId: "ord-ready", status: "new", tracking_number: "" }]
  ])("accepts a unique %s tracking-write order with empty or matching tracking", async (_field, order) => {
    mockGet.mockResolvedValue({ listorders: [order] });

    await expect(checkOrderTrackingReady(mockClient, "ord-ready", "GFU123456789012345")).resolves.toBe(true);
    expect(mockGet).toHaveBeenCalledWith(
      "/order/list?page=1&sizeperpage=10&search=ord-ready",
      expect.anything()
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", []],
    ["duplicate exact matches", [
      { apiOrderId: "ord-ready", status: "AWAITING_SHIPMENT" },
      { order_id: "ord-ready", order_status: "AWAITING_SHIPMENT" }
    ]],
    ["unknown status", [{ apiOrderId: "ord-ready", status: "MYSTERY" }]],
    ["expired observation", [{ apiOrderId: "ord-ready", status: "DELIVERED" }]],
    ["cancelled response", [{ apiOrderId: "ord-ready", status: "CANCELED" }]],
    ["conflicting existing tracking", [{ apiOrderId: "ord-ready", status: "AWAITING_SHIPMENT", tracking_number: "OTHER" }]]
  ])("rejects %s and therefore cannot write", async (_reason, listorders) => {
    mockGet.mockResolvedValue({ listorders });

    const ready = await checkOrderTrackingReady(mockClient, "ord-ready", "GFU123456789012345");
    if (ready) await mockClient.post("/order/import-tracking-v2", {});

    expect(ready).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects a response containing no exact order identity", async () => {
    mockGet.mockResolvedValue({ listorders: [{ apiOrderId: "other", status: "AWAITING_SHIPMENT" }] });

    await expect(checkOrderTrackingReady(mockClient, "ord-ready", "GFU123456789012345")).resolves.toBe(false);
  });

  it("fails closed when the exact search errors", async () => {
    mockGet.mockRejectedValue(new Error("provider failure"));

    await expect(checkOrderTrackingReady(mockClient, "ord-ready", "GFU123456789012345")).resolves.toBe(false);
  });
});
