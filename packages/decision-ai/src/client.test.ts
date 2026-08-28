import { describe, expect, it, vi } from "vitest";

import type { AiDecisionContext } from "@shop-health/domain";
import {
  buildDecisionAiMessages,
  createBaselineAiClientFromConfig,
  readBaselineAiConfig,
  type BaselineAiInput,
} from "./index.js";

const defaultModel = "oc/deepseek-v4-flash-free";
const fallbackModel = "oc/big-pickle";

const frozenContext: AiDecisionContext = {
  schemaVersion: "ai-decision-context.v1",
  profile: { profileId: "profile-safe-1", profileNo: "SAFE-1" },
  shop: {
    shopId: "shop-safe-1",
    tiktokShopId: null,
    displayName: "Safe Shop",
    region: "US",
    locale: "en-US",
    currency: "USD",
  },
  metrics: {
    observedAt: "2026-08-14T00:00:00.000Z",
    decision: {
      window: "FULL_PERSISTED_HISTORY",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-14T00:00:00.000Z",
      totalOrders: 120,
      totalPersistedOrders: 120,
      operationalOrderCount: 100,
      onHoldOrderCount: 18,
      deliveredCount: 84,
      deliveryRate: 0.84,
      cancellationRate: null,
      refundRate: null,
      currency: "USD",
      operationalExposure: "1200.0000",
    },
    finance: {
      capturedAt: "2026-08-14T00:00:00.000Z",
      currency: "USD",
      availableBalance: null,
      frozenBalance: null,
      totalBalance: null,
      toSettleBalance: "310.1600",
      officialFinanceOnHold: "310.1600",
      waitingForPackageDeliveryAmount: null,
      deliveredAwaitingSettlementAmount: null,
      waitingForCompletedRefundReturnAmount: "42.0000",
      reasonTotalsReconcileToOfficialOnHold: true,
      missingOnHoldExpectedAmountCount: 0,
      settlementCount: 8,
      onHoldSettlementCount: 8,
    },
  },
  comparisons: [],
  trends: [],
  dataQuality: {
    coverage: "COMPLETE",
    source: "SELLER_CENTER",
    provenSourceWindow: "ROLLING_12_MONTHS",
    completeWithinSourceWindow: true,
    lifetimeHistoryComplete: false,
    ordersSourceComplete: true,
    financeRequiredSourceComplete: true,
    sourceReconciled: true,
    freshness: "FRESH",
    latestSuccessfulSyncAt: "2026-08-14T00:00:00.000Z",
    financeCapturedAt: "2026-08-14T00:00:00.000Z",
    blockers: [],
  },
  risk: {
    policyVersion: "risk-control-policy.v1",
    evaluatedAt: "2026-08-14T00:00:00.000Z",
    deliveryRate: 0.84,
    stopByOnHoldValue: false,
    stopByDeliveryRate: false,
    dataSufficient: true,
    stopOnHoldValueAt: "3500.0000",
    stopDeliveryRateBelow: 0.7,
    minimumOrdersForRateRule: 10,
    operationalExposure: "1200.0000",
  },
  rule: {
    result: "CONTINUE",
    policyVersion: "risk-control-policy.v1",
    checks: [
      {
        metric: "operationalExposure",
        observedValue: "1200.0000",
        threshold: "3500.0000",
        operator: "GTE",
        result: "PASS",
        triggeredReason: null,
      },
      {
        metric: "deliveryRate",
        observedValue: 0.84,
        threshold: 0.7,
        operator: "LT",
        result: "PASS",
        triggeredReason: null,
      },
    ],
    triggers: [],
    expression: "operationalExposure >= 3500 USD OR deliveryRate < 70%",
    evaluatedAt: "2026-08-14T00:00:00.000Z",
  },
  previousCompatibleSnapshot: null,
  policyVersions: {
    metricDefinitionVersion: "decision-metrics.v1",
    riskPolicyVersion: "risk-control-policy.v1",
    trendPolicyVersion: null,
  },
};

