import type { BaselineAiConfig } from "./config.js";
import {
  BaselineAiInputSchema,
  type AiUnavailableErrorCode,
  type BaselineAiClient,
  type BaselineAiResult,
} from "./contracts.js";
import { createNineRouterDecisionProvider } from "./nine-router-provider.js";
import {
  DECISION_AI_OUTPUT_SCHEMA_VERSION,
  DECISION_AI_POLICY_VERSION,
  DECISION_AI_PROMPT_VERSION,
} from "./prompt.js";
import { resolveActualModel } from "./registry.js";

function canUseFallback(errorCode: AiUnavailableErrorCode): boolean {
  return errorCode !== "INVALID_RESPONSE";
}

export interface BaselineAiClientDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export function createBaselineAiClientFromConfig(
  config: BaselineAiConfig,
  dependencies: BaselineAiClientDependencies = {},
): BaselineAiClient {
  const now = dependencies.now ?? (() => new Date());
  const provider = createNineRouterDecisionProvider(config, {
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });

  return {
    async recommend(input): Promise<BaselineAiResult> {
      const parsedInput = BaselineAiInputSchema.parse(input);
      const models = [config.registry.defaultModel, ...config.registry.fallbackModels];
      const baseProvenance = {
        provider: config.provider,
        authMode: config.authMode,
        outputSchemaVersion: DECISION_AI_OUTPUT_SCHEMA_VERSION,
        promptVersion: DECISION_AI_PROMPT_VERSION,
        aiPolicyVersion: DECISION_AI_POLICY_VERSION,
        rulePolicyVersion: parsedInput.riskSnapshot.policyVersion,
        generatedAt: now().toISOString(),
      } as const;
      const unavailable = (
        errorCode: AiUnavailableErrorCode,
        requestedModel = config.registry.defaultModel,
      ): BaselineAiResult => ({
        status: "UNAVAILABLE",
        errorCode,
        humanReviewRequired: true,
        requestedModel,
        reportedModel: null,
        actualModelUsed: null,
        ...baseProvenance,
      });

      if (!config.enabled) return unavailable("FEATURE_DISABLED");
      if (config.authMode === "CONFIG_MISSING") return unavailable("CONFIG_MISSING");

      let lastError: AiUnavailableErrorCode = "PROVIDER_UNAVAILABLE";
      let lastModel = config.registry.defaultModel;
      for (const requestedModel of models) {
        lastModel = requestedModel;
        if (!config.registry.allowedModels.includes(requestedModel)) {
          return unavailable("MODEL_NOT_ALLOWED", requestedModel);
        }
        const result = await provider.recommend(parsedInput, requestedModel);
        if (result.status === "FAILURE") {
          lastError = result.errorCode;
          if (!canUseFallback(result.errorCode)) {
            return unavailable(result.errorCode, requestedModel);
          }
          continue;
        }
        const actualModelUsed = resolveActualModel(
          config.registry,
          requestedModel,
          result.reportedModel,
        );
        if (actualModelUsed === null) {
          return unavailable("INVALID_RESPONSE", requestedModel);
        }
        return {
          status: "AVAILABLE",
          ...result.output,
          ruleResult: parsedInput.ruleDecision,
          ruleOverride: result.output.recommendation !== parsedInput.ruleDecision,
          requestedModel,
          reportedModel: result.reportedModel,
          actualModelUsed,
          ...baseProvenance,
        };
      }
      return unavailable(lastError, lastModel);
    },
  };
}
