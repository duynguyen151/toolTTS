import { describe, expect, it, vi } from "vitest";

import { collectFinanceStatementPages } from "./finance-pagination.js";

const capturedPageOneUrl = [
  "https://seller-us.tiktok.com/api/v1/pay/statement/order/list",
  "?locale=en-US",
  "&language=en",
  "&oec_seller_id=seller-private",
  "&seller_id=seller-private",
  "&pagination_type=1",
  "&from=0",
  "&size=5",
  "&terminal_type=1",
  "&page_type=10",
  "&settlement_status=1",
  "&no_need_sku_record=false",
  "&statement_version=1",
  "&token=must-not-leave-page",
  "&sign=must-not-leave-page",
].join("");

describe("collectFinanceStatementPages", () => {
  it("collects the proven 5 + 3 pages atomically with an allowlisted request", async () => {
    const fetchPage = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect([...parsed.searchParams.keys()].sort()).toEqual([
        "from",
        "language",
        "locale",
        "no_need_sku_record",
        "oec_seller_id",
        "page_type",
        "pagination_type",
        "seller_id",
        "settlement_status",
        "size",
        "statement_version",
        "terminal_type",
      ]);
      expect(parsed.searchParams.get("token")).toBeNull();
      expect(parsed.searchParams.get("sign")).toBeNull();
      expect(parsed.searchParams.get("from")).toBe("5");
      return pageResponse(5, 3, 8, false);
    });

    const result = await collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 5, 8, true),
      fetchPage,
    });

    expect(result.rows).toHaveLength(8);
    expect(new Set(result.rows.map((row) => row.statement_detail_id)).size).toBe(8);
    expect(result.totalRecord).toBe(8);
    expect(result.pages).toBe(2);
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("seller-private");
    expect(JSON.stringify(result)).not.toContain("must-not-leave-page");
  });

  it("preserves the demonstrated variable page size while pinning protocol selectors", async () => {
    const dynamicUrl = capturedPageOneUrl.replace("size=5", "size=17");
    const fetchPage = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("from")).toBe("5");
      expect(parsed.searchParams.get("size")).toBe("17");
      expect(parsed.searchParams.get("pagination_type")).toBe("1");
      expect(parsed.searchParams.get("terminal_type")).toBe("1");
      expect(parsed.searchParams.get("page_type")).toBe("10");
      expect(parsed.searchParams.get("no_need_sku_record")).toBe("false");
      expect(parsed.searchParams.get("statement_version")).toBe("1");
      expect(parsed.searchParams.get("token")).toBeNull();
      expect(parsed.searchParams.get("sign")).toBeNull();
      return pageResponse(5, 3, 8, false);
    });

    const result = await collectFinanceStatementPages({
      capturedPageOneUrl: dynamicUrl,
      firstPage: pageResponse(0, 5, 8, true),
      fetchPage,
    });

    expect(result.rows).toHaveLength(8);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it("rejects changed protocol selectors instead of replaying them", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl: capturedPageOneUrl.replace("page_type=10", "page_type=23"),
      firstPage: pageResponse(0, 5, 8, true),
      fetchPage: vi.fn(),
    })).rejects.toMatchObject({ failureType: "INCOMPLETE_RESPONSE" });
  });

  it("bounds a page fetch using the supplied collection deadline", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 5, 8, true),
      fetchPage: async () => new Promise<never>(() => undefined),
      deadlineAt: Date.now() + 10,
      // Deadline breaches are typed SOURCE_TIMEOUT; only contract drift stays
      // INCOMPLETE_RESPONSE so the sync pause table can distinguish the two.
    })).rejects.toMatchObject({ failureType: "SOURCE_TIMEOUT" });
  });

  it("classifies a malformed nonzero page envelope as API_REJECTED", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: { code: 8 },
      fetchPage: vi.fn(),
    })).rejects.toMatchObject({ failureType: "API_REJECTED" });
  });

  it("rejects a repeated page signature", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 5, 10, true),
      fetchPage: async () => pageResponse(0, 5, 10, true),
    })).rejects.toThrow(/repeated Finance page/i);
  });

  it("rejects duplicate statement detail IDs across different pages", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 5, 8, true),
      fetchPage: async () => pageResponse(4, 4, 8, false),
    })).rejects.toThrow(/duplicate statement_detail_id/i);
  });

  it("rejects an unexpected empty page before termination", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 5, 8, true),
      fetchPage: async () => pageResponse(5, 0, 8, true),
    })).rejects.toThrow(/unexpected empty Finance page/i);
  });

  it("rejects a total_record change between pages", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 5, 8, true),
      fetchPage: async () => pageResponse(5, 3, 9, false),
    })).rejects.toThrow(/total_record changed/i);
  });

  it("rejects termination before unique rows equal total_record", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 5, 8, false),
      fetchPage: vi.fn(),
    })).rejects.toThrow(/unique row count 5 does not match total_record 8/i);
  });

  it("requires an explicit search_next_has_more termination signal", async () => {
    const malformed = pageResponse(0, 5, 5, false);
    delete (malformed as { data: { search_next_has_more?: boolean } }).data.search_next_has_more;

    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: malformed,
      fetchPage: vi.fn(),
    })).rejects.toBeInstanceOf(Error);
  });

  it("stops after the 100-page safety bound", async () => {
    let nextOffset = 1;
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl,
      firstPage: pageResponse(0, 1, 101, true),
      fetchPage: async () => pageResponse(nextOffset++, 1, 101, true),
    })).rejects.toThrow(/100 Finance pages/i);
  });

  it("rejects a captured Finance request from a changed origin", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl: capturedPageOneUrl.replace("seller-us.tiktok.com", "seller-us.tiktok.com:8443"),
      firstPage: pageResponse(0, 5, 5, false),
      fetchPage: vi.fn(),
    })).rejects.toMatchObject({ failureType: "INCOMPLETE_RESPONSE" });
  });

  it("rejects captured URLs whose fixed business contract changed", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl: capturedPageOneUrl.replace("settlement_status=1", "settlement_status=2"),
      firstPage: pageResponse(0, 5, 5, false),
      fetchPage: vi.fn(),
    })).rejects.toMatchObject({ failureType: "INCOMPLETE_RESPONSE" });
  });

  it("rejects duplicate allowlisted business parameters", async () => {
    await expect(collectFinanceStatementPages({
      capturedPageOneUrl: `${capturedPageOneUrl}&seller_id=second-seller`,
      firstPage: pageResponse(0, 5, 5, false),
      fetchPage: vi.fn(),
    })).rejects.toThrow(/duplicate seller_id/i);
  });
});

