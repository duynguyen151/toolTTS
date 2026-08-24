import { describe, expect, it, vi } from "vitest";

import { createCotikClient, CotikClientError } from "./client.js";

const token = "cotik-token-should-never-appear";
const success = { status: 200, data: { items: [] } };

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function client(fetchImpl: typeof fetch, options: Partial<Parameters<typeof createCotikClient>[0]> = {}) {
  return createCotikClient({ token, timeoutMs: 100, fetch: fetchImpl, sleep: async () => undefined, ...options });
}

describe("COTIK read client", () => {
  it("sends the server-side token and returns validated successful envelope data", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(success));

    await expect(client(fetchImpl).get("/order/list")).resolves.toEqual({ items: [] });
    expect(fetchImpl).toHaveBeenCalledWith("https://cotik.app/api/order/list", expect.objectContaining({
      method: "GET",
      headers: { "al-token": token },
    }));
  });

  it("rejects a business error returned under HTTP 200", async () => {
    await expect(client(async () => response({ status: 400, message: "invalid request" })).get("/order/list"))
      .rejects.toMatchObject({ code: "PERMANENT", httpStatus: 200, applicationStatus: 400 });
  });

  it.each([
    ["HTTP", () => response({ status: 429, message: "busy" }, 429, { "retry-after": "2" }), 2000],
    ["body", () => response({ status: 429, message: "busy" }), 1000],
  ])("retries a %s 429 using Retry-After or backoff", async (_kind, nextResponse, expectedDelay) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(nextResponse())
      .mockResolvedValueOnce(response(success));
    const sleep = vi.fn(async () => undefined);

    await expect(createCotikClient({ token, fetch: fetchImpl, sleep }).get("/order/list")).resolves.toEqual({ items: [] });
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
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response({ status: 503, message: "busy" }, 503));
    const sleep = vi.fn(async () => undefined);

    await expect(createCotikClient({ token, fetch: fetchImpl, sleep }).get("/order/list"))
      .rejects.toMatchObject({ code: "TRANSIENT", httpStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
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
    const firstClient = client(fetchImpl);
    const secondClient = client(fetchImpl);

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