const validInput: BaselineAiInput = {
  metricsSnapshot: {
    window: "FULL_PERSISTED_HISTORY",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-14T00:00:00.000Z",
    totalOrders: 120,
    totalPersistedOrders: 120,
    operationalOrderCount: 100,
    onHoldOrderCount: 18,
    deliveredCount: 84,
    deliveryRate: 0.84,
    cancellationRate: null,
    refundRate: null,
    onHoldValue: "1200.0000",
    currency: "USD",
  },
  financeSnapshot: {
    capturedAt: "2026-08-14T00:00:00.000Z",
    currency: "USD",
    availableBalance: null,
    frozenBalance: null,
    totalBalance: null,
    toSettleBalance: "310.1600",
    onHoldBalance: "310.1600",
    officialOnHoldAmount: "310.1600",
    waitingForPackageDeliveryAmount: null,
    deliveredAwaitingSettlementAmount: null,
    waitingForCompletedRefundReturnAmount: "42.0000",
    reasonTotalsReconcileToOfficialOnHold: true,
    missingOnHoldExpectedAmountCount: 0,
    settlementCount: 8,
    onHoldSettlementCount: 8,
  },
  coverageSnapshot: {
    coverageState: "COMPLETE",
    persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
    source: "SELLER_CENTER",
    provenSourceWindow: "ROLLING_12_MONTHS",
    completeWithinSourceWindow: true,
    lifetimeHistoryComplete: false,
    ordersSourceComplete: true,
    financeRequiredSourceComplete: true,
    sourceReconciled: true,
    latestSuccessfulSyncAt: "2026-08-14T00:00:00.000Z",
    financeCapturedAt: "2026-08-14T00:00:00.000Z",
    freshness: "FRESH",
  },
  riskSnapshot: {
    policyVersion: "risk-control-policy.v1",
    evaluatedAt: "2026-08-14T00:00:00.000Z",
    onHoldValue: "1200.0000",
    deliveryRate: 0.84,
    stopByOnHoldValue: false,
    stopByDeliveryRate: false,
    dataSufficient: true,
    stopOnHoldValueAt: "3500.0000",
    stopDeliveryRateBelow: 0.7,
    minimumOrdersForRateRule: 10,
  },
  ruleDecision: "CONTINUE",
  ruleTriggers: [],
  decisionContextSnapshot: frozenContext,
};

function config(overrides: NodeJS.ProcessEnv = {}) {
  return readBaselineAiConfig({
    TOOL_AI_ENABLED: "true",
    TOOL_AI_BASE_URL: "http://127.0.0.1:20128/v1",
    TOOL_AI_API_KEY: "",
    TOOL_AI_DEFAULT_MODEL: defaultModel,
    TOOL_AI_ALLOWED_MODELS: `${defaultModel},${fallbackModel}`,
    TOOL_AI_FALLBACK_MODELS: "",
    ...overrides,
  });
}

