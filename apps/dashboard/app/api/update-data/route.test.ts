import { describe, expect, it } from "vitest";

import type { DashboardOperations } from "../../../lib/server/operations/dashboard-operations.js";
import { createUpdateDataHandler } from "./handler.js";

function operations(onUpdate: (profileNo: string) => void): DashboardOperations {
  return {
    listProfiles: async () => ({ status: "READY", selectedProfileNo: null, profiles: [], error: null }),
    openProfile: async (profileNo) => ({ ok: true, profileNo, state: "OPEN" }),
    verifyProfile: async () => ({ ok: false, profileNo: "", verificationState: "UNVERIFIED", shop: null, error: { code: "UNEXPECTED_ERROR", message: "test" } }),
    updateData: async (profileNo, emit) => {
      onUpdate(profileNo);
      await emit({ state: "SUCCESS", message: "Complete", terminal: true, completedKinds: ["orders", "finance"], error: null });
      await emit({ state: "ERROR", message: "Must be ignored", terminal: true, completedKinds: [], error: null });
    },
    syncSelected: async () => [],
    syncAllEligible: async () => [],
  };
}

describe("POST /api/update-data", () => {
  it("rejects a non-local request before starting Update Data", async () => {
    const updated: string[] = [];
    const response = await createUpdateDataHandler(operations((profileNo) => updated.push(profileNo)))(
      new Request("http://remote.example/api/update-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileNo: "957" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(updated).toEqual([]);
  });

  it("streams NDJSON and closes after exactly one terminal event", async () => {
    const updated: string[] = [];
    const response = await createUpdateDataHandler(operations((profileNo) => updated.push(profileNo)))(
      new Request("http://127.0.0.1:3000/api/update-data", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({ profileNo: "957" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(updated).toEqual(["957"]);
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((event) => event.state)).toEqual(["SUCCESS"]);
    expect(lines.filter((event) => event.terminal)).toHaveLength(1);
  });
});
