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
});
