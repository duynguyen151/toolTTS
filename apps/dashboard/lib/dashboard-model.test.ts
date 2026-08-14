import { describe, expect, it } from "vitest";

import type { DashboardSource } from "./dashboard-contract.js";
import { buildDashboardPresentation } from "./dashboard-model.js";

const source: DashboardSource = {
  generatedAt: new Date("2026-08-14T15:45:00.000Z"),
  shops: [
    {
      id: "shop-live",
      profileNo: "957",
      displayName: "14303841479",
      currency: "USD",
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "PAUSED_LAYOUT",
      pauseReason: "Seller Center operation failed",
      lastOrdersSyncedAt: new Date("2026-08-14T13:56:28.424Z"),
      lastFinanceSyncedAt: new Date("2026-08-14T13:34:15.749Z"),
    },
  ],
  selected: {
    shopId: "shop-live",
    orders: { total: 9, awaitingShipment: 5, delivered: 3, canceled: 1 },
    finance: { officialOnHoldAmount: "310.1600", currency: "USD", capturedAt: new Date("2026-08-14T13:33:46.449Z") },
    deliveryRate: { status: "AVAILABLE", value: 1, coverage: 1 / 3 },
    grossValidSales: { status: "AVAILABLE", amount: "186.9200", currency: "USD" },
    dataCoverage: { status: "PARTIAL", label: "Rolling 12 months", reason: "Lifetime history is not verified." },
    latestSync: { status: "FAILED", startedAt: new Date("2026-08-14T13:56:00.000Z"), failureType: "LAYOUT_CHANGED" },
    profileState: "NOT_VERIFIED",
    rule: { status: "NOT_VERIFIED" },
    ai: { status: "UNAVAILABLE", detail: "NOT_RECORDED" },
    ba: { status: "NOT_REVIEWED" },
    execution: { status: "NOT_REQUESTED" },
  },
};

describe("buildDashboardPresentation", () => {
  it("keeps operational stages separate and preserves partial coverage", () => {
    const view = buildDashboardPresentation(source);

    expect(view.decisionTrace.map((stage) => stage.label)).toEqual(["Rule", "AI", "BA review", "Execution"]);
    expect(view.decisionTrace.map((stage) => stage.value)).toEqual([
      "Not verified",
      "Unavailable",
      "Not reviewed",
      "Not requested",
    ]);
    expect(view.coverage.status).toBe("PARTIAL");
    expect(view.coverage.label).toBe("Rolling 12 months");
  });

  it("does not convert unavailable money or rates into zero", () => {
    const view = buildDashboardPresentation({
      ...source,
      selected: {
        ...source.selected,
        finance: { officialOnHoldAmount: null, currency: "USD", capturedAt: null },
        deliveryRate: { status: "UNAVAILABLE", reason: "DELIVERY_ELIGIBILITY_INCOMPLETE" },
      },
    });

    expect(view.kpis.find((item) => item.id === "on-hold")?.value).toBe("Unavailable");
    expect(view.kpis.find((item) => item.id === "delivery")?.value).toBe("Not verified");
  });
});