describe("baseline AI technical failures", () => {
  it("returns unavailable without calling the provider when the frozen context is null", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });

    await expect(client.recommend({
      ...validInput,
      decisionContextSnapshot: null,
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
      reportedModel: null,
      actualModelUsed: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unavailable without calling the provider when canonical facts disagree with the frozen context", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });
    const mismatchedContext = {
      ...frozenContext,
      metrics: {
        ...frozenContext.metrics,
        decision: {
          ...frozenContext.metrics.decision,
          operationalExposure: "9999.0000",
        },
      },
    };

    await expect(client.recommend({
      ...validInput,
      decisionContextSnapshot: mismatchedContext,
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invokes the provider for stale complete/reconciled Official-OH evidence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      model: "deepseek-v4-flash-free",
      choices: [{ message: { content: JSON.stringify({
        recommendation: "WATCH", riskLevel: "MEDIUM", confidence: 0.5,
        reasonCodes: ["DATA_INCOMPLETE"], supportingFactors: ["Stale Finance evidence."],
        riskFactors: ["Finance is stale."], whatWouldChangeDecision: ["Fresh Finance evidence."],
        reason: "Stale Finance limits this advisory.", humanReviewRequired: true,
      }) } }],
    }), { status: 200 }));
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });
    const staleContext = {
      ...frozenContext,
      metrics: {
        ...frozenContext.metrics,
        finance: { ...frozenContext.metrics.finance, capturedAt: "2026-08-13T00:00:00.000Z" },
      },
      dataQuality: {
        ...frozenContext.dataQuality,
        freshness: "STALE" as const,
        financeCapturedAt: "2026-08-13T00:00:00.000Z",
        blockers: ["FRESHNESS_STALE"],
      },
    };

    const result = await client.recommend({
      ...validInput,
      financeSnapshot: { ...validInput.financeSnapshot, capturedAt: "2026-08-13T00:00:00.000Z" },
      coverageSnapshot: { ...validInput.coverageSnapshot, freshness: "STALE", financeCapturedAt: "2026-08-13T00:00:00.000Z" },
      decisionContextSnapshot: staleContext,
    });
    if (result.status !== "AVAILABLE") throw new Error(result.errorCode);
    expect(fetchMock).toHaveBeenCalled();
  });

  it.each([
    ["missing Official On Hold", {
      finance: { officialOnHoldAmount: null, officialFinanceOnHold: null },
      coverage: {},
      blockers: ["FRESHNESS_STALE"],
    }],
    ["incomplete Finance capture", {
      finance: {},
      coverage: { financeRequiredSourceComplete: false },
      blockers: ["FINANCE_SOURCE_INCOMPLETE", "FRESHNESS_STALE"],
    }],
    ["unreconciled Finance capture", {
      finance: {},
      coverage: { sourceReconciled: false },
      blockers: ["FINANCE_NOT_RECONCILED", "FRESHNESS_STALE"],
    }],
  ] as const)("rejects stale %s without invoking the provider", async (_label, mutation) => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });
    const coverageSnapshot = {
      ...validInput.coverageSnapshot,
      ...mutation.coverage,
      freshness: "STALE" as const,
      financeCapturedAt: "2026-08-13T00:00:00.000Z",
    };
    const financeSnapshot = {
      ...validInput.financeSnapshot,
      ...mutation.finance,
      capturedAt: "2026-08-13T00:00:00.000Z",
    };
    const context = {
      ...frozenContext,
      metrics: {
        ...frozenContext.metrics,
        finance: {
          ...frozenContext.metrics.finance,
          ...mutation.finance,
          officialFinanceOnHold: mutation.finance.officialOnHoldAmount === null
            ? null
            : mutation.finance.officialFinanceOnHold ?? frozenContext.metrics.finance.officialFinanceOnHold,
          capturedAt: "2026-08-13T00:00:00.000Z",
        },
      },
      dataQuality: {
        ...frozenContext.dataQuality,
        ...mutation.coverage,
        freshness: "STALE" as const,
        financeCapturedAt: "2026-08-13T00:00:00.000Z",
        blockers: mutation.blockers,
      },
    };

    await expect(client.recommend({
      ...validInput,
      financeSnapshot,
      coverageSnapshot,
      decisionContextSnapshot: context,
    })).resolves.toMatchObject({ status: "UNAVAILABLE", errorCode: "INVALID_RESPONSE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["finance currency", (context: AiDecisionContext) => ({
      ...context,
      metrics: { ...context.metrics, finance: { ...context.metrics.finance, currency: "EUR" as const } },
    })],
    ["coverage timestamp", (context: AiDecisionContext) => ({
      ...context,
      dataQuality: { ...context.dataQuality, financeCapturedAt: "2026-08-13T00:00:00.000Z" },
    })],
    ["risk threshold", (context: AiDecisionContext) => ({
      ...context,
      risk: { ...context.risk, stopOnHoldValueAt: "3600.0000" },
    })],
    ["rule evidence", (context: AiDecisionContext) => ({
      ...context,
      rule: { ...context.rule, checks: [{
        metric: "deliveryRate",
        observedValue: 0.84,
        threshold: 0.7,
        operator: "LT" as const,
        result: "PASS" as const,
        triggeredReason: null,
      }] },
    })],
  ])("returns unavailable without calling the provider when %s disagrees", async (_label, mutate) => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });

    await expect(client.recommend({
      ...validInput,
      decisionContextSnapshot: mutate(frozenContext),
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unavailable without calling the provider for a legacy context containing onHoldValue", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });
    const legacyContext = {
      ...frozenContext,
      metrics: {
        ...frozenContext.metrics,
        decision: {
          ...frozenContext.metrics.decision,
          onHoldValue: "1200.0000",
        },
      },
    };

    await expect(client.recommend({
      ...validInput,
      decisionContextSnapshot: legacyContext,
    } as never)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the frozen sanitized decision context when available", () => {
    const messages = buildDecisionAiMessages({
      ...validInput,
    });
    expect(JSON.parse(messages[1].content)).toMatchObject({ decisionContext: frozenContext });
  });
  it("does not call the provider without a verified Seller Center source identity", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });
    const { source: _source, ...coverageWithoutSource } = validInput.coverageSnapshot;

    await client.recommend({
      ...validInput,
      coverageSnapshot: coverageWithoutSource,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the provider without exact source coverage proof", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), {
      fetch: fetchMock,
    });

    await expect(client.recommend({
      ...validInput,
      coverageSnapshot: {
        ...validInput.coverageSnapshot,
        provenSourceWindow: null,
        completeWithinSourceWindow: null,
        lifetimeHistoryComplete: null,
      },
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the provider when disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config({ TOOL_AI_ENABLED: "false" }), {
      fetch: fetchMock,
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "FEATURE_DISABLED",
      actualModelUsed: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["schema-invalid JSON", JSON.stringify({ recommendation: "WATCH", confidence: 2 })],
  ])("fails closed on %s", async (_label, content) => {
    const client = createBaselineAiClientFromConfig(config(), {
      fetch: async () => new Response(JSON.stringify({
        model: "deepseek-v4-flash-free",
        choices: [{ message: { content } }],
      }), { status: 200 }),
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
      actualModelUsed: null,
    });
  });

  it("distinguishes network failure from timeout", async () => {
    const networkClient = createBaselineAiClientFromConfig(config(), {
      fetch: async () => { throw new Error("connection refused"); },
    });
    const timeoutClient = createBaselineAiClientFromConfig(config({
      TOOL_AI_TIMEOUT_MS: "1",
    }), {
      fetch: async () => new Promise<Response>(() => undefined),
    });

    await expect(networkClient.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "NETWORK_ERROR",
    });
    await expect(timeoutClient.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "TIMEOUT",
    });
  });

  it("returns unavailable after every explicit free fallback fails", async () => {
    const attemptedModels: string[] = [];
    const client = createBaselineAiClientFromConfig(config({
      TOOL_AI_FALLBACK_MODELS: fallbackModel,
    }), {
      fetch: async (_url, init) => {
        attemptedModels.push((JSON.parse(String(init?.body)) as { model: string }).model);
        return new Response("unavailable", { status: 503 });
      },
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "PROVIDER_UNAVAILABLE",
      requestedModel: fallbackModel,
      actualModelUsed: null,
    });
    expect(attemptedModels).toEqual([defaultModel, fallbackModel]);
  });
});
