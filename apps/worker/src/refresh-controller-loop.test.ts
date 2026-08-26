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
      renewRefreshAttemptLease: vi.fn(async () => true),
      releaseRefreshClaim: vi.fn(async () => true),
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
      withExecutionLock: async (_shop, operation) => operation(),
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

  it("renews ownership while a long-running execution is active and completes the original attempt", async () => {
    vi.useFakeTimers();
    try {
      let releaseExecution!: () => void;
      const execution = new Promise<boolean>((resolve) => { releaseExecution = () => resolve(true); });
      const repository = {
        recordRefreshAttemptStarted: vi.fn(async () => ({ id: "attempt-1" })),
        renewRefreshAttemptLease: vi.fn(async () => true),
        releaseRefreshClaim: vi.fn(async () => true),
        completeRefreshAttempt: vi.fn(async () => ({})),
      };
      const promise = executeClaimedRefreshAttempts({
        runs: [{ id: "run-1", shopId: "shop-1", claimToken: "token-1" }],
        shops: [{ id: "shop-1" }],
        now: new Date("2026-01-15T01:00:00.000Z"),
        repository,
        withExecutionLock: async (_shop, operation) => operation(),
        execute: async () => execution,
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(repository.renewRefreshAttemptLease).toHaveBeenCalledTimes(2);
      releaseExecution();
      await promise;

      expect(repository.completeRefreshAttempt).toHaveBeenCalledWith(expect.objectContaining({ outcome: "SUCCESS" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not consume an attempt when the profile execution lock is unavailable", async () => {
    const repository = {
      recordRefreshAttemptStarted: vi.fn(async () => ({ id: "attempt-1" })),
      renewRefreshAttemptLease: vi.fn(async () => true),
      releaseRefreshClaim: vi.fn(async () => true),
      completeRefreshAttempt: vi.fn(async () => ({})),
    };
    const execute = vi.fn(async () => true);

    await executeClaimedRefreshAttempts({
      runs: [{ id: "run-1", shopId: "shop-1", claimToken: "token-1" }],
      shops: [{ id: "shop-1" }],
      now: new Date("2026-01-15T01:00:00.000Z"),
      repository,
      withExecutionLock: async () => null,
      execute,
    });

    expect(repository.recordRefreshAttemptStarted).not.toHaveBeenCalled();
    expect(repository.releaseRefreshClaim).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });
});
