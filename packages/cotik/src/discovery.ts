import { z } from "zod";
import type { MultiAccountCotikClient } from "./multi-account-client.js";

export const DiscoveredShopRawSchema = z.object({
  shop_id: z.union([z.string(), z.number()]).transform(String),
  shop_name: z.string().optional().default(""),
  note: z.string().optional().default(""),
  region: z.string().optional(),
  country: z.string().optional(),
  currency: z.string().optional()
});

export const ShopDiscoveryResponseSchema = z.object({
  data: z.array(DiscoveredShopRawSchema),
  total: z.number()
});

export type DiscoveredShopRaw = z.infer<typeof DiscoveredShopRawSchema>;

export interface DiscoveredCotikShop {
  cotikShopId: string;
  shopName: string;
  maShopNoiBo: string;
  region: "US" | "UK" | null;
  raw: Record<string, unknown>;
}

export type DiscoveryResultState = "COMPLETE" | "DISCOVERY_INCOMPLETE" | "DISCOVERY_INSUFFICIENT";

export interface ShopDiscoveryResult {
  state: DiscoveryResultState;
  accountId: string;
  totalReported: number;
  shopsFound: number;
  shops: DiscoveredCotikShop[];
}

/**
 * Fail-closed region normalization: returns null for unknown regions.
 * Unknown regions must be treated as insufficient data — never silently default to US.
 */
export function normalizeShopRegion(rawRegion?: string, rawCountry?: string, currency?: string): "US" | "UK" | null {
  const norm = (rawRegion ?? rawCountry ?? currency ?? "").toUpperCase().trim();
  if (norm === "US" || norm === "USD") {
    return "US";
  }
  if (norm === "UK" || norm === "GB" || norm === "GBP") {
    return "UK";
  }
  // Fail-closed: unknown/missing region must not be silently assumed as US.
  // Callers must handle null and skip or log the shop.
  return null;
}

/**
 * Derive maShopNoiBo from note's leading digits.
 * Returns null when the note does not provide a leading numeric identity.
 */
export function deriveMaShopNoiBo(note: string | undefined, _cotikShopId?: string): string | null {
  const trimmed = (note ?? "").trim();
  const match = trimmed.match(/^(\d+)/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

export interface DiscoveryLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export async function discoverAccountShops(
  client: MultiAccountCotikClient,
  logger?: DiscoveryLogger | undefined
): Promise<ShopDiscoveryResult> {
  const result = await client.get("/analytic/shop", ShopDiscoveryResponseSchema);

  const totalReported = result.total;
  const shopsFound = result.data.length;

  const shops: DiscoveredCotikShop[] = [];
  let insufficient = false;

  for (const raw of result.data) {
    const maShopNoiBo = deriveMaShopNoiBo(raw.note, raw.shop_id);
    if (maShopNoiBo === null) {
      insufficient = true;
      logger?.warn(
        { cotikShopId: raw.shop_id },
        "Skipping discovered shop: leading numeric shop identity is missing"
      );
      continue;
    }

    const region = normalizeShopRegion(raw.region, raw.country, raw.currency);
    if (region === null) {
      // Fail-closed: skip shops with unrecognized region rather than misclassifying them.
      logger?.warn(
        { cotikShopId: raw.shop_id, rawRegion: raw.region, rawCountry: raw.country, currency: raw.currency },
        "Skipping discovered shop: region is unrecognized and cannot be safely classified"
      );
      continue;
    }

    shops.push({
      cotikShopId: raw.shop_id,
      shopName: raw.shop_name,
      maShopNoiBo,
      region,
      raw: raw as unknown as Record<string, unknown>
    });
  }

  const state: DiscoveryResultState = insufficient
    ? "DISCOVERY_INSUFFICIENT"
    : shopsFound === totalReported
      ? "COMPLETE"
      : "DISCOVERY_INCOMPLETE";

  return {
    state,
    accountId: client.accountId,
    totalReported,
    shopsFound: shops.length,
    shops
  };
}
