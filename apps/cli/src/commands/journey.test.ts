import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findShopByProfileNo: vi.fn(),
  getCurrentAiTaskConfig: vi.fn(),
  getEffectiveRiskPolicy: vi.fn(),
  getFinanceSummary: vi.fn(),
  resolveAiTaskConfig: vi.fn(),
  testAiTaskConnection: vi.fn(),
  runAuthoritativeFinanceRefresh: vi.fn(),
  runShopSync: vi.fn(),
  createSellerCenterDataSource: vi.fn(),
  createAdsPowerProxyPreflight: vi.fn(),
  calculateAndStoreReport: vi.fn(),
  createCliDecisionWorkflow: vi.fn(),
}));

vi.mock("@shop-health/db", () => ({
  findShopByProfileNo: mocks.findShopByProfileNo,
  getCurrentAiTaskConfig: mocks.getCurrentAiTaskConfig,
  getEffectiveRiskPolicy: mocks.getEffectiveRiskPolicy,
  getFinanceSummary: mocks.getFinanceSummary,
}));
vi.mock("@shop-health/decision-ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@shop-health/decision-ai")>(),
  resolveAiTaskConfig: mocks.resolveAiTaskConfig,
  testAiTaskConnection: mocks.testAiTaskConnection,
}));
vi.mock("@shop-health/sync", () => ({
  runAuthoritativeFinanceRefresh: mocks.runAuthoritativeFinanceRefresh,
  runShopSync: mocks.runShopSync,
}));
vi.mock("@shop-health/seller-center", () => ({ createSellerCenterDataSource: mocks.createSellerCenterDataSource }));
vi.mock("@shop-health/seller-center/proxy-preflight", () => ({ createAdsPowerProxyPreflight: mocks.createAdsPowerProxyPreflight }));
vi.mock("../db-runtime.js", () => ({
  withDatabase: async (_runtime: unknown, operation: (context: { db: object; close: () => Promise<void> }) => Promise<unknown>) =>
    operation({ db: {}, close: async () => undefined }),
}));
vi.mock("../metrics-service.js", () => ({ calculateAndStoreReport: mocks.calculateAndStoreReport }));
vi.mock("../review-workflow.js", () => ({ createCliDecisionWorkflow: mocks.createCliDecisionWorkflow }));

import { createDefaultJourneyRunner, registerJourneyCommands, type JourneyRunner } from "./journey.js";

const runtime = {
  config: {
    ADSPOWER_BASE_URL: "http://127.0.0.1:50325",
    ADSPOWER_API_KEY: "api-key",
    DISPLAY_TIME_ZONE: "Asia/Bangkok",
  },
  logger: {},
} as never;

