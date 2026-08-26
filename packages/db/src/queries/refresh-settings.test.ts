import { describe, expect, it } from "vitest";

import type { Database } from "../client.js";
import {
  MAX_REFRESH_RETRY_OFFSET_SECONDS,
  addRefreshCheckpoint,
  deleteRefreshCheckpoint,
  getCurrentRefreshSettings,
  setAutoRefreshEnabled,
  setRefreshCheckpointEnabled,
  setRefreshRetryOffsets,
  updateRefreshCheckpoint,
} from "./refresh-settings.js";

const unusedDb = {} as Database;

describe("refresh settings repository input validation", () => {
  it("rejects invalid Bangkok wall-clock values before touching the database", async () => {
    for (const localTime of ["24:00", "8:00", "08:60", "08:00Z", "08:00:00"]) {
      await expect(addRefreshCheckpoint(unusedDb, { localTime })).rejects.toThrow();
      await expect(updateRefreshCheckpoint(unusedDb, {
        checkpointId: "00000000-0000-4000-8000-000000000001",
        localTime,
      })).rejects.toThrow();
    }
  });

  it("accepts order-preserving unique retry offsets up to one day", async () => {
    const db = {
      transaction: async () => { throw new Error("transaction reached"); },
    } as unknown as Database;

    await expect(setRefreshRetryOffsets(db, { retryOffsetsSeconds: [86_400, 0, 30] }))
      .rejects.toThrow("transaction reached");
  });

  it("rejects invalid retry offsets before touching the database", async () => {
    for (const retryOffsetsSeconds of [
      [-1],
      [0, 30, 30],
      [0, 30.5],
      [],
      Array.from({ length: 13 }, (_, index) => index),
      [0, MAX_REFRESH_RETRY_OFFSET_SECONDS + 1],
      "[0,30]",
    ]) {
      await expect(setRefreshRetryOffsets(unusedDb, { retryOffsetsSeconds } as never)).rejects.toThrow();
    }
  });

  it("rejects invalid booleans and stable IDs before touching the database", async () => {
    await expect(setAutoRefreshEnabled(unusedDb, { enabled: "true" } as never)).rejects.toThrow();
    await expect(setRefreshCheckpointEnabled(unusedDb, {
      checkpointId: "not-a-uuid",
      enabled: true,
    })).rejects.toThrow();
    await expect(deleteRefreshCheckpoint(unusedDb, { checkpointId: "not-a-uuid" })).rejects.toThrow();
    await expect(getCurrentRefreshSettings(unusedDb, { unexpected: true } as never)).rejects.toThrow();
  });
});
