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

  it("fails closed for unknown nonblank proxy software", async () => {
    await expect(clientForProxySoftware("socks5").getProxyCapability("profile-1", { timeoutMs: 25 }))
      .resolves.toEqual({ status: "UNAVAILABLE", reasonCode: "PROXY_UNKNOWN" });
  });
});
