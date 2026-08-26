import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { shops, syncRuns } from "../schema.js";
import { findLatestSuccessfulSyncRun, listSyncRuns } from "./sync-runs.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("latest sync-run PostgreSQL read", () => {
  let context: DatabaseContext;
  const profileNo = `SYNC-${randomUUID()}`;
  let shopId: string;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo,
      profileNo,
      region: "US",
      locale: "en-US",
    }).returning({ id: shops.id });
    shopId = shop!.id;
  });

  afterAll(async () => {
    if (!context) return;
    await context.db.delete(syncRuns).where(eq(syncRuns.shopId, shopId));
    await context.db.delete(shops).where(eq(shops.id, shopId));
    await closeDatabase(context);
  });

  it("selects proven Finance runs only when completeness and reconciliation are both true", async () => {
    const completeUnreconciledId = randomUUID();
    const provenId = randomUUID();
    await context.db.insert(syncRuns).values([
      {
        id: provenId,
        shopId,
        mode: "FINANCE",
        status: "SUCCEEDED",
        sourceComplete: true,
        sourceReconciled: true,
        startedAt: new Date("2026-08-14T00:00:00.000Z"),
      },
      {
        id: completeUnreconciledId,
        shopId,
        mode: "FINANCE",
        status: "SUCCEEDED",
        sourceComplete: true,
        sourceReconciled: false,
        startedAt: new Date("2026-08-14T01:00:00.000Z"),
      },
    ]);

    await expect(findLatestSuccessfulSyncRun(
      context.db,
      shopId,
      "FINANCE",
      true,
      true,
    )).resolves.toMatchObject({ id: provenId });
  });

  it("returns the latest run for one requested mode regardless of status", async () => {
    const olderFinanceId = randomUUID();
    const latestFinanceId = randomUUID();
    await context.db.insert(syncRuns).values([
      {
        id: olderFinanceId,
        shopId,
        mode: "FINANCE",
        status: "SUCCEEDED",
        startedAt: new Date("2026-08-15T00:00:00.000Z"),
      },
      {
        shopId,
        mode: "ORDERS",
        status: "RUNNING",
        startedAt: new Date("2026-08-15T02:00:00.000Z"),
      },
      {
        id: latestFinanceId,
        shopId,
        mode: "FINANCE",
        status: "FAILED",
        startedAt: new Date("2026-08-15T01:00:00.000Z"),
        finishedAt: new Date("2026-08-15T01:01:00.000Z"),
      },
    ]);

    await expect(listSyncRuns(context.db, shopId, 1, "FINANCE")).resolves.toEqual([
      expect.objectContaining({
        id: latestFinanceId,
        mode: "FINANCE",
        status: "FAILED",
      }),
    ]);
  });
});
