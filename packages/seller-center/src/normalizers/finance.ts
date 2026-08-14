import {
  NormalizedFinancialSnapshotSchema,
  NormalizedSettlementRecordSchema,
  type NormalizedFinancialSnapshot,
  type NormalizedSettlementRecord,
} from "@shop-health/domain";

import type {
  RawStatementOrder,
  StatementStatResponse,
} from "../extractors/schemas.js";
import { stableHash, timestamp } from "./shared.js";

const ON_HOLD_REASONS = {
  "1": "WAITING_FOR_PACKAGE_DELIVERY",
  "3": "DELIVERED_AWAITING_SETTLEMENT",
} as const;

const SAFE_STARLING_KEYS: ReadonlySet<string> = new Set([
  "finance_on_hold_waiting",
  "finance_page_type_order",
] as const);

export function normalizeSettlementRecord(
  raw: RawStatementOrder,
  shopId: string,
): NormalizedSettlementRecord {
  const currency = requiredUsdCurrency([
    raw.settlement_amount.currency,
    raw.earning_amount.currency,
    raw.fees.currency,
  ]);
  const reasonCode = String(raw.to_settle_reason) as keyof typeof ON_HOLD_REASONS;
  const rawData = {
    statementDetailId: raw.statement_detail_id,
    referenceId: raw.reference_id,
    tradeOrderId: raw.trade_order_id,
    placedTime: raw.placed_time,
    tradeType: raw.trade_type,
    settlementAmount: {
      amount: raw.settlement_amount.amount,
      currency,
    },
    earningAmount: {
      amount: raw.earning_amount.amount,
      currency,
    },
    fees: {
      signedAmount: raw.fees.amount,
      currency,
    },
    settlementStatus: raw.settlement_status,
    toSettleReason: raw.to_settle_reason,
    estimateSettleTime: raw.estimate_settle_time ?? null,
    deliveryTime: raw.delivery_time,
    estimateSettleTimeNotDelivery: safeStarlingLabel(raw.estimate_settle_time_not_delivery),
    statement: {
      id: raw.statement_id,
      version: raw.statement_version,
    },
    sourcePageTypes: raw.source_page_types.map(safeStarlingLabel),
  };

  return NormalizedSettlementRecordSchema.parse({
    shopId,
    sourceStatementDetailId: raw.statement_detail_id,
    tradeOrderId: raw.trade_order_id,
    placedAt: timestamp(raw.placed_time),
    deliveredAt: nullableSourceTimestamp(raw.delivery_time),
    estimatedSettlementAt: timestamp(raw.estimate_settle_time),
    earningAmount: raw.earning_amount.amount,
    feeAmount: absoluteDecimal(raw.fees.amount),
    shippingAmount: null,
    expectedSettlementAmount: raw.settlement_amount.amount,
    eligibleSettlementAmount: null,
    settledAmount: null,
    currency,
    sourceSettlementStatus: String(raw.settlement_status),
    settlementState: "ON_HOLD",
    onHoldReason: ON_HOLD_REASONS[reasonCode],
    sourceHash: stableHash(rawData),
    sourceSchemaVersion: "seller-center-us-finance.v2",
    rawData,
  });
}

export function normalizeFinancialSnapshot(
  response: StatementStatResponse,
  shopId: string,
  capturedAt = new Date(),
): NormalizedFinancialSnapshot | null {
  const toSettle = response.data.to_settle_amount_stat?.amount;
  const reserve = response.data.seller_reserve_stat;
  const quality = response.data.seller_quality_stat;
  const currency = toSettle?.currency?.toUpperCase();
  if (!toSettle || !currency) return null;

  const rawData = {
    sourceSurface: "ON_HOLD",
    onHoldAmount: toSettle.amount ?? null,
    currency,
    reasons: response.data.to_settle_amount_stat?.reasons_detail?.map((reason) => ({
      reason: reason.reason ?? null,
      name: ON_HOLD_REASONS[String(reason.reason) as keyof typeof ON_HOLD_REASONS] ?? null,
      amount: reason.amount?.amount ?? null,
      currency: reason.amount?.currency?.toUpperCase() ?? null,
    })) ?? [],
    reserve: {
      sourceLevel: reserve?.seller_reserve_level ?? null,
      level: reserve?.reserve_level ?? null,
      days: reserve?.reserve_days ?? null,
      ratio: reserve?.reserve_ratio ?? null,
    },
    settlementPeriod: {
      days: quality?.bill_finish_period_in_days ?? null,
      sourceType: quality?.settle_period_type ?? null,
      sourceKey: quality?.quality_title?.starling_key ?? null,
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
    onHoldBalance: toSettle.amount ?? null,
    officialOnHoldAmount: toSettle.amount ?? null,
    settlementPeriodDays: quality?.bill_finish_period_in_days ?? null,
    settlementPeriodType: quality?.quality_title?.starling_key
      ?? (quality?.settle_period_type === undefined ? null : String(quality.settle_period_type)),
    reserveRatio: parseRatio(reserve?.reserve_ratio),
    reserveDays: parseInteger(reserve?.reserve_days),
    reserveLevel: reserve?.reserve_level ?? null,
    snapshotHash: stableHash(rawData),
    sourceSchemaVersion: "seller-center-us-finance.v2",
    rawData,
  });
}

function requiredUsdCurrency(values: readonly string[]): "USD" {
  const normalized = new Set(values.map((value) => value.toUpperCase()));
  if (normalized.size !== 1 || !normalized.has("USD")) {
    throw new Error("On hold settlement money fields must all use USD");
  }
  return "USD";
}

function absoluteDecimal(value: string): string {
  return value.startsWith("-") || value.startsWith("+") ? value.slice(1) : value;
}

function nullableSourceTimestamp(value: string | number): Date | null {
  return value === 0 || value === "0" ? null : timestamp(value);
}

function safeStarlingLabel(label: {
  starling_key: string;
  starling_text: string;
  params?: string[] | undefined;
}): { starlingKey: string | null } {
  return {
    starlingKey: SAFE_STARLING_KEYS.has(label.starling_key)
      ? label.starling_key
      : null,
  };
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
