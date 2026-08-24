import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { SourceProviderSchema, SourceProvenanceSchema } from "@shop-health/domain";

import type { Database } from "../client.js";
import { shopProviderBindings, type ShopProviderBindingRow } from "../schema.js";

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
