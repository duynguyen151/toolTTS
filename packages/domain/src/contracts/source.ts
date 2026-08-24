import { z } from "zod";

import type {
  NormalizedFinancialBatch,
} from "./finance.js";
import type { NormalizedOrderBatch } from "./orders.js";

export const ShopSourceConfigSchema = z.object({
  shopId: z.string().min(1),
  profileId: z.string().min(1),
  profileNo: z.string().min(1),
  region: z.literal("US"),
  locale: z.literal("en-US"),
});

export type ShopSourceConfig = z.infer<typeof ShopSourceConfigSchema>;

export const SourceHealthSchema = z.object({
  status: z.enum([
    "HEALTHY",
    "UNAVAILABLE",
    "PROXY_TIMEOUT",
    "LOGIN_REQUIRED",
    "CHALLENGE_REQUIRED",
    "LAYOUT_CHANGED",
  ]),
  checkedAt: z.date(),
  detail: z.string().nullable(),
});

export type SourceHealth = z.infer<typeof SourceHealthSchema>;

export const SourceFingerprintSchema = z.object({
  value: z.string().min(1),
  capturedAt: z.date(),
});

export type SourceFingerprint = z.infer<typeof SourceFingerprintSchema>;

export const SyncRequestSchema = z.object({
  shop: ShopSourceConfigSchema,
  mode: z.enum(["INCREMENTAL", "BACKFILL", "RECONCILE"]),
  checkpoint: z.string().nullable(),
  since: z.date().nullable(),
  until: z.date().nullable(),
});

export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export type SellerProfileIdentity =
  | { readonly status: "IDENTIFIED"; readonly tiktokShopId: string }
  | {
      readonly status: "AMBIGUOUS" | "UNAVAILABLE" | "NOT_TIKTOK_SELLER" | "UNSUPPORTED_REGION";
      readonly tiktokShopId: null;
    };

/** Read-provider identity; Seller Center stays authoritative for Official On-Hold finance. */
export const SourceProviderSchema = z.enum(["SELLER_CENTER", "COTIK"]);

export type SourceProvider = z.infer<typeof SourceProviderSchema>;

export const SourceCapabilitySchema = z.enum([
  "ORDERS",
  "SUPPLEMENTARY_FINANCE",
  "OFFICIAL_ON_HOLD",
]);

export type SourceCapability = z.infer<typeof SourceCapabilitySchema>;

/**
 * Provider capability declaration. Parsing rejects OFFICIAL_ON_HOLD for COTIK;
 * only Seller Center may currently claim Official On-Hold.
 */
export const SourceProvenanceSchema = z
  .object({
    source: SourceProviderSchema,
    capabilities: z.array(SourceCapabilitySchema),
  })
  .superRefine((provenance, context) => {
    if (
      provenance.source === "COTIK" &&
      provenance.capabilities.includes("OFFICIAL_ON_HOLD")
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "COTIK cannot declare the OFFICIAL_ON_HOLD capability",
      });
    }
  });

export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

export interface SellerDataSource {
  health(config: ShopSourceConfig): Promise<SourceHealth>;
  probe(config: ShopSourceConfig): Promise<SourceFingerprint>;
  /** Captures the identity from the source's canonical authenticated route. */
  verifyProfile?(config: Pick<ShopSourceConfig, "profileId">): Promise<SellerProfileIdentity>;
  collectOrders(request: SyncRequest): AsyncIterable<NormalizedOrderBatch>;
  /**
   * Official-On-Hold-capable Finance collection; only this method may produce
   * evidence claiming Official OH reconciliation.
   */
  collectFinancials(
    request: SyncRequest,
  ): AsyncIterable<NormalizedFinancialBatch>;
  /**
   * Optional supplementary Finance collection (e.g. COTIK statements/payments).
   * Batches never imply an Official On-Hold claim or reconciliation.
   */
  collectSupplementaryFinancials?(
    request: SyncRequest,
  ): AsyncIterable<SupplementaryFinancialBatch>;
}

/**
 * Supplementary Finance batch: same normalized shape as NormalizedFinancialBatch,
 * but its use never implies an Official On-Hold claim.
 */
export type SupplementaryFinancialBatch = NormalizedFinancialBatch;

export const SourceCoverageProofSchema = z.object({
  // ponytail: kept Seller Center-narrow so persisted v1 projections stay typed;
  // migrate consumers to ProviderSourceCoverageProofSchema when persistence lands (W11-T02).
  source: z.literal("SELLER_CENTER"),
  window: z.literal("ROLLING_12_MONTHS"),
  completeWithinSourceWindow: z.boolean(),
  completeWithinWindow: z.boolean().optional(),
  lifetimeHistoryComplete: z.literal(false),
});

export type SourceCoverageProof = z.infer<typeof SourceCoverageProofSchema>;

/** Provider-neutral coverage proof: any declared provider, same frozen window semantics. */
export const ProviderSourceCoverageProofSchema = SourceCoverageProofSchema.extend({
  source: SourceProviderSchema,
});

export type ProviderSourceCoverageProof = z.infer<
  typeof ProviderSourceCoverageProofSchema
>;
