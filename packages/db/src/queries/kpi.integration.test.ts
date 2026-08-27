import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { kpiSnapshots, shops } from "../schema.js";
import { insertKpiSnapshot, listKpiSnapshots } from "./kpi.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("objective shop-health snapshot persistence", () => {
  let context: DatabaseContext;
  let shopId: string;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const profileNo = `KPI-${randomUUID()}`;
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo,
      profileNo,
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning({ id: shops.id });
    shopId = shop!.id;
  });

  afterAll(async () => {
    if (!context) return;
    // The migration deliberately prevents deleting snapshot evidence, so this
    // isolated TEST shop remains as an auditable integration fixture.
    await closeDatabase(context);
  });

  it("deduplicates one cadence and preserves policy/provider provenance as immutable evidence", async () => {
    const input = {
      shopId,
      profileId: "profile-kpi",
      profileNo: "KPI-1",
      window: "Last 30 days (Asia/Bangkok)",
      periodStart: new Date("2026-08-01T17:00:00.000Z"),
      periodEnd: new Date("2026-08-31T17:00:00.000Z"),
      policyVersion: "score-policy.v1",
      metricsHash: "a".repeat(64),
      metrics: { schemaVersion: "objective-shop-health-history.v1", analytical: [] },
      trends: { orders: {} },
      providerProvenance: { orders: { source: "SELLER_CENTER" } },
      policyProvenance: { scorePolicyVersion: "score-policy.v1", categoricalTrendPolicyVersion: null },
      score: null,
      confidence: 0.5,
      recommendation: null,
      evaluationStatus: "FRESH" as const,
      warnings: [],
    };

    expect((await insertKpiSnapshot(context.db, input)).inserted).toBe(true);
    expect((await insertKpiSnapshot(context.db, input)).inserted).toBe(false);
    const [snapshot] = await listKpiSnapshots(context.db, shopId);
    expect(snapshot).toMatchObject({
      profileId: "profile-kpi",
      profileNo: "KPI-1",
      providerProvenance: input.providerProvenance,
      policyProvenance: input.policyProvenance,
    });
    await expect(context.db.update(kpiSnapshots)
      .set({ profileNo: "tampered" })
      .where(eq(kpiSnapshots.id, snapshot!.id))).rejects.toThrow(/immutable/i);
    await expect(context.db.delete(kpiSnapshots)
      .where(eq(kpiSnapshots.id, snapshot!.id))).rejects.toThrow(/immutable/i);
  });

});
