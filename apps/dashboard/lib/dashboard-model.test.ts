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
    latestSync: { status: "FAILED", startedAt: new Date("2026-08-14T13:56:00.000Z"), sourceComplete: null, failureType: "LAYOUT_CHANGED" },
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

    expect(view.decisionTrace.map((stage) => stage.label)).toEqual([
      "Rule Result",
      "AI Recommendation",
      "BA Decision",
      "Execution",
    ]);
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

  it("formats authoritative delivery rate 0.571428 as 57.1%", () => {
    const view = buildDashboardPresentation({
      ...source,
      selected: {
        ...source.selected,
        deliveryRate: { status: "AVAILABLE", value: 0.571428, coverage: 1 },
      },
    });

    expect(view.kpis.find((item) => item.id === "delivery")?.value).toBe("57.1%");
  });

  it("uses the persisted operational observation rather than read generation time", () => {
    const view = buildDashboardPresentation({
      ...source,
      generatedAt: new Date("2026-08-16T09:00:00.000Z"),
      selected: {
        ...source.selected,
        latestSync: { ...source.selected.latestSync, startedAt: new Date("2026-08-16T01:00:00.000Z") },
      },
    });

    expect(view.currentOperational).toMatchObject({
      owner: "CURRENT_OPERATIONAL_FACTS",
      source: "PERSISTED_SHOP_READ_MODEL",
      observedAt: "16 Aug 2026, 08:00 GMT+7",
    });
    expect(view.currentOperational?.observedAt).not.toBe(view.generatedAt);
  });

  it("labels current operational facts with their owner, source, and Bangkok timebase", () => {
    const view = buildDashboardPresentation(source);
    const currentOperational = view.currentOperational;

    expect(currentOperational).toEqual({
      owner: "CURRENT_OPERATIONAL_FACTS",
      source: "PERSISTED_SHOP_READ_MODEL",
      businessTimeZone: "Asia/Bangkok",
      observedAt: "14 Aug 2026, 20:56 GMT+7",
    });
  });
});
