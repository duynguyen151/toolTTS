import { describe, expect, it } from "vitest";

import { AdsPowerClient } from "./client.js";

describe("AdsPowerClient", () => {
  it("uses an already active profile without starting it", async () => {
    const urls: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({
        code: 0,
        msg: "success",
        data: { status: "Active", ws: { puppeteer: "ws://127.0.0.1:1234/devtools/browser/test" } },
      }), { headers: { "content-type": "application/json" } });
    };

    const client = new AdsPowerClient({ fetch: fetchMock, apiKey: "secret" });
    const result = await client.open("profile-1");

    expect(result.status).toBe("Active");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/api/v1/browser/active");
    expect(urls[0]).toContain("user_id=profile-1");
  });

  it("lists every profile while stripping private AdsPower fields", async () => {
    const urls: string[] = [];
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      user_id: `profile-${index + 1}`,
      serial_number: String(index + 1),
      group_name: index === 0 ? "Operators" : "",
      name: `Private profile ${index + 1}`,
      username: "private@example.com",
      password: "secret",
      user_proxy_config: { proxy_host: "private.proxy" },
    }));
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/v1/user/list")) {
        const page = new URL(url).searchParams.get("page");
        const list = page === "1"
          ? firstPage
          : [{
              user_id: "profile-201",
              serial_number: 201,
              group_name: null,
              name: "Private final profile",
              username: "private-final@example.com",
              password: "secret-final",
            }];
        return new Response(JSON.stringify({ code: 0, data: { list } }));
      }
      return new Response(JSON.stringify({
        code: 0,
        data: { list: [{ user_id: "profile-1", ws: { puppeteer: "ws://private" } }] },
      }));
    };

    const profiles = await new AdsPowerClient({ fetch: fetchMock }).listProfiles();

    expect(profiles).toHaveLength(201);
    expect(profiles[0]).toEqual({
      profileId: "profile-1",
      profileNo: "1",
      groupName: "Operators",
      state: "OPEN",
    });
    expect(profiles[200]).toEqual({
      profileId: "profile-201",
      profileNo: "201",
      groupName: null,
      state: "CLOSED",
    });
    expect(profiles[200]).not.toHaveProperty("observedStatus");
    expect(Object.keys(profiles[200] ?? {}).sort()).toEqual([
      "groupName",
      "profileId",
      "profileNo",
      "state",
    ]);
    expect(Object.keys(profiles[0] ?? {}).sort()).toEqual([
      "groupName",
      "profileId",
      "profileNo",
      "state",
    ]);
    expect(urls.filter((url) => url.includes("/api/v1/user/list"))).toHaveLength(2);
    expect(urls[0]).toContain("page_size=200");
  });

  it("reuses a fresh profile inventory instead of immediately hitting the rate-limited Local API", async () => {
    const urls: string[] = [];
    const client = new AdsPowerClient({
      fetch: async (input) => {
        urls.push(String(input));
        const path = new URL(String(input)).pathname;
        return new Response(JSON.stringify(path.endsWith("/user/list")
          ? { code: 0, data: { list: [{ user_id: "profile-1", serial_number: "957" }] } }
          : { code: 0, data: { list: [] } }),
        );
      },
    });

    await client.listProfiles();
    await client.listProfiles();

    expect(urls.filter((url) => url.includes("/user/list"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("/browser/local-active"))).toHaveLength(1);
  });

  it("marks profiles as error when active state cannot be verified", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      return new Response(JSON.stringify(path.endsWith("/user/list")
        ? { code: 0, data: { list: [{ user_id: "profile-1", serial_number: "957" }] } }
        : { code: -1, msg: "runtime unavailable" }));
    };

    const profiles = await new AdsPowerClient({ fetch: fetchMock }).listProfiles();

    expect(profiles).toEqual([{
      profileId: "profile-1",
      profileNo: "957",
      groupName: null,
      state: "ERROR",
    }]);
  });

  it("waits until a newly opened profile exposes its connection", async () => {
    let activePoll = 0;
    const urls: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      urls.push(String(input));
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/browser/start")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "Active" } }));
      }
      activePoll += 1;
      return new Response(JSON.stringify(activePoll < 3
        ? { code: 0, data: { status: activePoll === 1 ? "Inactive" : "Active" } }
        : {
            code: 0,
            data: { status: "Active", ws: { puppeteer: "ws://127.0.0.1:1234/ready" } },
          }));
    };

    const result = await new AdsPowerClient({ fetch: fetchMock }).openReady("profile-1", {
      readyTimeoutMs: 100,
      pollIntervalMs: 0,
    });

    expect(result.cdpEndpoint).toBe("ws://127.0.0.1:1234/ready");
    expect(activePoll).toBe(3);
    expect(urls.find((url) => url.includes("/browser/start"))).toContain("password_filling=1");
  });

  it("maps a ready deadline to the existing source timeout taxonomy", async () => {
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify({
      code: 0,
      data: { status: "Inactive" },
    }));

    await expect(new AdsPowerClient({ fetch: fetchMock }).openReady("profile-1", {
      readyTimeoutMs: 0,
      pollIntervalMs: 0,
    })).rejects.toMatchObject({ failureType: "SOURCE_TIMEOUT" });
  });

  it("bounds an active-profile request by the profile-ready deadline", async () => {
    const client = new AdsPowerClient({
      fetch: async () => new Promise<Response>(() => undefined),
      timeoutMs: 1_000,
    });

    const result = await Promise.race([
      client.openReady("profile-1", { readyTimeoutMs: 20, pollIntervalMs: 0 })
        .then(() => null, (error: unknown) => error),
      new Promise<"TEST_TIMEOUT">((resolve) => setTimeout(() => resolve("TEST_TIMEOUT"), 100)),
    ]);

    expect(result).toMatchObject({ failureType: "SOURCE_TIMEOUT" });
  });

  it("reports an unverifiable active response as an error state", async () => {
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify({ code: 0 }));

    await expect(new AdsPowerClient({ fetch: fetchMock }).getProfileState("profile-1"))
      .resolves.toBe("ERROR");
  });

  it("probes the local AdsPower API without exposing response details", async () => {
    const urls: string[] = [];
    const client = new AdsPowerClient({
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ code: 0, data: { version: "private" } }));
      },
      apiKey: "secret",
    });

    await expect(client.probeReadiness()).resolves.toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/status");
    expect(urls[0]).toContain("api_key=secret");
  });

  it("requires an explicit AdsPower proxy configuration signal without exposing proxy values", async () => {
    const proxyPassword = "proxy-password-secret";
    const capability = async (proxy: unknown) => new AdsPowerClient({
      fetch: async (input) => new Response(JSON.stringify(new URL(String(input)).pathname.endsWith("/user/list")
        ? { code: 0, data: { list: [{ user_id: "profile-1", ...proxy as object }] } }
        : { code: 0, data: { list: [] } }),
      ),
    }).getProxyCapability("profile-1", { timeoutMs: 25 });

    await expect(capability({ user_proxy_config: {} })).resolves.toEqual({
      status: "UNCONFIGURED",
      reasonCode: "PROXY_UNCONFIGURED",
    });
    await expect(capability({ user_proxy_config: { proxy_soft: "" } })).resolves.toEqual({
      status: "UNCONFIGURED",
      reasonCode: "PROXY_UNCONFIGURED",
    });
    await expect(capability({ user_proxy_config: { proxy_soft: "no_proxy" } })).resolves.toEqual({
      status: "UNCONFIGURED",
      reasonCode: "PROXY_UNCONFIGURED",
    });
    await expect(capability({ user_proxy_config: { proxy_soft: "socks5" } })).resolves.toEqual({
      status: "UNAVAILABLE",
      reasonCode: "PROXY_UNKNOWN",
    });
    await expect(capability({ user_proxy_config: { proxy_soft: "other" } })).resolves.toEqual({
      status: "CONFIGURED",
      reasonCode: "PROXY_CONFIGURED",
    });
    await expect(capability({ proxyid: 0 })).resolves.toEqual({
      status: "CONFIGURED",
      reasonCode: "PROXY_CONFIGURED",
    });
    const blankProxyId = await capability({ proxyid: "  " });
    const proxyPasswordResult = await capability({
      user_proxy_config: {
        proxy_soft: "other",
        proxy_host: "private-proxy.example",
        proxy_password: proxyPassword,
      },
    });

    expect(blankProxyId).toEqual({ status: "UNCONFIGURED", reasonCode: "PROXY_UNCONFIGURED" });
    expect(proxyPasswordResult).toEqual({ status: "CONFIGURED", reasonCode: "PROXY_CONFIGURED" });
    expect(JSON.stringify([blankProxyId, proxyPasswordResult])).not.toContain("private-proxy.example");
    expect(JSON.stringify([blankProxyId, proxyPasswordResult])).not.toContain(proxyPassword);
  });

  it("reports a missing profile as unavailable", async () => {
    await expect(new AdsPowerClient({
      fetch: async () => new Response(JSON.stringify({ code: 0, data: { list: [] } })),
    }).getProxyCapability("missing-profile")).resolves.toEqual({
      status: "UNAVAILABLE",
      reasonCode: "ADSPOWER_UNAVAILABLE",
    });
  });

  it("reports unconfigured and unavailable proxy capability through sanitized typed results", async () => {
    const unconfigured = await new AdsPowerClient({
      fetch: async (input) => new Response(JSON.stringify(new URL(String(input)).pathname.endsWith("/user/list")
        ? { code: 0, data: { list: [{ user_id: "profile-1" }] } }
        : { code: 0, data: { list: [] } }),
      ),
    }).getProxyCapability("profile-1", { timeoutMs: 25 });
    const unavailable = await new AdsPowerClient({
      fetch: async () => { throw new Error("http://private-proxy.example/?token=secret-token"); },
    }).getProxyCapability("profile-1", { timeoutMs: 25 });

    expect(unconfigured).toEqual({ status: "UNCONFIGURED", reasonCode: "PROXY_UNCONFIGURED" });
    expect(unavailable).toEqual({ status: "UNAVAILABLE", reasonCode: "ADSPOWER_UNAVAILABLE" });
    expect(JSON.stringify([unconfigured, unavailable])).not.toContain("secret-token");
    expect(JSON.stringify([unconfigured, unavailable])).not.toContain("private-proxy.example");
  });

  it("maps the bounded request timeout to a sanitized capability timeout", async () => {
    const timedOut = await new AdsPowerClient({
      fetch: async () => new Promise<Response>(() => undefined),
    }).getProxyCapability("profile-1", { timeoutMs: 25 });

    expect(timedOut).toEqual({ status: "UNAVAILABLE", reasonCode: "CAPABILITY_TIMEOUT" });
  });

  it("maps explicit AdsPower profile tags to an observed status", async () => {
    const fetchMock: typeof fetch = async (input) => new Response(JSON.stringify(
      new URL(String(input)).pathname.endsWith("/user/list")
        ? { code: 0, data: { list: [{ user_id: "profile-1", serial_number: "957", fbcc_user_tag: [{ name: "DEACTIVE" }] }] } }
        : { code: 0, data: { list: [] } },
    ));

    await expect(new AdsPowerClient({ fetch: fetchMock }).listProfiles()).resolves.toEqual([{
      profileId: "profile-1",
      profileNo: "957",
      groupName: null,
      observedStatus: "deactive",
      state: "CLOSED",
    }]);
  });

  it("reports the local AdsPower API as unavailable when the readiness probe fails", async () => {
    const client = new AdsPowerClient({ fetch: async () => { throw new Error("private network detail"); } });

    await expect(client.probeReadiness()).resolves.toBe(false);
  });
});
