import type { BaselineAiConfig } from "./config.js";
import { validateFrozenDecisionContext } from "@shop-health/domain";
import {
  BaselineAiInputSchema,
  type AiProvenance,
  type AiUnavailableErrorCode,
  type BaselineAiClient,
  type BaselineAiResult,
} from "./contracts.js";
import {
  createNineRouterDecisionProvider,
  type DecisionAiProvider,
} from "./nine-router-provider.js";
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

interface ProviderClientConfig {
  readonly enabled: boolean;
  readonly provider: AiProvenance["provider"];
  readonly authMode: AiProvenance["authMode"];
  readonly requestedModels: readonly string[];
  readonly allowedModels?: readonly string[];
  readonly verifiedReportedModels: boolean;
  readonly preflightErrorCode?: AiUnavailableErrorCode;
}

export function createBaselineAiClientFromProvider(
  config: ProviderClientConfig,
  provider: DecisionAiProvider,
  dependencies: { readonly now?: () => Date } = {},
): BaselineAiClient {
  const now = dependencies.now ?? (() => new Date());
  const requestedModel = config.requestedModels[0] ?? "unknown";
  return {
    async recommend(input): Promise<BaselineAiResult> {
      const parsed = BaselineAiInputSchema.safeParse(input);
      const baseProvenance = {
        provider: config.provider,
        authMode: config.authMode,
        outputSchemaVersion: DECISION_AI_OUTPUT_SCHEMA_VERSION,
        promptVersion: DECISION_AI_PROMPT_VERSION,
        aiPolicyVersion: DECISION_AI_POLICY_VERSION,
        rulePolicyVersion: parsed.success ? parsed.data.riskSnapshot.policyVersion : "unknown",
        generatedAt: now().toISOString(),
      } as const;
      const unavailable = (
        errorCode: AiUnavailableErrorCode,
        model = requestedModel,
      ): BaselineAiResult => ({
        status: "UNAVAILABLE",
        errorCode,
        humanReviewRequired: true,
        requestedModel: model,
        reportedModel: null,
        actualModelUsed: null,
        ...baseProvenance,
      });

      if (!parsed.success) return unavailable("INVALID_RESPONSE");
      const parsedInput = parsed.data;
      const frozenContextValidation = validateFrozenDecisionContext({
        context: parsedInput.decisionContextSnapshot,
        metrics: parsedInput.metricsSnapshot,
        finance: parsedInput.financeSnapshot,
        coverage: parsedInput.coverageSnapshot,
        risk: parsedInput.riskSnapshot,
        ruleDecision: parsedInput.ruleDecision,
        ruleTriggers: parsedInput.ruleTriggers,
      });
      if (!frozenContextValidation.valid) return unavailable("INVALID_RESPONSE");

      if (config.preflightErrorCode !== undefined) return unavailable(config.preflightErrorCode);
      if (!config.enabled) return unavailable("FEATURE_DISABLED");
      if (config.authMode === "CONFIG_MISSING") return unavailable("CONFIG_MISSING");
      const quality = parsedInput.coverageSnapshot;
      const staleAdvisoryAllowed = quality.freshness === "STALE"
        && quality.source === "SELLER_CENTER"
        && quality.coverageState === "COMPLETE"
        && quality.ordersSourceComplete === true
        && quality.financeRequiredSourceComplete === true
        && quality.sourceReconciled === true
        && parsedInput.financeSnapshot.officialOnHoldAmount !== null;
      if (
        quality.coverageState !== "COMPLETE" ||
        quality.source !== "SELLER_CENTER" ||
        quality.provenSourceWindow !== "ROLLING_12_MONTHS" ||
        quality.completeWithinSourceWindow !== true ||
        quality.lifetimeHistoryComplete !== false ||
        quality.ordersSourceComplete !== true ||
        quality.financeRequiredSourceComplete !== true ||
        quality.sourceReconciled !== true ||
        quality.latestSuccessfulSyncAt === null ||
        quality.latestSuccessfulSyncAt === undefined ||
        quality.financeCapturedAt === null ||
        quality.financeCapturedAt === undefined ||
        (quality.freshness !== "FRESH" && !staleAdvisoryAllowed)
      ) {
        return unavailable("INVALID_RESPONSE");
      }

      let lastError: AiUnavailableErrorCode = "PROVIDER_UNAVAILABLE";
      let lastModel = requestedModel;
      for (const model of config.requestedModels) {
        lastModel = model;
        if (config.allowedModels !== undefined && !config.allowedModels.includes(model)) {
          return unavailable("MODEL_NOT_ALLOWED", model);
        }
        const result = await provider.recommend(parsedInput, model);
        if (result.status === "FAILURE") {
          lastError = result.errorCode;
          if (!canUseFallback(result.errorCode)) return unavailable(result.errorCode, model);
          continue;
        }
        const actualModelUsed = config.verifiedReportedModels
          ? resolveActualModelForConfig(config, model, result.reportedModel)
          : result.reportedModel;
        if (actualModelUsed === null) return unavailable("INVALID_RESPONSE", model);
        return {
          status: "AVAILABLE",
          ...result.output,
          ruleResult: parsedInput.ruleDecision,
          ruleOverride: result.output.recommendation !== parsedInput.ruleDecision,
          requestedModel: model,
          reportedModel: result.reportedModel,
          actualModelUsed,
          ...baseProvenance,
        };
      }
      return unavailable(lastError, lastModel);
    },
  };
}

function resolveActualModelForConfig(
  config: ProviderClientConfig,
  requestedModel: string,
  reportedModel: string,
): string | null {
  if (config.allowedModels === undefined) return reportedModel;
  return resolveActualModel(
    {
      defaultModel: requestedModel,
      allowedModels: config.allowedModels,
      fallbackModels: [],
      freeOnly: true,
    },
    requestedModel,
    reportedModel,
  );
}

export function createBaselineAiClientFromConfig(
  config: BaselineAiConfig,
  dependencies: BaselineAiClientDependencies = {},
): BaselineAiClient {
  const provider = createNineRouterDecisionProvider(config, {
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });
  return createBaselineAiClientFromProvider({
    enabled: config.enabled,
    provider: config.provider,
    authMode: config.authMode,
    requestedModels: [config.registry.defaultModel, ...config.registry.fallbackModels],
    allowedModels: config.registry.allowedModels,
    verifiedReportedModels: true,
  }, provider, dependencies);
}
