import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/shops",
  notFound: vi.fn(),
}));

vi.mock("../../lib/operations-console-read", () => ({
  readConsoleShops: vi.fn().mockResolvedValue({
    items: [
      {
        id: "shop-1",
        profileId: "p-1",
        profileNo: "118",
        displayName: "Shop Alpha",
        region: "US",
        locale: "en-US",
        currency: "USD",
        enabled: true,
        syncState: "ACTIVE",
        pauseReason: null,
        verificationState: "READY",
        eligibilityStatus: "ELIGIBLE",
        verifiedTiktokShopId: "TTS_118",
        verifiedShopDisplayName: "Shop Alpha",
        lastVerifiedAt: "2026-08-16T09:00:00Z",
        lastOrdersSyncedAt: "2026-08-16T10:00:00Z",
        lastFinanceSyncedAt: "2026-08-16T10:00:00Z",
        dataOrigin: "LIVE",
        totalOrders: 42,
        onHoldAmount: "1250.00",
        deliveryRate: 0.714,
        latestRecommendation: "CONTINUE",
        latestAiRecommendation: "CONTINUE",
        latestBaDecision: "CONTINUE",
        activeDecisionCaseId: "case-118",
        adsPowerState: "OPEN",
        groupName: "Group Alpha",
        tags: [],
        cotikBinding: { enabled: true, cotikShopId: "cotik-118" },
      },
    ],
    totalItems: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }),
}));

import { GlobalTaskProvider } from "../../components/operations/global-task-context";
import ShopsPage from "./page";

describe("ShopsPage (/shops)", () => {
  it("renders the shops list route with shop links and actions", async () => {
    const pageElement = await ShopsPage({
      searchParams: Promise.resolve({}),
    });

    const html = renderToStaticMarkup(
      createElement(GlobalTaskProvider, null, pageElement)
    );
    expect(html).toContain("Shop Alpha");
    expect(html).toContain("#118");
    expect(html).toContain('href="/shops/118"');
    expect(html).toContain("Sync COTIK (Chính)");
    expect(html).toContain("Sync SC (Fallback)");
  });
});
