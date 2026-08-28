import { z } from "zod";
import type { FrozenAiTaskRequest } from "@shop-health/domain";

import { readBaselineAiConfig } from "./config.js";
import { createToolAiModelRegistry, type ToolAiModelRegistry } from "./registry.js";

export const AI_TASK_IDS = [
  "SHOP_HEALTH_REVIEWER",
  "FINANCE_SPECIALIST",
  "ORDER_ANOMALY_REVIEWER",
  "BA_ASSISTANT",
] as const;

export const AI_TASK_PROVIDERS = ["9router", "openai-compatible", "huggingface-hosted"] as const;

const AiTaskIdSchema = z.enum(AI_TASK_IDS);
const AiTaskStatusSchema = z.enum(["ENABLED", "DISABLED"]);
const AiTaskProviderSchema = z.enum(AI_TASK_PROVIDERS);
const SafeReferenceNameSchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const FiniteDateSchema = z.date().refine((value) => Number.isFinite(value.getTime()), {
  message: "Date must be finite",
});
const PositiveSafeIntegerSchema = z.number().int().min(1).max(300_000);

export const AiTaskBaseUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "AI task baseUrl must use HTTP or HTTPS" });
  }
  if (url.username !== "" || url.password !== "") {
    context.addIssue({ code: "custom", message: "AI task baseUrl must not contain credentials" });
  }
  if (url.search !== "" || url.hash !== "") {
    context.addIssue({ code: "custom", message: "AI task baseUrl must not contain query or fragment data" });
  }
});

const AiTaskParametersSchema = z.strictObject({
  timeoutMs: PositiveSafeIntegerSchema.optional(),
});

export const AiTaskConfigInputSchema = z.strictObject({
  taskId: AiTaskIdSchema,
  provider: AiTaskProviderSchema,
  baseUrl: AiTaskBaseUrlSchema,
  model: z.string().trim().min(1).max(256),
  parameters: AiTaskParametersSchema,
  secretRef: SafeReferenceNameSchema,
  enabled: z.boolean(),
  status: AiTaskStatusSchema,
  effectiveFrom: FiniteDateSchema.optional(),
}).superRefine((input, context) => {
  if ((input.status === "ENABLED") !== input.enabled) {
    context.addIssue({ code: "custom", path: ["status"], message: "status must match enabled" });
  }
  if (input.taskId !== "SHOP_HEALTH_REVIEWER" && (input.enabled || input.status !== "DISABLED")) {
    context.addIssue({ code: "custom", message: "Future AI tasks must remain disabled" });
  }
  if (input.provider === "9router") {
    try {
      createToolAiModelRegistry({
        defaultModel: input.model,
        allowedModels: [input.model],
        fallbackModels: [],
        freeOnly: true,
      });
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: error instanceof Error ? error.message : "AI task model is invalid",
      });
    }
  }
});

export const PersistedAiTaskConfigSchema = AiTaskConfigInputSchema.safeExtend({
  revisionId: z.string().uuid(),
  sequence: z.bigint().positive(),
  effectiveFrom: FiniteDateSchema,
  createdAt: FiniteDateSchema,
});

export type AiTaskId = z.infer<typeof AiTaskIdSchema>;
export type AiTaskProvider = z.infer<typeof AiTaskProviderSchema>;
export type AiTaskConfigInput = z.input<typeof AiTaskConfigInputSchema>;
export type PersistedAiTaskConfig = z.infer<typeof PersistedAiTaskConfigSchema>;

/** Non-secret configuration handed to W14-T02's future provider factory. */
type ResolvedConfiguredAiTaskConfig = {
  readonly taskId: AiTaskId;
  readonly source: "PERSISTED" | "ENVIRONMENT";
  readonly revisionId: string | null;
  readonly provider: AiTaskProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly parameters: { readonly timeoutMs: number };
  readonly secretRef: string;
  readonly enabled: boolean;
  readonly status: "ENABLED" | "DISABLED";
  readonly availability: "AVAILABLE" | "UNAVAILABLE";
  readonly registry: ToolAiModelRegistry | null;
};

export type ResolvedAiTaskConfig =
  | ResolvedConfiguredAiTaskConfig
  | {
      readonly taskId: AiTaskId;
      readonly source: "UNSET";
      readonly revisionId: null;
      readonly provider: null;
      readonly baseUrl: null;
      readonly model: null;
      readonly parameters: null;
      readonly secretRef: null;
      readonly enabled: false;
      readonly status: "DISABLED";
      readonly availability: "UNAVAILABLE";
      readonly registry: null;
    };

function registryFor(config: Pick<PersistedAiTaskConfig, "provider" | "model">): ToolAiModelRegistry | null {
  return config.provider === "9router"
    ? createToolAiModelRegistry({
        defaultModel: config.model,
        allowedModels: [config.model],
        fallbackModels: [],
        freeOnly: true,
      })
    : null;
}

function persistedConfig(config: PersistedAiTaskConfig): ResolvedConfiguredAiTaskConfig {
  return {
    taskId: config.taskId,
    source: "PERSISTED",
    revisionId: config.revisionId,
    provider: config.provider,
    baseUrl: config.baseUrl.replace(/\/$/, ""),
    model: config.model,
    parameters: { timeoutMs: config.parameters.timeoutMs ?? 30_000 },
    secretRef: config.secretRef,
    enabled: config.enabled,
    status: config.status,
    availability: config.enabled ? "AVAILABLE" : "UNAVAILABLE",
    registry: registryFor(config),
  };
}

function environmentConfig(environment: NodeJS.ProcessEnv): ResolvedConfiguredAiTaskConfig {
  const config = readBaselineAiConfig(environment);
  return {
    taskId: "SHOP_HEALTH_REVIEWER",
    source: "ENVIRONMENT",
    revisionId: null,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.registry.defaultModel,
    parameters: { timeoutMs: config.timeoutMs },
    secretRef: "TOOL_AI_API_KEY",
    enabled: config.enabled,
    status: config.enabled ? "ENABLED" : "DISABLED",
    availability: config.enabled ? "AVAILABLE" : "UNAVAILABLE",
    registry: config.registry,
  };
}

function unsetConfig(taskId: AiTaskId): Extract<ResolvedAiTaskConfig, { source: "UNSET" }> {
  return {
    taskId,
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
  };
}

/** No migration seed is written: existing deployments retain the current env baseline until an operator appends a revision. */
export function resolveAiTaskConfig(
  taskId: AiTaskId,
  current: PersistedAiTaskConfig | null,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedAiTaskConfig {
  if (current !== null) {
    const persisted = PersistedAiTaskConfigSchema.parse(current);
    if (persisted.taskId !== taskId) {
      throw new Error(`Persisted AI task ${persisted.taskId} does not match requested task ${taskId}`);
    }
    return persistedConfig(persisted);
  }
  return taskId === "SHOP_HEALTH_REVIEWER" ? environmentConfig(environment) : unsetConfig(taskId);
}

export function matchesFrozenAiTaskRequest(
  config: ResolvedAiTaskConfig,
  request: FrozenAiTaskRequest,
): boolean {
  return config.source !== "UNSET" &&
    config.taskId === request.taskId &&
    config.source === request.taskConfigSource &&
    config.revisionId === request.taskConfigRevisionId &&
    config.provider === request.provider &&
    config.model === request.requestedModel &&
    config.secretRef === request.secretRef;
}
