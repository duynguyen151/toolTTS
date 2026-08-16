import { describe, expect, it, vi } from "vitest";

import {
  buildDecisionAiMessages,
  createBaselineAiClientFromConfig,
  readBaselineAiConfig,
  type BaselineAiInput,
} from "./index.js";

const defaultModel = "oc/deepseek-v4-flash-free";
const fallbackModel = "oc/big-pickle";

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
  it("sends the frozen sanitized decision context when available", () => {
    const context = { schemaVersion: "ai-decision-context.v1", safe: "context-only" };
    const messages = buildDecisionAiMessages({
      ...validInput,
      decisionContextSnapshot: context as never,
    });
    expect(JSON.parse(messages[1].content)).toMatchObject({ decisionContext: context });
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
