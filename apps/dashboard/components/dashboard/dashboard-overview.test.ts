import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DashboardPresentation } from "../../lib/dashboard-contract";
import type { ProfileOperationsPresentation } from "../../lib/operations-contract";
import { OperationsProvider } from "../operations/operations-provider";
import { DashboardOverview } from "./dashboard-overview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));

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

const operationsPresentation: ProfileOperationsPresentation = {
  status: "READY",
  selectedProfileNo: "957",
  profiles: [{
    profileNo: "957",
    state: "CLOSED",
    linkState: "LINKED",
    linkedShop: { profileNo: "957", displayName: "TikTok Shop 957" },
  }],
  error: null,
};

function renderDashboard(
  dataOrigin: DashboardPresentation["dataOrigin"] = "DEMO_SANITIZED",
  operatorProfileNo?: string,
): string {
  return renderToStaticMarkup(createElement(
    OperationsProvider,
    {
      initialPresentation: operationsPresentation,
      persistedShop: {
        profileNo: presentation.selectedShop.profileNo,
        displayName: presentation.selectedShop.displayName,
        dataOrigin,
      },
      children: createElement(DashboardOverview, {
        presentation: { ...presentation, dataOrigin },
        ...(operatorProfileNo === undefined ? {} : { operatorProfileNo }),
      }),
    },
  ));
}

describe("DashboardOverview", () => {
  it("keeps operational unknowns and decision stages explicit", () => {
    const html = renderDashboard();

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
    const html = renderDashboard();

    expect(html).toMatch(/<h1[^>]*>Operational overview<\/h1>/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="kpi-heading"/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="decision-heading"/);
    expect(html).toMatch(/<ol[^>]*aria-label="Decision trace"/);
    expect(html).toContain("Rule → AI → BA → Execution");
    expect(html).toContain('aria-label="Stage 1 of 4: Rule result"');
    expect(html).toContain('aria-label="Stage 4 of 4: Execution"');
  });

  it("connects profile operations without changing the approved dashboard regions", () => {
    const html = renderDashboard();

    expect(html).toContain('id="shops"');
    expect(html).toContain('id="sync-state"');
    expect(html).toContain("Order health");
    expect(html).toContain("/orders?profile=957");
    expect(html).toContain("/shops/957");
    expect(html).toContain("Data coverage");
    expect(html).toContain("Paused: layout changed");
    expect(html).toContain("Live operations are disabled for sanitized demo data.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
    expect(html).not.toMatch(/profileId|cdpEndpoint|user_id|password|proxy/i);
  });

  it("mounts the live shop decision center instead of the fixture workspace", () => {
    const html = renderDashboard("LIVE");

    expect(html).toContain("Shop Decision Center");
    expect(html).toContain("Live read model");
    expect(html).not.toContain("TEST / DEV FIXTURE");
    expect(html).not.toContain("Integration D required");
  });

  it("distinguishes an operator-selected profile from stale persisted shop data", () => {
    const html = renderDashboard("LIVE", "987");

    expect(html).toContain("Operator profile 987 selected");
    expect(html).toContain("Decision Center data below belongs to profile 957 until Verify completes.");
  });

  it("enables profile operations only for LIVE dashboard data", () => {
    const html = renderDashboard("LIVE");

    expect(html).toContain("Profile 957 · CLOSED · linked");
    expect(html).toContain("Linked to TikTok Shop 957");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Update data/s);
  });

  it("formats the generated timestamp for the dashboard display zone", () => {
    const html = renderDashboard();

    expect(html).toContain("14 Aug 2026");
    expect(html).toContain("GMT+7");
    expect(html).not.toContain(">Generated 2026-08-14T16:02:04.716Z</time>");
  });

  it("labels the operational dashboard surface separately from immutable decision evidence", () => {
    const html = renderDashboard("LIVE");

    expect(html).toContain("Current operational facts · persisted shop read model · GMT+07");
  });
});
