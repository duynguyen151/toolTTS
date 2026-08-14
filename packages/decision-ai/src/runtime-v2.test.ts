import { describe, expect, it, vi } from "vitest";

import {
  createBaselineAiClientFromConfig,
  readBaselineAiConfig,
  type BaselineAiInput,
} from "./index.js";

const deepseek = "oc/deepseek-v4-flash-free";
const pickle = "oc/big-pickle";

const validInput: BaselineAiInput = {
  metricsSnapshot: {
    window: "FULL_PERSISTED_HISTORY",
    periodStart: "2025-08-14T00:00:00.000Z",
    periodEnd: "2026-08-14T00:00:00.000Z",
    totalOrders: 9,
    onHoldOrderCount: 9,
    deliveredCount: 8,
    deliveryRate: 8 / 9,
    cancellationRate: null,
    refundRate: null,
    onHoldValue: "844.6500",
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
    coverageState: "UNKNOWN",
    persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
    provenSourceWindow: null,
    completeWithinSourceWindow: null,
    lifetimeHistoryComplete: null,
  },
  riskSnapshot: {
    policyVersion: "risk-control-policy.v1",
    evaluatedAt: "2026-08-14T00:00:00.000Z",
    onHoldValue: "844.6500",
    deliveryRate: 8 / 9,
    stopByOnHoldValue: false,
    stopByDeliveryRate: false,
    dataSufficient: true,
    stopOnHoldValueAt: "3500.0000",
    stopDeliveryRateBelow: 0.7,
    minimumOrdersForRateRule: 0,
  },
  ruleDecision: "CONTINUE",
  ruleTriggers: [],
};

