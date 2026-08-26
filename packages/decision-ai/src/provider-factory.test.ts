import { describe, expect, it, vi } from "vitest";

import {
  createBaselineAiClientForTask,
  AiConnectionResultSchema,
  testAiTaskConnection,
  MAX_RESPONSE_BODY_BYTES,
  type AiConnectionResult,
} from "./index.js";
import { resolveAiTaskConfig, type PersistedAiTaskConfig } from "./task-config.js";
import { validBaselineAiInput } from "./test-fixtures.js";

const persisted = {
  taskId: "SHOP_HEALTH_REVIEWER",
  provider: "openai-compatible",
  baseUrl: "https://provider.example.test/v1",
  model: "safe-model",
  parameters: { timeoutMs: 30_000 },
  secretRef: "TEST_AI_KEY",
  enabled: true,
  status: "ENABLED",
  revisionId: "00000000-0000-4000-8000-000000000001",
  sequence: 1n,
  effectiveFrom: new Date("2026-08-25T00:00:00.000Z"),
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
} satisfies PersistedAiTaskConfig;

function resolved(overrides: Partial<typeof persisted> = {}) {
  return resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", { ...persisted, ...overrides }, {});
}

function resolvedNineRouter(overrides: Partial<typeof persisted> = {}) {
  return resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", {
    ...persisted,
    provider: "9router",
    baseUrl: "http://127.0.0.1:20128/v1",
    model: "oc/deepseek-v4-flash-free",
    ...overrides,
  }, {});
}

function environmentNineRouter(overrides: NodeJS.ProcessEnv = {}) {
  return resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", null, {
    TOOL_AI_ENABLED: "true",
    TOOL_AI_PROVIDER: "9router",
    TOOL_AI_BASE_URL: "http://127.0.0.1:20128/v1",
    TOOL_AI_API_KEY: "router-secret",
    TOOL_AI_TIMEOUT_MS: "30000",
    TOOL_AI_FREE_ONLY: "true",
    TOOL_AI_DEFAULT_MODEL: "oc/deepseek-v4-flash-free",
    TOOL_AI_ALLOWED_MODELS: "oc/deepseek-v4-flash-free,oc/big-pickle",
    TOOL_AI_FALLBACK_MODELS: "oc/big-pickle",
    ...overrides,
  });
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function successfulProbeResponse(model = "reported-model") {
  return response({ model, choices: [{ message: { content: "OK" } }] });
}

function nineRouterResponse(model = "oc/deepseek-v4-flash-free", trailer = "") {
  return new Response(`${JSON.stringify({ model, choices: [{ message: { content: JSON.stringify({
    recommendation: "WATCH",
    riskLevel: "MEDIUM",
    confidence: 0.62,
    reasonCodes: ["DATA_INCOMPLETE"],
    supportingFactors: ["Coverage is explicit."],
    riskFactors: ["Lifetime history is incomplete."],
    whatWouldChangeDecision: ["Complete source history."],
    reason: "Review required.",
    humanReviewRequired: true,
  }) } }] })}${trailer}`, { status: 200 });
}

function delayedBodyResponse(delayMs: number): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: () => new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({ model: "safe-model", choices: [{ message: { content: JSON.stringify({
      recommendation: "WATCH",
      riskLevel: "MEDIUM",
      confidence: 0.62,
      reasonCodes: ["DATA_INCOMPLETE"],
      supportingFactors: ["Coverage is explicit."],
      riskFactors: ["Lifetime history is incomplete."],
      whatWouldChangeDecision: ["Complete source history."],
      reason: "Review required.",
      humanReviewRequired: true,
    }) } }] })), delayMs)),
  } as Response;
}

function oversizedBodyResponse(): { response: Response; wasCanceled: () => boolean } {
  let canceled = false;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(MAX_RESPONSE_BODY_BYTES + 1) }),
        cancel: async () => { canceled = true; },
      }),
    },
    text: async () => { throw new Error("unbounded text fallback must not be used"); },
  } as unknown as Response;
  return { response, wasCanceled: () => canceled };
}

function serialized(result: AiConnectionResult): string {
  return JSON.stringify(result);
}

