import { afterEach, describe, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({
  findShopByProfileNo: vi.fn(),
  getEffectiveRiskPolicy: vi.fn(),
  getFinanceSummary: vi.fn(),
  getFullPersistedRiskOrderFacts: vi.fn(),
  findEnabledShopProviderBinding: vi.fn(),
  findLatestSuccessfulSyncRun: vi.fn(),
  listSyncRuns: vi.fn(),
  getLatestDecisionContext: vi.fn(),
  getRiskControlState: vi.fn(),
}));

vi.mock("@shop-health/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@shop-health/db")>(),
  ...db,
}));

import {
  createDbDecisionWorkflowStore,
  normalizeRiskFacts,
  resolveFullHistoryPeriod,
  toAiPersistenceInput,
} from "./review-workflow.js";

const provenance = {
  provider: "9router" as const,
  requestedModel: "oc/deepseek-v4-flash-free",
  reportedModel: "deepseek-v4-flash-free",
  actualModelUsed: "deepseek-v4-flash-free",
  authMode: "LOCAL_NO_AUTH" as const,
  outputSchemaVersion: "decision-ai-output.v1" as const,
  promptVersion: "decision-ai-prompt.v2" as const,
  aiPolicyVersion: "decision-ai-policy.v1" as const,
  rulePolicyVersion: "risk-control-policy.v1",
  generatedAt: "2026-08-14T08:30:00.000Z",
};

