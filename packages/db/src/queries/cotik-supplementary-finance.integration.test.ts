import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import {
  financeCaptures,
  financialSnapshots,
  settlementRecords,
  shops,
} from "../schema.js";
import {
  listCotikSupplementaryStatementsWithPayments,
  upsertCotikSupplementaryPaymentBatch,
  upsertCotikSupplementaryStatementBatch,
  type CotikSupplementaryPaymentUpsertInput,
  type CotikSupplementaryStatementUpsertInput,
} from "./cotik-supplementary-finance.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase.sequential("COTIK supplementary Finance PostgreSQL persistence", () => {
  let context: DatabaseContext;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
  });

  afterAll(async () => {
    if (context) await closeDatabase(context);
  });

  it("joins provider payment IDs, preserves signed decimals, and never writes Official-On-Hold tables", async () => {
    const shopId = await createShop();
    const observedAt = new Date("2026-08-24T12:00:00.000Z");
    await upsertCotikSupplementaryStatementBatch(context.db, [statement(shopId, observedAt)]);
    await upsertCotikSupplementaryPaymentBatch(context.db, [payment(shopId, observedAt)]);

    await expect(listCotikSupplementaryStatementsWithPayments(context.db, shopId)).resolves.toEqual([
      expect.objectContaining({
        statement: expect.objectContaining({
          providerStatementId: "statement-1",
          providerPaymentId: "payment-1",
          feeAmount: "-1.2500",
          shippingCostAmount: "-0.5000",
        }),
        payment: expect.objectContaining({
          providerPaymentId: "payment-1",
          reserveAmount: "-0.2500",
        }),
      }),
    ]);
    await expect(context.db.select().from(financialSnapshots)).resolves.toHaveLength(0);
    await expect(context.db.select().from(settlementRecords)).resolves.toHaveLength(0);
    await expect(context.db.select().from(financeCaptures)).resolves.toHaveLength(0);
  });

  it("replays a completed COTIK Finance window idempotently without duplicate provider rows", async () => {
    const shopId = await createShop();
    const observedAt = new Date("2026-08-24T12:00:00.000Z");
    const statementInput = statement(shopId, observedAt);
    const paymentInput = payment(shopId, observedAt);

    await upsertCotikSupplementaryStatementBatch(context.db, [statementInput]);
    await upsertCotikSupplementaryPaymentBatch(context.db, [paymentInput]);
    await expect(upsertCotikSupplementaryStatementBatch(context.db, [statementInput]))
      .resolves.toEqual({ rowsRead: 1, rowsWritten: 0 });
    await expect(upsertCotikSupplementaryPaymentBatch(context.db, [paymentInput]))
      .resolves.toEqual({ rowsRead: 1, rowsWritten: 0 });
    await expect(listCotikSupplementaryStatementsWithPayments(context.db, shopId)).resolves.toHaveLength(1);
  });

  async function createShop(): Promise<string> {
    const [shop] = await context.db.insert(shops).values({
      profileId: `COTIK-FINANCE-${randomUUID()}`,
      profileNo: `COTIK-FINANCE-${randomUUID()}`,
      displayName: "COTIK supplementary Finance integration",
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning({ id: shops.id });
    return shop!.id;
  }
});

function statement(shopId: string, observedAt: Date): CotikSupplementaryStatementUpsertInput {
  return {
    shopId,
    providerStatementId: "statement-1",
    providerPaymentId: "payment-1",
    providerShopId: "cotik-shop-1",
    statementAt: new Date("2026-08-23T00:00:00.000Z"),
    currency: "USD",
    revenueAmount: "10.0000",
    feeAmount: "-1.2500",
    adjustmentAmount: "0.0000",
    shippingCostAmount: "-0.5000",
    netSalesAmount: "8.2500",
    settlementAmount: "8.2500",
    paymentStatus: "PAID",
    orderIds: ["order-1"],
    observedAt,
    sourceHash: "a".repeat(64),
    sourceSchemaVersion: "cotik-us-supplementary-finance.v1",
    rawData: { providerStatementId: "statement-1" },
  };
}

function payment(shopId: string, observedAt: Date): CotikSupplementaryPaymentUpsertInput {
  return {
    shopId,
    providerPaymentId: "payment-1",
    providerShopId: "cotik-shop-1",
    paymentStatus: "PAID",
    currency: "USD",
    amount: "8.2500",
    settlementAmount: "8.2500",
    reserveAmount: "-0.2500",
    paymentAmountBeforeExchange: "8.2500",
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    paidAt: new Date("2026-08-24T00:00:00.000Z"),
    observedAt,
    sourceHash: "b".repeat(64),
    sourceSchemaVersion: "cotik-us-supplementary-finance.v1",
    rawData: { providerPaymentId: "payment-1" },
  };
}
