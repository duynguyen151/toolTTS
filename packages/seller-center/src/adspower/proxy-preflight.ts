import { performance } from "node:perf_hooks";

import {
  ProxyPreflightInputSchema,
  ProxyPreflightResultSchema,
  type ProxyPreflight,
  type ProxyPreflightInput,
  type ProxyPreflightResult,
} from "@shop-health/domain";
import { z } from "zod";

const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_DEGRADED_LATENCY_MS = 1_000;

const ObservationSchema = z.object({
  status: z.enum(["HEALTHY", "UNAVAILABLE"]),
  exitIp: z.string().optional(),
});

const ReadinessSchema = z.object({ code: z.literal(0) });

class PreflightFailure extends Error {
  constructor(readonly reasonClass: "AUTH_REJECTED" | "HTTP_REJECTED" | "NETWORK_UNAVAILABLE") {
    super(reasonClass);
  }
}

export interface ProxyPreflightObservationSource {
  observe(input: ProxyPreflightInput, options: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface AdsPowerProxyPreflightOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly degradedLatencyMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly observationSource?: ProxyPreflightObservationSource;
}

export function createAdsPowerProxyPreflight(
  options: AdsPowerProxyPreflightOptions = {},
): ProxyPreflight {
  const timeoutMs = boundedMilliseconds(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const degradedLatencyMs = boundedMilliseconds(options.degradedLatencyMs, DEFAULT_DEGRADED_LATENCY_MS);
  const now = options.now ?? performance.now.bind(performance);
  const observationSource = options.observationSource ?? createReadinessObservationSource(options);

  return {
    async preflight(input: ProxyPreflightInput): Promise<ProxyPreflightResult> {
      const parsed = ProxyPreflightInputSchema.parse(input);
      const startedAt = now();
      try {
        const observed = await withDeadline(
          observationSource.observe(parsed, { signal: AbortSignal.timeout(timeoutMs) }),
          timeoutMs,
        );
        const latencyMs = elapsedMilliseconds(startedAt, now(), timeoutMs);
        if (observed === undefined) {
          return result({ status: "UNKNOWN", latencyMs, exitIp: null, reasonClass: "OBSERVATION_UNAVAILABLE" });
        }
        const safe = ObservationSchema.safeParse(observed);
        if (!safe.success) {
          return result({ status: "UNKNOWN", latencyMs, exitIp: null, reasonClass: "OBSERVATION_UNAVAILABLE" });
        }
        if (safe.data.status === "UNAVAILABLE") {
          return result({ status: "UNAVAILABLE", latencyMs, exitIp: null, reasonClass: "OBSERVED_UNAVAILABLE" });
        }
        const exitIp = sanitizeExitIp(safe.data.exitIp);
        return latencyMs > degradedLatencyMs
          ? result({ status: "DEGRADED", latencyMs, exitIp, reasonClass: "OBSERVED_SLOW" })
          : result({ status: "HEALTHY", latencyMs, exitIp, reasonClass: "OBSERVED_HEALTHY" });
      } catch (error) {
        const latencyMs = elapsedMilliseconds(startedAt, now(), timeoutMs);
        if (error instanceof TimeoutError) {
          return result({ status: "UNAVAILABLE", latencyMs, exitIp: null, reasonClass: "REQUEST_TIMEOUT" });
        }
        if (error instanceof PreflightFailure) {
          return result({ status: "UNAVAILABLE", latencyMs, exitIp: null, reasonClass: error.reasonClass });
        }
        return result({ status: "UNAVAILABLE", latencyMs, exitIp: null, reasonClass: "NETWORK_UNAVAILABLE" });
      }
    },
  };
}

function createReadinessObservationSource(options: AdsPowerProxyPreflightOptions): ProxyPreflightObservationSource {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:50325").replace(/\/$/, "");
  const apiKey = options.apiKey?.trim() || undefined;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async observe(_input, request): Promise<undefined> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/status`, {
          signal: request.signal,
          ...(apiKey === undefined ? {} : { headers: { authorization: `Bearer ${apiKey}` } }),
        });
      } catch {
        if (request.signal.aborted) throw new TimeoutError();
        throw new PreflightFailure("NETWORK_UNAVAILABLE");
      }
      if (!response.ok) {
        throw new PreflightFailure(response.status === 401 || response.status === 403 ? "AUTH_REJECTED" : "HTTP_REJECTED");
      }
      try {
        ReadinessSchema.parse(await response.json());
      } catch {
        throw new PreflightFailure("HTTP_REJECTED");
      }
      // AdsPower documents this endpoint only as Local API readiness, not proxy health.
      return undefined;
    },
  };
}

function boundedMilliseconds(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.floor(value)));
}

function elapsedMilliseconds(startedAt: number, finishedAt: number, timeoutMs: number): number {
  return Math.min(timeoutMs, Math.max(0, Math.ceil(finishedAt - startedAt)));
}

function sanitizeExitIp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = ProxyPreflightResultSchema.safeParse({
    status: "HEALTHY",
    latencyMs: 0,
    exitIp: value,
    reasonClass: "OBSERVED_HEALTHY",
  });
  return parsed.success ? parsed.data.exitIp : null;
}

function result(value: ProxyPreflightResult): ProxyPreflightResult {
  return ProxyPreflightResultSchema.parse(value);
}

class TimeoutError extends Error {}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
