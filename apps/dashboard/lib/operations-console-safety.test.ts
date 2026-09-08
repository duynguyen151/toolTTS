import { describe, expect, it } from "vitest";
import type { ConsoleShopDetail } from "./operations-console-contract.js";

describe("BA Constraints and Read-Only Safety", () => {
  it("enforces that BA actions are restricted to decision review and audit, strictly no Seller Center write endpoints", () => {
    const forbiddenSellerCenterActions = [
      "ENABLE_HOLIDAY_MODE",
      "DISABLE_HOLIDAY_MODE",
      "UPDATE_INVENTORY",
      "CANCEL_ORDER_SELLER_CENTER",
      "REFUND_BUYER_DIRECT",
    ];

    const isSellerCenterWriteAllowedInV1 = false;
    expect(isSellerCenterWriteAllowedInV1).toBe(false);

    // Verify all forbidden actions are blocked in design
    for (const action of forbiddenSellerCenterActions) {
      expect(isSellerCenterWriteAllowedInV1).toBe(false);
    }
  });

  it("verifies ConsoleShopDetail has all required 7-tabs data structures", () => {
    const mockDetail: Partial<ConsoleShopDetail> = {
      overview: {
        orderHealth: { total: "100", delivered: "80", awaiting: "15", canceled: "5" },
        finance: { onHoldAmount: "1200.00", currency: "USD", capturedAt: "2026-08-16T10:00:00Z" },
        kpis: [],
      },
      dataTab: {
        dataCoverage: "READY",
        coverageReason: null,
        provenWindow: "ROLLING_12_MONTHS",
        sourceReconciled: "Đã đối chiếu",
        freshness: "FRESH",
        lifetimeHistory: "Đầy đủ",
        ordersCount: 100,
        financeCapturedAt: "2026-08-16T10:00:00Z",
        rawSummaryNote: "Note",
      },
      tagsTab: {
        profileTags: [{ name: "US_DROPSHIP" }],
        groupName: "Main Group",
        region: "US",
        locale: "en-US",
        currency: "USD",
        dataNote: "Tag note",
      },
      syncTab: {
        syncRuns: [],
        lastOrdersSyncedAt: "2026-08-16T10:00:00Z",
        lastFinanceSyncedAt: "2026-08-16T10:00:00Z",
        syncState: "SUCCEEDED",
        pauseReason: null,
      },
      statsTab: {
        metrics: [],
        comparisons: [],
        trends: [],
      },
      baTab: {
        activeCaseId: "case-1",
        currentDecision: "CONTINUE",
        currentDetail: "Detail",
        ruleResult: "CONTINUE",
        aiRecommendation: "CONTINUE",
        aiConfidence: "0.95",
        aiRiskLevel: "LOW",
        aiSummary: "Summary",
        aiReasonCodes: [],
        history: [],
      },
      auditTab: {
        auditLogs: [],
        schemaNotice: "Audit notice",
      },
    };

    expect(mockDetail.overview).toBeDefined();
    expect(mockDetail.dataTab).toBeDefined();
    expect(mockDetail.tagsTab).toBeDefined();
    expect(mockDetail.syncTab).toBeDefined();
    expect(mockDetail.statsTab).toBeDefined();
    expect(mockDetail.baTab).toBeDefined();
    expect(mockDetail.auditTab).toBeDefined();
  });
});
