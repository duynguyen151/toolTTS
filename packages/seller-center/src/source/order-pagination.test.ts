import { describe, expect, it, vi } from "vitest";

import { SellerCenterError } from "../errors.js";
import type { RawOrder } from "../extractors/schemas.js";
import {
  buildNextOrderRequest,
  collectOrderPages,
  detectLockedProtocol,
  parseOrderPage,
  type OrderPageRequest,
} from "./order-pagination.js";

function rawOrder(id: string): RawOrder {
  return {
    main_order_id: id,
    trade_order_module: {
      create_time: 1700000000,
      payment_time: 1700000001,
      latest_delivery_time: 1700001000,
    },
    order_status_module: [
      {
        main_order_status: 101,
      },
    ],
    price_module: {
      grand_total: {
        amount: "19.99",
        currency: "USD",
      },
    },
  };
}

function orderResponse(params: {
  orders: RawOrder[];
  totalCount?: number | null;
  hasMore?: boolean;
  searchNextHasMore?: boolean;
  nextCursorToken?: string;
  searchNextCursor?: string;
  code?: number;
}): unknown {
  return {
    code: params.code ?? 0,
    message: "success",
    data: {
      main_orders: params.orders,
      ...(params.totalCount !== undefined ? { total_count: params.totalCount } : {}),
      ...(params.hasMore !== undefined ? { has_more: params.hasMore } : {}),
      ...(params.searchNextHasMore !== undefined ? { search_next_has_more: params.searchNextHasMore } : {}),
      ...(params.nextCursorToken !== undefined ? { next_cursor_token: params.nextCursorToken } : {}),
      ...(params.searchNextCursor !== undefined ? { search_next_cursor: params.searchNextCursor } : {}),
    },
  };
}

