import {
  NormalizedFinancialSnapshotSchema,
  type NormalizedFinancialSnapshot,
} from "@shop-health/domain";

import type { StatementStatResponse } from "../extractors/schemas.js";
import { stableHash } from "./shared.js";

export function normalizeFinancialSnapshot(
  response: StatementStatResponse,
  shopId: string,
  capturedAt = new Date(),
): NormalizedFinancialSnapshot | null {
  const toSettle = response.data.to_settle_amount_stat?.amount;
  const reserve = response.data.seller_reserve_stat;
  const currency = toSettle?.currency?.toUpperCase();
  if (!toSettle || !currency) return null;

  const rawData = {
    toSettleAmount: toSettle.amount ?? null,
    currency,
    reasons: response.data.to_settle_amount_stat?.reasons_detail?.map((reason) => ({
      reason: reason.reason ?? null,
      amount: reason.amount?.amount ?? null,
    })) ?? [],
    reserve: {
      sourceLevel: reserve?.seller_reserve_level ?? null,
      level: reserve?.reserve_level ?? null,
      days: reserve?.reserve_days ?? null,
      ratio: reserve?.reserve_ratio ?? null,
    },
  };

  return NormalizedFinancialSnapshotSchema.parse({
    shopId,
    capturedAt,
    currency,
    availableBalance: null,
    frozenBalance: null,
    totalBalance: null,
    toSettleBalance: toSettle.amount ?? null,
    onHoldBalance: null,
    reserveRatio: parseRatio(reserve?.reserve_ratio),
    reserveDays: parseInteger(reserve?.reserve_days),
    reserveLevel: reserve?.reserve_level ?? null,
    snapshotHash: stableHash(rawData),
    sourceSchemaVersion: "seller-center-us-finance.v1",
    rawData,
  });
}

function parseRatio(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value.replace("%", ""));
  if (!Number.isFinite(numeric)) return null;
  const ratio = value.includes("%") || numeric > 1 ? numeric / 100 : numeric;
  return ratio >= 0 && ratio <= 1 ? ratio : null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
}
