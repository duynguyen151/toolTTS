import type {
  DashboardKpi,
  DashboardPresentation,
  DashboardProfileState,
  DashboardSource,
  DashboardStatusView,
  DashboardSyncState,
  DashboardTone,
} from "./dashboard-contract.js";

const DISPLAY_TIME_ZONE = "Asia/Bangkok";

function formatMoney(amount: string | null, currency: string): string {
  if (amount === null) return "Unavailable";

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return "Unavailable";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
}

function formatTimestamp(value: Date | null): string {
  if (value === null) return "Not available";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).format(value);
}

function coverageTone(status: DashboardSource["selected"]["dataCoverage"]["status"]): DashboardTone {
  if (status === "READY") return "success";
  if (status === "PARTIAL" || status === "STALE") return "warning";
  return "danger";
}

function syncStatusView(status: DashboardSyncState): DashboardStatusView {
  const views: Record<DashboardSyncState, DashboardStatusView> = {
    IDLE: { label: "Idle", detail: "No sync is currently running.", tone: "neutral" },
    RUNNING: { label: "Updating data", detail: "A data sync is in progress.", tone: "primary" },
    SUCCEEDED: { label: "Sync complete", detail: "The latest sync completed successfully.", tone: "success" },
    FAILED: { label: "Sync error", detail: "The latest sync did not complete.", tone: "danger" },
    PAUSED_LAYOUT: { label: "Layout review required", detail: "Collection paused after a Seller Center layout change.", tone: "warning" },
    DISABLED: { label: "Sync disabled", detail: "Automatic collection is disabled for this shop.", tone: "neutral" },
  };
  return views[status];
}

function profileStatusView(status: DashboardProfileState): DashboardStatusView {
  const views: Record<DashboardProfileState, DashboardStatusView> = {
    OPEN: { label: "Open", detail: "The AdsPower profile is open.", tone: "success" },
    CLOSED: { label: "Closed", detail: "Open the profile before a manual action.", tone: "neutral" },
    ERROR: { label: "Profile error", detail: "AdsPower could not verify this profile.", tone: "danger" },
    NOT_VERIFIED: { label: "Not verified", detail: "Profile runtime state is not exposed by the current read seam.", tone: "warning" },
  };
  return views[status];
}

function buildKpis(source: DashboardSource): DashboardKpi[] {
  const { selected } = source;
  const deliveryValue = selected.deliveryRate.status === "AVAILABLE"
    ? new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(selected.deliveryRate.value)
    : "Not verified";
  const deliveryDetail = selected.deliveryRate.status === "AVAILABLE"
    ? `${new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(selected.deliveryRate.coverage)} of orders are delivery-eligible`
    : selected.deliveryRate.reason.replaceAll("_", " ").toLowerCase();
  const salesValue = selected.grossValidSales.status === "AVAILABLE"
    ? formatMoney(selected.grossValidSales.amount, selected.grossValidSales.currency)
    : "Unavailable";
  const salesDetail = selected.grossValidSales.status === "AVAILABLE"
    ? "Gross value from persisted valid orders"
    : selected.grossValidSales.reason.replaceAll("_", " ").toLowerCase();

  return [
    {
      id: "on-hold",
      label: "Finance on hold",
      value: formatMoney(selected.finance.officialOnHoldAmount, selected.finance.currency),
      detail: selected.finance.capturedAt === null
        ? "Official balance has not been captured"
        : `Official snapshot · ${formatTimestamp(selected.finance.capturedAt)}`,
      tone: "rose",
    },
    {
      id: "orders",
      label: "Orders observed",
      value: selected.orders.total.toLocaleString("en-US"),
      detail: "Persisted order population",
      tone: "lilac",
    },
    {
      id: "awaiting",
      label: "Awaiting shipment",
      value: selected.orders.awaitingShipment.toLocaleString("en-US"),
      detail: "Orders requiring fulfilment attention",
      tone: "amber",
    },
    {
      id: "delivery",
      label: "Delivery rate",
      value: deliveryValue,
      detail: deliveryDetail,
      tone: selected.deliveryRate.status === "AVAILABLE" ? "mint" : "neutral",
    },
    {
      id: "sales",
      label: "Gross valid sales",
      value: salesValue,
      detail: salesDetail,
      tone: selected.grossValidSales.status === "AVAILABLE" ? "sky" : "neutral",
    },
  ];
}

