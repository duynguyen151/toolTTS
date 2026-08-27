import { describe, expect, it, vi } from "vitest";

import type { CotikClient } from "./client.js";
import {
  buildCotikPaymentListPath,
  buildCotikStatementListPath,
  ingestCotikSupplementaryFinance,
  normalizeCotikPayment,
  normalizeCotikStatement,
  type CotikSupplementaryFinanceIngestionInput,
} from "./supplementary-finance.js";

const RUN_NOW = new Date("2026-08-24T12:00:00.000Z");
const SHOP_ID = "11111111-2222-4333-8444-555555555555";
const COTIK_SHOP_ID = "cotik-shop-1";

function statement(id: string, paymentId = "payment-1"): Record<string, unknown> {
  return {
    _id: `cotik-statement-${id}`,
    apiStatementId: id,
    statement_time: 1_724_198_400_000,
    currency: "USD",
    revenue_amount: "1250.00",
    fee_amount: "-120.50",
    adjustment_amount: "0.00",
    shipping_cost_amount: "-80.00",
    net_sales_amount: "1049.50",
    settlement_amount: "1049.50",
    payment_id: paymentId,
    payment_status: "PAID",
    shopId: COTIK_SHOP_ID,
    order_ids: ["order-1", "order-2"],
    paymenttiktoks: { _id: "cotik-payment-1", bank_account: "****1234" },
  };
}

function payment(id = "payment-1"): Record<string, unknown> {
  return {
    _id: `cotik-payment-${id}`,
    id,
    status: "PAID",
    amount: { currency: "USD", value: "1049.50" },
    settlement_amount: { currency: "USD", value: "1049.50" },
    reserve_amount: { currency: "USD", value: "-1.25" },
    payment_amount_before_exchange: { currency: "USD", value: "1049.50" },
    exchange_rate: "1",
    bank_account: "****1234",
    create_time: 1_724_198_400_000,
    paid_time: 1_724_284_800_000,
    shop_id: COTIK_SHOP_ID,
  };
}

function ingestionInput(
  overrides: Partial<CotikSupplementaryFinanceIngestionInput> = {},
): CotikSupplementaryFinanceIngestionInput {
  return {
    client: { get: vi.fn() } as unknown as CotikClient,
    shopId: SHOP_ID,
    cotikShopId: COTIK_SHOP_ID,
    persistStatements: async () => undefined,
    persistPayments: async () => undefined,
    now: () => RUN_NOW,
    ...overrides,
  };
}

describe("COTIK supplementary Finance normalization", () => {
  it("preserves documented signed decimals and statement/payment provider-ID joins without bank data", () => {
    const normalizedStatement = normalizeCotikStatement(statement("statement-1"), SHOP_ID, RUN_NOW);
    const normalizedPayment = normalizeCotikPayment(payment(), SHOP_ID, RUN_NOW);

    expect(normalizedStatement).toMatchObject({
      providerStatementId: "statement-1",
      providerPaymentId: "payment-1",
      feeAmount: "-120.50",
      shippingCostAmount: "-80.00",
      classification: "SUPPLEMENTARY_FINANCE",
      officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
    });
    expect(normalizedPayment).toMatchObject({
      providerPaymentId: "payment-1",
      reserveAmount: "-1.25",
      classification: "SUPPLEMENTARY_FINANCE",
      officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
    });
    expect(normalizedStatement.providerPaymentId).toBe(normalizedPayment.providerPaymentId);
    expect(JSON.stringify([normalizedStatement, normalizedPayment])).not.toContain("1234");
  });
});

describe("COTIK supplementary Finance paths", () => {
  it("uses the documented bounded sliding date window and COTIK shop scope", () => {
    const params = {
      page: 2,
      sizePerPage: 100,
      cotikShopId: "shop id",
      dateStartMs: RUN_NOW.valueOf() - 3 * 24 * 60 * 60 * 1000,
      dateEndMs: RUN_NOW.valueOf(),
    };

    expect(buildCotikStatementListPath(params)).toBe(
      "/statements/?page=2&sizeperpage=100&dateStart=1787313600000&dateEnd=1787572800000&shops=shop%20id",
    );
    expect(buildCotikPaymentListPath(params)).toBe(
      "/payment-tiktok/?page=2&sizeperpage=100&dateStart=1787313600000&dateEnd=1787572800000&shops=shop%20id",
    );
  });

  it.each([
    ["zero page", { page: 0, sizePerPage: 100, cotikShopId: COTIK_SHOP_ID, dateStartMs: 1, dateEndMs: 2 }],
    ["page size over the documented cap", { page: 1, sizePerPage: 101, cotikShopId: COTIK_SHOP_ID, dateStartMs: 1, dateEndMs: 2 }],
    ["inverted date range", { page: 1, sizePerPage: 100, cotikShopId: COTIK_SHOP_ID, dateStartMs: 2, dateEndMs: 1 }],
  ])("rejects %s at the boundary", (_label, params) => {
    expect(() => buildCotikStatementListPath(params)).toThrow(/page|size|date/i);
  });
});

