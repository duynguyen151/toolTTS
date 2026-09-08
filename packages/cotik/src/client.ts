import { z } from "zod";

const BASE_URL = "https://cotik.app/api";
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const tokenLanes = new Map<string, TokenLane>();
const SECOND_LIMIT = 2;
const MINUTE_LIMIT = 60;
const SECOND_WINDOW_MS = 1_000;
const MINUTE_WINDOW_MS = 60_000;

interface TokenLane {
  tail: Promise<void>;
  requestTimes: number[];
}

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
  readonly applicationMessage: string | null;

  constructor(
    code: CotikClientErrorCode,
    message: string,
    details: { httpStatus?: number; applicationStatus?: number; applicationMessage?: string | null } = {},
  ) {
    super(redact(message));
    this.name = "CotikClientError";
    this.code = code;
    this.httpStatus = details.httpStatus ?? null;
    this.applicationStatus = details.applicationStatus ?? null;
    this.applicationMessage = details.applicationMessage ?? null;
  }
}

export interface CotikClientOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly beforePost?: () => Promise<void>;
}

export interface CotikClient {
  get<T = unknown>(path: string, dataSchema?: z.ZodType<T>): Promise<T>;
  post?<T = unknown>(path: string, body: unknown, dataSchema?: z.ZodType<T>): Promise<T>;
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
  method = "GET",
  body?: unknown
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const headers: Record<string, string> = { "al-token": token };
    let reqBody: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      reqBody = typeof body === "string" ? body : JSON.stringify(body);
    }
    const request = fetchImpl(url, {
      method,
      headers,
      ...(reqBody !== undefined ? { body: reqBody } : {}),
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

function waitForTokenRequestSlot(
  lane: TokenLane,
  now: () => number,
  sleep: (durationMs: number) => Promise<void>,
): Promise<void> | undefined {
  const currentTime = now();
  lane.requestTimes = lane.requestTimes.filter(
    (requestTime) => requestTime <= currentTime && requestTime > currentTime - MINUTE_WINDOW_MS,
  );
  const secondWindow = lane.requestTimes.filter((requestTime) => requestTime > currentTime - SECOND_WINDOW_MS);
  const minuteDelay = lane.requestTimes.length >= MINUTE_LIMIT
    ? lane.requestTimes[0]! + MINUTE_WINDOW_MS - currentTime
    : 0;
  const secondDelay = secondWindow.length >= SECOND_LIMIT
    ? secondWindow[0]! + SECOND_WINDOW_MS - currentTime
    : 0;
  const delay = Math.max(minuteDelay, secondDelay);
  if (delay <= 0) {
    lane.requestTimes.push(currentTime);
    return undefined;
  }
  return sleep(delay).then(() => {
    const next = waitForTokenRequestSlot(lane, now, sleep);
    return next ?? Promise.resolve();
  });
}

export function createCotikClient(options: CotikClientOptions): CotikClient {
  if (!options.token.trim()) throw new CotikClientError("PERMANENT", "COTIK token is required");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const now = options.now ?? (() => Date.now());
  const baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function request<T>(path: string, method = "GET", body?: unknown, dataSchema?: z.ZodType<T>): Promise<T> {
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    for (let attempt = 0; ; attempt += 1) {
      const lane = tokenLanes.get(options.token);
      if (!lane) throw new Error("COTIK token lane is missing");
      const slotWait = waitForTokenRequestSlot(lane, now, sleep);
      if (slotWait) await slotWait;
      if (method === "POST") await options.beforePost?.();
      const response = await timedFetch(fetchImpl, url, options.token, timeoutMs, method, body);
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
      if (method === "POST") {
        throw new CotikClientError(delay === null ? "PERMANENT" : "TRANSIENT", "COTIK request was rejected", {
          httpStatus: response.status,
          applicationStatus,
          applicationMessage: envelope.message ?? null,
        });
      }
      if (delay !== null && attempt < RETRY_DELAYS_MS.length) {
        await sleep(delay);
        continue;
      }
      throw new CotikClientError(delay === null ? "PERMANENT" : "TRANSIENT", "COTIK request was rejected", {
        httpStatus: response.status,
        applicationStatus,
        applicationMessage: envelope.message ?? null,
      });
    }
  }

  return {
    get<T>(path: string, dataSchema?: z.ZodType<T>): Promise<T> {
      const lane = tokenLanes.get(options.token) ?? { tail: Promise.resolve(), requestTimes: [] };
      tokenLanes.set(options.token, lane);
      const next = lane.tail.then(() => request<T>(path, "GET", undefined, dataSchema));
      const settled = next.then(() => undefined, () => undefined);
      lane.tail = settled;
      return next;
    },
    post<T>(path: string, body: unknown, dataSchema?: z.ZodType<T>): Promise<T> {
      const lane = tokenLanes.get(options.token) ?? { tail: Promise.resolve(), requestTimes: [] };
      tokenLanes.set(options.token, lane);
      const next = lane.tail.then(() => request<T>(path, "POST", body, dataSchema));
      const settled = next.then(() => undefined, () => undefined);
      lane.tail = settled;
      return next;
    },
  };
}
