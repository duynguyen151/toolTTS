import { describe, expect, it, vi } from "vitest";

import type { DashboardOperations } from "../../../../lib/server/operations/dashboard-operations.js";
import { createRetryProfilesHandler } from "./handler.js";

const listed = {
  status: "READY" as const,
  selectedProfileNo: "957",
  profiles: [],
  error: null,
};

function operations(listProfiles: DashboardOperations["listProfiles"]): DashboardOperations {
  return {
    listProfiles,
    openProfile: async (profileNo) => ({ ok: true, profileNo, state: "OPEN" }),
    verifyProfile: async (profileNo) => ({
      ok: false,
      profileNo,
      verificationState: "UNVERIFIED",
      shop: null,
      error: { code: "UNEXPECTED_ERROR", message: "test" },
    }),
    updateData: async () => undefined,
    syncSelected: async () => [],
    syncAllEligible: async () => [],
  };
}

function request(url: string, body = "{}"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/profiles/retry", () => {
  it("requests a fresh AdsPower inventory without forwarding internal profile data", async () => {
    const listProfiles = vi.fn().mockResolvedValue(listed);

    const response = await createRetryProfilesHandler(operations(listProfiles))(
      request("http://127.0.0.1:3000/api/profiles/retry"),
    );

    expect(response.status).toBe(200);
    expect(listProfiles).toHaveBeenCalledWith(undefined, { forceRefresh: true });
    expect(await response.json()).toEqual(listed);
  });

  it("rejects a non-local request before calling AdsPower", async () => {
    const listProfiles = vi.fn().mockResolvedValue(listed);

    const response = await createRetryProfilesHandler(operations(listProfiles))(
      request("https://example.com/api/profiles/retry"),
    );

    expect(response.status).toBe(403);
    expect(listProfiles).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
});
