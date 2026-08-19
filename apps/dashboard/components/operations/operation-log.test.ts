import { describe, expect, it } from "vitest";

import {
  appendOperationLog,
  createOperationLogEntry,
  formatOperationLogText,
} from "./operation-log.js";

describe("operation log", () => {
  it("normalizes sensitive operation details before recording an event", () => {
    const entry = createOperationLogEntry({
      state: "ERROR",
      message: "Request failed at https://seller.example/path?token=secret&buyer=Alice with cookie=private",
      timestamp: "2026-08-17T09:00:00.000Z",
    });

    expect(entry).toEqual({
      timestamp: "2026-08-17T09:00:00.000Z",
      level: "error",
      state: "ERROR",
      message: "Request failed at https://seller.example/path",
    });
  });

  it("keeps the latest 200 events", () => {
    const entries = Array.from({ length: 200 }, (_, index) => createOperationLogEntry({
      state: "READY",
      message: `Event ${index + 1}`,
      timestamp: `2026-08-17T09:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    const next = appendOperationLog(entries, createOperationLogEntry({
      state: "ERROR",
      message: "Newest event",
      timestamp: "2026-08-17T10:00:00.000Z",
    }));

    expect(next).toHaveLength(200);
    expect(next[0]?.message).toBe("Event 2");
    expect(next.at(-1)?.message).toBe("Newest event");
  });

  it("formats only normalized log fields for text export", () => {
    const text = formatOperationLogText([createOperationLogEntry({
      state: "SYNCING_ORDERS",
      message: "Synchronizing persisted order data.",
      timestamp: "2026-08-17T09:00:00.000Z",
    })]);

    expect(text).toBe("2026-08-17T09:00:00.000Z [info] SYNCING_ORDERS: Synchronizing persisted order data.\n");
  });
});
