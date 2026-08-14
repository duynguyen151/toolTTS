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

export interface SellerDataSource {
  health(config: ShopSourceConfig): Promise<SourceHealth>;
  probe(config: ShopSourceConfig): Promise<SourceFingerprint>;
  collectOrders(request: SyncRequest): AsyncIterable<NormalizedOrderBatch>;
  collectFinancials(
    request: SyncRequest,
  ): AsyncIterable<NormalizedFinancialBatch>;
}
