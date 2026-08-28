import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/shops/118",
  notFound: vi.fn(),
}));

vi.mock("../../../lib/operations-console-read", () => ({
  readConsoleShopDetail: vi.fn().mockImplementation((_dbUrl, profileNo) => {
    if (profileNo === "118") {
      return Promise.resolve({
        shop: {
          profileNo: "118",
          displayName: "Shop Alpha",
          verificationState: "READY",
          tags: [],
        },
        overview: {
          kpis: [],
          orderHealth: { total: "42", awaiting: "12", delivered: "30", canceled: "0" },
          finance: { onHoldAmount: "1250.00", currency: "USD", capturedAt: new Date().toISOString() },
        },
        dataTab: { dataCoverage: "READY", freshness: "FRESH", ordersCount: 42, financeCapturedAt: new Date().toISOString(), rawSummaryNote: "" },
        tagsTab: { groupName: "Group A", region: "US", locale: "en-US", currency: "USD", profileTags: [], dataNote: "" },
        syncTab: { syncRuns: [] },
        statsTab: { metrics: [], trends: [] },
        baTab: { currentDecision: "CONTINUE", ruleResult: "CONTINUE", aiRecommendation: "CONTINUE", aiConfidence: "95%", aiSummary: "All good", history: [], activeCaseId: "case-118" },
        auditTab: { auditLogs: [], schemaNotice: "" },
      });
    }
    return Promise.resolve(null);
  }),
}));

import { GlobalTaskProvider } from "../../../components/operations/global-task-context";
import ShopDetailPage from "./page";

describe("ShopDetailPage (/shops/[profileNo])", () => {
  it("renders the shop detail route with order explorer link and shop identity", async () => {
    const pageElement = await ShopDetailPage({
      params: Promise.resolve({ profileNo: "118" }),
      searchParams: Promise.resolve({ tab: "overview" }),
    });

    const html = renderToStaticMarkup(
      createElement(GlobalTaskProvider, null, pageElement)
    );
    expect(html).toContain("Shop Alpha");
    expect(html).toContain("Profile #118");
    expect(html).toContain('href="/orders?profile=118"');
    expect(html).toContain("Order Explorer (42 đơn) →");
  });
});


