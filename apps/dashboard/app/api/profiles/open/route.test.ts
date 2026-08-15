import { describe, expect, it } from "vitest";

import type { DashboardOperations } from "../../../../lib/server/operations/dashboard-operations.js";
import { createOpenProfileHandler } from "./handler.js";

function operations(onOpen: (profileNo: string) => void): DashboardOperations {
  return {
    listProfiles: async () => ({ status: "READY", selectedProfileNo: null, profiles: [], error: null }),
    openProfile: async (profileNo) => {
      onOpen(profileNo);
      return { ok: true, profileNo, state: "OPEN" };
    },
    updateData: async () => undefined,
  };
}

function request(
  url: string,
  body: string,
  origin?: string,
  forwardedHeaders?: Record<string, string>,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin === undefined ? {} : { origin }),
      ...forwardedHeaders,
    },
    body,
  });
}

describe("POST /api/profiles/open", () => {
  it.each([
    ["invalid JSON", "http://127.0.0.1:3000/api/profiles/open", "{", undefined, undefined, 400],
    ["invalid profile number", "http://127.0.0.1:3000/api/profiles/open", JSON.stringify({ profileNo: "bad profile" }), undefined, undefined, 400],
    ["non-local host", "http://example.com/api/profiles/open", JSON.stringify({ profileNo: "957" }), undefined, undefined, 403],
    ["non-local origin", "http://localhost:3000/api/profiles/open", JSON.stringify({ profileNo: "957" }), "https://evil.example", undefined, 403],
    ["different local origin port", "http://localhost:3000/api/profiles/open", JSON.stringify({ profileNo: "957" }), "http://localhost:4000", undefined, 403],
    ["non-loopback X-Forwarded-For", "http://localhost:3000/api/profiles/open", JSON.stringify({ profileNo: "957" }), undefined, { "x-forwarded-for": "203.0.113.9" }, 403],
    ["non-loopback Forwarded", "http://localhost:3000/api/profiles/open", JSON.stringify({ profileNo: "957" }), undefined, { forwarded: "for=198.51.100.7;proto=http" }, 403],
  ] as const)("rejects %s before invoking operations", async (_label, url, body, origin, forwardedHeaders, expectedStatus) => {
    const opened: string[] = [];

    const response = await createOpenProfileHandler(operations((profileNo) => opened.push(profileNo)))(
      request(url, body, origin, forwardedHeaders),
    );

    expect(response.status).toBe(expectedStatus);
    expect(opened).toEqual([]);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("opens a valid profile from a local request", async () => {
    const opened: string[] = [];

    const response = await createOpenProfileHandler(operations((profileNo) => opened.push(profileNo)))(
      request(
        "http://[::1]:3000/api/profiles/open",
        JSON.stringify({ profileNo: "DEMO_957-1" }),
        "http://localhost:3000",
      ),
    );

    expect(response.status).toBe(200);
    expect(opened).toEqual(["DEMO_957-1"]);
    expect(await response.json()).toEqual({ ok: true, profileNo: "DEMO_957-1", state: "OPEN" });
  });
});
