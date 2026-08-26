import { z } from "zod";
import { validateFrozenDecisionContext } from "@shop-health/domain";

import type { BaselineAiConfig } from "./config.js";
import {
  BaselineAiInputSchema,
  BaselineAiOutputSchema,
  type AiUnavailableErrorCode,
  type BaselineAiInput,
  type BaselineAiOutput,
} from "./contracts.js";
import { buildDecisionAiMessages } from "./prompt.js";

const ChatCompletionEnvelopeSchema = z.object({
  model: z.string().trim().min(1),
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
  })).min(1),
});

export type DecisionProviderResult =
  | { readonly status: "SUCCESS"; readonly reportedModel: string; readonly output: BaselineAiOutput }
  | { readonly status: "FAILURE"; readonly errorCode: AiUnavailableErrorCode };

export interface DecisionAiProvider {
  recommend(input: BaselineAiInput, requestedModel: string): Promise<DecisionProviderResult>;
}

export interface NineRouterDecisionProvider extends DecisionAiProvider {}

class RequestTimeoutError extends Error {}
const NINE_ROUTER_DONE_TRAILER = /\s*data: \[DONE\]\s*$/;

function httpFailure(status: number): AiUnavailableErrorCode {
  if (status === 429) return "RATE_LIMITED";
  if (status === 404) return "MODEL_UNAVAILABLE";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "HTTP_ERROR";
}

export function createNineRouterDecisionProvider(
  config: BaselineAiConfig,
  dependencies: { readonly fetch?: typeof globalThis.fetch } = {},
): NineRouterDecisionProvider {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  return {
    async recommend(input, requestedModel) {
      const parsedInput = BaselineAiInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return { status: "FAILURE", errorCode: "INVALID_RESPONSE" };
      }
      const frozenContextValidation = validateFrozenDecisionContext({
        context: parsedInput.data.decisionContextSnapshot,
        metrics: parsedInput.data.metricsSnapshot,
        finance: parsedInput.data.financeSnapshot,
        coverage: parsedInput.data.coverageSnapshot,
        risk: parsedInput.data.riskSnapshot,
        ruleDecision: parsedInput.data.ruleDecision,
        ruleTriggers: parsedInput.data.ruleTriggers,
      });
      if (!frozenContextValidation.valid) {
        return { status: "FAILURE", errorCode: "INVALID_RESPONSE" };
      }
      const controller = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new RequestTimeoutError("9Router request timed out"));
        }, config.timeoutMs);
      });
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.authMode === "BEARER" && config.apiKey !== undefined) {
        headers.authorization = `Bearer ${config.apiKey}`;
      }

      let response: Response;
      try {
        response = await Promise.race([
          fetchImpl(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            redirect: "error",
            body: JSON.stringify({
              model: requestedModel,
              temperature: 0,
              response_format: { type: "json_object" },
              messages: buildDecisionAiMessages(parsedInput.data),
            }),
            signal: controller.signal,
          }),
          timeout,
        ]);
      } catch (error) {
        return {
          status: "FAILURE",
          errorCode: error instanceof RequestTimeoutError ? "TIMEOUT" : "NETWORK_ERROR",
        };
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
      if (!response.ok) return { status: "FAILURE", errorCode: httpFailure(response.status) };

      try {
        const responseText = await response.text();
        const envelope = ChatCompletionEnvelopeSchema.parse(JSON.parse(
          responseText.replace(NINE_ROUTER_DONE_TRAILER, ""),
        ));
        const decoded = JSON.parse(envelope.choices[0]!.message.content) as unknown;
        return {
          status: "SUCCESS",
          reportedModel: envelope.model,
          output: BaselineAiOutputSchema.parse(decoded),
        };
      } catch {
        return { status: "FAILURE", errorCode: "INVALID_RESPONSE" };
      }
    },
  };
}
