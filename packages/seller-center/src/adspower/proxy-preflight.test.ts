import { describe, expect, it } from "vitest";

import { createAdsPowerProxyPreflight } from "./proxy-preflight.js";

const secret = "proxy-password-never-returned";

function clock(...values: number[]): () => number {
  return () => values.shift() ?? 0;
}

describe("AdsPower observable proxy preflight", () => {
  it("returns a healthy result only from a safe observed result", async () => {
    const preflight = createAdsPowerProxyPreflight({
      now: clock(100, 142),
      observationSource: {
        observe: async () => ({ status: "HEALTHY", exitIp: "8.8.8.8", proxyPassword: secret }),
      },
    });

    await expect(preflight.preflight({ profileId: "profile-1" })).resolves.toEqual({
      status: "HEALTHY",
      latencyMs: 42,
      exitIp: "8.8.8.8",
      reasonClass: "OBSERVED_HEALTHY",
    });
  });

  it("classifies a slow healthy observation as degraded", async () => {
    const preflight = createAdsPowerProxyPreflight({
      degradedLatencyMs: 25,
      now: clock(100, 126),
      observationSource: { observe: async () => ({ status: "HEALTHY" }) },
    });

    await expect(preflight.preflight({ profileId: "profile-1" })).resolves.toEqual({
      status: "DEGRADED",
      latencyMs: 26,
      exitIp: null,
      reasonClass: "OBSERVED_SLOW",
    });
  });

  it("returns observed unavailable without retaining an exit IP", async () => {
    const preflight = createAdsPowerProxyPreflight({
      now: clock(100, 102),
      observationSource: { observe: async () => ({ status: "UNAVAILABLE", exitIp: "8.8.8.8" }) },
    });

    await expect(preflight.preflight({ profileId: "profile-1" })).resolves.toEqual({
      status: "UNAVAILABLE",
      latencyMs: 2,
      exitIp: null,
      reasonClass: "OBSERVED_UNAVAILABLE",
    });
  });

  it("returns unknown after the read-only Local API readiness response lacks proxy health material", async () => {
    const urls: string[] = [];
    const preflight = createAdsPowerProxyPreflight({
      now: clock(100, 101),
      fetch: async (input) => {
        urls.push(new URL(String(input)).pathname);
        return new Response(JSON.stringify({ code: 0, data: { version: "private" } }));
      },
      apiKey: secret,
    });

    const result = await preflight.preflight({ profileId: "profile-1" });

    expect(result).toEqual({
      status: "UNKNOWN",
      latencyMs: 1,
      exitIp: null,
      reasonClass: "OBSERVATION_UNAVAILABLE",
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("/status");
    expect(urls[0]).not.toContain("/browser/");
    expect(urls[0]).not.toContain("cdp");
  });

  it("treats a rejected Local API envelope as unavailable without using its message", async () => {
    const preflight = createAdsPowerProxyPreflight({
      now: clock(100, 101),
      fetch: async () => new Response(JSON.stringify({ code: -1, msg: secret })),
    });

    await expect(preflight.preflight({ profileId: "profile-1" })).resolves.toEqual({
      status: "UNAVAILABLE",
      latencyMs: 1,
      exitIp: null,
      reasonClass: "HTTP_REJECTED",
    });
  });

  it.each([
    [401, "AUTH_REJECTED"],
    [403, "AUTH_REJECTED"],
    [503, "HTTP_REJECTED"],
  ] as const)("sanitizes Local API HTTP %i as %s", async (httpStatus, reasonClass) => {
    const preflight = createAdsPowerProxyPreflight({
      now: clock(100, 101),
      fetch: async () => new Response(secret, { status: httpStatus }),
    });

    const result = await preflight.preflight({ profileId: "profile-1" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      latencyMs: 1,
      exitIp: null,
      reasonClass,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("bounds a stalled observation and returns a timeout class", async () => {
    const preflight = createAdsPowerProxyPreflight({
      timeoutMs: 20,
      observationSource: { observe: async () => new Promise<unknown>(() => undefined) },
    });

    const result = await Promise.race([
      preflight.preflight({ profileId: "profile-1" }),
      new Promise<"TEST_TIMEOUT">((resolve) => setTimeout(() => resolve("TEST_TIMEOUT"), 100)),
    ]);

    expect(result).toMatchObject({ status: "UNAVAILABLE", reasonClass: "REQUEST_TIMEOUT" });
  });

  it("classifies an aborted Local API fetch as timeout rather than network outage", async () => {
    const preflight = createAdsPowerProxyPreflight({
      timeoutMs: 20,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("secret abort detail")), { once: true });
      }),
    });

    await expect(preflight.preflight({ profileId: "profile-1" })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      reasonClass: "REQUEST_TIMEOUT",
    });
  });

  it("maps network outage to a secret-free unavailable result", async () => {
    const preflight = createAdsPowerProxyPreflight({
      now: clock(100, 101),
      observationSource: {
        observe: async () => { throw new Error(`http://private.proxy/?token=${secret}`); },
      },
    });

    const result = await preflight.preflight({ profileId: "profile-1" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      latencyMs: 1,
      exitIp: null,
      reasonClass: "NETWORK_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("private.proxy");
  });

  it.each([
    ["10.0.0.1", null],
    ["127.0.0.1", null],
    ["198.51.100.10", null],
    ["2001:db8::1", null],
    ["2001:4860:4860::8888", null],
  ])("allows only public exit IPs: %s", async (observedIp, expectedExitIp) => {
    const preflight = createAdsPowerProxyPreflight({
      now: clock(100, 101),
      observationSource: { observe: async () => ({ status: "HEALTHY", exitIp: observedIp }) },
    });

    await expect(preflight.preflight({ profileId: "profile-1" })).resolves.toMatchObject({
      status: "HEALTHY",
      exitIp: expectedExitIp,
    });
  });
});
