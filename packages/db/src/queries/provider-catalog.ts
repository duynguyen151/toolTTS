import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  cotikProviderCatalog,
  cotikProviderRules,
  type CotikProviderCatalogRow,
  type CotikProviderRuleRow
} from "../schema.js";

export interface UpsertProviderCatalogInput {
  id?: string | undefined;
  providerId: string;
  carrierName: string;
  region: "US" | "UK";
  isActive?: boolean | undefined;
}

export async function upsertProviderCatalogEntry(
  db: Database,
  input: UpsertProviderCatalogInput
): Promise<CotikProviderCatalogRow> {
  const cleanProviderId = input.providerId.trim();
  const cleanCarrierName = input.carrierName.trim();
  if (cleanProviderId.length === 0) throw new Error("providerId cannot be blank");
  if (cleanCarrierName.length === 0) throw new Error("carrierName cannot be blank");

  const [entry] = await db
    .insert(cotikProviderCatalog)
    .values({
      ...(input.id ? { id: input.id } : {}),
      providerId: cleanProviderId,
      carrierName: cleanCarrierName,
      region: input.region,
      isActive: input.isActive ?? true
    })
    .onConflictDoUpdate({
      target: cotikProviderCatalog.providerId,
      set: {
        carrierName: cleanCarrierName,
        region: input.region,
        isActive: input.isActive ?? true
      }
    })
    .returning();

  if (!entry) {
    throw new Error("Failed to upsert provider catalog entry");
  }

  return entry;
}

export async function seedProviderCatalog(
  db: Database,
  items?: Array<{ providerId: string; carrierName: string; region: "US" | "UK" }>
): Promise<CotikProviderCatalogRow[]> {
  const seeds = items ?? [
    // US
    { providerId: "7117858858072016686", carrierName: "USPS", region: "US" as const },
    { providerId: "7352739623900022544", carrierName: "Gofo", region: "US" as const },
    { providerId: "7352738314622863120", carrierName: "UniUni", region: "US" as const },
    { providerId: "7325327335803406082", carrierName: "SpeedX", region: "US" as const },
    // UK
    { providerId: "6639580521074524161", carrierName: "DHL_UK", region: "UK" as const },
    { providerId: "6599541761693270018", carrierName: "EVRi", region: "UK" as const },
    { providerId: "6671794738251726849", carrierName: "Royal_Mail", region: "UK" as const }
  ];

  const results: CotikProviderCatalogRow[] = [];
  for (const item of seeds) {
    const entry = await upsertProviderCatalogEntry(db, item);
    results.push(entry);
  }
  return results;
}

export async function listProviderCatalog(
  db: Database | DatabaseTransaction,
  region?: "US" | "UK",
  activeOnly: boolean = true
): Promise<CotikProviderCatalogRow[]> {
  const conditions = [];
  if (region) {
    conditions.push(eq(cotikProviderCatalog.region, region));
  }
  if (activeOnly) {
    conditions.push(eq(cotikProviderCatalog.isActive, true));
  }

  const query = db.select().from(cotikProviderCatalog);
  if (conditions.length > 0) {
    return await query.where(and(...conditions)).orderBy(cotikProviderCatalog.carrierName);
  }
  return await query.orderBy(cotikProviderCatalog.carrierName);
}

export interface CreateProviderRuleInput {
  id?: string | undefined;
  region: "US" | "UK";
  prefix: string;
  trackingLength?: number | null | undefined;
  charsetPattern?: string | null | undefined;
  providerId: string;
  version?: number | undefined;
  isActive?: boolean | undefined;
}

export async function createProviderRule(
  db: Database,
  input: CreateProviderRuleInput
): Promise<CotikProviderRuleRow> {
  const cleanPrefix = input.prefix.trim();
  if (cleanPrefix.length === 0) throw new Error("prefix cannot be blank");

  const [rule] = await db
    .insert(cotikProviderRules)
    .values({
      ...(input.id ? { id: input.id } : {}),
      region: input.region,
      prefix: cleanPrefix,
      trackingLength: input.trackingLength ?? null,
      charsetPattern: input.charsetPattern ?? null,
      providerId: input.providerId,
      version: input.version ?? 1,
      isActive: input.isActive ?? true
    })
    .returning();

  if (!rule) {
    throw new Error("Failed to create provider rule");
  }

  return rule;
}

export async function seedProviderRules(
  db: Database,
  rules?: Array<{
    region: "US" | "UK";
    prefix: string;
    trackingLength?: number;
    providerId: string;
  }>
): Promise<CotikProviderRuleRow[]> {
  const seeds = rules ?? [
    // US
    { region: "US" as const, prefix: "GFU", trackingLength: 18, providerId: "7352739623900022544" },
    { region: "US" as const, prefix: "UUS", trackingLength: 26, providerId: "7352738314622863120" },
    { region: "US" as const, prefix: "SPX", trackingLength: 24, providerId: "7325327335803406082" },
    // UK
    { region: "UK" as const, prefix: "JJD", trackingLength: 19, providerId: "6639580521074524161" },
    { region: "UK" as const, prefix: "H022|H023", trackingLength: 16, providerId: "6599541761693270018" },
    { region: "UK" as const, prefix: "HD3|HD5|GV5", trackingLength: 13, providerId: "6671794738251726849" }
  ];

  const results: CotikProviderRuleRow[] = [];
  for (const item of seeds) {
    const rule = await createProviderRule(db, item);
    results.push(rule);
  }
  return results;
}

export async function listProviderRules(
  db: Database | DatabaseTransaction,
  region?: "US" | "UK",
  activeOnly: boolean = true
): Promise<CotikProviderRuleRow[]> {
  const conditions = [];
  if (region) {
    conditions.push(eq(cotikProviderRules.region, region));
  }
  if (activeOnly) {
    conditions.push(eq(cotikProviderRules.isActive, true));
  }

  const query = db.select().from(cotikProviderRules);
  if (conditions.length > 0) {
    return await query.where(and(...conditions)).orderBy(desc(cotikProviderRules.createdAt));
  }
  return await query.orderBy(desc(cotikProviderRules.createdAt));
}
