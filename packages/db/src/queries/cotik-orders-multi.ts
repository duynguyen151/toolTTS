import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { CotikOrderItemContract } from "@shop-health/domain";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  cotikLogicalShops,
  cotikAccounts,
  cotikAccountShops,
  cotikOrderItems,
  cotikOrderObservations,
  cotikOrders,
  type CotikOrderObservationRow,
  type CotikOrderItemRow,
  type CotikOrderRow
} from "../schema.js";
import { upsertOrderBatch } from "./orders.js";

export interface ProjectWinningOrderInput {
  logicalShopId: string;
  orderId: string;
  items?: CotikOrderItemContract[] | undefined;
  sourceAccountId?: string | undefined;
}

export interface CotikWinningObservationCandidate {
  readonly accountStatus: string;
  readonly discoveryState: string;
  readonly accountLastSeenAt: Date | null;
  readonly observation: CotikOrderObservationRow;
}

export function pickWinningCotikObservation(
  candidates: readonly CotikWinningObservationCandidate[]
): CotikWinningObservationCandidate | undefined {
  return candidates.filter(isEligibleCotikWinnerCandidate).sort((left, right) => {
    const lastSeenComparison = compareDates(right.accountLastSeenAt, left.accountLastSeenAt);
    if (lastSeenComparison !== 0) return lastSeenComparison;
    return left.observation.accountId.localeCompare(right.observation.accountId);
  })[0];
}

export function isEligibleCotikWinnerCandidate(
  candidate: CotikWinningObservationCandidate
): boolean {
  return (
    candidate.accountStatus === "ACTIVE" &&
    candidate.discoveryState === "DISCOVERED" &&
    candidate.accountLastSeenAt !== null &&
    Number.isFinite(candidate.accountLastSeenAt.getTime())
  );
}

function compareDates(left: Date | null, right: Date | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.getTime() - right.getTime();
}

export function shouldPersistCotikOrderItems(
  sourceAccountId: string | undefined,
  winnerAccountId: string
): boolean {
  return sourceAccountId !== undefined && sourceAccountId === winnerAccountId;
}

