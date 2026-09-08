import { and, desc, eq } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  cotikAccountShops,
  cotikLogicalShops,
  type CotikAccountShopRow,
  type CotikLogicalShopRow
} from "../schema.js";

export interface UpsertCotikLogicalShopInput {
  id?: string | undefined;
  maShopNoiBo: string;
  region: "US" | "UK";
  canonicalShopId?: string | null | undefined;
}

export async function upsertCotikLogicalShop(
  db: Database,
  input: UpsertCotikLogicalShopInput
): Promise<CotikLogicalShopRow> {
  const cleanCode = input.maShopNoiBo.trim();
  if (cleanCode.length === 0) {
    throw new Error("maShopNoiBo cannot be blank");
  }

  const [shop] = await db
    .insert(cotikLogicalShops)
    .values({
      ...(input.id ? { id: input.id } : {}),
      maShopNoiBo: cleanCode,
      region: input.region,
      canonicalShopId: input.canonicalShopId ?? null
    })
    .onConflictDoUpdate({
      target: cotikLogicalShops.maShopNoiBo,
      set: {
        region: input.region,
        canonicalShopId: input.canonicalShopId ?? null,
        updatedAt: new Date()
      }
    })
    .returning();

  if (!shop) {
    throw new Error("Failed to upsert cotik logical shop");
  }

  return shop;
}

export async function findCotikLogicalShopByMaShopNoiBo(
  db: Database,
  maShopNoiBo: string
): Promise<CotikLogicalShopRow | null> {
  const cleanCode = maShopNoiBo.trim();
  const [shop] = await db
    .select()
    .from(cotikLogicalShops)
    .where(eq(cotikLogicalShops.maShopNoiBo, cleanCode))
    .limit(1);

  return shop ?? null;
}

export async function findCotikLogicalShopById(
  db: Database | DatabaseTransaction,
  id: string
): Promise<CotikLogicalShopRow | null> {
  const [shop] = await db
    .select()
    .from(cotikLogicalShops)
    .where(eq(cotikLogicalShops.id, id))
    .limit(1);

  return shop ?? null;
}

export async function listCotikLogicalShops(
  db: Database,
  region?: "US" | "UK"
): Promise<CotikLogicalShopRow[]> {
  if (region) {
    return await db
      .select()
      .from(cotikLogicalShops)
      .where(eq(cotikLogicalShops.region, region))
      .orderBy(desc(cotikLogicalShops.createdAt));
  }

  return await db
    .select()
    .from(cotikLogicalShops)
    .orderBy(desc(cotikLogicalShops.createdAt));
}

export interface UpsertCotikAccountShopInput {
  id?: string | undefined;
  accountId: string;
  logicalShopId: string;
  cotikShopId: string;
  discoveryState?: "DISCOVERED" | "DISCONNECTED" | "ERROR" | undefined;
  lastDiscoveredAt?: Date | null | undefined;
  checkpoint?: Record<string, unknown> | null | undefined;
  missingDayCount?: number | undefined;
}

export async function upsertCotikAccountShop(
  db: Database,
  input: UpsertCotikAccountShopInput
): Promise<CotikAccountShopRow> {
  const cleanCotikShopId = input.cotikShopId.trim();
  if (cleanCotikShopId.length === 0) {
    throw new Error("cotikShopId cannot be blank");
  }

  const [link] = await db
    .insert(cotikAccountShops)
    .values({
      ...(input.id ? { id: input.id } : {}),
      accountId: input.accountId,
      logicalShopId: input.logicalShopId,
      cotikShopId: cleanCotikShopId,
      discoveryState: input.discoveryState ?? "DISCOVERED",
      lastDiscoveredAt: input.lastDiscoveredAt ?? null,
      checkpoint: input.checkpoint ?? null,
      missingDayCount: input.missingDayCount ?? 0
    })
    .onConflictDoUpdate({
      target: [cotikAccountShops.accountId, cotikAccountShops.cotikShopId],
      set: {
        logicalShopId: input.logicalShopId,
        discoveryState: input.discoveryState ?? "DISCOVERED",
        lastDiscoveredAt: input.lastDiscoveredAt !== undefined ? input.lastDiscoveredAt : new Date(),
        checkpoint: input.checkpoint !== undefined ? input.checkpoint : null,
        missingDayCount: input.missingDayCount ?? 0,
        updatedAt: new Date()
      }
    })
    .returning();

  if (!link) {
    throw new Error("Failed to upsert cotik account shop");
  }

  return link;
}

export async function listCotikAccountShopsByAccount(
  db: Database,
  accountId: string
): Promise<CotikAccountShopRow[]> {
  return await db
    .select()
    .from(cotikAccountShops)
    .where(eq(cotikAccountShops.accountId, accountId))
    .orderBy(desc(cotikAccountShops.createdAt));
}

export async function listCotikAccountShopsByLogicalShop(
  db: Database | DatabaseTransaction,
  logicalShopId: string
): Promise<CotikAccountShopRow[]> {
  return await db
    .select()
    .from(cotikAccountShops)
    .where(eq(cotikAccountShops.logicalShopId, logicalShopId))
    .orderBy(desc(cotikAccountShops.createdAt));
}

export async function updateCotikAccountShopDiscoveryState(
  db: Database,
  accountId: string,
  cotikShopId: string,
  discoveryState: "DISCOVERED" | "DISCONNECTED" | "ERROR",
  lastDiscoveredAt?: Date | null
): Promise<CotikAccountShopRow | null> {
  const updates: Partial<typeof cotikAccountShops.$inferInsert> = {
    discoveryState,
    updatedAt: new Date()
  };

  if (lastDiscoveredAt !== undefined) {
    updates.lastDiscoveredAt = lastDiscoveredAt;
  }

  const [updated] = await db
    .update(cotikAccountShops)
    .set(updates)
    .where(
      and(
        eq(cotikAccountShops.accountId, accountId),
        eq(cotikAccountShops.cotikShopId, cotikShopId)
      )
    )
    .returning();

  return updated ?? null;
}

export async function updateCotikAccountShopCheckpoint(
  db: Database,
  accountId: string,
  cotikShopId: string,
  checkpoint: Record<string, unknown> | null,
  missingDayCount?: number
): Promise<CotikAccountShopRow | null> {
  const updates: Partial<typeof cotikAccountShops.$inferInsert> = {
    checkpoint,
    updatedAt: new Date()
  };

  if (missingDayCount !== undefined) {
    updates.missingDayCount = missingDayCount;
  }

  const [updated] = await db
    .update(cotikAccountShops)
    .set(updates)
    .where(
      and(
        eq(cotikAccountShops.accountId, accountId),
        eq(cotikAccountShops.cotikShopId, cotikShopId)
      )
    )
    .returning();

  return updated ?? null;
}
