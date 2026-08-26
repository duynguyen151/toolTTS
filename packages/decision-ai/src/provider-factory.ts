import { createBaselineAiClientFromProvider, type BaselineAiClientDependencies } from "./client.js";
import type { BaselineAiConfig, ToolAiAuthMode } from "./config.js";
import { z } from "zod";
import { buildDecisionAiMessages } from "./prompt.js";
import {
  BaselineAiOutputSchema,
  type BaselineAiClient,
  type BaselineAiInput,
} from "./contracts.js";
import { createNineRouterDecisionProvider } from "./nine-router-provider.js";
import type { AiTaskProvider, ResolvedAiTaskConfig } from "./task-config.js";

export type AiConnectionCode =
  | "CONNECTED"
  | "AUTH_FAILURE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "UNSUPPORTED"
  | "UNAVAILABLE"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "CONFIG_ERROR";

export type AiConnectionResult =
  | Readonly<{
      status: "SUCCESS";
      code: "CONNECTED";
      requested: AiConnectionIdentity | null;
      reported: AiReportedIdentity;
    }>
  | Readonly<{
      status: "FAILURE";
      code: Exclude<AiConnectionCode, "CONNECTED">;
      requested: AiConnectionIdentity | null;
      message: string;
      retryAfterSeconds?: number;
    }>;

export interface AiConnectionIdentity {
  readonly provider: AiTaskProvider;
  readonly baseUrl: string;
  readonly model: string;
}

export const AiConnectionIdentitySchema = z.strictObject({
  provider: z.enum(["9router", "openai-compatible", "huggingface-hosted"]),
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(256),
});

export const AiReportedIdentitySchema = z.strictObject({
  provider: z.string().trim().min(1).max(256).nullable(),
  model: z.string().trim().min(1).max(256).nullable(),
});

export const AiConnectionResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("SUCCESS"),
    code: z.literal("CONNECTED"),
    requested: AiConnectionIdentitySchema.nullable(),
    reported: AiReportedIdentitySchema,
  }),
  z.strictObject({
    status: z.literal("FAILURE"),
    code: z.enum(["AUTH_FAILURE", "RATE_LIMITED", "TIMEOUT", "MALFORMED_RESPONSE", "UNSUPPORTED", "UNAVAILABLE", "NETWORK_ERROR", "HTTP_ERROR", "CONFIG_ERROR"]),
    requested: AiConnectionIdentitySchema.nullable(),
    message: z.string().trim().min(1).max(160),
    retryAfterSeconds: z.number().int().min(0).max(1_000_000).optional(),
  }),
]);

export interface AiReportedIdentity {
  readonly provider: string | null;
  readonly model: string | null;
}

export interface TaskAiClientDependencies extends BaselineAiClientDependencies {
  readonly environment?: NodeJS.ProcessEnv;
}

const SAFE_MESSAGES: Record<Exclude<AiConnectionCode, "CONNECTED">, string> = {
  AUTH_FAILURE: "Provider authentication failed.",
  RATE_LIMITED: "Provider rate limit reached.",
  TIMEOUT: "Provider connection timed out.",
  MALFORMED_RESPONSE: "Provider returned an invalid response.",
  UNSUPPORTED: "Provider connection testing is unsupported.",
  UNAVAILABLE: "Provider is unavailable.",
  NETWORK_ERROR: "Provider network request failed.",
  HTTP_ERROR: "Provider returned an HTTP error.",
  CONFIG_ERROR: "Provider configuration is unavailable.",
};

function readProbeResponse(value: unknown): { model: string; content: string } {
  if (typeof value !== "object" || value === null) throw new Error("invalid response");
  const record = value as Record<string, unknown>;
  const model = typeof record.model === "string" && record.model.trim() !== ""
    ? record.model.trim()
    : null;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  const message = typeof first === "object" && first !== null
    ? (first as Record<string, unknown>).message
    : null;
  const content = typeof message === "object" && message !== null
    ? (message as Record<string, unknown>).content
    : null;
  if (model === null || typeof content !== "string" || choices.length < 1) throw new Error("invalid response");
  return { model, content };
}

