import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { SourceProviderSchema, SourceProvenanceSchema } from "@shop-health/domain";

import type { Database } from "../client.js";
import { shopProviderBindings, shops, type ShopProviderBindingRow, type ShopRow } from "../schema.js";

export type { ShopProviderBindingRow };

/**
 * Validates binding input at the persistence trust boundary and projects it onto
 * exactly the persisted columns. Unknown fields (including token/credential-shaped
 * ones) are rejected before they can reach a row.
 */
export const upsertShopProviderBindingValuesSchema = z
  .strictObject({
    shopId: z.string().uuid(),
    provider: SourceProviderSchema,
    providerShopId: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    provenance: SourceProvenanceSchema,
    providerUpdatedAt: z.date().nullable().optional(),
    collectedAt: z.date().optional(),
    checkpoint: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .superRefine((input, context) => {
    if (input.provider !== input.provenance.source) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "source"],
        message: "Provenance source must match the binding provider"
      });
    }
  })
  .transform((input) => ({
    shopId: input.shopId,
    provider: input.provider,
    providerShopId: input.providerShopId,
    enabled: input.enabled ?? true,
    provenance: input.provenance,
    providerUpdatedAt: input.providerUpdatedAt ?? null,
    collectedAt: input.collectedAt ?? new Date(),
    checkpoint: input.checkpoint ?? null
  }));

export type UpsertShopProviderBindingInput = z.input<
  typeof upsertShopProviderBindingValuesSchema
>;

export async function upsertShopProviderBinding(
  db: Database,
  input: UpsertShopProviderBindingInput
): Promise<ShopProviderBindingRow> {
  const values = upsertShopProviderBindingValuesSchema.parse(input);
  const [binding] = await db
    .insert(shopProviderBindings)
    .values(values)
    .onConflictDoUpdate({
      target: [shopProviderBindings.shopId, shopProviderBindings.provider],
      set: {
        providerShopId: values.providerShopId,
        enabled: values.enabled,
        provenance: values.provenance,
        providerUpdatedAt: values.providerUpdatedAt,
        collectedAt: values.collectedAt,
        checkpoint: values.checkpoint,
        updatedAt: new Date()
      }
    })
    .returning();

  if (!binding) {
    throw new Error("Failed to upsert shop provider binding");
  }

  return binding;
}

export async function findEnabledShopProviderBinding(
  db: Database,
  shopId: string,
  provider: ShopProviderBindingRow["provider"]
): Promise<ShopProviderBindingRow | null> {
  const [binding] = await db
    .select()
    .from(shopProviderBindings)
    .where(
      and(
        eq(shopProviderBindings.shopId, shopId),
        eq(shopProviderBindings.provider, provider),
        eq(shopProviderBindings.enabled, true)
      )
    )
    .limit(1);

  return binding ?? null;
}

export async function listEnabledShopProviderBindings(
  db: Database,
  shopId: string
): Promise<ShopProviderBindingRow[]> {
  return db
    .select()
    .from(shopProviderBindings)
    .where(and(eq(shopProviderBindings.shopId, shopId), eq(shopProviderBindings.enabled, true)))
    .orderBy(asc(shopProviderBindings.provider));
}

/**
 * Returns canonical enabled shops that have an active (enabled) COTIK provider binding,
 * ordered by profileNo. This discovery does not require AdsPower profile readiness.
 */
export async function listEnabledCotikBoundShops(db: Database): Promise<ShopRow[]> {
  const rows = await db
    .select({ shop: shops })
    .from(shops)
    .innerJoin(
      shopProviderBindings,
      and(
        eq(shopProviderBindings.shopId, shops.id),
        eq(shopProviderBindings.provider, "COTIK"),
        eq(shopProviderBindings.enabled, true),
      ),
    )
    .where(and(eq(shops.enabled, true), eq(shops.syncState, "ACTIVE")))
    .orderBy(asc(shops.profileNo));

  return rows.map((row) => row.shop);
}

/** Disables one provider binding in place; canonical shop rows are never touched. */
export async function disableShopProviderBinding(
  db: Database,
  shopId: string,
  provider: ShopProviderBindingRow["provider"]
): Promise<ShopProviderBindingRow | null> {
  const [binding] = await db
    .update(shopProviderBindings)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(shopProviderBindings.shopId, shopId), eq(shopProviderBindings.provider, provider)))
    .returning();

  return binding ?? null;
}

const FORBIDDEN_CHECKPOINT_KEY_PATTERN = /token|secret|password|cookie|credential|api[_-]?key/i;

/**
 * Binding checkpoints are opaque operational bookkeeping read back by provider
 * sync entrypoints. They must stay plain JSON objects and may never carry
 * credential-shaped keys across this persistence trust boundary.
 */
export const shopProviderBindingCheckpointSchema = z
  .record(z.string(), z.unknown())
  .superRefine((checkpoint, context) => {
    for (const key of Object.keys(checkpoint)) {
      if (FORBIDDEN_CHECKPOINT_KEY_PATTERN.test(key)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `Checkpoint field "${key}" looks credential-shaped`
        });
      }
    }
  });

/**
 * Advances ONLY the checkpoint (and collection instant) of one ENABLED binding
 * row and returns the fresh row, or null when disabled/missing — nothing is
 * created. Canonical shop data and binding identity/provenance are untouched.
 * Called by provider order-sync entrypoints exactly once per complete run so a
 * mid-run failure leaves the prior checkpoint standing for idempotent replay.
 */
export async function updateShopProviderBindingCheckpoint(
  db: Database,
  shopId: string,
  provider: ShopProviderBindingRow["provider"],
  checkpoint: Record<string, unknown>,
  collectedAt?: Date
): Promise<ShopProviderBindingRow | null> {
  const parsedCheckpoint = shopProviderBindingCheckpointSchema.parse(checkpoint);
  const [binding] = await db
    .update(shopProviderBindings)
    .set({
      checkpoint: parsedCheckpoint,
      collectedAt: collectedAt ?? new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(shopProviderBindings.shopId, shopId),
        eq(shopProviderBindings.provider, provider),
        eq(shopProviderBindings.enabled, true)
      )
    )
    .returning();

  return binding ?? null;
}
