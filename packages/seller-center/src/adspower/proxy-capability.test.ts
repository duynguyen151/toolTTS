import { describe, expect, it } from "vitest";

import { AdsPowerClient } from "./client.js";

function clientForProxySoftware(proxySoft: string): AdsPowerClient {
  return new AdsPowerClient({
    fetch: async (input) => new Response(JSON.stringify(new URL(String(input)).pathname.endsWith("/user/list")
      ? { code: 0, data: { list: [{ user_id: "profile-1", user_proxy_config: { proxy_soft: proxySoft } }] } }
      : { code: 0, data: { list: [] } }),
    ),
  });
}

describe("AdsPower proxy capability", () => {
  it("reports luminati proxy capability as configured", async () => {
    await expect(clientForProxySoftware("luminati").getProxyCapability("profile-1", { timeoutMs: 25 }))
      .resolves.toEqual({ status: "CONFIGURED", reasonCode: "PROXY_CONFIGURED" });
  });

  it.each([" 922S5AuTo ", "922s5AuTh", "SsH"])(
    "reports each documented configured proxy software after normalization: %s",
    async (proxySoft) => {
      await expect(clientForProxySoftware(proxySoft).getProxyCapability("profile-1", { timeoutMs: 25 }))
        .resolves.toEqual({ status: "CONFIGURED", reasonCode: "PROXY_CONFIGURED" });
    },
  );

  it("fails closed for unknown nonblank proxy software", async () => {
    await expect(clientForProxySoftware("socks5").getProxyCapability("profile-1", { timeoutMs: 25 }))
      .resolves.toEqual({ status: "UNAVAILABLE", reasonCode: "PROXY_UNKNOWN" });
  });

  it("fails closed for unsupported lumiproxyauto proxy software", async () => {
    await expect(clientForProxySoftware("lumiproxyauto").getProxyCapability("profile-1", { timeoutMs: 25 }))
      .resolves.toEqual({ status: "UNAVAILABLE", reasonCode: "PROXY_UNKNOWN" });
  });
});