function readChatResponse(value: unknown): { model: string; content: string } {
  return readProbeResponse(value);
}

function identity(config: Exclude<ResolvedAiTaskConfig, { source: "UNSET" }>): AiConnectionIdentity {
  return { provider: config.provider, baseUrl: config.baseUrl, model: config.model };
}

function safeReportedModel(value: string): string | null {
  const model = value.trim();
  return /^[\w./:-]{1,256}$/.test(model) ? model : null;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function resultFailure(
  requested: AiConnectionIdentity,
  code: Exclude<AiConnectionCode, "CONNECTED">,
  retryAfter?: number,
): AiConnectionResult {
  return retryAfter === undefined
    ? { status: "FAILURE", code, requested, message: SAFE_MESSAGES[code] }
    : { status: "FAILURE", code, requested, message: SAFE_MESSAGES[code], retryAfterSeconds: retryAfter };
}

function providerConfig(
  config: Exclude<ResolvedAiTaskConfig, { source: "UNSET" }>,
  secret: string | undefined,
): BaselineAiConfig {
  if (config.provider !== "9router" || config.registry === null) throw new Error("invalid 9Router config");
  const apiKey = secret?.trim() || undefined;
  const hostname = new URL(config.baseUrl).hostname.toLowerCase();
  const authMode: ToolAiAuthMode = apiKey === undefined
    ? (["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname) ? "LOCAL_NO_AUTH" : "CONFIG_MISSING")
    : "BEARER";
  if (authMode === "CONFIG_MISSING") throw new Error("missing provider secret");
  return {
    enabled: config.enabled,
    provider: "9router" as const,
    baseUrl: config.baseUrl,
    apiKey,
    timeoutMs: config.parameters.timeoutMs,
    authMode,
    registry: config.registry,
  };
}

function createOpenAiCompatibleProvider(
  config: Exclude<ResolvedAiTaskConfig, { source: "UNSET" }>,
  dependencies: TaskAiClientDependencies,
) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  return {
    async recommend(input: BaselineAiInput, requestedModel: string) {
      const controller = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, config.parameters!.timeoutMs);
      });
      const headers: Record<string, string> = { "content-type": "application/json" };
      const secret = dependencies.environment?.[config.secretRef!]?.trim() || process.env[config.secretRef!]?.trim();
      if (secret) headers.authorization = `Bearer ${secret}`;
      try {
        const response = await Promise.race([
          fetchImpl(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: requestedModel,
              temperature: 0,
              response_format: { type: "json_object" },
              messages: buildDecisionAiMessages(input),
            }),
            redirect: "error",
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (!response.ok) {
          const errorCode: "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "HTTP_ERROR" = response.status === 429
            ? "RATE_LIMITED"
            : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "HTTP_ERROR";
          return { status: "FAILURE" as const, errorCode };
        }
        try {
          const parsed = readChatResponse(await response.json());
          return { status: "SUCCESS" as const, reportedModel: parsed.model, output: BaselineAiOutputSchema.parse(JSON.parse(parsed.content)) };
        } catch {
          return { status: "FAILURE" as const, errorCode: "INVALID_RESPONSE" as const };
        }
      } catch (error) {
        return { status: "FAILURE" as const, errorCode: error instanceof Error && error.message === "timeout" ? "TIMEOUT" as const : "NETWORK_ERROR" as const };
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
    },
  };
}

export function createBaselineAiClientForTask(
  config: ResolvedAiTaskConfig,
  dependencies: TaskAiClientDependencies = {},
): BaselineAiClient {
  if (config.source === "UNSET" || !config.enabled || config.provider === null || config.baseUrl === null || config.model === null || config.parameters === null || config.secretRef === null) {
    return {
      async recommend() {
        return {
          status: "UNAVAILABLE",
          errorCode: config.source === "UNSET" ? "CONFIG_MISSING" : "FEATURE_DISABLED",
          humanReviewRequired: true,
          requestedModel: config.model ?? "unknown",
          reportedModel: null,
          actualModelUsed: null,
          provider: config.provider ?? "9router",
          authMode: "CONFIG_MISSING",
          outputSchemaVersion: "decision-ai-output.v1",
          promptVersion: "decision-ai-prompt.v2",
          aiPolicyVersion: "decision-ai-policy.v1",
          rulePolicyVersion: "unknown",
          generatedAt: new Date().toISOString(),
        };
      },
    };
  }
  if (config.provider === "huggingface-hosted") {
    return {
      async recommend() {
        return {
          status: "UNAVAILABLE",
          errorCode: "PROVIDER_UNAVAILABLE",
          humanReviewRequired: true,
          requestedModel: config.model,
          reportedModel: null,
          actualModelUsed: null,
          provider: config.provider,
          authMode: "BEARER",
          outputSchemaVersion: "decision-ai-output.v1",
          promptVersion: "decision-ai-prompt.v2",
          aiPolicyVersion: "decision-ai-policy.v1",
          rulePolicyVersion: "unknown",
          generatedAt: new Date().toISOString(),
        };
      },
    };
  }
  if (config.provider === "openai-compatible") {
    return createBaselineAiClientFromProvider({
      enabled: config.enabled,
      provider: config.provider,
      authMode: "BEARER",
      requestedModels: [config.model],
      verifiedReportedModels: false,
    }, createOpenAiCompatibleProvider(config, dependencies), dependencies);
  }
  try {
    const provider = createNineRouterDecisionProvider(providerConfig(config, dependencies.environment?.[config.secretRef] ?? process.env[config.secretRef]), {
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    });
    const registry = config.registry;
    return createBaselineAiClientFromProvider({
      enabled: config.enabled,
      provider: config.provider,
      authMode: providerConfig(config, dependencies.environment?.[config.secretRef] ?? process.env[config.secretRef]).authMode,
      requestedModels: [config.model],
      ...(registry === null ? {} : { allowedModels: registry.allowedModels }),
      verifiedReportedModels: true,
    }, provider, dependencies);
  } catch {
    return createBaselineAiClientForTask({ ...config, enabled: false, status: "DISABLED", availability: "UNAVAILABLE" }, dependencies);
  }
}

export async function testAiTaskConnection(
  config: ResolvedAiTaskConfig,
  dependencies: TaskAiClientDependencies = {},
): Promise<AiConnectionResult> {
  if (config.source === "UNSET" || !config.enabled || config.provider === null || config.baseUrl === null || config.model === null || config.parameters === null || config.secretRef === null) {
    const requested = config.source === "UNSET"
      ? { provider: "9router" as const, baseUrl: "", model: "" }
      : { provider: config.provider ?? "9router", baseUrl: config.baseUrl ?? "", model: config.model ?? "" };
    return resultFailure(requested, "CONFIG_ERROR");
  }
  const requested = identity(config);
  if (config.provider === "huggingface-hosted") return resultFailure(requested, "UNSUPPORTED");
  const secret = dependencies.environment?.[config.secretRef]?.trim() ?? process.env[config.secretRef]?.trim();
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(config.baseUrl).hostname.toLowerCase());
  if (!loopback && !secret) return resultFailure(requested, "AUTH_FAILURE");
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, config.parameters.timeoutMs);
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  try {
    const response = await Promise.race([
      fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: "Reply with OK." }], temperature: 0, max_tokens: 1 }),
        redirect: "error",
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (response.status === 401 || response.status === 403) return resultFailure(requested, "AUTH_FAILURE");
    if (response.status === 429) return resultFailure(requested, "RATE_LIMITED", retryAfterSeconds(response.headers.get("retry-after")));
    if (!response.ok) return resultFailure(requested, "HTTP_ERROR");
    try {
      const parsed = readProbeResponse(await response.json());
      return AiConnectionResultSchema.parse({
        status: "SUCCESS",
        code: "CONNECTED",
        requested,
        reported: { provider: null, model: safeReportedModel(parsed.model) },
      }) as AiConnectionResult;
    } catch {
      return resultFailure(requested, "MALFORMED_RESPONSE");
    }
  } catch (error) {
    return resultFailure(requested, error instanceof Error && error.message === "timeout" ? "TIMEOUT" : "NETWORK_ERROR");
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
