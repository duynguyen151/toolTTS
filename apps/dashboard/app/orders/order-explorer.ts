import {
  resolveAnalyticalDeliveryPeriod,
  type AnalyticalDeliveryPeriodKey,
  type CanonicalOrderStatus,
} from "@shop-health/domain";

const PERIODS = new Set<AnalyticalDeliveryPeriodKey>(["TODAY", "7D", "30D", "12M", "ALL_AVAILABLE"]);
const STATUSES = new Set<CanonicalOrderStatus>([
  "PENDING", "AWAITING_SHIPMENT", "AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELED", "UNKNOWN",
]);

export function parseOrderExplorerQuery(query: Record<string, string | string[] | undefined>) {
  const value = (key: string) => Array.isArray(query[key]) ? query[key][0] : query[key];
  const period = value("period");
  const status = value("status");
  const page = Number(value("page") ?? "1");
  const profileNo = value("profile")?.trim() ?? "";
  return {
    profileNo,
    period: PERIODS.has(period as AnalyticalDeliveryPeriodKey) ? period as AnalyticalDeliveryPeriodKey : "ALL_AVAILABLE" as const,
    status: STATUSES.has(status as CanonicalOrderStatus) ? status as CanonicalOrderStatus : undefined,
    search: value("search")?.trim() || undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function orderExplorerWindow(period: AnalyticalDeliveryPeriodKey, now = new Date()) {
  return resolveAnalyticalDeliveryPeriod(period, now);
}

export function formatOrderExplorerCoverage(coverage: { availableFrom: Date | null; availableTo: Date | null }): string {
  if (coverage.availableFrom === null || coverage.availableTo === null) return "Persisted coverage: unavailable";
  const date = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  return `Persisted coverage: ${date(coverage.availableFrom)} to ${date(coverage.availableTo)} (not a lifetime-history claim)`;
}