function pageResponse(
  offset: number,
  count: number,
  totalRecord: number,
  hasMore: boolean,
): Record<string, unknown> {
  return {
    code: 0,
    data: {
      total_record: totalRecord,
      search_next_has_more: hasMore,
      order_records: Array.from({ length: count }, (_, index) => statementRow(offset + index)),
    },
  };
}

function statementRow(index: number): Record<string, unknown> {
  return {
    statement_detail_id: `detail-${index}`,
    reference_id: `reference-${index}`,
    trade_order_id: `order-${index}`,
    placed_time: 1_723_680_000_000 + index,
    trade_type: 1,
    settlement_amount: { amount: "1.00", currency: "USD" },
    earning_amount: { amount: "1.10", currency: "USD" },
    fees: { amount: "-0.10", currency: "USD" },
    settlement_status: 1,
    to_settle_reason: index % 2 === 0 ? 1 : 3,
    ...(index % 2 === 1
      ? { estimate_settle_time: 1_724_198_400_000 + index }
      : {}),
    delivery_time: 1_723_939_200_000 + index,
    statement_id: "statement-1",
    statement_version: 1,
    estimate_settle_time_not_delivery: {
      starling_key: "finance_on_hold_waiting",
      starling_text: "Waiting",
      params: ["31"],
    },
    source_page_types: [{
      starling_key: "finance_page_type_order",
      starling_text: "Order",
    }],
  };
}