describe("order-pagination module", () => {
  it("Test 1: Single Page Complete (has_more=false)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("ord-1"), rawOrder("ord-2")],
      totalCount: 2,
      hasMore: false,
    });

    const request: OrderPageRequest = {
      url: "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
      body: { count: 20 },
    };

    const fetchPostPage = vi.fn();
    const result = await collectOrderPages({
      capturedRequest: request,
      firstPage,
      fetchPostPage,
    });

    expect(result.completeness).toBe("COMPLETE");
    expect(result.pages).toBe(1);
    expect(result.orders.length).toBe(2);
    expect(result.diagnostics.stopReason).toBe("END_OF_PAGES");
    expect(result.diagnostics.reconciliation).toEqual({
      status: "MATCH",
      expected: 2,
      collected: 2,
    });
    expect(fetchPostPage).not.toHaveBeenCalled();
  });

  it("Test 2: Multi-Page Cursor Token (next_cursor_token)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("ord-1")],
      totalCount: 3,
      hasMore: true,
      nextCursorToken: "cursor-1",
    });

    const page2 = orderResponse({
      orders: [rawOrder("ord-2")],
      totalCount: 3,
      hasMore: true,
      nextCursorToken: "cursor-2",
    });

    const page3 = orderResponse({
      orders: [rawOrder("ord-3")],
      totalCount: 3,
      hasMore: false,
    });

    const fetchPostPage = vi.fn().mockImplementation(async (req: OrderPageRequest) => {
      const body = req.body as Record<string, unknown>;
      if (body.cursor_token === "cursor-1") return page2;
      if (body.cursor_token === "cursor-2") return page3;
      throw new Error(`Unexpected cursor: ${body.cursor_token}`);
    });

    const request: OrderPageRequest = {
      url: "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
      body: { count: 20, time_range: "last_30_days" },
    };

    const result = await collectOrderPages({
      capturedRequest: request,
      firstPage,
      fetchPostPage,
    });

    expect(result.completeness).toBe("COMPLETE");
    expect(result.pages).toBe(3);
    expect(result.orders.map((o) => o.main_order_id)).toEqual(["ord-1", "ord-2", "ord-3"]);
    expect(result.diagnostics.reconciliation.status).toBe("MATCH");
    expect(fetchPostPage).toHaveBeenCalledTimes(2);
  });

  it("Test 3: Multi-Page Search Next Cursor (search_next_cursor)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("s-1")],
      totalCount: 2,
      searchNextHasMore: true,
      searchNextCursor: "search-c-1",
    });

    const page2 = orderResponse({
      orders: [rawOrder("s-2")],
      totalCount: 2,
      searchNextHasMore: false,
    });

    const fetchPostPage = vi.fn().mockResolvedValue(page2);

    const request: OrderPageRequest = {
      url: "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
      body: { count: 10, search_next_cursor: "" },
    };

    const result = await collectOrderPages({
      capturedRequest: request,
      firstPage,
      fetchPostPage,
    });

    expect(result.completeness).toBe("COMPLETE");
    expect(result.pages).toBe(2);
    expect(result.orders.length).toBe(2);
    expect(fetchPostPage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ search_next_cursor: "search-c-1" }),
      }),
    );
  });

  it("Test 4: Filter & Sort Preservation in Next Request", () => {
    const originalRequest: OrderPageRequest = {
      url: "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
      body: {
        filter_status: [101, 102],
        sort_by: "create_time_desc",
        custom_query: { depth: 2 },
      },
      headers: { "content-type": "application/json" },
    };

    const nextReq = buildNextOrderRequest({
      originalRequest,
      lockedProtocol: {
        mode: "CURSOR_TOKEN",
        requestField: "cursor_token",
        responseField: "next_cursor_token",
      },
      nextCursorValue: "tok-999",
    });

    expect(nextReq.body).toEqual({
      filter_status: [101, 102],
      sort_by: "create_time_desc",
      custom_query: { depth: 2 },
      cursor_token: "tok-999",
    });
    expect(nextReq.headers).toEqual({ "content-type": "application/json" });
  });

  it("Test 5: Original Body Immutability", async () => {
    const originalBody = Object.freeze({ count: 20, tag: "immutable-test" });
    const originalRequest: OrderPageRequest = {
      url: "https://seller-us.tiktok.com/api/fulfillment/na/order/list",
      body: originalBody,
    };

    const firstPage = orderResponse({
      orders: [rawOrder("imm-1")],
      totalCount: 2,
      hasMore: true,
      nextCursorToken: "c1",
    });

    const page2 = orderResponse({
      orders: [rawOrder("imm-2")],
      totalCount: 2,
      hasMore: false,
    });

    const result = await collectOrderPages({
      capturedRequest: originalRequest,
      firstPage,
      fetchPostPage: vi.fn().mockResolvedValue(page2),
    });

    expect(result.completeness).toBe("COMPLETE");
    expect(originalBody).toEqual({ count: 20, tag: "immutable-test" });
    expect("cursor_token" in originalBody).toBe(false);
  });

  it("Test 6: Duplicate Order Overlap Handling", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("dup-1"), rawOrder("dup-2")],
      totalCount: 3,
      hasMore: true,
      nextCursorToken: "c-dup",
    });

    const page2 = orderResponse({
      orders: [rawOrder("dup-2"), rawOrder("dup-3")],
      totalCount: 3,
      hasMore: false,
    });

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn().mockResolvedValue(page2),
    });

    expect(result.completeness).toBe("COMPLETE");
    expect(result.orders.map((o) => o.main_order_id)).toEqual(["dup-1", "dup-2", "dup-3"]);
    expect(result.diagnostics.duplicateOrderCount).toBe(1);
    expect(result.diagnostics.collectedUniqueCount).toBe(3);
    expect(result.diagnostics.reconciliation.status).toBe("MATCH");
  });

  it("Test 7: Cursor Loop Protection (PAGINATION_LOOP)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("loop-1")],
      totalCount: 10,
      hasMore: true,
      nextCursorToken: "c-loop",
    });

    const loopPage = orderResponse({
      orders: [rawOrder("loop-2")],
      totalCount: 10,
      hasMore: true,
      nextCursorToken: "c-loop", // Cùng cursor token lặp lại
    });

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn().mockResolvedValue(loopPage),
    });

    expect(result.completeness).toBe("INCOMPLETE");
    expect(result.diagnostics.stopReason).toBe("PAGINATION_LOOP");
    expect(result.diagnostics.repeatedCursor).toBe(true);
    expect(result.orders.length).toBe(2);
  });

  it("Test 8: Missing Cursor on HasMore=True (PAGINATION_PROTOCOL_ERROR)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("err-1")],
      totalCount: 10,
      hasMore: true,
      // Không có next_cursor_token hay search_next_cursor
    });

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn(),
    });

    expect(result.completeness).toBe("INCOMPLETE");
    expect(result.diagnostics.stopReason).toBe("PAGINATION_PROTOCOL_ERROR");
  });

  it("Test 9: Missing Both HasMore Fields With Cursor Present (RESPONSE_PARSE_ERROR)", async () => {
    const firstPage = {
      code: 0,
      data: {
        main_orders: [rawOrder("nomore-field")],
        total_count: 5,
        next_cursor_token: "ambiguous-cursor",
        // Thiếu cả has_more và search_next_has_more nhưng lại có cursor
      },
    };

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn(),
    });

    expect(result.completeness).toBe("INCOMPLETE");
    expect(result.diagnostics.stopReason).toBe("RESPONSE_PARSE_ERROR");
  });

  it("Test 10: Incompatible Response Mode (Locked CURSOR_TOKEN but received search_next_cursor)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("mode-1")],
      totalCount: 5,
      hasMore: true,
      nextCursorToken: "tok-1", // Khóa sang mode CURSOR_TOKEN
    });

    const page2 = orderResponse({
      orders: [rawOrder("mode-2")],
      totalCount: 5,
      hasMore: true,
      searchNextCursor: "other-cursor-type", // Response không có next_cursor_token
    });

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn().mockResolvedValue(page2),
    });

    expect(result.completeness).toBe("INCOMPLETE");
    expect(result.diagnostics.stopReason).toBe("PAGINATION_PROTOCOL_ERROR");
  });

  it("Test 11: No Progress Protection (NO_PROGRESS)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("p-1")],
      totalCount: 5,
      hasMore: true,
      nextCursorToken: "c1",
    });

    const emptyPage = orderResponse({
      orders: [],
      totalCount: 5,
      hasMore: true,
      nextCursorToken: "c2",
    });

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn().mockResolvedValue(emptyPage),
    });

    expect(result.completeness).toBe("INCOMPLETE");
    expect(result.diagnostics.stopReason).toBe("NO_PROGRESS");
    expect(result.diagnostics.noProgress).toBe(true);
  });

  it("Test 12: Page Limit Protection (PAGE_LIMIT_REACHED)", async () => {
    let cursorIndex = 0;
    const makeInfinitePage = () => {
      cursorIndex += 1;
      return orderResponse({
        orders: [rawOrder(`inf-${cursorIndex}`)],
        totalCount: 9999,
        hasMore: true,
        nextCursorToken: `cursor-${cursorIndex}`,
      });
    };

    const firstPage = makeInfinitePage();
    const fetchPostPage = vi.fn().mockImplementation(async () => makeInfinitePage());

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage,
      maxPages: 5, // Giới hạn thử 5 trang
    });

    expect(result.completeness).toBe("INCOMPLETE");
    expect(result.pages).toBe(5);
    expect(result.diagnostics.stopReason).toBe("PAGE_LIMIT_REACHED");
    expect(result.diagnostics.stoppedByPageLimit).toBe(true);
  });

  it("Test 13: Total Count Reconciliation Match (MATCH)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("m-1"), rawOrder("m-2")],
      totalCount: 2,
      hasMore: false,
    });

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn(),
    });

    expect(result.diagnostics.reconciliation).toEqual({
      status: "MATCH",
      expected: 2,
      collected: 2,
    });
  });

  it("Test 14: Total Count Reconciliation Mismatch (MISMATCH)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("mis-1")],
      totalCount: 10,
      hasMore: false, // Báo hết trang nhưng chỉ có 1 đơn trong khi total_count = 10
    });

    const result = await collectOrderPages({
      capturedRequest: { url: "https://example.com", body: {} },
      firstPage,
      fetchPostPage: vi.fn(),
    });

    expect(result.diagnostics.reconciliation).toEqual({
      status: "MISMATCH",
      expected: 10,
      collected: 1,
      delta: 9,
    });
  });

  it("Test 15: Malformed JSON Body (SellerCenterError API_SCHEMA_CHANGED)", () => {
    expect(() => parseOrderPage({ code: 0, data: { invalid_key: 123 } })).toThrow(
      expect.objectContaining({ failureType: "API_SCHEMA_CHANGED" }),
    );
  });

  it("Test 16: Transport Fetch Failure (SellerCenterError SOURCE_TIMEOUT)", async () => {
    const firstPage = orderResponse({
      orders: [rawOrder("f-1")],
      totalCount: 5,
      hasMore: true,
      nextCursorToken: "tok-fail",
    });

    const fetchPostPage = vi.fn().mockRejectedValue(new Error("Network disconnect"));

    await expect(
      collectOrderPages({
        capturedRequest: { url: "https://example.com", body: {} },
        firstPage,
        fetchPostPage,
      }),
    ).rejects.toThrow(expect.objectContaining({ failureType: "SOURCE_TIMEOUT" }));
  });
});
