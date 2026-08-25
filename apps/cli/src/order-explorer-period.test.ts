import { describe, expect, it } from "vitest";

import { resolveOrderExplorerPeriod } from "./order-explorer-period.js";

describe("resolveOrderExplorerPeriod", () => {
  it("uses Asia/Bangkok calendar midnight for Today regardless of the runtime timezone", () => {
    const period = resolveOrderExplorerPeriod("TODAY", new Date("2026-08-13T20:15:00.000Z"));

    expect(period).toEqual({
      key: "TODAY",
      label: "Today (Asia/Bangkok)",
      start: new Date("2026-08-13T17:00:00.000Z"),
      end: new Date("2026-08-14T17:00:00.000Z"),
    });
  });

  it("keeps rolling periods in Bangkok calendar time across a US proxy/browser timezone", () => {
    const period = resolveOrderExplorerPeriod("7D", new Date("2026-01-01T03:30:00.000Z"));

    expect(period.start).toEqual(new Date("2025-12-25T17:00:00.000Z"));
    expect(period.end).toEqual(new Date("2026-01-01T17:00:00.000Z"));
  });

  it("labels All Available as persisted data without a lifetime-completeness claim", () => {
    expect(resolveOrderExplorerPeriod("ALL_AVAILABLE", new Date("2026-01-01T00:00:00.000Z"))).toEqual({
      key: "ALL_AVAILABLE",
      label: "All Available (persisted source data; not lifetime completeness)",
      start: null,
      end: null,
    });
  });
});