export async function projectWinningCotikOrder(
  db: Database,
  input: ProjectWinningOrderInput
): Promise<CotikOrderRow | null> {
  const candidateRows = await db
    .select()
    .from(cotikOrderObservations)
    .innerJoin(cotikAccounts, eq(cotikOrderObservations.accountId, cotikAccounts.id))
    .innerJoin(
      cotikAccountShops,
      and(
        eq(cotikAccountShops.accountId, cotikOrderObservations.accountId),
        eq(cotikAccountShops.logicalShopId, cotikOrderObservations.logicalShopId)
      )
    )
    .where(
      and(
        eq(cotikOrderObservations.logicalShopId, input.logicalShopId),
        eq(cotikOrderObservations.orderId, input.orderId),
        eq(cotikAccounts.status, "ACTIVE"),
        eq(cotikAccountShops.discoveryState, "DISCOVERED"),
        isNotNull(cotikAccounts.lastSeenAt)
      )
    );

  const winnerCandidate = pickWinningCotikObservation(
    candidateRows.map((row) => ({
      accountStatus: row.cotik_accounts.status,
      discoveryState: row.cotik_account_shops.discoveryState,
      accountLastSeenAt: row.cotik_accounts.lastSeenAt,
      observation: row.cotik_order_observations
    }))
  );

  if (!winnerCandidate) {
    return null;
  }

  const winner = winnerCandidate.observation;

  return await db.transaction(async (tx) => {
    const [projected] = await tx
      .insert(cotikOrders)
      .values({
        logicalShopId: winner.logicalShopId,
        orderId: winner.orderId,
        orderStatus: winner.orderStatus,
        orderCreateTime: winner.orderCreateTime,
        orderUpdateTime: winner.orderUpdateTime,
        winnerAccountId: winner.accountId,
        winnerObservedAt: winner.observedAt,
        tracking: winner.tracking,
        carrier: winner.carrier,
        shippingProvider: winner.shippingProvider,
        rawData: winner.rawData,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [cotikOrders.logicalShopId, cotikOrders.orderId],
        set: {
          orderStatus: winner.orderStatus,
          orderUpdateTime: winner.orderUpdateTime,
          winnerAccountId: winner.accountId,
          winnerObservedAt: winner.observedAt,
          tracking: winner.tracking,
          carrier: winner.carrier,
          shippingProvider: winner.shippingProvider,
          rawData: winner.rawData,
          updatedAt: new Date()
        },
      })
      .returning();

    // Persist order items if provided
    if (
      input.items &&
      input.items.length > 0 &&
      shouldPersistCotikOrderItems(input.sourceAccountId, winner.accountId)
    ) {
      await tx
        .delete(cotikOrderItems)
        .where(
          and(
            eq(cotikOrderItems.logicalShopId, winner.logicalShopId),
            eq(cotikOrderItems.orderId, winner.orderId)
          )
        );

      for (const item of input.items) {
        await tx.insert(cotikOrderItems).values({
          logicalShopId: winner.logicalShopId,
          orderId: winner.orderId,
          sku: item.sku,
          skuName: item.skuName,
          refLink: item.refLink ?? null,
          quantity: item.quantity,
          providerEvidence: item.providerEvidence ?? null
        });
      }
    }

    // If logical shop is linked to a canonical shop, also project into existing canonical orders table
    const [logicalShop] = await tx
      .select()
      .from(cotikLogicalShops)
      .where(eq(cotikLogicalShops.id, winner.logicalShopId))
      .limit(1);

    if (logicalShop?.canonicalShopId) {
      const hash = createHash("sha256")
        .update(`${winner.orderId}:${winner.orderStatus}:${winner.orderUpdateTime.toISOString()}`)
        .digest("hex");

      await upsertOrderBatch(tx, [
        {
          shopId: logicalShop.canonicalShopId,
          sourceOrderId: winner.orderId,
          createdAt: winner.orderCreateTime,
          paidAt: null,
          sourceUpdatedAt: winner.orderUpdateTime,
          readyToShipAt: null,
          latestDeliveryAt: null,
          sourceStatus: winner.orderStatus,
          sourceSubStatus: null,
          canonicalStatus: "UNKNOWN",
          grandTotal: "0.00",
          currency: "USD",
          trackingNumber: winner.tracking ?? null,
          carrier: winner.carrier ?? null,
          refundAmount: null,
          refundStatus: null,
          deliveryEligible: null,
          firstSeenAt: winner.observedAt,
          lastSeenAt: winner.observedAt,
          sourceHash: hash,
          sourceSchemaVersion: "cotik.multi.v1",
          rawData: (winner.rawData as Record<string, unknown>) ?? {}
        }
      ]);
    }

    return (
      projected ??
      (
        await tx
          .select()
          .from(cotikOrders)
          .where(
            and(
              eq(cotikOrders.logicalShopId, winner.logicalShopId),
              eq(cotikOrders.orderId, winner.orderId)
            )
          )
          .limit(1)
      )[0] ??
      null
    );
  });
}

export async function findCotikOrderById(
  db: Database | DatabaseTransaction,
  logicalShopId: string,
  orderId: string
): Promise<CotikOrderRow | null> {
  const [order] = await db
    .select()
    .from(cotikOrders)
    .where(
      and(
        eq(cotikOrders.logicalShopId, logicalShopId),
        eq(cotikOrders.orderId, orderId)
      )
    )
    .limit(1);

  return order ?? null;
}

export async function listCotikOrderItems(
  db: Database,
  logicalShopId: string,
  orderId: string
): Promise<CotikOrderItemRow[]> {
  return await db
    .select()
    .from(cotikOrderItems)
    .where(
      and(
        eq(cotikOrderItems.logicalShopId, logicalShopId),
        eq(cotikOrderItems.orderId, orderId)
      )
    );
}
