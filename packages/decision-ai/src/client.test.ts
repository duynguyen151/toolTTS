import { describe, expect, it, vi } from "vitest";

import {
  createBaselineAiClient,
  readBaselineAiConfig,
  type BaselineAiInput,
} from "./index.js";

const validInput: BaselineAiInput = {
  metricsSnapshot: {
    window: "FULL_PERSISTED_HISTORY",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-14T00:00:00.000Z",
    totalOrders: 120,
    onHoldOrderCount: 18,
    deliveredCount: 84,
    deliveryRate: 0.84,
    cancellationRate: 0.05,
    refundRate: 0.02,
    onHoldValue: "1200.0000",
    currency: "USD",
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

const generatedAt = new Date("2026-08-14T08:30:00.000Z");

describe("baseline AI client", () => {
  it("returns a validated recommendation with provenance", async () => {
    const fetchMock: typeof fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "WATCH",
                  confidence: 0.82,
                  reasonCodes: ["HIGH_VOLUME_HEALTHY"],
                  reason: "Exposure is elevated while delivery performance remains stable.",
                  humanReviewRequired: true,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      fetch: fetchMock,
      now: () => generatedAt,
    });

    await expect(client.recommend(validInput)).resolves.toEqual({
      status: "AVAILABLE",
      decision: "WATCH",
      confidence: 0.82,
      reasonCodes: ["HIGH_VOLUME_HEALTHY"],
      reason: "Exposure is elevated while delivery performance remains stable.",
      humanReviewRequired: true,
      provider: "opencode-zen",
      model: "deepseek-v4-flash-free",
      promptVersion: "baseline-ai-prompt.v1",
      policyVersion: "risk-control-policy.v1",
      generatedAt: "2026-08-14T08:30:00.000Z",
    });
  });

  it("sends only normalized decision data and fixed R1-R5 context", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchMock: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "CONTINUE",
                  confidence: 0.9,
                  reasonCodes: ["RECOVERY_TREND"],
                  reason: "Current normalized indicators support continuation.",
                  humanReviewRequired: false,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const client = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      fetch: fetchMock,
      now: () => generatedAt,
    });

    await client.recommend(validInput);

    expect(requestUrl).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(requestInit?.headers).toEqual({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    const requestBody = JSON.parse(String(requestInit?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = requestBody.messages.find(({ role }) => role === "user")?.content;
    expect(userContent).toBeDefined();
    const decisionContext = JSON.parse(userContent ?? "") as {
      knownRiskExceptions: Array<{ id: string }>;
      outputSchema: { reasonCodes: string[] };
    };
    expect(decisionContext.knownRiskExceptions.map(({ id }) => id)).toEqual([
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
    ]);
    expect(decisionContext.outputSchema.reasonCodes).toEqual([
      "HIGH_ABSOLUTE_EXPOSURE",
      "LOW_DELIVERY_RATE",
      "HIGH_VOLUME_HEALTHY",
      "LOW_SAMPLE_SIZE",
      "CARRIER_SYSTEMIC_DELAY",
      "RAPID_ONHOLD_GROWTH",
      "DELIVERY_DETERIORATION",
      "REFUND_SPIKE",
      "DATA_INCOMPLETE",
      "RECOVERY_TREND",
      "THRESHOLD_FLAPPING",
      "OTHER",
    ]);
    expect(userContent).not.toMatch(
      /shopId|shopName|rawData|cookie|token|buyer|contact|address/i,
    );
  });

  it("does not call the provider when the feature is disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClient({
      enabled: false,
      apiKey: "test-key",
      fetch: fetchMock,
      now: () => generatedAt,
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "FEATURE_DISABLED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the provider when the API key is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClient({
      enabled: true,
      apiKey: "  ",
      fetch: fetchMock,
      now: () => generatedAt,
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "MISSING_API_KEY",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the approved OpenCode Zen defaults from environment config", () => {
    expect(readBaselineAiConfig({ TOOL_AI_API_KEY: "test-key" })).toEqual({
      enabled: true,
      provider: "opencode-zen",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "test-key",
      model: "deepseek-v4-flash-free",
      timeoutMs: 30_000,
    });
  });

  it("rejects input containing fields outside the normalized decision contract", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      fetch: fetchMock,
      now: () => generatedAt,
    });

    await expect(
      client.recommend({
        ...validInput,
        shopId: "must-not-cross-the-ai-boundary",
      } as unknown as BaselineAiInput),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [429, "RATE_LIMITED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ] as const)("maps HTTP %s to %s without parsing the response body", async (status, errorCode) => {
    const client = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      fetch: async () => new Response("provider details must not escape", { status }),
      now: () => generatedAt,
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode,
      humanReviewRequired: true,
    });
  });

  it("returns unavailable when the provider response is not valid structured output", async () => {
    const client = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not-json" } }],
          }),
          { status: 200 },
        ),
      now: () => generatedAt,
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
    });
  });

  it("returns unavailable when a validated field is outside its contract", async () => {
    const client = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    decision: "WATCH",
                    confidence: 1.5,
                    reasonCodes: ["OTHER"],
                    reason: "Invalid confidence must fail closed.",
                    humanReviewRequired: true,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      now: () => generatedAt,
    });

    await expect(client.recommend(validInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_OUTPUT",
    });
  });

  it("distinguishes network failure from timeout", async () => {
    const networkClient = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      fetch: async () => {
        throw new Error("connection refused");
      },
      now: () => generatedAt,
    });
    const timeoutClient = createBaselineAiClient({
      enabled: true,
      apiKey: "test-key",
      timeoutMs: 1,
      fetch: async () => new Promise<Response>(() => undefined),
      now: () => generatedAt,
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
});
