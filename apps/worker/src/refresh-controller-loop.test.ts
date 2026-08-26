import { describe, expect, it, vi } from "vitest";

import { executeClaimedRefreshAttempts } from "./refresh-controller-loop.js";

describe("executeClaimedRefreshAttempts", () => {
  it("serializes profile work and records one bounded attempt outcome per claim", async () => {
    const events: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const repository = {
      recordRefreshAttemptStarted: vi.fn(async (input: { runId: string; claimToken: string; now: Date }) => {
        events.push(`start:${input.runId}`);
        return { id: `attempt-${input.runId}` };
      }),
      completeRefreshAttempt: vi.fn(async (input: { runId: string; attemptId: string; claimToken: string; outcome: "SUCCESS" | "FAILURE"; failureMessage?: string; now: Date }) => {
        events.push(`complete:${input.runId}:${input.outcome}`);
        return {};
      }),
    };
    const runs = [
      { id: "run-1", shopId: "shop-1", claimToken: "token-1" },
      { id: "run-2", shopId: "shop-2", claimToken: "token-2" },
    ];

    await executeClaimedRefreshAttempts({
      runs,
      shops: [{ id: "shop-1" }, { id: "shop-2" }],
      now: new Date("2026-01-15T01:00:00.000Z"),
      repository,
      execute: async (shop) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        events.push(`execute:${shop.id}`);
        active -= 1;
        return shop.id === "shop-1";
      },
    });

    expect(maximumActive).toBe(1);
    expect(events).toEqual([
      "start:run-1", "execute:shop-1", "complete:run-1:SUCCESS",
      "start:run-2", "execute:shop-2", "complete:run-2:FAILURE",
    ]);
    expect(repository.completeRefreshAttempt).toHaveBeenCalledTimes(2);
  });
});
