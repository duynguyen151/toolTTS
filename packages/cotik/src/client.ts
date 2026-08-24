import { z } from "zod";

const BASE_URL = "https://cotik.app/api";
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const tokenLanes = new Map<string, Promise<void>>();

const CotikEnvelopeSchema = z.object({
  status: z.number(),
  data: z.unknown().optional(),
  message: z.string().optional(),
});

export type CotikClientErrorCode =
  | "MALFORMED_RESPONSE"
  | "NETWORK"
  | "PERMANENT"
  | "TIMEOUT"
  | "TRANSIENT";

function redact(value: string): string {
  return value.replace(/(?:al-token|token)=?[^\s,]*/gi, "[REDACTED]");
}

export class CotikClientError extends Error {
  readonly code: CotikClientErrorCode;
  readonly httpStatus: number | null;
  readonly applicationStatus: number | null;

  constructor(
    code: CotikClientErrorCode,
    message: string,
    details: { httpStatus?: number; applicationStatus?: number } = {},
  ) {
    super(redact(message));
    this.name = "CotikClientError";
    this.code = code;
    this.httpStatus = details.httpStatus ?? null;
    this.applicationStatus = details.applicationStatus ?? null;
  }
}

export interface CotikClientOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly timeoutMs?: number;
}

export interface CotikClient {
  get<T = unknown>(path: string, dataSchema?: z.ZodType<T>): Promise<T>;
}

function retryDelay(response: Response, applicationStatus: number | null, attempt: number): number | null {
  if (response.status === 429 || applicationStatus === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    return Number.isFinite(retryAfter) && retryAfter >= 0
      ? retryAfter * 1_000
      : RETRY_DELAYS_MS[attempt]!;
  }
  return response.status >= 500 || (applicationStatus !== null && applicationStatus >= 500)
    ? RETRY_DELAYS_MS[attempt]!
    : null;
}

async function timedFetch(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  token: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetchImpl(url, {
      method: "GET",
      headers: { "al-token": token },
      signal: controller.signal,
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CotikClientError("TIMEOUT", "COTIK request timed out"));
      }, Math.max(timeoutMs, 0));
    });
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (error instanceof CotikClientError) throw error;
    if (controller.signal.aborted) throw new CotikClientError("TIMEOUT", "COTIK request timed out");
    throw new CotikClientError("NETWORK", "COTIK request failed");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createCotikClient(options: CotikClientOptions): CotikClient {
  if (!options.token.trim()) throw new CotikClientError("PERMANENT", "COTIK token is required");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function request<T>(path: string, dataSchema?: z.ZodType<T>): Promise<T> {
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    for (let attempt = 0; ; attempt += 1) {
      const response = await timedFetch(fetchImpl, url, options.token, timeoutMs);
      let envelope: z.infer<typeof CotikEnvelopeSchema>;
      try {
        envelope = CotikEnvelopeSchema.parse(await response.json());
      } catch {
        throw new CotikClientError("MALFORMED_RESPONSE", "COTIK returned a malformed envelope", {
          httpStatus: response.status,
        });
      }
      const applicationStatus = envelope.status;
      if (response.ok && applicationStatus === 200) {
        try {
          return dataSchema ? dataSchema.parse(envelope.data) : envelope.data as T;
        } catch {
          throw new CotikClientError("MALFORMED_RESPONSE", "COTIK returned invalid data", {
            httpStatus: response.status,
            applicationStatus,
          });
        }
      }
      const delay = retryDelay(response, applicationStatus, attempt);
      if (delay !== null && attempt < RETRY_DELAYS_MS.length) {
        await sleep(delay);
        continue;
      }
      throw new CotikClientError(delay === null ? "PERMANENT" : "TRANSIENT", "COTIK request was rejected", {
        httpStatus: response.status,
        applicationStatus,
      });
    }
  }

  return {
    get<T>(path: string, dataSchema?: z.ZodType<T>): Promise<T> {
      const previous = tokenLanes.get(options.token) ?? Promise.resolve();
      const next = previous.then(() => request(path, dataSchema));
      const settled = next.then(() => undefined, () => undefined);
      tokenLanes.set(options.token, settled);
      void settled.finally(() => {
        if (tokenLanes.get(options.token) === settled) tokenLanes.delete(options.token);
      });
      return next;
    },
  };
}