describe("ingestCotikSupplementaryFinance", () => {
  it("paginates statements and payments through totalsize before reporting only unproven Official-OH capability", async () => {
    const requests: string[] = [];
    const responses = [
      { statements: [statement("statement-1")], totalsize: 2 },
      { statements: [statement("statement-2", "payment-2")], totalsize: 2 },
      { paymenttiktoks: [payment("payment-1")], totalsize: 2 },
      { paymenttiktoks: [payment("payment-2")], totalsize: 2 },
    ];
    const client: CotikClient = {
      get: vi.fn(async (path: string) => {
        requests.push(path);
        const next = responses[requests.length - 1];
        if (next === undefined) throw new Error(`unexpected request ${path}`);
        return next;
      }),
    };
    const persistedStatements: string[] = [];
    const persistedPayments: string[] = [];

    const result = await ingestCotikSupplementaryFinance(ingestionInput({
      client,
      pageSize: 1,
      persistStatements: async (records) => persistedStatements.push(...records.map((record) => record.providerStatementId)),
      persistPayments: async (records) => persistedPayments.push(...records.map((record) => record.providerPaymentId)),
    }));

    expect(result).toEqual({
      classification: "SUPPLEMENTARY_FINANCE",
      officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
      statementPagesFetched: 2,
      paymentPagesFetched: 2,
      statementsPersisted: 2,
      paymentsPersisted: 2,
      window: {
        start: new Date("2026-08-21T12:00:00.000Z"),
        end: RUN_NOW,
      },
    });
    expect(persistedStatements).toEqual(["statement-1", "statement-2"]);
    expect(persistedPayments).toEqual(["payment-1", "payment-2"]);
    expect(requests).toEqual([
      "/statements/?page=1&sizeperpage=1&dateStart=1787313600000&dateEnd=1787572800000&shops=cotik-shop-1",
      "/statements/?page=2&sizeperpage=1&dateStart=1787313600000&dateEnd=1787572800000&shops=cotik-shop-1",
      "/payment-tiktok/?page=1&sizeperpage=1&dateStart=1787313600000&dateEnd=1787572800000&shops=cotik-shop-1",
      "/payment-tiktok/?page=2&sizeperpage=1&dateStart=1787313600000&dateEnd=1787572800000&shops=cotik-shop-1",
    ]);
  });

  it("rejects a statement from another COTIK shop before persistence", async () => {
    const client: CotikClient = {
      get: vi.fn().mockResolvedValueOnce({
        statements: [statement("statement-1", "payment-1"), { ...statement("statement-2"), shopId: "other-shop" }],
        totalsize: 2,
      }),
    };
    const persistStatements = vi.fn(async () => undefined);

    await expect(ingestCotikSupplementaryFinance(ingestionInput({ client, pageSize: 2, persistStatements })))
      .rejects.toThrow(/different bound shop/i);
    expect(persistStatements).not.toHaveBeenCalled();
  });

  it("fails before reporting completion when a totalsize changes mid-pagination", async () => {
    const client: CotikClient = {
      get: vi.fn()
        .mockResolvedValueOnce({ statements: [statement("statement-1")], totalsize: 2 })
        .mockResolvedValueOnce({ statements: [statement("statement-2")], totalsize: 3 }),
    };
    const persistStatements = vi.fn(async () => undefined);

    await expect(ingestCotikSupplementaryFinance(ingestionInput({ client, pageSize: 1, persistStatements })))
      .rejects.toMatchObject({ code: "PAGINATION_MISMATCH" });
    expect(persistStatements).toHaveBeenCalledTimes(1);
  });
});
