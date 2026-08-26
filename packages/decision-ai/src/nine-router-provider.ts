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

const NINE_ROUTER_DONE_TRAILER = /\s*data: \[DONE\]\s*$/;

export function parseChatCompletionEnvelope(value: string): { model: string; content: string } {
  const responseText = value.replace(NINE_ROUTER_DONE_TRAILER, "");
  const envelope = ChatCompletionEnvelopeSchema.parse(JSON.parse(responseText));
  return {
    model: envelope.model,
    content: envelope.choices[0]!.message.content,
  };
}

export type DecisionProviderResult =
  | { readonly status: "SUCCESS"; readonly reportedModel: string; readonly output: BaselineAiOutput }
  | { readonly status: "FAILURE"; readonly errorCode: AiUnavailableErrorCode };

export interface DecisionAiProvider {
  recommend(input: BaselineAiInput, requestedModel: string): Promise<DecisionProviderResult>;
}

export interface NineRouterDecisionProvider extends DecisionAiProvider {}

export const MAX_RESPONSE_BODY_BYTES = 1_048_576;

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export class ResponseBodyTooLargeError extends Error {
  constructor() {
    super("Provider response body exceeds the maximum size");
    this.name = "ResponseBodyTooLargeError";
  }
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const reader = response.body?.getReader?.();
  if (reader !== undefined) {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = chunk.value;
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The overflow is the useful error even if cancellation fails.
        }
        throw new ResponseBodyTooLargeError();
      }
      chunks.push(bytes);
    }
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BODY_BYTES) {
    throw new ResponseBodyTooLargeError();
  }
  return text;
}

export async function fetchResponseBody(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ readonly response: Response; readonly body: string | null }> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError("Provider request timed out"));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
    if (!response.ok) return { response, body: null };
    return { response, body: await Promise.race([readBoundedResponseBody(response), timeout]) };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

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
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.authMode === "BEARER" && config.apiKey !== undefined) {
        headers.authorization = `Bearer ${config.apiKey}`;
      }

      let response: Response;
      let body: string | null;
      try {
        ({ response, body } = await fetchResponseBody(fetchImpl, `${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify({
            model: requestedModel,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: buildDecisionAiMessages(parsedInput.data),
          }),
        }, config.timeoutMs));
      } catch (error) {
        return {
          status: "FAILURE",
          errorCode: error instanceof RequestTimeoutError
            ? "TIMEOUT"
            : error instanceof ResponseBodyTooLargeError ? "INVALID_RESPONSE" : "NETWORK_ERROR",
        };
      }
      if (!response.ok) return { status: "FAILURE", errorCode: httpFailure(response.status) };
      if (body === null) return { status: "FAILURE", errorCode: "INVALID_RESPONSE" };

      try {
        const envelope = parseChatCompletionEnvelope(body);
        const decoded = JSON.parse(envelope.content) as unknown;
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
