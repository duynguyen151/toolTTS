import type { CanonicalOrderStatus } from "./contracts/orders.js";

export const AUTHORITATIVE_DELIVERY_TOTAL_STATUSES = [
  "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
] as const satisfies readonly CanonicalOrderStatus[];

export const AUTHORITATIVE_DELIVERED_STATUSES = [
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
] as const satisfies readonly CanonicalOrderStatus[];

const totalStatuses = new Set<CanonicalOrderStatus>(AUTHORITATIVE_DELIVERY_TOTAL_STATUSES);
const deliveredStatuses = new Set<CanonicalOrderStatus>(AUTHORITATIVE_DELIVERED_STATUSES);

export type AuthoritativeDeliveryRateDataIssue = "UNKNOWN_STATUS_PRESENT" | "NO_OPERATIONAL_ORDERS";

export interface AuthoritativeDeliveryRate {
  readonly deliveredCount: number | null;
  readonly totalCount: number | null;
  readonly rate: number | null;
  readonly dataIssues: readonly AuthoritativeDeliveryRateDataIssue[];
}

export interface DeliveryStatusCount {
  readonly canonicalStatus: CanonicalOrderStatus;
  readonly count: number;
}

/** Rule input: full persisted population only; caller-provided periods never enter here. */
export function calculateAuthoritativeDeliveryRate(statuses: readonly CanonicalOrderStatus[]): AuthoritativeDeliveryRate {
  const counts = new Map<CanonicalOrderStatus, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return calculateAuthoritativeDeliveryRateFromCounts(
    [...counts].map(([canonicalStatus, count]) => ({ canonicalStatus, count })),
  );
}

export function calculateAuthoritativeDeliveryRateFromCounts(counts: readonly DeliveryStatusCount[]): AuthoritativeDeliveryRate {
  if (counts.some(({ canonicalStatus, count }) => canonicalStatus === "UNKNOWN" && count > 0)) {
    return { deliveredCount: null, totalCount: null, rate: null, dataIssues: ["UNKNOWN_STATUS_PRESENT"] };
  }
  const totalCount = counts.filter(({ canonicalStatus }) => totalStatuses.has(canonicalStatus)).reduce((sum, { count }) => sum + count, 0);
  const deliveredCount = counts.filter(({ canonicalStatus }) => deliveredStatuses.has(canonicalStatus)).reduce((sum, { count }) => sum + count, 0);
  return totalCount === 0
    ? { deliveredCount, totalCount, rate: null, dataIssues: ["NO_OPERATIONAL_ORDERS"] }
    : { deliveredCount, totalCount, rate: deliveredCount / totalCount, dataIssues: [] };
}

export type AnalyticalDeliveryPeriodKey = "TODAY" | "7D" | "30D" | "12M" | "ALL_AVAILABLE";

export interface AnalyticalDeliveryPeriod {
  readonly key: AnalyticalDeliveryPeriodKey;
  readonly label: string;
  readonly start: Date | null;
  readonly end: Date | null;
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Presentation/analytics only; this does not feed the Rule's full-population input. */
export function resolveAnalyticalDeliveryPeriod(key: AnalyticalDeliveryPeriodKey, now = new Date()): AnalyticalDeliveryPeriod {
  if (key === "ALL_AVAILABLE") return { key, label: "All Available (persisted source data; not lifetime completeness)", start: null, end: null };
  const local = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const endLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1));
  const end = new Date(endLocal.getTime() - BANGKOK_OFFSET_MS);
  if (key === "TODAY") return { key, label: "Today (Asia/Bangkok)", start: new Date(end.getTime() - 86_400_000), end };
  if (key === "7D") return { key, label: "Last 7 days (Asia/Bangkok)", start: new Date(end.getTime() - 7 * 86_400_000), end };
  if (key === "30D") return { key, label: "Last 30 days (Asia/Bangkok)", start: new Date(end.getTime() - 30 * 86_400_000), end };
  const startLocal = new Date(Date.UTC(endLocal.getUTCFullYear() - 1, endLocal.getUTCMonth(), endLocal.getUTCDate()));
  return { key, label: "Last 12 months (Asia/Bangkok)", start: new Date(startLocal.getTime() - BANGKOK_OFFSET_MS), end };
}