describe("task-driven AI provider factory", () => {
  it("returns a server-side BaselineAiClient for the resolved task without exposing the secret", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => successfulProbeResponse());
    const client = createBaselineAiClientForTask(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: fetchMock,
    });

    expect(client).toHaveProperty("recommend");
    await expect(client.recommend({} as never)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
    });
    expect(serialized(client as never)).not.toContain("sk-test-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("performs a harmless OpenAI-compatible chat probe with requested and reported identity separated", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const result = await testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async (url, init) => {
        request = { url: String(url), init: init ?? {} };
        return successfulProbeResponse();
      },
    });

    expect(result).toEqual({
      status: "SUCCESS",
      code: "CONNECTED",
      requested: {
        provider: "openai-compatible",
        baseUrl: "https://provider.example.test/v1",
        model: "safe-model",
      },
      reported: { provider: null, model: "reported-model" },
    });
    expect(request?.url).toBe("https://provider.example.test/v1/chat/completions");
    const body = JSON.parse(String(request?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: "safe-model",
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0,
      max_tokens: 1,
    });
    expect(String(request?.init.body)).not.toMatch(/shop|buyer|customer|email|phone|address|pii/i);
    expect(new Headers(request?.init.headers).get("authorization")).toBe("Bearer sk-test-secret");
    expect(serialized(result)).not.toContain("sk-test-secret");
    expect(serialized(result)).not.toContain("TEST_AI_KEY");
  });

  it("returns CONFIG_MISSING before provider invocation when a valid request lacks its referenced secret", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createBaselineAiClientForTask(resolved(), {
      environment: {},
      fetch: fetchMock,
    });

    await expect(client.recommend(validBaselineAiInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "CONFIG_MISSING",
      requestedModel: "safe-model",
      reportedModel: null,
      actualModelUsed: null,
      authMode: "CONFIG_MISSING",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a safe reported model in an OpenAI-compatible business result", async () => {
    const client = createBaselineAiClientForTask(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => nineRouterResponse("reported-model"),
    });

    await expect(client.recommend(validBaselineAiInput)).resolves.toMatchObject({
      status: "AVAILABLE",
      requestedModel: "safe-model",
      reportedModel: "reported-model",
      actualModelUsed: "reported-model",
    });
  });

  it("does not return a provider secret in a valid OpenAI-compatible business result", async () => {
    const client = createBaselineAiClientForTask(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => nineRouterResponse("sk-test-secret"),
    });

    const result = await client.recommend(validBaselineAiInput);

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
      reportedModel: null,
      actualModelUsed: null,
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });

  it("does not return a provider secret as reported model identity", async () => {
    const result = await testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => successfulProbeResponse("sk-test-secret"),
    });

    expect(result).toMatchObject({ status: "FAILURE", code: "MALFORMED_RESPONSE" });
    expect(serialized(result)).not.toContain("sk-test-secret");
  });

  it("treats an explicit environment dependency as authoritative over ambient credentials", async () => {
    vi.stubEnv("TEST_AI_KEY", "ambient-secret");
    try {
      const fetchMock = vi.fn<typeof fetch>();
      const openAiClient = createBaselineAiClientForTask(resolved({ baseUrl: "https://provider.example.test/v1" }), {
        environment: {},
        fetch: fetchMock,
      });
      const nineRouterClient = createBaselineAiClientForTask(resolvedNineRouter({ baseUrl: "https://router.example.test/v1" }), {
        environment: {},
        fetch: fetchMock,
      });

      await expect(openAiClient.recommend(validBaselineAiInput)).resolves.toMatchObject({ errorCode: "CONFIG_MISSING" });
      await expect(nineRouterClient.recommend(validBaselineAiInput)).resolves.toMatchObject({ errorCode: "CONFIG_MISSING" });
      await expect(testAiTaskConnection(resolved({ baseUrl: "https://provider.example.test/v1" }), {
        environment: {},
        fetch: fetchMock,
      })).resolves.toMatchObject({ status: "FAILURE", code: "AUTH_FAILURE" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed before fetch when the referenced secret is absent", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await testAiTaskConnection(resolved(), {
      environment: {},
      fetch: fetchMock,
    });

    expect(result).toMatchObject({ status: "FAILURE", code: "AUTH_FAILURE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "AUTH_FAILURE"],
    [403, "AUTH_FAILURE"],
  ] as const)("maps HTTP %s to %s without leaking provider output", async (status, code) => {
    const result = await testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => response({ error: "sk-test-secret Authorization Bearer sk-test-secret" }, status),
    });

    expect(result).toMatchObject({ status: "FAILURE", code });
    expect(serialized(result)).not.toMatch(/sk-test-secret|authorization|Bearer/i);
  });

  it("returns a safe retry delay for a rate-limited response", async () => {
    const result = await testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => response({ error: "rate limited" }, 429, { "retry-after": "17" }),
    });

    expect(result).toMatchObject({ status: "FAILURE", code: "RATE_LIMITED", retryAfterSeconds: 17 });
  });

  it("parses the established 9Router JSON envelope with its exact done trailer", async () => {
    const result = await testAiTaskConnection(environmentNineRouter(), {
      environment: { routerSecret: "router-secret" },
      fetch: async () => nineRouterResponse("oc/deepseek-v4-flash-free", "data: [DONE]\n"),
    });

    expect(result).toEqual({
      status: "SUCCESS",
      code: "CONNECTED",
      requested: {
        provider: "9router",
        baseUrl: "http://127.0.0.1:20128/v1",
        model: "oc/deepseek-v4-flash-free",
      },
      reported: { provider: null, model: "oc/deepseek-v4-flash-free" },
    });
  });

  it("parses every connection branch through the result schema and maps HTTP 5xx to unavailable", async () => {
    const cases = [
      await testAiTaskConnection(resolved(), { environment: { TEST_AI_KEY: "sk-test-secret" }, fetch: async () => successfulProbeResponse() }),
      await testAiTaskConnection(resolved(), { environment: {}, fetch: async () => { throw new Error("not called"); } }),
      await testAiTaskConnection(resolved({ provider: "huggingface-hosted" }), { environment: {}, fetch: async () => { throw new Error("not called"); } }),
      await testAiTaskConnection(resolved(), { environment: { TEST_AI_KEY: "sk-test-secret" }, fetch: async () => response("unavailable", 503) }),
    ];

    for (const result of cases) expect(() => AiConnectionResultSchema.parse(result)).not.toThrow();
    expect(cases[3]).toMatchObject({ status: "FAILURE", code: "UNAVAILABLE" });
  });

  it("preserves 9Router environment fallback models while persisted task metadata remains authoritative", async () => {
    const attemptedModels: string[] = [];
    const client = createBaselineAiClientForTask(environmentNineRouter(), {
      environment: { routerSecret: "router-secret" },
      fetch: async (_url, init) => {
        attemptedModels.push((JSON.parse(String(init?.body)) as { model: string }).model);
        return response("unavailable", 503);
      },
    });

    await expect(client.recommend(validBaselineAiInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "PROVIDER_UNAVAILABLE",
    });
    expect(attemptedModels).toEqual(["oc/deepseek-v4-flash-free", "oc/big-pickle"]);

    const persistedClient = createBaselineAiClientForTask(resolvedNineRouter(), {
      environment: { TOOL_AI_API_KEY: "router-secret" },
      fetch: async (_url, init) => {
        attemptedModels.push((JSON.parse(String(init?.body)) as { model: string }).model);
        return response("unavailable", 503);
      },
    });
    await persistedClient.recommend(validBaselineAiInput);
    expect(attemptedModels.slice(2)).toEqual(["oc/deepseek-v4-flash-free"]);
  });

  it("returns CONFIG_MISSING for a missing remote 9Router secret without disabling the configuration", async () => {
    const client = createBaselineAiClientForTask(environmentNineRouter({ TOOL_AI_BASE_URL: "https://router.example.test/v1", TOOL_AI_API_KEY: "" }), {
      environment: {},
      fetch: vi.fn<typeof fetch>(),
    });

    await expect(client.recommend(validBaselineAiInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "CONFIG_MISSING",
      authMode: "CONFIG_MISSING",
    });
  });

  it("validates invalid input before disabled and unsupported provider outcomes", async () => {
    const invalid = {} as never;
    const fetchMock = vi.fn<typeof fetch>();
    await expect(createBaselineAiClientForTask({ ...resolved(), enabled: false, status: "DISABLED" }, { fetch: fetchMock }).recommend(invalid)).resolves.toMatchObject({ errorCode: "INVALID_RESPONSE" });
    await expect(createBaselineAiClientForTask(resolveAiTaskConfig("FINANCE_SPECIALIST", null, {}), { fetch: fetchMock }).recommend(invalid)).resolves.toMatchObject({ errorCode: "INVALID_RESPONSE" });
    await expect(createBaselineAiClientForTask({ ...resolved({ provider: "huggingface-hosted" }), enabled: false, status: "DISABLED" }, { fetch: fetchMock }).recommend(invalid)).resolves.toMatchObject({ errorCode: "INVALID_RESPONSE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps timeout, network, server, and malformed responses to stable safe codes", async () => {
    const timeout = await testAiTaskConnection(resolved({ parameters: { timeoutMs: 1 } }), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => new Promise<Response>(() => undefined),
    });
    const network = await testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => { throw new Error("sk-test-secret Authorization https://x.test/?secret=secret"); },
    });
    const server = await testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => response("raw secret body", 503),
    });
    const malformed = await testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => response({ model: "reported-model", choices: [] }),
    });

    expect(timeout).toMatchObject({ status: "FAILURE", code: "TIMEOUT" });
    expect(network).toMatchObject({ status: "FAILURE", code: "NETWORK_ERROR" });
    expect(server).toMatchObject({ status: "FAILURE", code: "UNAVAILABLE" });
    expect(malformed).toMatchObject({ status: "FAILURE", code: "MALFORMED_RESPONSE" });
    for (const result of [timeout, network, server, malformed]) {
      expect(serialized(result)).not.toMatch(/sk-test-secret|authorization|secret=|raw secret body|TEST_AI_KEY/i);
    }
  });

  it("times out while reading an OpenAI-compatible response body", async () => {
    const client = createBaselineAiClientForTask(resolved({ parameters: { timeoutMs: 5 } }), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => delayedBodyResponse(30),
    });

    await expect(client.recommend(validBaselineAiInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "TIMEOUT",
      reportedModel: null,
      actualModelUsed: null,
    });
  });

  it("times out while reading a 9Router or connection response body", async () => {
    const nineRouterClient = createBaselineAiClientForTask(resolvedNineRouter({ parameters: { timeoutMs: 5 } }), {
      environment: { TEST_AI_KEY: "router-secret" },
      fetch: async () => delayedBodyResponse(30),
    });
    const connection = testAiTaskConnection(resolved({ parameters: { timeoutMs: 5 } }), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => delayedBodyResponse(30),
    });

    await expect(nineRouterClient.recommend(validBaselineAiInput)).resolves.toMatchObject({ errorCode: "TIMEOUT" });
    await expect(connection).resolves.toMatchObject({ status: "FAILURE", code: "TIMEOUT" });
  });

  it("rejects oversized successful bodies without retaining their contents", async () => {
    const oversized = oversizedBodyResponse();
    const client = createBaselineAiClientForTask(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => oversized.response,
    });
    const result = await client.recommend(validBaselineAiInput);

    expect(result).toMatchObject({ status: "UNAVAILABLE", errorCode: "INVALID_RESPONSE" });
    expect(JSON.stringify(result)).not.toContain("x".repeat(100));
    expect(oversized.wasCanceled()).toBe(true);
    const nineRouterOversized = oversizedBodyResponse();
    const nineRouterClient = createBaselineAiClientForTask(resolvedNineRouter(), {
      environment: { TEST_AI_KEY: "router-secret" },
      fetch: async () => nineRouterOversized.response,
    });
    await expect(nineRouterClient.recommend(validBaselineAiInput)).resolves.toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "INVALID_RESPONSE",
    });
    expect(nineRouterOversized.wasCanceled()).toBe(true);
    const connectionOversized = oversizedBodyResponse();
    await expect(testAiTaskConnection(resolved(), {
      environment: { TEST_AI_KEY: "sk-test-secret" },
      fetch: async () => connectionOversized.response,
    })).resolves.toMatchObject({ status: "FAILURE", code: "MALFORMED_RESPONSE" });
    expect(connectionOversized.wasCanceled()).toBe(true);
  });

  it("reports unsupported Hugging Face hosting without inventing an endpoint contract", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await testAiTaskConnection(resolved({ provider: "huggingface-hosted" }), {
      environment: { TEST_AI_KEY: "hf-secret" },
      fetch: fetchMock,
    });

    expect(result).toMatchObject({ status: "FAILURE", code: "UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized(result)).not.toContain("hf-secret");
  });
});

it("returns a schema-valid typed failure for an accepted long task URL", async () => {
  const baseUrl = `https://provider.example.test/${"a".repeat(2050)}`;

  const result = await testAiTaskConnection(resolved({ baseUrl }), {
    environment: { TEST_AI_KEY: "sk-test-secret" },
    fetch: async () => response("malformed"),
  });

  expect(() => AiConnectionResultSchema.parse(result)).not.toThrow();
  expect(result).toMatchObject({ status: "FAILURE", code: "MALFORMED_RESPONSE" });
});

it("does not accept unsafe identity in the task contract", () => {
  expect(() => resolved({ baseUrl: "https://provider.example.test/v1?secret=key#fragment" })).toThrow();
});
