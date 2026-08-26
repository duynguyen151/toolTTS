import { createBaselineAiClientFromProvider, type BaselineAiClientDependencies } from "./client.js";
import type { BaselineAiConfig, ToolAiAuthMode } from "./config.js";
import { z } from "zod";
import { buildDecisionAiMessages } from "./prompt.js";
import {
  BaselineAiOutputSchema,
  type BaselineAiClient,
  type BaselineAiInput,
} from "./contracts.js";
import {
  baselineAiOutputContainsSecret,
  createNineRouterDecisionProvider,
  fetchResponseBody,
  parseChatCompletionEnvelope,
  RequestTimeoutError,
  ResponseBodyTooLargeError,
} from "./nine-router-provider.js";
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
  baseUrl: z.string().trim().min(1).max(4096),
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

function readProbeResponse(value: string): { model: string; content: string } {
  return parseChatCompletionEnvelope(value);
}

function safeIdentity(config: Exclude<ResolvedAiTaskConfig, { source: "UNSET" }>): AiConnectionIdentity | null {
  const parsed = AiConnectionIdentitySchema.safeParse({
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  return parsed.success ? parsed.data : null;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function resultFailure(
  requested: AiConnectionIdentity | null,
  code: Exclude<AiConnectionCode, "CONNECTED">,
  retryAfter?: number,
): AiConnectionResult {
  const result = retryAfter === undefined
    ? { status: "FAILURE" as const, code, requested, message: SAFE_MESSAGES[code] }
    : { status: "FAILURE" as const, code, requested, message: SAFE_MESSAGES[code], retryAfterSeconds: retryAfter };
  return AiConnectionResultSchema.parse(result) as AiConnectionResult;
}

function isSecretTainted(value: string, secret: string | undefined): boolean {
  return secret !== undefined && secret !== "" && value.includes(secret);
}

function safeReportedModel(value: string, secret: string | undefined): string | null {
  const model = value.trim();
  return /^[\w./:-]{1,256}$/.test(model) && !isSecretTainted(model, secret) ? model : null;
}

function resolvedSecret(config: Exclude<ResolvedAiTaskConfig, { source: "UNSET" }>, dependencies: TaskAiClientDependencies): string | undefined {
  const environment = dependencies.environment === undefined ? process.env : dependencies.environment;
  return environment[config.secretRef]?.trim() || undefined;
}

function providerConfig(
  config: Exclude<ResolvedAiTaskConfig, { source: "UNSET" }>,
  secret: string | undefined,
): BaselineAiConfig {
  if (config.provider !== "9router" || config.registry === null) throw new Error("invalid 9Router config");
  const hostname = new URL(config.baseUrl).hostname.toLowerCase();
  const authMode: ToolAiAuthMode = secret === undefined
    ? (["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname) ? "LOCAL_NO_AUTH" : "CONFIG_MISSING")
    : "BEARER";
  return {
    enabled: config.enabled,
    provider: "9router" as const,
    baseUrl: config.baseUrl,
    apiKey: secret,
    timeoutMs: config.parameters.timeoutMs,
    authMode,
    registry: config.registry,
  };
}

function createOpenAiCompatibleProvider(
  config: Exclude<ResolvedAiTaskConfig, { source: "UNSET" }>,
  dependencies: TaskAiClientDependencies,
  secret: string | undefined,
) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  return {
    async recommend(input: BaselineAiInput, requestedModel: string) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (secret) headers.authorization = `Bearer ${secret}`;
      let response: Response;
      let body: string | null;
      try {
        ({ response, body } = await fetchResponseBody(fetchImpl, `${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: requestedModel,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: buildDecisionAiMessages(input),
          }),
          redirect: "error",
        }, config.parameters!.timeoutMs));
      } catch (error) {
        return {
          status: "FAILURE" as const,
          errorCode: error instanceof RequestTimeoutError
            ? "TIMEOUT" as const
            : error instanceof ResponseBodyTooLargeError ? "INVALID_RESPONSE" as const : "NETWORK_ERROR" as const,
        };
      }
      if (!response.ok) {
        const errorCode: "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "HTTP_ERROR" = response.status === 429
          ? "RATE_LIMITED"
          : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "HTTP_ERROR";
        return { status: "FAILURE" as const, errorCode };
      }
      if (body === null) return { status: "FAILURE" as const, errorCode: "INVALID_RESPONSE" as const };
      try {
        const parsed = readProbeResponse(body);
        const reportedModel = safeReportedModel(parsed.model, secret);
        if (reportedModel === null) return { status: "FAILURE" as const, errorCode: "INVALID_RESPONSE" as const };
        const output = BaselineAiOutputSchema.parse(JSON.parse(parsed.content));
        if (baselineAiOutputContainsSecret(output, secret)) return { status: "FAILURE" as const, errorCode: "INVALID_RESPONSE" as const };
        return { status: "SUCCESS" as const, reportedModel, output };
      } catch {
        return { status: "FAILURE" as const, errorCode: "INVALID_RESPONSE" as const };
      }
    },
  };
}

function unavailableClient(
  config: ResolvedAiTaskConfig,
  errorCode: "FEATURE_DISABLED" | "CONFIG_MISSING" | "PROVIDER_UNAVAILABLE",
  authMode: "LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING",
): BaselineAiClient {
  return createBaselineAiClientFromProvider({
    enabled: true,
    provider: config.provider ?? "9router",
    authMode,
    requestedModels: config.model === null ? ["unknown"] : [config.model],
    verifiedReportedModels: false,
    preflightErrorCode: errorCode,
  }, { recommend: async () => ({ status: "FAILURE", errorCode }) });
}

export function createBaselineAiClientForTask(
  config: ResolvedAiTaskConfig,
  dependencies: TaskAiClientDependencies = {},
): BaselineAiClient {
  if (config.source === "UNSET") return unavailableClient(config, "CONFIG_MISSING", "CONFIG_MISSING");
  if (!config.enabled) return unavailableClient(config, "FEATURE_DISABLED", "CONFIG_MISSING");
  if (config.provider === "huggingface-hosted") return unavailableClient(config, "PROVIDER_UNAVAILABLE", "BEARER");
  const secret = resolvedSecret(config, dependencies);
  if (config.provider === "openai-compatible") {
    return createBaselineAiClientFromProvider({
      enabled: config.enabled,
      provider: config.provider,
      authMode: secret === undefined ? "CONFIG_MISSING" : "BEARER",
      requestedModels: [config.model],
      verifiedReportedModels: false,
    }, createOpenAiCompatibleProvider(config, dependencies, secret), dependencies);
  }
  const configured = providerConfig(config, secret);
  const registry = config.registry;
  return createBaselineAiClientFromProvider({
    enabled: config.enabled,
    provider: config.provider,
    authMode: configured.authMode,
    requestedModels: [config.model, ...(registry?.fallbackModels ?? [])],
    ...(registry === null ? {} : { allowedModels: registry.allowedModels }),
    verifiedReportedModels: true,
  }, createNineRouterDecisionProvider(configured, {
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  }), dependencies);
}

export async function testAiTaskConnection(
  config: ResolvedAiTaskConfig,
  dependencies: TaskAiClientDependencies = {},
): Promise<AiConnectionResult> {
  if (config.source === "UNSET") return resultFailure(null, "CONFIG_ERROR");
  if (config.provider === null || config.baseUrl === null || config.model === null || config.parameters === null || config.secretRef === null) {
    return resultFailure(null, "CONFIG_ERROR");
  }
  const requested = safeIdentity(config);
  if (requested === null) return resultFailure(null, "CONFIG_ERROR");
  if (!config.enabled) return resultFailure(requested, "CONFIG_ERROR");
  if (config.provider === "huggingface-hosted") return resultFailure(requested, "UNSUPPORTED");
  const secret = resolvedSecret(config, dependencies);
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(config.baseUrl).hostname.toLowerCase());
  if (!loopback && secret === undefined) {
    return resultFailure(requested, config.provider === "9router" ? "CONFIG_ERROR" : "AUTH_FAILURE");
  }
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers.authorization = `Bearer ${secret}`;
  let response: Response;
  let body: string | null;
  try {
    ({ response, body } = await fetchResponseBody(fetchImpl, `${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: "Reply with OK." }], temperature: 0, max_tokens: 1 }),
      redirect: "error",
    }, config.parameters.timeoutMs));
  } catch (error) {
    return resultFailure(requested,
      error instanceof RequestTimeoutError ? "TIMEOUT" : error instanceof ResponseBodyTooLargeError ? "MALFORMED_RESPONSE" : "NETWORK_ERROR");
  }
  if (response.status === 401 || response.status === 403) return resultFailure(requested, "AUTH_FAILURE");
  if (response.status === 429) return resultFailure(requested, "RATE_LIMITED", retryAfterSeconds(response.headers.get("retry-after")));
  if (response.status >= 500) return resultFailure(requested, "UNAVAILABLE");
  if (!response.ok) return resultFailure(requested, "HTTP_ERROR");
  if (body === null) return resultFailure(requested, "MALFORMED_RESPONSE");
  try {
    const parsed = readProbeResponse(body);
    const reportedModel = safeReportedModel(parsed.model, secret);
    if (reportedModel === null) return resultFailure(requested, "MALFORMED_RESPONSE");
    return AiConnectionResultSchema.parse({
      status: "SUCCESS",
      code: "CONNECTED",
      requested,
      reported: { provider: null, model: reportedModel },
    }) as AiConnectionResult;
  } catch {
    return resultFailure(requested, "MALFORMED_RESPONSE");
  }
}
