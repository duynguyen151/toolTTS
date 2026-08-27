import { describe, expect, it } from "vitest";

import type { Database } from "../client.js";
import {
  claimDueRefreshAttempts,
  completeRefreshAttempt,
  getRefreshCheckpointRun,
  recordRefreshAttemptStarted,
  recordRefreshAttemptProxyPreflight,
} from "./refresh-controller.js";

const shopId = "00000000-0000-4000-8000-000000000001";
const checkpointId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const attemptId = "00000000-0000-4000-8000-000000000004";
const unusedDb = {} as Database;

describe("refresh controller repository input validation", () => {
  it("rejects malformed claims before touching the database", async () => {
    await expect(claimDueRefreshAttempts(unusedDb, {
      now: new Date("2026-01-15T01:00:00.000Z"),
      shops: [{ id: "not-a-uuid" }],
    })).rejects.toThrow();
    await expect(claimDueRefreshAttempts(unusedDb, {
      now: new Date("invalid"),
      shops: [{ id: shopId }],
    })).rejects.toThrow();
  });

  it("rejects invalid attempt transitions before touching the database", async () => {
    await expect(recordRefreshAttemptStarted(unusedDb, {
      runId: "not-a-uuid",
      claimToken: "00000000-0000-4000-8000-000000000010",
      now: new Date("2026-01-15T01:00:00.000Z"),
    })).rejects.toThrow();
    await expect(completeRefreshAttempt(unusedDb, {
      runId,
      attemptId,
      claimToken: "00000000-0000-4000-8000-000000000010",
      outcome: "FAILURE",
      failureMessage: "",
      now: new Date("2026-01-15T01:00:00.000Z"),
    })).rejects.toThrow();
    await expect(getRefreshCheckpointRun(unusedDb, { shopId, checkpointId, businessDate: "2026-1-15" })).rejects.toThrow();
    await expect(recordRefreshAttemptProxyPreflight(unusedDb, {
      runId,
      attemptId,
      claimToken: "00000000-0000-4000-8000-000000000010",
      preflight: {
        status: "UNAVAILABLE",
        latencyMs: 1,
        exitIp: "private.proxy.example",
        reasonClass: "NETWORK_UNAVAILABLE",
      },
    })).rejects.toThrow();
  });
});
