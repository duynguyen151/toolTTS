import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DashboardPresentation } from "../../lib/dashboard-contract";
import { DashboardOverview } from "./dashboard-overview";

const presentation: DashboardPresentation = {
  generatedAt: "2026-08-14T16:02:04.716Z",
  dataOrigin: "DEMO_SANITIZED",
  shops: [
    {
      id: "shop-957",
      profileNo: "957",
      displayName: "TikTok Shop 957",
      selected: true,
    },
  ],
  selectedShop: {
    id: "shop-957",
    profileNo: "957",
    displayName: "TikTok Shop 957",
    currency: "USD",
  },
  kpis: [
    {
      id: "on-hold",
      label: "Finance on hold",
      value: "$310.16",
      detail: "Official captured amount",
      tone: "rose",
    },
    {
      id: "orders",
      label: "Orders",
      value: "9",
      detail: "Latest available window",
      tone: "amber",
    },
    {
      id: "awaiting",
      label: "Awaiting shipment",
      value: "5",
      detail: "Requires operator attention",
      tone: "mint",
    },
    {
      id: "delivery",
      label: "Delivery rate",
      value: "UNKNOWN",
      detail: "Lifetime coverage not verified",
      tone: "lilac",
    },
  ],
  coverage: {
    status: "PARTIAL",
    label: "Partial coverage",
    detail: "Rolling 12-month history; lifetime completeness is not verified.",
    tone: "warning",
  },
  freshness: {
    label: "Freshness available",
    detail: "Orders and finance timestamps are shown independently.",
    tone: "sky",
    ordersUpdatedAt: "14 Aug, 09:12",
    financeUpdatedAt: "14 Aug, 09:08",
  },
  sync: {
    status: "PAUSED_LAYOUT",
    label: "Paused: layout changed",
    detail: "Review the Seller Center layout before the next update.",
    tone: "warning",
    updatedAt: "14 Aug, 09:12",
  },
  profile: {
    status: "NOT_VERIFIED",
    label: "Profile not verified",
    detail: "AdsPower runtime state is not exposed by the current read boundary.",
    tone: "neutral",
  },
  orderHealth: {
    total: "9",
    awaiting: "5",
    delivered: "3",
    canceled: "1",
  },
  decisionTrace: [
    {
      id: "rule",
      label: "Rule result",
      value: "NOT VERIFIED",
      detail: "No deterministic result is recorded for this review.",
      tone: "warning",
    },
    {
      id: "ai",
      label: "AI recommendation",
      value: "UNAVAILABLE",
      detail: "No recommendation is recorded.",
      tone: "neutral",
    },
    {
      id: "ba",
      label: "BA review",
      value: "NOT REVIEWED",
      detail: "A business analyst has not reviewed this shop.",
      tone: "neutral",
    },
    {
      id: "execution",
      label: "Execution",
      value: "NOT REQUESTED",
      detail: "No Seller Center action has been requested.",
      tone: "neutral",
    },
  ],
};

describe("DashboardOverview", () => {
  it("keeps operational unknowns and decision stages explicit", () => {
    const html = renderToStaticMarkup(createElement(DashboardOverview, { presentation }));

    expect(html).toContain("DEMO_SANITIZED");
    expect(html).toContain("Delivery rate");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("Rule result");
    expect(html).toContain("AI recommendation");
    expect(html).toContain("BA review");
    expect(html).toContain("Execution");
    expect(html).not.toContain("AI Health Score");
  });

  it("renders dashboard regions with semantic headings and lists", () => {
    const html = renderToStaticMarkup(createElement(DashboardOverview, { presentation }));

    expect(html).toMatch(/<h1[^>]*>Operational overview<\/h1>/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="kpi-heading"/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="decision-heading"/);
    expect(html).toMatch(/<ol[^>]*aria-label="Decision trace"/);
    expect(html).toContain("Rule → AI → BA → Execution");
    expect(html).toContain('aria-label="Stage 1 of 4: Rule result"');
    expect(html).toContain('aria-label="Stage 4 of 4: Execution"');
  });

  it("shows the operational read states without implying unavailable actions work", () => {
    const html = renderToStaticMarkup(createElement(DashboardOverview, { presentation }));

    expect(html).toContain('id="shops"');
    expect(html).toContain('id="sync-state"');
    expect(html).toContain("Order health");
    expect(html).toContain("Data coverage");
    expect(html).toContain("Paused: layout changed");
    expect(html).toContain("Profile not verified");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Open profile/s);
  });

  it("formats the generated timestamp for the dashboard display zone", () => {
    const html = renderToStaticMarkup(createElement(DashboardOverview, { presentation }));

    expect(html).toContain("14 Aug 2026");
    expect(html).toContain("GMT+7");
    expect(html).not.toContain(">Generated 2026-08-14T16:02:04.716Z</time>");
  });
});
