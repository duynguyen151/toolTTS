import { randomUUID } from "node:crypto";

import {
  GlobalRiskPolicyRevisionSchema,
  ShopRiskPolicyOverrideRevisionSchema,
  resolveEffectiveRiskPolicy,
  type GlobalRiskPolicyRevision,
  type ResolvedRiskPolicy,
  type ShopRiskPolicyOverrideRevision,
} from "@shop-health/domain";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DatabaseTransaction } from "../client.js";
import { riskPolicyRevisions, type RiskPolicyRevisionRow } from "../schema.js";

const ValidDateSchema = z.date().refine((value) => !Number.isNaN(value.getTime()), {
  message: "Date must be valid",
});
const ShopIdSchema = z.string().uuid();

const GlobalInputSchema = GlobalRiskPolicyRevisionSchema.omit({
  revisionId: true,
});
const ShopInputSchema = ShopRiskPolicyOverrideRevisionSchema.omit({
  revisionId: true,
}).extend({ shopId: ShopIdSchema });
const DisableShopInputSchema = z.object({
  shopId: ShopIdSchema,
  effectiveFrom: ValidDateSchema,
}).strict();
const EffectiveInputSchema = z.object({
  shopId: ShopIdSchema.optional(),
  effectiveAt: ValidDateSchema,
}).strict();

export type AppendGlobalRiskPolicyRevisionInput = z.input<typeof GlobalInputSchema>;
export type AppendShopRiskPolicyOverrideRevisionInput = z.input<typeof ShopInputSchema>;
export type DisableShopRiskPolicyOverrideInput = z.input<typeof DisableShopInputSchema>;
export type GetEffectiveRiskPolicyInput = z.input<typeof EffectiveInputSchema>;

function globalFromRow(row: RiskPolicyRevisionRow): GlobalRiskPolicyRevision {
  return GlobalRiskPolicyRevisionSchema.parse({
    ...row.payload,
    revisionId: row.revisionId,
    effectiveFrom: row.effectiveFrom,
  });
}

function shopFromRow(row: RiskPolicyRevisionRow): ShopRiskPolicyOverrideRevision {
  return ShopRiskPolicyOverrideRevisionSchema.parse({
    ...row.payload,
    revisionId: row.revisionId,
    shopId: row.shopId,
    effectiveFrom: row.effectiveFrom,
  });
}

async function lockScope(transaction: DatabaseTransaction, scopeKey: string): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`risk-policy:${scopeKey}`}, 0))`,
  );
}

export async function appendGlobalRiskPolicyRevision(
  db: Database,
  input: AppendGlobalRiskPolicyRevisionInput,
): Promise<RiskPolicyRevisionRow> {
  const revision = GlobalRiskPolicyRevisionSchema.parse({
    ...GlobalInputSchema.parse(input),
    revisionId: randomUUID(),
  });
  return db.transaction(async (transaction) => {
    await lockScope(transaction, "GLOBAL");
    const [created] = await transaction.insert(riskPolicyRevisions).values({
      revisionId: revision.revisionId,
      scope: "GLOBAL",
      shopId: null,
      enabled: true,
      payload: {
        version: revision.version,
        currency: revision.currency,
        thresholds: revision.thresholds,
        caution: revision.caution,
      },
      effectiveFrom: revision.effectiveFrom,
    }).returning();
    if (!created) throw new Error("Failed to append GLOBAL risk policy revision");
    return created;
  });
}

export async function appendShopRiskPolicyOverrideRevision(
  db: Database,
  input: AppendShopRiskPolicyOverrideRevisionInput,
): Promise<RiskPolicyRevisionRow> {
  const revision = ShopRiskPolicyOverrideRevisionSchema.parse({
    ...ShopInputSchema.parse(input),
    revisionId: randomUUID(),
  });
  return db.transaction(async (transaction) => {
    await lockScope(transaction, `SHOP:${revision.shopId}`);
    const [created] = await transaction.insert(riskPolicyRevisions).values({
      revisionId: revision.revisionId,
      scope: "SHOP",
      shopId: revision.shopId,
      enabled: true,
      payload: {
        thresholds: revision.thresholds,
        caution: revision.caution,
      },
      effectiveFrom: revision.effectiveFrom,
    }).returning();
    if (!created) throw new Error("Failed to append SHOP risk policy override revision");
    return created;
  });
}

export async function disableShopRiskPolicyOverride(
  db: Database,
  input: DisableShopRiskPolicyOverrideInput,
): Promise<RiskPolicyRevisionRow> {
  const parsed = DisableShopInputSchema.parse(input);
  const revision = ShopRiskPolicyOverrideRevisionSchema.parse({
    revisionId: randomUUID(),
    shopId: parsed.shopId,
    thresholds: {},
    caution: {},
    effectiveFrom: parsed.effectiveFrom,
  });
  return db.transaction(async (transaction) => {
    await lockScope(transaction, `SHOP:${revision.shopId}`);
    const [created] = await transaction.insert(riskPolicyRevisions).values({
      revisionId: revision.revisionId,
      scope: "SHOP",
      shopId: revision.shopId,
      enabled: false,
      payload: { thresholds: revision.thresholds, caution: revision.caution },
      effectiveFrom: revision.effectiveFrom,
    }).returning();
    if (!created) throw new Error("Failed to append SHOP policy disabling revision");
    return created;
  });
}

export async function getEffectiveRiskPolicy(
  db: Database,
  input: GetEffectiveRiskPolicyInput,
): Promise<ResolvedRiskPolicy> {
  const parsed = EffectiveInputSchema.parse(input);
  const globalQuery = db.select().from(riskPolicyRevisions).where(and(
    eq(riskPolicyRevisions.scope, "GLOBAL"),
    isNull(riskPolicyRevisions.shopId),
    lte(riskPolicyRevisions.effectiveFrom, parsed.effectiveAt),
  )).orderBy(
    desc(riskPolicyRevisions.effectiveFrom),
    desc(riskPolicyRevisions.sequence),
  ).limit(1);
  const shopQuery = parsed.shopId === undefined
    ? Promise.resolve([])
    : db.select().from(riskPolicyRevisions).where(and(
        eq(riskPolicyRevisions.scope, "SHOP"),
        eq(riskPolicyRevisions.shopId, parsed.shopId),
        lte(riskPolicyRevisions.effectiveFrom, parsed.effectiveAt),
      )).orderBy(
        desc(riskPolicyRevisions.effectiveFrom),
        desc(riskPolicyRevisions.sequence),
      ).limit(1);
  const [[globalRow], [shopRow]] = await Promise.all([globalQuery, shopQuery]);

  return resolveEffectiveRiskPolicy({
    globalRevisions: globalRow === undefined ? [] : [globalFromRow(globalRow)],
    shopOverrides: shopRow === undefined || !shopRow.enabled ? [] : [shopFromRow(shopRow)],
    ...(parsed.shopId === undefined ? {} : { shopId: parsed.shopId }),
    effectiveAt: parsed.effectiveAt,
  });
}
