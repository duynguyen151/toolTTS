import type { ProxyPreflightResult } from "@shop-health/domain";
import { describe, expect, it, vi } from "vitest";

import { executeClaimedRefreshAttempts } from "./refresh-controller-loop.js";

const healthyPreflight: ProxyPreflightResult = {
  status: "HEALTHY",
  latencyMs: 42,
  exitIp: null,
  reasonClass: "OBSERVED_HEALTHY",
};

function preflightFor(result: ProxyPreflightResult = healthyPreflight) {
  return async () => result;
}

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
      recordRefreshAttemptProxyPreflight: vi.fn(async (input: { runId: string; attemptId: string; claimToken: string; preflight: ProxyPreflightResult }) => {
        events.push(`preflight:${input.runId}:${input.preflight.status}`);
        return true;
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
      preflight: preflightFor(),
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
      "start:run-1", "preflight:run-1:HEALTHY", "execute:shop-1", "complete:run-1:SUCCESS",
      "start:run-2", "preflight:run-2:HEALTHY", "execute:shop-2", "complete:run-2:FAILURE",
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
        recordRefreshAttemptProxyPreflight: vi.fn(async () => true),
        renewRefreshAttemptLease: vi.fn(async () => true),
        releaseRefreshClaim: vi.fn(async () => true),
        completeRefreshAttempt: vi.fn(async () => ({})),
      };
      const promise = executeClaimedRefreshAttempts({
        runs: [{ id: "run-1", shopId: "shop-1", claimToken: "token-1" }],
        shops: [{ id: "shop-1" }],
        now: new Date("2026-01-15T01:00:00.000Z"),
        repository,
        preflight: preflightFor(),
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
      recordRefreshAttemptProxyPreflight: vi.fn(async () => true),
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
      preflight: preflightFor(),
      withExecutionLock: async () => null,
      execute,
    });

    expect(repository.recordRefreshAttemptStarted).not.toHaveBeenCalled();
    expect(repository.releaseRefreshClaim).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["UNKNOWN", "UNAVAILABLE"] as const)("records %s and completes the attempt without browser execution", async (status) => {
    const repository = {
      recordRefreshAttemptStarted: vi.fn(async () => ({ id: "attempt-1" })),
      recordRefreshAttemptProxyPreflight: vi.fn(async () => true),
      renewRefreshAttemptLease: vi.fn(async () => true),
      releaseRefreshClaim: vi.fn(async () => true),
      completeRefreshAttempt: vi.fn(async () => ({})),
    };
    const execute = vi.fn(async () => true);
    const preflight = preflightFor({
      status,
      latencyMs: 42,
      exitIp: null,
      reasonClass: status === "UNKNOWN" ? "OBSERVATION_UNAVAILABLE" : "NETWORK_UNAVAILABLE",
    });

    await executeClaimedRefreshAttempts({
      runs: [{ id: "run-1", shopId: "shop-1", claimToken: "token-1" }],
      shops: [{ id: "shop-1", profileId: "profile-1" }],
      now: new Date("2026-01-15T01:00:00.000Z"),
      repository,
      preflight,
      withExecutionLock: async (_shop, operation) => operation(),
      execute,
    });

    expect(repository.recordRefreshAttemptProxyPreflight).toHaveBeenCalledWith({
      runId: "run-1",
      attemptId: "attempt-1",
      claimToken: "token-1",
      preflight: expect.objectContaining({ status }),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(repository.completeRefreshAttempt).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "FAILURE",
      failureMessage: `Proxy preflight ${status}`,
    }));
  });

  it.each(["lease", "preflight", "persistence"] as const)("sanitizes %s failure before attempt completion", async (phase) => {
    const secret = "http://private.proxy/?token=secret";
    const repository = {
      recordRefreshAttemptStarted: vi.fn(async () => ({ id: "attempt-1" })),
      recordRefreshAttemptProxyPreflight: vi.fn(async () => {
        if (phase === "persistence") throw new Error(secret);
        return true;
      }),
      renewRefreshAttemptLease: vi.fn(async () => {
        if (phase === "lease") throw new Error(secret);
        return true;
      }),
      releaseRefreshClaim: vi.fn(async () => true),
      completeRefreshAttempt: vi.fn(async () => ({})),
    };

    await executeClaimedRefreshAttempts({
      runs: [{ id: "run-1", shopId: "shop-1", claimToken: "token-1" }],
      shops: [{ id: "shop-1", profileId: "profile-1" }],
      now: new Date("2026-01-15T01:00:00.000Z"),
      repository,
      preflight: async () => {
        if (phase === "preflight") throw new Error(secret);
        return healthyPreflight;
      },
      withExecutionLock: async (_shop, operation) => operation(),
      execute: vi.fn(async () => true),
    });

    expect(repository.completeRefreshAttempt).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "FAILURE",
      failureMessage: "Proxy preflight failed before refresh",
    }));
    expect(JSON.stringify(repository.completeRefreshAttempt.mock.calls)).not.toContain(secret);
  });

  it.each(["HEALTHY", "DEGRADED"] as const)("executes browser work after recording %s", async (status) => {
    const events: string[] = [];
    const repository = {
      recordRefreshAttemptStarted: vi.fn(async () => ({ id: "attempt-1" })),
      recordRefreshAttemptProxyPreflight: vi.fn(async () => { events.push("persist"); return true; }),
      renewRefreshAttemptLease: vi.fn(async () => true),
      releaseRefreshClaim: vi.fn(async () => true),
      completeRefreshAttempt: vi.fn(async () => ({})),
    };
    const execute = vi.fn(async () => { events.push("execute"); return true; });
    const preflight = preflightFor({
      status,
      latencyMs: status === "HEALTHY" ? 42 : 1_001,
      exitIp: null,
      reasonClass: status === "HEALTHY" ? "OBSERVED_HEALTHY" : "OBSERVED_SLOW",
    });

    await executeClaimedRefreshAttempts({
      runs: [{ id: "run-1", shopId: "shop-1", claimToken: "token-1" }],
      shops: [{ id: "shop-1", profileId: "profile-1" }],
      now: new Date("2026-01-15T01:00:00.000Z"),
      repository,
      preflight,
      withExecutionLock: async (_shop, operation) => operation(),
      execute,
    });

    expect(events).toEqual(["persist", "execute"]);
    expect(repository.completeRefreshAttempt).toHaveBeenCalledWith(expect.objectContaining({ outcome: "SUCCESS" }));
  });

  it("persists the controller's typed manual-login reason instead of treating it as a success", async () => {
    const repository = {
      recordRefreshAttemptStarted: vi.fn(async () => ({ id: "attempt-1" })),
      recordRefreshAttemptProxyPreflight: vi.fn(async () => true),
      renewRefreshAttemptLease: vi.fn(async () => true),
      releaseRefreshClaim: vi.fn(async () => true),
      completeRefreshAttempt: vi.fn(async () => ({})),
    };

    await executeClaimedRefreshAttempts({
      runs: [{ id: "run-1", shopId: "shop-1", claimToken: "token-1" }],
      shops: [{ id: "shop-1", profileId: "profile-1" }],
      now: new Date("2026-01-15T01:00:00.000Z"),
      repository,
      preflight: preflightFor(),
      withExecutionLock: async (_shop, operation) => operation(),
      // W8 must preserve actionable manual-bootstrap state in its refresh audit.
      execute: async () => ({ success: false, failureMessage: "HUMAN_ACTION_REQUIRED:LOGIN_REQUIRED" } as never),
    });

    expect(repository.completeRefreshAttempt).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "FAILURE",
      failureMessage: "HUMAN_ACTION_REQUIRED:LOGIN_REQUIRED",
    }));
  });
});
