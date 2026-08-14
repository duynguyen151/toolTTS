import { BaDecisionReasonCodeSchema } from "@shop-health/domain";
import { z } from "zod";

import type { BaselineAiConfig } from "./config.js";
import {
  BaselineAiInputSchema,
  BaselineAiOutputSchema,
  type AiUnavailableErrorCode,
  type BaselineAiClient,
  type BaselineAiInput,
  type BaselineAiResult,
} from "./contracts.js";

export const BASELINE_AI_PROMPT_VERSION = "baseline-ai-prompt.v1" as const;

const KNOWN_RISK_EXCEPTIONS = [
  { id: "R1", code: "DATA_INCOMPLETE", guidance: "Unknown or incomplete data requires human review." },
  { id: "R2", code: "LOW_SAMPLE_SIZE", guidance: "Rates from small samples must not be treated as conclusive." },
  { id: "R3", code: "CARRIER_SYSTEMIC_DELAY", guidance: "Carrier delays may explain risk but do not override the deterministic rule." },
  { id: "R4", code: "RAPID_ONHOLD_GROWTH", guidance: "Rapid exposure growth requires review when verified history exists." },
  { id: "R5", code: "THRESHOLD_FLAPPING", guidance: "Repeated threshold crossings require human review." },
] as const;

const ChatCompletionEnvelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

export interface CreateBaselineAiClientOptions {
  readonly enabled: boolean;
  readonly apiKey?: string | undefined;
  readonly provider?: "opencode-zen";
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export interface BaselineAiClientDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

class RequestTimeoutError extends Error {}

function buildRequestBody(input: BaselineAiInput, model: string): string {
  return JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Return only one JSON object matching the requested schema. The deterministic rule is authoritative context and must not be modified.",
      },
      {
        role: "user",
        content: JSON.stringify({
          metricsSnapshot: input.metricsSnapshot,
          riskSnapshot: input.riskSnapshot,
          deterministicRule: {
            decision: input.ruleDecision,
            triggers: input.ruleTriggers,
            thresholds: {
              stopOnHoldValueAt: input.riskSnapshot.stopOnHoldValueAt,
              stopDeliveryRateBelow: input.riskSnapshot.stopDeliveryRateBelow,
              minimumOrdersForRateRule: input.riskSnapshot.minimumOrdersForRateRule,
            },
          },
          knownRiskExceptions: KNOWN_RISK_EXCEPTIONS,
          outputSchema: {
            decision: ["SCALE", "CONTINUE", "WATCH", "PAUSE"],
            confidence: "number from 0 to 1",
            reasonCodes: BaDecisionReasonCodeSchema.options,
            reason: "concise non-empty reason, maximum 500 characters",
            humanReviewRequired: "boolean",
          },
        }),
      },
    ],
  });
}

export function createBaselineAiClient(
  options: CreateBaselineAiClientOptions,
): BaselineAiClient {
  const provider = options.provider ?? "opencode-zen";
  const baseUrl = (options.baseUrl ?? "https://opencode.ai/zen/v1").replace(/\/$/, "");
  const model = options.model ?? "deepseek-v4-flash-free";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  return {
    async recommend(input): Promise<BaselineAiResult> {
      const parsedInput = BaselineAiInputSchema.parse(input);
      const provenance = {
        provider,
        model,
        promptVersion: BASELINE_AI_PROMPT_VERSION,
        policyVersion: parsedInput.riskSnapshot.policyVersion,
        generatedAt: now().toISOString(),
      } as const;
      const unavailable = (errorCode: AiUnavailableErrorCode): BaselineAiResult => ({
        status: "UNAVAILABLE",
        errorCode,
        humanReviewRequired: true,
        ...provenance,
      });

      if (!options.enabled) return unavailable("FEATURE_DISABLED");
      const apiKey = options.apiKey?.trim();
      if (!apiKey) return unavailable("MISSING_API_KEY");

      const controller = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new RequestTimeoutError("AI provider request timed out"));
        }, timeoutMs);
      });

      let response: Response;
      try {
        response = await Promise.race([
          fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: buildRequestBody(parsedInput, model),
            signal: controller.signal,
          }),
          timeout,
        ]);
      } catch (error) {
        return unavailable(error instanceof RequestTimeoutError ? "TIMEOUT" : "NETWORK_ERROR");
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }

      if (!response.ok) {
        return unavailable(response.status === 429 ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE");
      }

      let envelope: z.infer<typeof ChatCompletionEnvelopeSchema>;
      try {
        envelope = ChatCompletionEnvelopeSchema.parse(await response.json());
      } catch {
        return unavailable("INVALID_RESPONSE");
      }

      const content = envelope.choices[0]?.message.content;
      if (content === undefined) return unavailable("INVALID_RESPONSE");

      let decoded: unknown;
      try {
        decoded = JSON.parse(content);
      } catch {
        return unavailable("INVALID_RESPONSE");
      }
      const output = BaselineAiOutputSchema.safeParse(decoded);
      if (!output.success) return unavailable("INVALID_OUTPUT");

      return {
        status: "AVAILABLE",
        ...output.data,
        ...provenance,
      };
    },
  };
}

export function createBaselineAiClientFromConfig(
  config: BaselineAiConfig,
  dependencies: BaselineAiClientDependencies = {},
): BaselineAiClient {
  return createBaselineAiClient({
    enabled: config.enabled,
    apiKey: config.apiKey,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    ...dependencies,
  });
}
