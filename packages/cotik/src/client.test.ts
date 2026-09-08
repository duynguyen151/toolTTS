import { describe, expect, it, vi } from "vitest";

import { createCotikClient, CotikClientError } from "./client.js";

const token = "cotik-token-should-never-appear";
const success = { status: 200, data: { items: [] } };
let nextTestToken = 0;

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function client(fetchImpl: typeof fetch, options: Partial<Parameters<typeof createCotikClient>[0]> = {}) {
  return createCotikClient({ token: options.token ?? `test-token-${nextTestToken++}`, timeoutMs: 100, fetch: fetchImpl, sleep: async () => undefined, ...options });
}

describe("COTIK read client", () => {
  it("sends the server-side token and returns validated successful envelope data", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response(success));

    await expect(client(fetchImpl, { token }).get("/order/list")).resolves.toEqual({ items: [] });
    expect(fetchImpl).toHaveBeenCalledWith("https://cotik.app/api/order/list", expect.objectContaining({
      method: "GET",
      headers: { "al-token": token },
    }));
  });

  it("rejects a business error returned under HTTP 200", async () => {
    await expect(client(async () => response({ status: 400, message: "invalid request" })).get("/order/list"))
      .rejects.toMatchObject({ code: "PERMANENT", httpStatus: 200, applicationStatus: 400 });
  });

  it("does not retry a POST after a transient response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ status: 503, message: "busy" }));

    await expect(client(fetchImpl).post!("/order/import-tracking-v2", { items: [] }))
      .rejects.toMatchObject({
        code: "TRANSIENT",
        httpStatus: 200,
        applicationStatus: 503,
        message: "COTIK request was rejected"
      });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("runs beforePost after pacing and blocks a disabled POST before transport", async () => {
    let now = 0;
    let killSwitchEnabled = true;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response(success));
    const hookTimes: number[] = [];
    const beforePost = vi.fn(async () => {
      hookTimes.push(now);
      if (!killSwitchEnabled) throw new Error("Cotik POST kill switch is disabled");
    });
    const cotik = createCotikClient({
      token: "before-post-token",
      fetch: fetchImpl,
      sleep: async (durationMs) => { now += durationMs; },
      now: () => now,
      beforePost
    });

    await Promise.all([cotik.get("/first"), cotik.get("/second")]);
    killSwitchEnabled = false;
    await expect(cotik.post!("/order/import-tracking-v2", { items: [] })).rejects.toThrow("kill switch");

    expect(hookTimes).toEqual([1_000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["HTTP", () => response({ status: 429, message: "busy" }, 429, { "retry-after": "2" }), 2000],
    ["body", () => response({ status: 429, message: "busy" }), 1000],
  ])("retries a %s 429 using Retry-After or backoff", async (_kind, nextResponse, expectedDelay) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(nextResponse())
      .mockResolvedValueOnce(response(success));
    const sleep = vi.fn(async () => undefined);

    await expect(createCotikClient({ token: "retry-http-token", fetch: fetchImpl, sleep }).get("/order/list")).resolves.toEqual({ items: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(expectedDelay);
  });

  it("rejects a malformed envelope", async () => {
    await expect(client(async () => response({ data: {} })).get("/order/list"))
      .rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("turns an aborted request into a timeout without leaking the token", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    const value = client(fetchImpl, { timeoutMs: 0 }).get("/order/list");

    await expect(value).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(value.catch((error: unknown) => String(error))).resolves.not.toContain(token);
  });

  it("stops after three retries on transient failures", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response({ status: 503, message: "busy" }, 503));
    const sleep = vi.fn(async (durationMs: number) => { now += durationMs; });

    await expect(createCotikClient({ token: "retry-transient-token", fetch: fetchImpl, sleep, now: () => now }).get("/order/list"))
      .rejects.toMatchObject({ code: "TRANSIENT", httpStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  it("enforces both per-second and per-minute limits for concurrent callers", async () => {
    let now = 0;
    const requestTimes: number[] = [];
    const sleep = vi.fn(async (durationMs: number) => { now += durationMs; });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      requestTimes.push(now);
      return response(success);
    });
    const cotik = createCotikClient({ token: "rate-limit-token", fetch: fetchImpl, sleep, now: () => now });

    await Promise.all(Array.from({ length: 61 }, (_, index) => cotik.get(`/order/${index}`)));

    expect(requestTimes).toHaveLength(61);
    expect(requestTimes[0]).toBe(0);
    expect(requestTimes[1]).toBe(0);
    expect(requestTimes[2]).toBe(1000);
    expect(requestTimes[59]).toBe(29_000);
    expect(requestTimes[60]).toBe(60_000);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep).toHaveBeenCalledWith(31_000);
  });

  it("counts GET retry attempts as requests in the token lane", async () => {
    let now = 0;
    const requestTimes: number[] = [];
    const sleep = vi.fn(async (durationMs: number) => { now += durationMs; });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      requestTimes.push(now);
      return requestTimes.length === 1
        ? response({ status: 429, message: "busy" }, 429, { "retry-after": "1" })
        : response(success);
    });
    const cotik = createCotikClient({ token: "retry-rate-limit-token", fetch: fetchImpl, sleep, now: () => now });

    await Promise.all([cotik.get("/first"), cotik.get("/second")]);

    expect(requestTimes).toEqual([0, 1_000, 1_000]);
  });

  it("serializes requests sharing a token", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<Response>((resolve) => { releaseFirst = () => resolve(response(success)); });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => firstPending)
      .mockResolvedValueOnce(response(success));
    const cotik = client(fetchImpl);

    const first = cotik.get("/order/list");
    const second = cotik.get("/statements/");
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    releaseFirst!();
    await expect(Promise.all([first, second])).resolves.toEqual([{ items: [] }, { items: [] }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serializes requests from separate clients sharing a token", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<Response>((resolve) => { releaseFirst = () => resolve(response(success)); });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => firstPending)
      .mockResolvedValueOnce(response(success));
    const firstClient = client(fetchImpl, { token: "shared-token" });
    const secondClient = client(fetchImpl, { token: "shared-token" });

    const first = firstClient.get("/order/list");
    const second = secondClient.get("/statements/");
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    releaseFirst!();
    await expect(Promise.all([first, second])).resolves.toEqual([{ items: [] }, { items: [] }]);
  });

  it("redacts tokens from typed error messages", () => {
    expect(String(new CotikClientError("NETWORK", `failed with ${token}`))).not.toContain(token);
  });
});
