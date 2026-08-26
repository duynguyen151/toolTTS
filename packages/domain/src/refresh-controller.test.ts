import { describe, expect, it } from "vitest";

import {
  RefreshBusinessDateSchema,
  RefreshCheckpointRunStateSchema,
  calculateRetryAt,
  getBangkokBusinessDate,
  getDueRefreshCheckpoints,
  transitionRefreshAttempt,
} from "./refresh-controller.js";

describe("refresh controller time and schedule contract", () => {
  it("uses the strict Bangkok business date and due wall-clock boundary", () => {
    const now = new Date("2026-01-15T01:00:00.000Z");

    expect(getBangkokBusinessDate(now)).toBe("2026-01-15");
    expect(getDueRefreshCheckpoints({
      now,
      checkpoints: [
        { id: "00000000-0000-4000-8000-000000000001", localTime: "08:00", enabled: true },
        { id: "00000000-0000-4000-8000-000000000002", localTime: "08:01", enabled: true },
      ],
    }).map((checkpoint) => checkpoint.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("does not claim disabled or future checkpoints and sorts custom times", () => {
    const due = getDueRefreshCheckpoints({
      now: new Date("2026-01-15T04:59:00.000Z"),
      checkpoints: [
        { id: "00000000-0000-4000-8000-000000000003", localTime: "12:00", enabled: true },
        { id: "00000000-0000-4000-8000-000000000002", localTime: "11:59", enabled: false },
        { id: "00000000-0000-4000-8000-000000000001", localTime: "08:00", enabled: true },
      ],
    });

    expect(due.map((checkpoint) => checkpoint.localTime)).toEqual(["08:00"]);
  });

  it("returns no automatic claims when Auto Refresh is off", () => {
    expect(getDueRefreshCheckpoints({
      now: new Date("2026-01-15T01:00:00.000Z"),
      autoRefreshEnabled: false,
      checkpoints: [{
        id: "00000000-0000-4000-8000-000000000001",
        localTime: "08:00",
        enabled: true,
      }],
    })).toEqual([]);
  });

  it("maps attempt one to offset zero and later attempts to exact seconds", () => {
    const cycleAt = new Date("2026-01-15T01:00:00.000Z");

    expect(calculateRetryAt(cycleAt, 1, [0, 30, 120])).toEqual(cycleAt);
    expect(calculateRetryAt(cycleAt, 2, [0, 30, 120])).toEqual(new Date("2026-01-15T01:00:30.000Z"));
    expect(calculateRetryAt(cycleAt, 3, [0, 30, 120])).toEqual(new Date("2026-01-15T01:02:00.000Z"));
    expect(calculateRetryAt(cycleAt, 4, [0, 30, 120])).toBeNull();
  });
});

describe("refresh controller state transitions", () => {
  const base = RefreshCheckpointRunStateSchema.parse({
    status: "RETRY_WAIT",
    attemptCount: 1,
    retryOffsetsSeconds: [0, 30],
    cycleStartedAt: new Date("2026-01-15T01:00:00.000Z"),
    nextAttemptAt: new Date("2026-01-15T01:00:30.000Z"),
  });

  it("records a failure as durable retry wait without allowing a fourth attempt", () => {
    const retry = transitionRefreshAttempt({
      ...base,
      status: "RUNNING",
      attemptCount: 1,
    }, { type: "FAILURE", at: new Date("2026-01-15T01:00:01.000Z"), message: "temporary" });
    expect(retry).toMatchObject({ status: "RETRY_WAIT", attemptCount: 1, nextAttemptAt: new Date("2026-01-15T01:00:30.000Z") });

    const exhausted = transitionRefreshAttempt({
      ...base,
      status: "RUNNING",
      attemptCount: 2,
    }, { type: "FAILURE", at: new Date("2026-01-15T01:01:00.000Z"), message: "final" });
    expect(exhausted).toMatchObject({ status: "FAILED_EXHAUSTED", attemptCount: 2, nextAttemptAt: null });
  });

  it("accepts success only from a running attempt and rejects invalid transitions", () => {
    expect(transitionRefreshAttempt({ ...base, status: "RUNNING" }, {
      type: "SUCCESS",
      at: new Date("2026-01-15T01:00:02.000Z"),
    })).toMatchObject({ status: "SUCCEEDED", nextAttemptAt: null });
    expect(() => transitionRefreshAttempt(base, {
      type: "SUCCESS",
      at: new Date("2026-01-15T01:00:02.000Z"),
    })).toThrow("running");
  });
});

it("rejects invalid transition timestamps, retry offsets, and calendar dates", () => {
  expect(() => RefreshCheckpointRunStateSchema.parse({
    status: "RETRY_WAIT",
    attemptCount: 1,
    retryOffsetsSeconds: [0, 30, 30],
    cycleStartedAt: new Date("2026-01-15T01:00:00.000Z"),
    nextAttemptAt: new Date("2026-01-15T01:00:30.000Z"),
  })).toThrow();
  expect(() => getBangkokBusinessDate(new Date("invalid"))).toThrow();
  expect(() => RefreshBusinessDateSchema.parse("2026-02-30")).toThrow();
});
