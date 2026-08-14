import { z } from "zod";

export const VERIFIED_TOOL_AI_MODELS = [
  { requestedModel: "oc/deepseek-v4-flash-free", reportedModels: ["deepseek-v4-flash-free"] },
  { requestedModel: "oc/big-pickle", reportedModels: ["big-pickle"] },
  { requestedModel: "oc/hy3-free", reportedModels: ["hy3-free"] },
  { requestedModel: "oc/laguna-s-2.1-free", reportedModels: ["laguna-s-2.1-free"] },
  { requestedModel: "oc/nemotron-3-ultra-free", reportedModels: ["nemotron-3-ultra-free"] },
  { requestedModel: "oc/nemotron-3.5-lightning-free", reportedModels: ["nemotron-3.5-lightning-free"] },
] as const;

const verifiedByRequest = new Map<string, ReadonlySet<string>>(
  VERIFIED_TOOL_AI_MODELS.map((entry) => [entry.requestedModel, new Set<string>(entry.reportedModels)]),
);
const ModelIdSchema = z.string().trim().min(1);

export interface ToolAiModelRegistry {
  readonly defaultModel: string;
  readonly allowedModels: readonly string[];
  readonly fallbackModels: readonly string[];
  readonly freeOnly: true;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => ModelIdSchema.parse(value)))];
}

function assertVerified(model: string): void {
  if (model === "auto" || model.startsWith("cx/") || !verifiedByRequest.has(model)) {
    throw new Error(`Tool AI model is not an approved verified free model: ${model}`);
  }
}

export function createToolAiModelRegistry(input: {
  readonly defaultModel: string;
  readonly allowedModels: readonly string[];
  readonly fallbackModels: readonly string[];
  readonly freeOnly: true;
}): ToolAiModelRegistry {
  const defaultModel = ModelIdSchema.parse(input.defaultModel);
  const allowedModels = unique(input.allowedModels);
  const fallbackModels = unique(input.fallbackModels);
  assertVerified(defaultModel);
  for (const model of allowedModels) assertVerified(model);
  for (const model of fallbackModels) assertVerified(model);
  if (!allowedModels.includes(defaultModel)) {
    throw new Error("TOOL_AI_DEFAULT_MODEL must be present in TOOL_AI_ALLOWED_MODELS");
  }
  if (fallbackModels.includes(defaultModel)) {
    throw new Error("TOOL_AI_FALLBACK_MODELS must not repeat the default model");
  }
  if (fallbackModels.some((model) => !allowedModels.includes(model))) {
    throw new Error("TOOL_AI_FALLBACK_MODELS must be a subset of TOOL_AI_ALLOWED_MODELS");
  }
  return { defaultModel, allowedModels, fallbackModels, freeOnly: true };
}

export function resolveActualModel(
  registry: ToolAiModelRegistry,
  requestedModel: string,
  reportedModel: string,
): string | null {
  if (!registry.allowedModels.includes(requestedModel)) return null;
  return verifiedByRequest.get(requestedModel)?.has(reportedModel) === true
    ? reportedModel
    : null;
}
