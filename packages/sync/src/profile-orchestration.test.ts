import { describe, expect, it } from "vitest";

import { runSequentialProfileQueue } from "./profile-orchestration.js";

describe("runSequentialProfileQueue", () => {
  it("runs profiles one at a time and isolates a failed profile", async () => {
    const started: string[] = [];
    let active = 0;
    let maximumActive = 0;

    const results = await runSequentialProfileQueue(["101", "202", "303"], async (profileNo) => {
      started.push(profileNo);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
      if (profileNo === "202") throw new Error("Seller Center unavailable");
    });

    expect(started).toEqual(["101", "202", "303"]);
    expect(maximumActive).toBe(1);
    expect(results).toEqual([
      { profileNo: "101", status: "SUCCEEDED", error: null },
      { profileNo: "202", status: "FAILED", error: "Seller Center unavailable" },
      { profileNo: "303", status: "SUCCEEDED", error: null },
    ]);
  });
});
