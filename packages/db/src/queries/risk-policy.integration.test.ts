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

  it("rejects malformed raw GLOBAL, SHOP, tombstone, and non-finite effective rows", async () => {
    const validGlobal = {
      version: "risk-control-policy.v2",
      currency: "USD",
      thresholds: globalInput().thresholds,
      caution: globalInput().caution,
    };
    const validShop = {
      thresholds: { stopDeliveryRateBelow: 0.74 },
      caution: { deliveryRate: { mode: "DISABLED" } },
    };
    const attempts = [
      { scope: "GLOBAL", owner: null, enabled: true, payload: { ...validGlobal, extra: true }, effectiveFrom: T0 },
      { scope: "GLOBAL", owner: null, enabled: true, payload: { ...validGlobal, thresholds: { ...validGlobal.thresholds, stableCyclesBeforeResume: 1.5 } }, effectiveFrom: T0 },
      { scope: "GLOBAL", owner: null, enabled: true, payload: { ...validGlobal, thresholds: { ...validGlobal.thresholds, minimumOrdersForRateRule: 9007199254740992 } }, effectiveFrom: T0 },
      { scope: "GLOBAL", owner: null, enabled: true, payload: { ...validGlobal, caution: { ...validGlobal.caution, deliveryRate: { mode: "RELATIVE_RATIO", ratio: 1.1 } } }, effectiveFrom: T0 },
      { scope: "SHOP", owner: shopId, enabled: true, payload: { ...validShop, thresholds: { unknown: 1 } }, effectiveFrom: T0 },
      { scope: "SHOP", owner: shopId, enabled: true, payload: { ...validShop, caution: { onHoldValue: { mode: "ABSOLUTE_BUFFER", buffer: -1 } } }, effectiveFrom: T0 },
      { scope: "SHOP", owner: shopId, enabled: false, payload: validShop, effectiveFrom: T0 },
      { scope: "SHOP", owner: shopId, enabled: false, payload: { thresholds: {}, caution: {}, extra: true }, effectiveFrom: T0 },
      { scope: "SHOP", owner: shopId, enabled: true, payload: validShop, effectiveFrom: "infinity" },
    ] as const;

    for (const attempt of attempts) {
      await expect(context.sql`
        insert into risk_policy_revisions (scope, shop_id, enabled, payload, effective_from)
        values (
          ${attempt.scope}, ${attempt.owner}, ${attempt.enabled},
          ${JSON.stringify(attempt.payload)}::jsonb,
          ${attempt.effectiveFrom instanceof Date ? attempt.effectiveFrom.toISOString() : attempt.effectiveFrom}::timestamptz
        )
      `).rejects.toMatchObject({ constraint_name: expect.stringMatching(/^risk_policy_revisions_(payload_valid|effective_from_finite)$/) });
    }
  });

  it("appends immutable revisions and forbids historical update/delete", async () => {
    const first = await appendGlobalRiskPolicyRevision(context.db, globalInput());
    const second = await appendGlobalRiskPolicyRevision(context.db, globalInput({
      effectiveFrom: T1,
      thresholds: { ...globalInput().thresholds, stopOnHoldValueAt: "5000.0000" },
    }));
    revisionIds.push(first.revisionId, second.revisionId);

    expect(typeof first.sequence).toBe("bigint");
    expect(second.sequence).toBeGreaterThan(first.sequence);
    await expect(context.db.update(riskPolicyRevisions).set({ enabled: false }).where(eq(riskPolicyRevisions.revisionId, first.revisionId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ message: "risk_policy_revisions are append-only" }) });
    await expect(context.db.delete(riskPolicyRevisions).where(eq(riskPolicyRevisions.revisionId, first.revisionId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ message: "risk_policy_revisions are append-only" }) });
  });

  it("preserves sequence values beyond the JavaScript safe integer boundary", async () => {
    await context.sql`
      select setval(
        pg_get_serial_sequence('risk_policy_revisions', 'sequence'),
        greatest(
          (select coalesce(max(sequence), 0) from risk_policy_revisions),
          9007199254740992
        )
      )
    `;
    const created = await appendGlobalRiskPolicyRevision(context.db, globalInput({
      effectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
    }));
    revisionIds.push(created.revisionId);

    expect(typeof created.sequence).toBe("bigint");
    expect(created.sequence).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
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