describe("v1 journey command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the ordered CLI-first proof and emits a stable aggregate", async () => {
    const calls: string[] = [];
    const runner: JourneyRunner = vi.fn(async (input) => {
      calls.push(`run:${input.profileNo}`);
      return {
        schemaVersion: "v1-journey.v1" as const,
        profileNo: input.profileNo,
        stages: {
          select: { profileNo: input.profileNo },
          sync: { orders: { status: "SUCCEEDED" }, finance: { status: "SUCCEEDED" } },
          financeHealth: { status: "FRESH" },
          metrics: { period: input.period },
          policy: { effectiveAt: input.effectiveAt },
          rule: { result: "CONTINUE" },
          aiConnection: { status: "SUCCESS", code: "CONNECTED" },
          case: { caseId: "case-1", immutable: true },
          ba: { decision: input.decision },
          readback: { caseId: "case-1", immutable: true },
          history: { profileNo: input.profileNo },
        },
      };
    });
    const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
    registerJourneyCommands(program, runner);
    let output = "";
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    try {
      await program.parseAsync([
        "node", "shop-health", "journey", "957",
        "--period", "30d",
        "--effective-at", "2026-08-28T04:00:00.000Z",
        "--decision", "SLOW_SELL",
        "--reason-code", "LOW_DELIVERY_RATE",
        "--planned-method", "INCREASE_PRICE",
        "--notes", "Reduce demand while monitoring delivery.",
        "--json",
      ]);
    } finally {
      write.mockRestore();
    }

    expect(runner).toHaveBeenCalledWith({
      profileNo: "957",
      period: "30d",
      effectiveAt: new Date("2026-08-28T04:00:00.000Z"),
      decision: "SLOW_SELL",
      reasonCodes: ["LOW_DELIVERY_RATE"],
      plannedMethods: ["INCREASE_PRICE"],
      notes: "Reduce demand while monitoring delivery.",
    });
    expect(calls).toEqual(["run:957"]);
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: "v1-journey.v1",
      profileNo: "957",
      stages: {
        sync: { orders: { status: "SUCCEEDED" }, finance: { status: "SUCCEEDED" } },
        case: { immutable: true },
        readback: { immutable: true },
      },
    });
  });

  it("composes existing provider, deterministic, AI, BA, and immutable-readback seams", async () => {
    const shop = { id: "shop-1", profileNo: "957", profileId: "profile-1", tiktokShopId: "tt-1" };
    mocks.findShopByProfileNo.mockResolvedValue(shop);
    mocks.createSellerCenterDataSource.mockReturnValue("seller-source");
    mocks.runShopSync.mockResolvedValue({ status: "SUCCEEDED", complete: true });
    mocks.createAdsPowerProxyPreflight.mockReturnValue({
      preflight: vi.fn().mockResolvedValue({ status: "HEALTHY" }),
    });
    mocks.runAuthoritativeFinanceRefresh.mockResolvedValue({ status: "SUCCEEDED", sync: { status: "SUCCEEDED" } });
    mocks.getFinanceSummary.mockResolvedValue({
      proofStatus: "PROVEN",
      statementCount: 4,
      onHoldCount: 1,
      expectedSettlementAmount: "50.0000",
      onHoldExpectedAmount: "10.0000",
      settledAmount: "40.0000",
      unknownOnHoldReasonCount: 0,
      missingOnHoldExpectedAmountCount: 0,
      latestSnapshot: {
        capturedAt: new Date("2026-08-28T03:00:00.000Z"),
        currency: "USD",
        officialOnHoldAmount: "10.0000",
      },
    });
    mocks.calculateAndStoreReport.mockResolvedValue({ metrics: { deliveryRate: 0.8 } });
    mocks.getEffectiveRiskPolicy.mockResolvedValue({ policyVersion: "risk-policy.v1" });
    mocks.getCurrentAiTaskConfig.mockResolvedValue(null);
    mocks.resolveAiTaskConfig.mockReturnValue({ source: "ENVIRONMENT", taskId: "SHOP_HEALTH_REVIEWER" });
    mocks.testAiTaskConnection.mockResolvedValue({ status: "SUCCESS", code: "CONNECTED" });
    const started = { case: { id: "case-1" }, rule: { decision: "CONTINUE", source: "OFFICIAL_ON_HOLD" } };
    const decided = { ba: { status: "DECIDED", decision: "SLOW_SELL" } };
    const readback = { case: { id: "case-1" } };
    mocks.createCliDecisionWorkflow.mockReturnValue({
      startReview: vi.fn().mockResolvedValue(started),
      decide: vi.fn().mockResolvedValue(decided),
      show: vi.fn().mockResolvedValue(readback),
      history: vi.fn().mockResolvedValue({ schemaVersion: "decision-history.v1", items: [], nextCursor: null }),
    });

    const result = await createDefaultJourneyRunner(runtime)({
      profileNo: "957",
      period: "30d",
      effectiveAt: new Date("2026-08-28T04:00:00.000Z"),
      decision: "SLOW_SELL",
      reasonCodes: ["LOW_DELIVERY_RATE"],
      plannedMethods: ["INCREASE_PRICE"],
      notes: "Reduce demand while monitoring delivery.",
    });

    expect(mocks.runShopSync).toHaveBeenCalledWith(expect.objectContaining({ kind: "orders", source: "seller-source", shop }));
    expect(mocks.runAuthoritativeFinanceRefresh).toHaveBeenCalledWith(expect.objectContaining({ source: "seller-source", shop }));
    expect(mocks.testAiTaskConnection).toHaveBeenCalledWith(
      { source: "ENVIRONMENT", taskId: "SHOP_HEALTH_REVIEWER" },
      { environment: process.env },
    );
    const workflow = mocks.createCliDecisionWorkflow.mock.results[0]?.value;
    expect(workflow.startReview).toHaveBeenCalledWith({ profileNo: "957" });
    expect(workflow.decide).toHaveBeenCalledWith(expect.objectContaining({
      caseId: "case-1",
      decision: "SLOW_SELL",
      plannedMethods: ["INCREASE_PRICE"],
    }));
    expect(workflow.show).toHaveBeenCalledWith("case-1");
    expect(result).toMatchObject({
      schemaVersion: "v1-journey.v1",
      profileNo: "957",
      stages: {
        sync: { orders: { status: "SUCCEEDED" }, finance: { status: "SUCCEEDED" } },
        rule: { decision: "CONTINUE", source: "OFFICIAL_ON_HOLD" },
        case: { caseId: "case-1", immutable: true },
        readback: { immutable: true, review: readback },
      },
    });
  });

  it("fails closed before metrics or a Case when the authoritative Finance refresh needs attention", async () => {
    const shop = { id: "shop-1", profileNo: "957", profileId: "profile-1", tiktokShopId: "tt-1" };
    mocks.findShopByProfileNo.mockResolvedValue(shop);
    mocks.createSellerCenterDataSource.mockReturnValue("seller-source");
    mocks.runShopSync.mockResolvedValue({ status: "SUCCEEDED", complete: true });
    mocks.createAdsPowerProxyPreflight.mockReturnValue({
      preflight: vi.fn().mockResolvedValue({ status: "UNAVAILABLE" }),
    });
    mocks.runAuthoritativeFinanceRefresh.mockResolvedValue({
      status: "MANUAL_ACTION_REQUIRED",
      reason: "PROXY_UNAVAILABLE",
    });

    await expect(createDefaultJourneyRunner(runtime)({
      profileNo: "957",
      period: "30d",
      effectiveAt: new Date("2026-08-28T04:00:00.000Z"),
      decision: "CONTINUE",
      reasonCodes: ["DATA_INCOMPLETE"],
      plannedMethods: [],
    })).rejects.toThrow("Authoritative Finance refresh requires attention");

    expect(mocks.calculateAndStoreReport).not.toHaveBeenCalled();
    expect(mocks.createCliDecisionWorkflow).not.toHaveBeenCalled();
  });

  it("preserves a tri-state Official-On-Hold Rule, stale Finance disclosure, and unavailable AI", async () => {
    const shop = { id: "shop-1", profileNo: "957", profileId: "profile-1", tiktokShopId: "tt-1" };
    mocks.findShopByProfileNo.mockResolvedValue(shop);
    mocks.createSellerCenterDataSource.mockReturnValue("seller-source");
    mocks.runShopSync.mockResolvedValue({ status: "SUCCEEDED", complete: true });
    mocks.createAdsPowerProxyPreflight.mockReturnValue({ preflight: vi.fn().mockResolvedValue({ status: "HEALTHY" }) });
    mocks.runAuthoritativeFinanceRefresh.mockResolvedValue({ status: "SUCCEEDED", sync: { status: "SUCCEEDED" } });
    mocks.getFinanceSummary.mockResolvedValue({
      proofStatus: "PROOF_UNAVAILABLE", statementCount: 0, onHoldCount: 0,
      expectedSettlementAmount: null, onHoldExpectedAmount: null, settledAmount: null,
      unknownOnHoldReasonCount: 0, missingOnHoldExpectedAmountCount: 0, latestSnapshot: null,
    });
    mocks.calculateAndStoreReport.mockResolvedValue({ metrics: {} });
    mocks.getEffectiveRiskPolicy.mockResolvedValue({ policyVersion: "risk-policy.v1" });
    mocks.getCurrentAiTaskConfig.mockResolvedValue(null);
    mocks.resolveAiTaskConfig.mockReturnValue({ source: "UNSET", taskId: "SHOP_HEALTH_REVIEWER" });
    mocks.testAiTaskConnection.mockResolvedValue({ status: "FAILURE", code: "CONFIG_ERROR", requested: null, message: "Provider configuration is unavailable." });
    const started = {
      case: { id: "case-stale" },
      rule: { decision: "INSUFFICIENT_DATA", conditions: { officialOnHold: "NOT_EVALUATED", deliveryRate: "CLEAR" } },
      coverageSnapshot: { financeHealth: { health: "STALE", collectedAt: "2026-08-27T00:00:00.000Z" } },
    };
    mocks.createCliDecisionWorkflow.mockReturnValue({
      startReview: vi.fn().mockResolvedValue(started),
      decide: vi.fn().mockResolvedValue({ ba: { status: "DECIDED", decision: "WATCH" } }),
      show: vi.fn().mockResolvedValue(started),
      history: vi.fn().mockResolvedValue({ schemaVersion: "decision-history.v1", items: [], nextCursor: null }),
    });

    const result = await createDefaultJourneyRunner(runtime)({
      profileNo: "957", period: "30d", effectiveAt: new Date("2026-08-28T04:00:00.000Z"),
      decision: "WATCH", reasonCodes: ["DATA_INCOMPLETE"], plannedMethods: [],
    });

    expect(result.stages.rule).toEqual(started.rule);
    expect(result.stages.aiConnection).toMatchObject({ status: "FAILURE", code: "CONFIG_ERROR" });
    expect(result.stages.case).toMatchObject({ caseId: "case-stale", immutable: true });
    expect((result.stages.case as { review: typeof started }).review.coverageSnapshot?.financeHealth).toMatchObject({ health: "STALE" });
  });

  it("preserves a triggered Official-On-Hold condition and PAUSE outcome from the immutable Case", async () => {
    const shop = { id: "shop-1", profileNo: "957", profileId: "profile-1", tiktokShopId: "tt-1" };
    mocks.findShopByProfileNo.mockResolvedValue(shop);
    mocks.createSellerCenterDataSource.mockReturnValue("seller-source");
    mocks.runShopSync.mockResolvedValue({ status: "SUCCEEDED", complete: true });
    mocks.createAdsPowerProxyPreflight.mockReturnValue({ preflight: vi.fn().mockResolvedValue({ status: "HEALTHY" }) });
    mocks.runAuthoritativeFinanceRefresh.mockResolvedValue({ status: "SUCCEEDED", sync: { status: "SUCCEEDED" } });
    mocks.getFinanceSummary.mockResolvedValue({
      proofStatus: "PROVEN", statementCount: 1, onHoldCount: 1,
      expectedSettlementAmount: "5000.0000", onHoldExpectedAmount: "5000.0000", settledAmount: "0.0000",
      unknownOnHoldReasonCount: 0, missingOnHoldExpectedAmountCount: 0,
      latestSnapshot: { capturedAt: new Date("2026-08-28T03:00:00.000Z"), currency: "USD", officialOnHoldAmount: "5000.0000" },
    });
    mocks.calculateAndStoreReport.mockResolvedValue({ metrics: {} });
    mocks.getEffectiveRiskPolicy.mockResolvedValue({ policyVersion: "risk-policy.v1" });
    mocks.getCurrentAiTaskConfig.mockResolvedValue(null);
    mocks.resolveAiTaskConfig.mockReturnValue({ source: "UNSET", taskId: "SHOP_HEALTH_REVIEWER" });
    mocks.testAiTaskConnection.mockResolvedValue({ status: "FAILURE", code: "CONFIG_ERROR", requested: null, message: "Provider configuration is unavailable." });
    const started = {
      case: { id: "case-pause" },
      rule: { decision: "PAUSE", conditions: { officialOnHold: "TRIGGERED", deliveryRate: "CLEAR" } },
    };
    mocks.createCliDecisionWorkflow.mockReturnValue({
      startReview: vi.fn().mockResolvedValue(started),
      decide: vi.fn().mockResolvedValue({ ba: { status: "DECIDED", decision: "PAUSE" } }),
      show: vi.fn().mockResolvedValue(started),
      history: vi.fn().mockResolvedValue({ schemaVersion: "decision-history.v1", items: [], nextCursor: null }),
    });

    const result = await createDefaultJourneyRunner(runtime)({
      profileNo: "957", period: "30d", effectiveAt: new Date("2026-08-28T04:00:00.000Z"),
      decision: "PAUSE", reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"], plannedMethods: [],
    });

    expect(result.stages.rule).toEqual(started.rule);
    expect((result.stages.case as { immutable: boolean }).immutable).toBe(true);
  });
});
