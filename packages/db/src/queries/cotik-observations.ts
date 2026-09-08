import { and, desc, eq, sql } from "drizzle-orm";
import type { CotikOrderObservationContract } from "@shop-health/domain";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  cotikOrderObservations,
  type CotikOrderObservationRow
} from "../schema.js";

export async function recordCotikOrderObservation(
  db: Database,
  input: CotikOrderObservationContract
): Promise<CotikOrderObservationRow> {
  const [row] = await db
    .insert(cotikOrderObservations)
    .values({
      accountId: input.accountId,
      logicalShopId: input.logicalShopId,
      cotikShopId: input.cotikShopId,
      orderId: input.orderId,
      orderStatus: input.orderStatus,
      orderCreateTime: input.orderCreateTime,
      orderUpdateTime: input.orderUpdateTime,
      tracking: input.tracking ?? null,
      carrier: input.carrier ?? null,
      shippingProvider: input.shippingProvider ?? null,
      rawData: input.rawData ?? {},
      observedAt: input.observedAt ?? new Date()
    })
    .onConflictDoUpdate({
      target: [
        cotikOrderObservations.accountId,
        cotikOrderObservations.logicalShopId,
        cotikOrderObservations.orderId
      ],
      set: {
        orderStatus: input.orderStatus,
        orderUpdateTime: input.orderUpdateTime,
        tracking: input.tracking ?? null,
        carrier: input.carrier ?? null,
        shippingProvider: input.shippingProvider ?? null,
        rawData: input.rawData ?? {},
        observedAt: input.observedAt ?? new Date()
      },
      // Stale-write prevention: only overwrite if incoming updateTime is greater or equal
      where: sql`excluded.order_update_time >= ${cotikOrderObservations.orderUpdateTime}`
    })
    .returning();

  if (!row) {
    // If not inserted or updated due to where clause, fetch existing
    const [existing] = await db
      .select()
      .from(cotikOrderObservations)
      .where(
        and(
          eq(cotikOrderObservations.accountId, input.accountId),
          eq(cotikOrderObservations.logicalShopId, input.logicalShopId),
          eq(cotikOrderObservations.orderId, input.orderId)
        )
      )
      .limit(1);
    if (!existing) {
      throw new Error("Failed to record or fetch cotik order observation");
    }
    return existing;
  }

  return row;
}

export async function recordCotikOrderObservations(
  db: Database,
  inputs: CotikOrderObservationContract[]
): Promise<CotikOrderObservationRow[]> {
  const results: CotikOrderObservationRow[] = [];
  for (const input of inputs) {
    const row = await recordCotikOrderObservation(db, input);
    results.push(row);
  }
  return results;
}

export async function listObservationsForOrder(
  db: Database | DatabaseTransaction,
  logicalShopId: string,
  orderId: string
): Promise<CotikOrderObservationRow[]> {
  return await db
    .select()
    .from(cotikOrderObservations)
    .where(
      and(
        eq(cotikOrderObservations.logicalShopId, logicalShopId),
        eq(cotikOrderObservations.orderId, orderId)
      )
    )
    .orderBy(
      desc(cotikOrderObservations.orderUpdateTime),
      desc(cotikOrderObservations.observedAt),
      cotikOrderObservations.accountId
    );
}
