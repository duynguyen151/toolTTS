import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CotikClient } from "@shop-health/cotik";
import type { DatabaseContext, ShopProviderBindingRow, ShopRow } from "@shop-health/db";

const db = vi.hoisted(() => ({
  findEnabledShopProviderBinding: vi.fn(),
  upsertCotikSupplementaryStatementBatch: vi.fn(),
  upsertCotikSupplementaryPaymentBatch: vi.fn(),
  withShopAdvisoryLock: vi.fn(async (_context: unknown, _shopId: string, operation: () => Promise<unknown>) => operation()),
  withTransactionalShopLock: vi.fn(async (_context: unknown, _shopId: string, operation: (tx: unknown) => Promise<unknown>) => operation({})),
}));

vi.mock("@shop-health/db", () => db);

import { runCotikSupplementaryFinanceSync } from "./cotik-supplementary-finance.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.withShopAdvisoryLock.mockImplementation(async (_c: unknown, _s: string, op: () => Promise<unknown>) => op());
  db.withTransactionalShopLock.mockImplementation(async (_c: unknown, _s: string, op: (tx: unknown) => Promise<unknown>) => op({}));
});

describe("runCotikSupplementaryFinanceSync", () => {
  it("persists COTIK statements/payments separately and never calls an Official-On-Hold persistence seam", async () => {
    const client: CotikClient = {
      get: vi.fn()
        .mockResolvedValueOnce({ statements: [statement()], totalsize: 1 })
        .mockResolvedValueOnce({ paymenttiktoks: [payment()], totalsize: 1 }),
    };
    db.findEnabledShopProviderBinding.mockResolvedValue(cotikBinding());
    db.upsertCotikSupplementaryStatementBatch.mockResolvedValue({ rowsRead: 1, rowsWritten: 1 });
    db.upsertCotikSupplementaryPaymentBatch.mockResolvedValue({ rowsRead: 1, rowsWritten: 1 });

    const result = await runCotikSupplementaryFinanceSync({
      context: {} as DatabaseContext,
      shop: shopRow(),
      client,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      classification: "SUPPLEMENTARY_FINANCE",
      officialOnHoldCapabilityStatus: "OFFICIAL_ON_HOLD_UNPROVEN",
      statementPagesFetched: 1,
      paymentPagesFetched: 1,
      rowsRead: 2,
      rowsWritten: 2,
    });
    expect(db.upsertCotikSupplementaryStatementBatch).toHaveBeenCalledTimes(1);
    expect(db.upsertCotikSupplementaryPaymentBatch).toHaveBeenCalledTimes(1);
    expect(Object.keys(db)).not.toContain("finalizeFinanceSyncRun");
    expect(Object.keys(db)).not.toContain("insertFinancialSnapshot");
    expect(Object.keys(db)).not.toContain("upsertSettlementBatch");
  });

  it("fails closed without fetching when the COTIK binding lacks SUPPLEMENTARY_FINANCE", async () => {
    db.findEnabledShopProviderBinding.mockResolvedValue(cotikBinding(["ORDERS"]));
    const client = { get: vi.fn() } as unknown as CotikClient;

    const result = await runCotikSupplementaryFinanceSync({
      context: {} as DatabaseContext,
      shop: shopRow(),
      client,
      now: () => NOW,
    });

    expect(result).toMatchObject({ status: "SKIPPED", skipReason: "COTIK_SUPPLEMENTARY_FINANCE_UNAVAILABLE" });
    expect(client.get).not.toHaveBeenCalled();
  });
});

function shopRow(): ShopRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    profileId: "profile-1",
    profileNo: "957",
    tiktokShopId: "seller-957",
    region: "US",
    locale: "en-US",
  } as ShopRow;
}

function cotikBinding(capabilities: ("ORDERS" | "SUPPLEMENTARY_FINANCE")[] = ["SUPPLEMENTARY_FINANCE"]): ShopProviderBindingRow {
  return {
    id: "00000000-0000-0000-0000-0000000000c0",
    shopId: "00000000-0000-0000-0000-000000000001",
    provider: "COTIK",
    providerShopId: "cotik-shop-1",
    enabled: true,
    provenance: { source: "COTIK", capabilities },
    providerUpdatedAt: null,
    collectedAt: new Date(0),
    checkpoint: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function statement(): Record<string, unknown> {
  return {
    _id: "cotik-statement-1",
    apiStatementId: "statement-1",
    statement_time: 1_724_198_400_000,
    currency: "USD",
    revenue_amount: "10.00",
    fee_amount: "-1.00",
    adjustment_amount: "0.00",
    shipping_cost_amount: "-0.50",
    net_sales_amount: "8.50",
    settlement_amount: "8.50",
    payment_id: "payment-1",
    payment_status: "PAID",
    shopId: "cotik-shop-1",
    order_ids: ["order-1"],
  };
}

function payment(): Record<string, unknown> {
  return {
    _id: "cotik-payment-1",
    id: "payment-1",
    status: "PAID",
    amount: { currency: "USD", value: "8.50" },
    settlement_amount: { currency: "USD", value: "8.50" },
    reserve_amount: { currency: "USD", value: "0.00" },
    payment_amount_before_exchange: { currency: "USD", value: "8.50" },
    create_time: 1_724_198_400_000,
    paid_time: 1_724_284_800_000,
    shop_id: "cotik-shop-1",
  };
}
