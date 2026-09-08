export type CotikAccountHealthState =
  | "ACTIVE"
  | "TOKEN_EXPIRED"
  | "BLOCKED"
  | "SUBSCRIPTION_EXPIRED"
  | "SHOP_DISCONNECTED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface CotikOrderItemContract {
  sku: string;
  skuName: string;
  refLink?: string | null | undefined;
  quantity: number;
  providerEvidence?: Record<string, unknown> | null | undefined;
}

export interface CotikOrderObservationContract {
  accountId: string;
  logicalShopId: string;
  cotikShopId: string;
  orderId: string;
  orderStatus: string;
  orderCreateTime: Date; // Converted from epoch seconds to UTC Date
  orderUpdateTime: Date; // Converted from epoch seconds to UTC Date
  tracking?: string | null | undefined;
  carrier?: string | null | undefined;
  shippingProvider?: string | null | undefined;
  items: CotikOrderItemContract[];
  rawData?: Record<string, unknown> | undefined;
  observedAt?: Date | undefined;
}

export interface CotikWinningOrderProjection {
  logicalShopId: string;
  orderId: string;
  orderStatus: string;
  orderCreateTime: Date;
  orderUpdateTime: Date;
  winnerAccountId: string;
  winnerObservedAt: Date;
  tracking?: string | null | undefined;
  carrier?: string | null | undefined;
  shippingProvider?: string | null | undefined;
  items: CotikOrderItemContract[];
  rawData?: Record<string, unknown> | undefined;
}

/**
 * Deterministic winner projection tie-breaker for observations of the same (logicalShopId, orderId):
 * 1. orderUpdateTime DESC (most recent update wins)
 * 2. observedAt DESC (most recently seen wins)
 * 3. accountId ASC (lexicographical UUID tie-break)
 */
export function compareObservationPrecedence(
  a: { orderUpdateTime: Date; observedAt: Date; accountId: string },
  b: { orderUpdateTime: Date; observedAt: Date; accountId: string }
): number {
  const timeDiff = b.orderUpdateTime.getTime() - a.orderUpdateTime.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const seenDiff = b.observedAt.getTime() - a.observedAt.getTime();
  if (seenDiff !== 0) {
    return seenDiff;
  }

  return a.accountId.localeCompare(b.accountId);
}
