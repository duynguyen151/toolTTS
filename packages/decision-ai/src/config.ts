import { z } from "zod";

import { createToolAiModelRegistry, type ToolAiModelRegistry } from "./registry.js";

const DEFAULT_MODEL = "oc/deepseek-v4-flash-free";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const ToolAiBaseUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "TOOL_AI_BASE_URL must use HTTP or HTTPS" });
  }
  if (url.username !== "" || url.password !== "") {
    context.addIssue({ code: "custom", message: "TOOL_AI_BASE_URL must not contain credentials" });
  }
  if (url.search !== "" || url.hash !== "") {
    context.addIssue({ code: "custom", message: "TOOL_AI_BASE_URL must not contain query or fragment data" });
  }
});

const BaselineAiEnvironmentSchema = z.object({
  TOOL_AI_ENABLED: z.enum(["true", "false"]).default("true"),
  TOOL_AI_PROVIDER: z.literal("9router").default("9router"),
  TOOL_AI_BASE_URL: ToolAiBaseUrlSchema.default("http://127.0.0.1:20128/v1"),
  TOOL_AI_API_KEY: z.string().optional(),
  TOOL_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  TOOL_AI_FREE_ONLY: z.literal("true").default("true"),
  TOOL_AI_DEFAULT_MODEL: z.string().trim().min(1).default(DEFAULT_MODEL),
  TOOL_AI_ALLOWED_MODELS: z.string().default(DEFAULT_MODEL),
  TOOL_AI_FALLBACK_MODELS: z.string().default(""),
});

export type ToolAiAuthMode = "LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING";

export interface BaselineAiConfig {
  readonly enabled: boolean;
  readonly provider: "9router";
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly timeoutMs: number;
  readonly authMode: ToolAiAuthMode;
  readonly registry: ToolAiModelRegistry;
}

function list(value: string): string[] {
  if (value.trim() === "") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function resolveAuthMode(baseUrl: string, apiKey: string | undefined): ToolAiAuthMode {
  if (apiKey !== undefined) return "BEARER";
  return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname.toLowerCase())
    ? "LOCAL_NO_AUTH"
    : "CONFIG_MISSING";
}

export function readBaselineAiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BaselineAiConfig {
  const parsed = BaselineAiEnvironmentSchema.parse(environment);
  const apiKey = parsed.TOOL_AI_API_KEY?.trim() || undefined;
  return {
    enabled: parsed.TOOL_AI_ENABLED === "true",
    provider: parsed.TOOL_AI_PROVIDER,
    baseUrl: parsed.TOOL_AI_BASE_URL.replace(/\/$/, ""),
    apiKey,
    timeoutMs: parsed.TOOL_AI_TIMEOUT_MS,
    authMode: resolveAuthMode(parsed.TOOL_AI_BASE_URL, apiKey),
    registry: createToolAiModelRegistry({
      defaultModel: parsed.TOOL_AI_DEFAULT_MODEL,
      allowedModels: list(parsed.TOOL_AI_ALLOWED_MODELS),
      fallbackModels: list(parsed.TOOL_AI_FALLBACK_MODELS),
      freeOnly: true,
    }),
  };
}
