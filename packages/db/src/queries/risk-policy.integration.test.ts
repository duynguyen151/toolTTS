import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { riskPolicyRevisions, shops } from "../schema.js";
import {
  appendGlobalRiskPolicyRevision,
  appendShopRiskPolicyOverrideRevision,
  disableShopRiskPolicyOverride,
  getEffectiveRiskPolicy,
} from "./risk-policy.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const T0 = new Date("2026-09-01T00:00:00.000Z");
const T1 = new Date("2026-10-01T00:00:00.000Z");

function globalInput(overrides: Record<string, unknown> = {}) {
  return {
    version: "risk-control-policy.v2",
    currency: "USD",
    thresholds: {
      stopOnHoldValueAt: "4000.0000",
      stopDeliveryRateBelow: 0.75,
      minimumOrdersForRateRule: 10,
      resumeOnHoldValueBelow: "3800.0000",
      resumeDeliveryRateAt: 0.8,
      stableCyclesBeforeResume: 2,
    },
    caution: {
      onHoldValue: { mode: "DISABLED" as const },
      deliveryRate: { mode: "DISABLED" as const },
    },
    effectiveFrom: T0,
    ...overrides,
  };
}

describeWithDatabase("risk policy PostgreSQL persistence", () => {
  let context: DatabaseContext;
  let shopId: string;
  const revisionIds: string[] = [];

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const [shop] = await context.db.insert(shops).values({
      profileId: `POLICY-${randomUUID()}`,
      profileNo: `POLICY-${randomUUID()}`,
      region: "US",
      locale: "en-US",
    }).returning();
    shopId = shop!.id;
  });

  afterAll(async () => {
    if (!context) return;
    await closeDatabase(context);
  });

  it("migrates immutable scope constraints and evidence-backed effective indexes", async () => {
    const [table] = await context.sql`
      select relname from pg_class where relname = 'risk_policy_revisions'
    `;
    expect(table?.relname).toBe("risk_policy_revisions");

    const indexes = await context.sql`
      select indexname from pg_indexes where tablename = 'risk_policy_revisions' order by indexname
    `;
    expect(indexes.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      "risk_policy_revisions_global_effective_idx",
      "risk_policy_revisions_shop_effective_idx",
    ]));
  });

  it("appends immutable revisions and forbids historical update/delete", async () => {
    const first = await appendGlobalRiskPolicyRevision(context.db, globalInput());
    const second = await appendGlobalRiskPolicyRevision(context.db, globalInput({
      effectiveFrom: T1,
      thresholds: { ...globalInput().thresholds, stopOnHoldValueAt: "5000.0000" },
    }));
    revisionIds.push(first.revisionId, second.revisionId);

    expect(second.sequence).toBeGreaterThan(first.sequence);
    await expect(context.db.update(riskPolicyRevisions).set({ enabled: false }).where(eq(riskPolicyRevisions.revisionId, first.revisionId)))
      .rejects.toThrow("risk_policy_revisions are append-only");
    await expect(context.db.delete(riskPolicyRevisions).where(eq(riskPolicyRevisions.revisionId, first.revisionId)))
      .rejects.toThrow("risk_policy_revisions are append-only");
  });

  it("serializes concurrent same-scope appends with an explicit monotonic tie-break", async () => {
    const [left, right] = await Promise.all([
      appendShopRiskPolicyOverrideRevision(context.db, {
        shopId,
        thresholds: { stopOnHoldValueAt: "4100.0000" },
        caution: {},
        effectiveFrom: T0,
      }),
      appendShopRiskPolicyOverrideRevision(context.db, {
        shopId,
        thresholds: { stopOnHoldValueAt: "4200.0000" },
        caution: {},
        effectiveFrom: T0,
      }),
    ]);
    revisionIds.push(left.revisionId, right.revisionId);
    expect(left.sequence).not.toBe(right.sequence);

    const winner = left.sequence > right.sequence ? left : right;
    const effective = await getEffectiveRiskPolicy(context.db, { shopId, effectiveAt: T0 });
    expect(effective.shopOverrideRevisionId).toBe(winner.revisionId);
  });

  it("resolves GLOBAL/SHOP partial precedence, future activation, and exact effective reads", async () => {
    const before = await getEffectiveRiskPolicy(context.db, {
      shopId,
      effectiveAt: new Date("2026-09-15T00:00:00.000Z"),
    });
    expect(before.thresholds.stopDeliveryRateBelow).toBe(0.75);
    expect(before.sources.thresholds.stopDeliveryRateBelow).toBe("GLOBAL");
    expect(before.sources.thresholds.stopOnHoldValueAt).toBe("SHOP");

    const atFutureBoundary = await getEffectiveRiskPolicy(context.db, { shopId, effectiveAt: T1 });
    expect(atFutureBoundary.thresholds.stopOnHoldValueAt).toBe("4200.0000");
    expect(atFutureBoundary.globalRevisionId).not.toBe(before.globalRevisionId);
    expect(atFutureBoundary.effectiveAt).toBe(T1.toISOString());
  });

  it("appends a disabling revision so later reads inherit GLOBAL without deleting history", async () => {
    const beforeRows = await context.db.select().from(riskPolicyRevisions).where(eq(riskPolicyRevisions.shopId, shopId));
    const disabled = await disableShopRiskPolicyOverride(context.db, { shopId, effectiveFrom: T1 });
    revisionIds.push(disabled.revisionId);

    const effective = await getEffectiveRiskPolicy(context.db, { shopId, effectiveAt: T1 });
    expect(effective.shopOverrideRevisionId).toBeNull();
    expect(effective.thresholds.stopOnHoldValueAt).toBe("5000.0000");
    const afterRows = await context.db.select().from(riskPolicyRevisions).where(eq(riskPolicyRevisions.shopId, shopId));
    expect(afterRows).toHaveLength(beforeRows.length + 1);
    expect(afterRows.find((row) => row.revisionId === disabled.revisionId)).toMatchObject({ enabled: false });
  });
});