describe("review workflow DB mapping", () => {
  afterEach(() => vi.clearAllMocks());

  test("keeps unproven Finance snapshot values out of a Decision Case source", async () => {
    const capturedAt = new Date("2026-08-14T00:00:00.000Z");
    db.findShopByProfileNo.mockResolvedValue({
      id: "shop-1",
      profileId: "profile-1",
      profileNo: "957",
      tiktokShopId: "seller-957",
      displayName: "Shop 957",
      currency: "USD",
      dataOrigin: "LIVE",
      lastOrdersSyncedAt: null,
      lastFinanceSyncedAt: null,
    });
    db.getFullPersistedRiskOrderFacts.mockResolvedValue([]);
    db.getFinanceSummary.mockResolvedValue({
      proofStatus: "PROOF_UNAVAILABLE",
      latestSnapshot: {
        capturedAt,
        currency: "USD",
        availableBalance: "100.0000",
        frozenBalance: "200.0000",
        totalBalance: "300.0000",
        toSettleBalance: "400.0000",
        onHoldBalance: "500.0000",
        officialOnHoldAmount: "500.0000",
      },
      statementCount: 8,
      onHoldCount: 4,
    });
    db.findEnabledShopProviderBinding.mockResolvedValue(null);
    db.findLatestSuccessfulSyncRun.mockResolvedValue(null);
    db.listSyncRuns.mockResolvedValue([]);
    db.getRiskControlState.mockResolvedValue(null);
    db.getLatestDecisionContext.mockResolvedValue(null);
    db.getEffectiveRiskPolicy.mockResolvedValue({ version: "policy.v1" });

    const source = await createDbDecisionWorkflowStore({} as never).loadReviewStartSource(
      "957",
      new Date("2026-08-15T00:00:00.000Z"),
    );

    expect(db.getFinanceSummary).toHaveBeenCalledWith(expect.anything(), "shop-1", null);
    expect(source.coverageSnapshot?.financeHealth).toMatchObject({
      provider: "SELLER_CENTER",
      capability: "OFFICIAL_ON_HOLD",
      providerUpdatedAt: null,
      collectedAt: null,
      health: "UNKNOWN",
      officialOnHoldAvailability: "UNAVAILABLE",
      refreshState: "NOT_REQUESTED",
    });
    expect(source.financeSnapshot).toEqual({
      capturedAt: null,
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: null,
      onHoldBalance: null,
      officialOnHoldAmount: null,
      settlementCount: 0,
      onHoldSettlementCount: 0,
    });
  });

  test("uses the earliest persisted fact even when it predates shop creation", () => {
    const periodEnd = new Date("2026-08-14T08:30:00.000Z");
    const period = resolveFullHistoryPeriod([
      {
        canonicalStatus: "DELIVERED",
        currency: "USD",
        orderCount: 2,
        totalValue: "10.0000",
        firstObservedAt: new Date("2026-07-01T00:00:00.000Z"),
        lastObservedAt: new Date("2026-08-13T00:00:00.000Z"),
      },
      {
        canonicalStatus: "AWAITING_SHIPMENT",
        currency: "USD",
        orderCount: 1,
        totalValue: "5.0000",
        firstObservedAt: new Date("2026-08-01T00:00:00.000Z"),
        lastObservedAt: new Date("2026-08-12T00:00:00.000Z"),
      },
    ], periodEnd);

    expect(period).toEqual({
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd,
    });
  });

  test("uses a deterministic zero-length period for empty persisted history", () => {
    const periodEnd = new Date("2026-08-14T08:30:00.000Z");

    expect(resolveFullHistoryPeriod([], periodEnd)).toEqual({
      periodStart: periodEnd,
      periodEnd,
    });
  });

  test("normalizes PostgreSQL aggregate timestamps before domain evaluation", () => {
    const facts = normalizeRiskFacts([{
      canonicalStatus: "DELIVERED",
      currency: "USD",
      orderCount: 2,
      totalValue: "10.0000",
      firstObservedAt: "2026-08-01T08:30:00.000Z" as unknown as Date,
      lastObservedAt: "2026-08-14T08:30:00.000Z" as unknown as Date,
    }]);

    expect(facts[0]?.firstObservedAt).toEqual(new Date("2026-08-01T08:30:00.000Z"));
    expect(facts[0]?.lastObservedAt).toEqual(new Date("2026-08-14T08:30:00.000Z"));
  });

  test("maps an available AI decision without mixing it into the rule or BA fields", () => {
    expect(toAiPersistenceInput(
      "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      {
        status: "AVAILABLE",
        recommendation: "WATCH",
        riskLevel: "MEDIUM",
        confidence: 0.82,
        ruleResult: "CONTINUE",
        ruleOverride: true,
        reasonCodes: ["DATA_INCOMPLETE"],
        supportingFactors: ["Delivery remains above threshold."],
        riskFactors: ["Coverage is incomplete."],
        whatWouldChangeDecision: ["Verified complete coverage."],
        reason: "More persisted history is required.",
        humanReviewRequired: true,
        ...provenance,
      },
    )).toEqual({
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      decisionCaseId: "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      status: "AVAILABLE",
      model: "deepseek-v4-flash-free",
      recommendation: "WATCH",
      riskLevel: "MEDIUM",
      confidence: 0.82,
      ruleOverride: true,
      reasonCodes: ["DATA_INCOMPLETE"],
      supportingFactors: ["Delivery remains above threshold."],
      riskFactors: ["Coverage is incomplete."],
      whatWouldChangeDecision: ["Verified complete coverage."],
      reason: "More persisted history is required.",
      humanReviewRequired: true,
      failureCode: null,
      provider: "9router",
      requestedModel: "oc/deepseek-v4-flash-free",
      reportedModel: "deepseek-v4-flash-free",
      actualModelUsed: "deepseek-v4-flash-free",
      authMode: "LOCAL_NO_AUTH",
      outputSchemaVersion: "decision-ai-output.v1",
      promptVersion: "decision-ai-prompt.v2",
      policyVersion: "risk-control-policy.v1",
      aiPolicyVersion: "decision-ai-policy.v1",
    });
  });

  test("maps unavailable AI provenance without fabricating a recommendation", () => {
    expect(toAiPersistenceInput(
      "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      "0df4a641-4555-4f4d-bb32-595f95ad3c7c",
      {
        status: "UNAVAILABLE",
        errorCode: "CONFIG_MISSING",
        humanReviewRequired: true,
        ...provenance,
        reportedModel: null,
        actualModelUsed: null,
        authMode: "CONFIG_MISSING",
      },
    )).toMatchObject({
      status: "UNAVAILABLE",
      model: null,
      recommendation: null,
      riskLevel: null,
      confidence: null,
      ruleOverride: null,
      reasonCodes: null,
      supportingFactors: null,
      riskFactors: null,
      whatWouldChangeDecision: null,
      reason: null,
      failureCode: "CONFIG_MISSING",
      humanReviewRequired: true,
    });
  });
});
