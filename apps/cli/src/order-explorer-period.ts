export const ORDER_EXPLORER_TIME_ZONE = "Asia/Bangkok";

export type OrderExplorerPeriodKey = "TODAY" | "7D" | "30D" | "12M" | "ALL_AVAILABLE";

export interface OrderExplorerPeriod {
  readonly key: OrderExplorerPeriodKey;
  readonly label: string;
  readonly start: Date | null;
  readonly end: Date | null;
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Resolves Explorer filters in the fixed V1 business timezone, never the
 * server, proxy, or browser timezone. These are analytical read windows only.
 */
export function resolveOrderExplorerPeriod(key: OrderExplorerPeriodKey, now = new Date()): OrderExplorerPeriod {
  if (key === "ALL_AVAILABLE") {
    return {
      key,
      label: "All Available (persisted source data; not lifetime completeness)",
      start: null,
      end: null,
    };
  }

  const localNow = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const end = new Date(Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() + 1,
  ) - BANGKOK_OFFSET_MS);

  if (key === "TODAY") return { key, label: "Today (Asia/Bangkok)", start: new Date(end.getTime() - 86_400_000), end };
  if (key === "7D") return { key, label: "Last 7 days (Asia/Bangkok)", start: new Date(end.getTime() - 7 * 86_400_000), end };
  if (key === "30D") return { key, label: "Last 30 days (Asia/Bangkok)", start: new Date(end.getTime() - 30 * 86_400_000), end };

  return {
    key,
    label: "Last 12 months (Asia/Bangkok)",
    start: new Date(Date.UTC(localNow.getUTCFullYear() - 1, localNow.getUTCMonth(), localNow.getUTCDate() + 1) - BANGKOK_OFFSET_MS),
    end,
  };
}
