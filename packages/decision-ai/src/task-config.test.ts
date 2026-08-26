import { describe, expect, it } from "vitest";

import {
  AI_TASK_IDS,
  AiTaskConfigInputSchema,
  resolveAiTaskConfig,
  type PersistedAiTaskConfig,
} from "./task-config.js";

const input = {
  taskId: "SHOP_HEALTH_REVIEWER",
  provider: "9router",
  baseUrl: "http://127.0.0.1:20128/v1",
  model: "oc/deepseek-v4-flash-free",
  parameters: {},
  secretRef: "TOOL_AI_API_KEY",
  enabled: true,
  status: "ENABLED",
};

const current = {
  ...input,
  revisionId: "00000000-0000-4000-8000-000000000001",
  sequence: 1n,
  effectiveFrom: new Date("2026-08-25T00:00:00.000Z"),
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
} satisfies PersistedAiTaskConfig;

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    TOOL_AI_ENABLED: "true",
    TOOL_AI_PROVIDER: "9router",
    TOOL_AI_BASE_URL: "http://127.0.0.1:20128/v1",
    TOOL_AI_API_KEY: "",
    TOOL_AI_TIMEOUT_MS: "30000",
    TOOL_AI_FREE_ONLY: "true",
    TOOL_AI_DEFAULT_MODEL: "oc/deepseek-v4-flash-free",
    TOOL_AI_ALLOWED_MODELS: "oc/deepseek-v4-flash-free,oc/big-pickle",
    TOOL_AI_FALLBACK_MODELS: "",
    ...overrides,
  };
}

describe("AI task registry contract", () => {
  it("declares the enabled reviewer and exact disabled future slots", () => {
    expect(AI_TASK_IDS).toEqual([
      "SHOP_HEALTH_REVIEWER",
      "FINANCE_SPECIALIST",
      "ORDER_ANOMALY_REVIEWER",
      "BA_ASSISTANT",
    ]);
  });

  it("accepts the current 9Router reviewer and rejects unknown task/provider/status/parameters", () => {
    expect(AiTaskConfigInputSchema.parse(input)).toMatchObject({
      taskId: "SHOP_HEALTH_REVIEWER",
      provider: "9router",
    });
    for (const invalid of [
      { ...current, taskId: "UNKNOWN_TASK" },
      { ...current, provider: "openai" },
      { ...current, status: "READY" },
      { ...current, parameters: { temperature: 0 } },
      { ...current, parameters: { maxTokens: Number.POSITIVE_INFINITY } },
      { ...current, unexpected: true },
    ]) {
      expect(() => AiTaskConfigInputSchema.parse(invalid)).toThrow();
    }
  });

  it("rejects malformed, credentialed, queried, fragmented, and non-http URLs", () => {
    for (const baseUrl of [
      "not-a-url",
      "ftp://router.example.test/v1",
      "https://user:pass@router.example.test/v1",
      "https://router.example.test/v1?token=secret",
      "https://router.example.test/v1#fragment",
    ]) {
      expect(() => AiTaskConfigInputSchema.parse({ ...current, baseUrl })).toThrow();
    }
  });

  it("accepts only opaque environment-style secret references and never stores a secret value", () => {
    expect(AiTaskConfigInputSchema.parse(input).secretRef).toBe("TOOL_AI_API_KEY");
    for (const secretRef of ["sk-live-secret", "Bearer abc", "apiKey=secret", ""])
      expect(() => AiTaskConfigInputSchema.parse({ ...current, secretRef })).toThrow();
    expect(JSON.stringify(AiTaskConfigInputSchema.parse(input))).not.toContain("secret-value");
  });

  it("resolves persisted enabled reviewer over env and exposes only metadata", () => {
    const resolved = resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", current, environment({ TOOL_AI_DEFAULT_MODEL: "oc/big-pickle" }));
    expect(resolved).toMatchObject({
      taskId: "SHOP_HEALTH_REVIEWER",
      source: "PERSISTED",
      revisionId: current.revisionId,
      provider: "9router",
      model: "oc/deepseek-v4-flash-free",
      enabled: true,
      status: "ENABLED",
    });
    expect(JSON.stringify(resolved)).not.toContain("secret-value");
    expect(resolved).not.toHaveProperty("apiKey");
  });

  it("falls back unchanged to the env baseline when reviewer has no persisted current revision", () => {
    const resolved = resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", null, environment({ TOOL_AI_DEFAULT_MODEL: "oc/big-pickle" }));
    expect(resolved).toMatchObject({
      taskId: "SHOP_HEALTH_REVIEWER",
      source: "ENVIRONMENT",
      revisionId: null,
      provider: "9router",
      model: "oc/big-pickle",
      enabled: true,
      status: "ENABLED",
      secretRef: "TOOL_AI_API_KEY",
    });
  });

  it("reports disabled persisted reviewer unavailable and keeps future slots disabled", () => {
    const disabled = { ...current, enabled: false, status: "DISABLED" as const };
    expect(resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", disabled, environment())).toMatchObject({
      taskId: "SHOP_HEALTH_REVIEWER",
      source: "PERSISTED",
      enabled: false,
      status: "DISABLED",
      availability: "UNAVAILABLE",
    });
    expect(resolveAiTaskConfig("FINANCE_SPECIALIST", { ...disabled, taskId: "FINANCE_SPECIALIST" }, environment())).toMatchObject({
      taskId: "FINANCE_SPECIALIST",
      source: "PERSISTED",
      enabled: false,
      status: "DISABLED",
      availability: "UNAVAILABLE",
    });
  });

  it("returns an explicit unavailable UNSET result for future tasks without a matching persisted revision", () => {
    const resolved = resolveAiTaskConfig("FINANCE_SPECIALIST", null, environment());

    expect(resolved).toEqual({
      taskId: "FINANCE_SPECIALIST",
      source: "UNSET",
      revisionId: null,
      provider: null,
      baseUrl: null,
      model: null,
      parameters: null,
      secretRef: null,
      registry: null,
      enabled: false,
      status: "DISABLED",
      availability: "UNAVAILABLE",
    });
  });

  it("rejects a persisted revision for a different requested task", () => {
    expect(() => resolveAiTaskConfig("FINANCE_SPECIALIST", current, environment())).toThrow("does not match requested task");
  });
});

describe("AI task resolution safety", () => {
  it("rejects invalid persisted metadata before resolution", () => {
    expect(() => resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", { ...current, model: "oc/unverified-free" }, environment())).toThrow();
  });
});
