import type { DatabaseContext, ShopRow } from "@shop-health/db";
import type { RiskControlDecision } from "@shop-health/domain";
import { evaluateAndStoreRiskControl } from "@shop-health/sync";

export interface ShopRiskEvaluation {
  readonly decision: RiskControlDecision;
  readonly lastSuccessfulOrderSyncAt: Date | null;
  readonly evaluatedAt: Date;
}

export async function evaluateShopRisk(
  context: DatabaseContext,
  shop: ShopRow
): Promise<ShopRiskEvaluation> {
  const evaluatedAt = new Date();
  const decision = await evaluateAndStoreRiskControl(context, shop, evaluatedAt);
  return {
    decision,
    lastSuccessfulOrderSyncAt: shop.lastOrdersSyncedAt,
    evaluatedAt
  };
}