function stage(
  id: DashboardPresentation["decisionTrace"][number]["id"],
  label: string,
  value: string,
  detail: string,
  tone: DashboardTone,
): DashboardPresentation["decisionTrace"][number] {
  return { id, label, value, detail, tone };
}

function buildDecisionTrace(source: DashboardSource): DashboardPresentation["decisionTrace"] {
  const { rule, ai, ba, execution } = source.selected;

  const ruleStage = rule.status === "READY"
    ? stage("rule", "Rule", "Ready", "A persisted deterministic rule result is available.", "primary")
    : rule.status === "NOT_VERIFIED"
      ? stage("rule", "Rule", "Not verified", "No persisted decision case is available for this shop.", "warning")
      : stage("rule", "Rule", "Unavailable", "Rule evidence is unavailable.", "danger");
  const aiStage = ai.status === "READY"
    ? stage("ai", "AI", "Ready", ai.detail ?? "A recorded AI recommendation is available.", "lilac")
    : stage("ai", "AI", "Unavailable", ai.detail === "NOT_RECORDED" ? "No AI recommendation has been recorded." : (ai.detail ?? "AI recommendation is unavailable."), "neutral");
  const baStage = ba.status === "REVIEWED"
    ? stage("ba", "BA review", "Reviewed", "A business analyst decision is recorded.", "success")
    : ba.status === "NOT_REVIEWED"
      ? stage("ba", "BA review", "Not reviewed", "Business analyst review has not been completed.", "warning")
      : stage("ba", "BA review", "Unavailable", "BA review state is unavailable.", "neutral");
  const executionStage = execution.status === "EXECUTED"
    ? stage("execution", "Execution", "Executed", "An audited execution record exists.", "success")
    : execution.status === "NOT_REQUESTED"
      ? stage("execution", "Execution", "Not requested", "No action has been requested.", "neutral")
      : stage("execution", "Execution", "Unavailable", "Execution state is unavailable.", "neutral");

  return [ruleStage, aiStage, baStage, executionStage];
}

export function buildDashboardPresentation(source: DashboardSource): DashboardPresentation {
  const selectedShop = source.shops.find((shop) => shop.id === source.selected.shopId);
  if (selectedShop === undefined) {
    throw new Error(`Selected dashboard shop was not found: ${source.selected.shopId}`);
  }

  const syncView = syncStatusView(source.selected.latestSync.status);
  const profileView = profileStatusView(source.selected.profileState);

  return {
    generatedAt: source.generatedAt.toISOString(),
    dataOrigin: selectedShop.dataOrigin,
    shops: source.shops.map((shop) => ({
      id: shop.id,
      profileNo: shop.profileNo,
      displayName: shop.displayName,
      selected: shop.id === selectedShop.id,
    })),
    selectedShop: {
      id: selectedShop.id,
      profileNo: selectedShop.profileNo,
      displayName: selectedShop.displayName,
      currency: selectedShop.currency,
    },
    kpis: buildKpis(source),
    coverage: {
      status: source.selected.dataCoverage.status,
      label: source.selected.dataCoverage.label,
      detail: source.selected.dataCoverage.reason ?? "The required data coverage is available.",
      tone: coverageTone(source.selected.dataCoverage.status),
    },
    freshness: {
      label: selectedShop.lastOrdersSyncedAt !== null && selectedShop.lastFinanceSyncedAt !== null
        ? "Orders and finance"
        : "Partial freshness",
      detail: "Timestamps reflect the latest persisted collector updates.",
      tone: selectedShop.lastOrdersSyncedAt !== null && selectedShop.lastFinanceSyncedAt !== null ? "sky" : "warning",
      ordersUpdatedAt: formatTimestamp(selectedShop.lastOrdersSyncedAt),
      financeUpdatedAt: formatTimestamp(selectedShop.lastFinanceSyncedAt),
    },
    sync: {
      ...syncView,
      status: source.selected.latestSync.status,
      updatedAt: formatTimestamp(source.selected.latestSync.startedAt),
    },
    profile: { ...profileView, status: source.selected.profileState },
    orderHealth: {
      total: source.selected.orders.total.toLocaleString("en-US"),
      awaiting: source.selected.orders.awaitingShipment.toLocaleString("en-US"),
      delivered: source.selected.orders.delivered.toLocaleString("en-US"),
      canceled: source.selected.orders.canceled.toLocaleString("en-US"),
    },
    decisionTrace: buildDecisionTrace(source),
  };
}
