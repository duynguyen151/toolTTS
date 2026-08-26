import { describe, expect, it, vi } from "vitest";

import {
  createBaselineAiClientForTask,
  testAiTaskConnection,
  type AiConnectionResult,
} from "./index.js";
import { resolveAiTaskConfig, type PersistedAiTaskConfig } from "./task-config.js";

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

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function successfulProbeResponse(model = "reported-model") {
  return response({ model, choices: [{ message: { content: "OK" } }] });
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
    expect(server).toMatchObject({ status: "FAILURE", code: "HTTP_ERROR" });
    expect(malformed).toMatchObject({ status: "FAILURE", code: "MALFORMED_RESPONSE" });
    for (const result of [timeout, network, server, malformed]) {
      expect(serialized(result)).not.toMatch(/sk-test-secret|authorization|secret=|raw secret body|TEST_AI_KEY/i);
    }
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

it("does not accept unsafe identity in the task contract", () => {
  expect(() => resolved({ baseUrl: "https://provider.example.test/v1?secret=key#fragment" })).toThrow();
});