function availableResponse(
  reportedModel = "deepseek-v4-flash-free",
  overrides: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({
    id: "router-test",
    object: "chat.completion",
    created: 1,
    model: reportedModel,
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: JSON.stringify({
          recommendation: "WATCH",
          riskLevel: "MEDIUM",
          confidence: 0.62,
          reasonCodes: ["DATA_INCOMPLETE"],
          supportingFactors: ["Delivery rate is currently above the deterministic threshold."],
          riskFactors: ["Lifetime order history has not been proven complete."],
          whatWouldChangeDecision: ["A complete source window with stable delivery performance."],
          reason: "Current operations are stable, but coverage remains explicitly unknown.",
          humanReviewRequired: true,
          ...overrides,
        }),
      },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    cost: "0",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function config(overrides: NodeJS.ProcessEnv = {}) {
  return readBaselineAiConfig({
    TOOL_AI_ENABLED: "true",
    TOOL_AI_PROVIDER: "9router",
    TOOL_AI_BASE_URL: "http://127.0.0.1:20128/v1",
    TOOL_AI_API_KEY: "",
    TOOL_AI_TIMEOUT_MS: "30000",
    TOOL_AI_FREE_ONLY: "true",
    TOOL_AI_DEFAULT_MODEL: deepseek,
    TOOL_AI_ALLOWED_MODELS: `${deepseek},${pickle}`,
    TOOL_AI_FALLBACK_MODELS: "",
    ...overrides,
  });
}

describe("Tool AI runtime v1", () => {
  it("uses LOCAL_NO_AUTH only for exact approved loopback hosts", () => {
    expect(config().authMode).toBe("LOCAL_NO_AUTH");
    expect(config({ TOOL_AI_BASE_URL: "http://localhost:20128/v1" }).authMode)
      .toBe("LOCAL_NO_AUTH");
    expect(config({ TOOL_AI_BASE_URL: "http://[::1]:20128/v1" }).authMode)
      .toBe("LOCAL_NO_AUTH");

    expect(config({
      TOOL_AI_BASE_URL: "https://router.example.test/v1",
      TOOL_AI_API_KEY: "application-key",
    }).authMode).toBe("BEARER");
    expect(config({ TOOL_AI_BASE_URL: "http://127.0.0.1.example.test/v1" }).authMode)
      .toBe("CONFIG_MISSING");
    expect(() => config({ TOOL_AI_BASE_URL: "ftp://127.0.0.1/v1" })).toThrow();
    expect(() => config({ TOOL_AI_BASE_URL: "http://hidden@127.0.0.1:20128/v1" })).toThrow();
  });

  it("rejects auto, cx models, unverified models, and invalid fallback configuration", () => {
    for (const environment of [
      { TOOL_AI_DEFAULT_MODEL: "auto", TOOL_AI_ALLOWED_MODELS: "auto" },
      { TOOL_AI_DEFAULT_MODEL: "cx/gpt-5.6-sol", TOOL_AI_ALLOWED_MODELS: "cx/gpt-5.6-sol" },
      { TOOL_AI_DEFAULT_MODEL: "oc/unverified-free", TOOL_AI_ALLOWED_MODELS: "oc/unverified-free" },
      { TOOL_AI_FALLBACK_MODELS: "oc/nemotron-3-ultra-free" },
    ]) {
      expect(() => config(environment)).toThrow();
    }
  });

  it("sends an explicit approved model without an authorization header in loopback mode", async () => {
    let request: RequestInit | undefined;
    const fetchMock: typeof fetch = vi.fn(async (_url, init) => {
      request = init;
      return availableResponse();
    });
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "AVAILABLE",
      recommendation: "WATCH",
      riskLevel: "MEDIUM",
      ruleResult: "CONTINUE",
      ruleOverride: true,
      requestedModel: deepseek,
      reportedModel: "deepseek-v4-flash-free",
      actualModelUsed: "deepseek-v4-flash-free",
      authMode: "LOCAL_NO_AUTH",
      promptVersion: "decision-ai-prompt.v2",
      aiPolicyVersion: "decision-ai-policy.v1",
      rulePolicyVersion: "risk-control-policy.v1",
    });
    const headers = new Headers(request?.headers);
    expect(headers.has("authorization")).toBe(false);
    const body = JSON.parse(String(request?.body)) as { model: string };
    expect(body.model).toBe(deepseek);
    expect(request?.redirect).toBe("error");
  });

  it("accepts the proven 9Router JSON envelope followed by its terminal done marker", async () => {
    const body = await availableResponse().text();
    const client = createBaselineAiClientFromConfig(config(), {
      fetch: async () => new Response(`${body}data: [DONE]\n`, { status: 200 }),
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "AVAILABLE",
      actualModelUsed: "deepseek-v4-flash-free",
    });
  });

  it("uses bearer auth when an application key is configured", async () => {
    let request: RequestInit | undefined;
    const client = createBaselineAiClientFromConfig(config({
      TOOL_AI_API_KEY: "application-key",
    }), {
      fetch: async (_url, init) => {
        request = init;
        return availableResponse();
      },
    });

    await client.recommend(validInput);

    expect(new Headers(request?.headers).get("authorization"))
      .toBe("Bearer application-key");
  });

  it("fails closed before network access when a remote endpoint has no application key", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config({
      TOOL_AI_BASE_URL: "https://router.example.test/v1",
    }), { fetch: fetchMock });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "CONFIG_MISSING",
      humanReviewRequired: true,
      authMode: "CONFIG_MISSING",
      actualModelUsed: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the router reports an unapproved or missing model", async () => {
    for (const response of [
      availableResponse("cx/gpt-5.6-sol"),
      availableResponse("paid-model"),
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          recommendation: "WATCH",
          riskLevel: "MEDIUM",
          confidence: 0.5,
          reasonCodes: ["OTHER"],
          supportingFactors: [],
          riskFactors: [],
          whatWouldChangeDecision: [],
          reason: "Review required.",
          humanReviewRequired: true,
        }) } }],
      }), { status: 200 }),
    ]) {
      const client = createBaselineAiClientFromConfig(config(), {
        fetch: async () => response,
      });
      await expect(client.recommend(validInput)).resolves.toMatchObject({
        status: "UNAVAILABLE",
        errorCode: "INVALID_RESPONSE",
        actualModelUsed: null,
      });
    }
  });

  it("does not route around an unapproved reported model by falling back", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => availableResponse("cx/gpt-5.6-sol"));
    const client = createBaselineAiClientFromConfig(config({
      TOOL_AI_FALLBACK_MODELS: pickle,
    }), { fetch: fetchMock });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
      requestedModel: deepseek,
      actualModelUsed: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses only an explicitly ordered fallback for technical failures", async () => {
    const attemptedModels: string[] = [];
    const client = createBaselineAiClientFromConfig(config({
      TOOL_AI_FALLBACK_MODELS: pickle,
    }), {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        attemptedModels.push(body.model);
        return body.model === deepseek
          ? new Response("unavailable", { status: 503 })
          : availableResponse("big-pickle");
      },
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "AVAILABLE",
      requestedModel: pickle,
      reportedModel: "big-pickle",
      actualModelUsed: "big-pickle",
    });
    expect(attemptedModels).toEqual([deepseek, pickle]);
  });

  it("does not use a fallback after a structurally invalid response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const requestedModel = (JSON.parse(String(init?.body)) as { model: string }).model;
      return requestedModel === deepseek
        ? new Response(JSON.stringify({
            model: "deepseek-v4-flash-free",
            choices: [{ message: { content: "not-json" } }],
          }), { status: 200 })
        : availableResponse("big-pickle");
    });
    const client = createBaselineAiClientFromConfig(config({
      TOOL_AI_FALLBACK_MODELS: pickle,
    }), { fetch: fetchMock });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
      requestedModel: deepseek,
      actualModelUsed: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fallback for a valid low-confidence recommendation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => availableResponse(
      "deepseek-v4-flash-free",
      { confidence: 0.05 },
    ));
    const client = createBaselineAiClientFromConfig(config({
      TOOL_AI_FALLBACK_MODELS: pickle,
    }), { fetch: fetchMock });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "AVAILABLE",
      confidence: 0.05,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, "RATE_LIMITED"],
    [404, "MODEL_UNAVAILABLE"],
    [503, "PROVIDER_UNAVAILABLE"],
    [400, "HTTP_ERROR"],
  ] as const)("maps HTTP %s to %s", async (status, errorCode) => {
    const client = createBaselineAiClientFromConfig(config(), {
      fetch: async () => new Response("sanitized", { status }),
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode,
      actualModelUsed: null,
    });
  });

  it("keeps provider payload privacy-safe and preserves unknown values", async () => {
    let requestBody = "";
    const client = createBaselineAiClientFromConfig(config(), {
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return availableResponse();
      },
    });

    await client.recommend(validInput);

    const body = JSON.parse(requestBody) as {
      messages: Array<{ role: string; content: string }>;
    };
    const context = body.messages.find(({ role }) => role === "user")?.content ?? "";
    expect(context).toContain('"officialOnHoldAmount":"310.1600"');
    expect(context).toContain('"operationalOrderExposure":"844.6500"');
    expect(context).toContain('"lifetimeHistoryComplete":null');
    expect(context).not.toMatch(
      /shopId|profileNo|buyer|customer|shippingAddress|phone|email|cookie|token|csrf|proxy|cdp|rawData/i,
    );
  });

  it("rejects prohibited fields before the network boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientFromConfig(config(), { fetch: fetchMock });

    await expect(client.recommend({
      ...validInput,
      buyerName: "must-not-cross-boundary",
    } as unknown as BaselineAiInput)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
