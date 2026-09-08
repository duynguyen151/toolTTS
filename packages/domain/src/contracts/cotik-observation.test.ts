import { describe, expect, it } from "vitest";
import { compareObservationPrecedence } from "./cotik-observation.js";

describe("Cotik Observation Winner Projection Logic (2A)", () => {
  it("prioritizes most recent orderUpdateTime", () => {
    const newer = {
      orderUpdateTime: new Date("2026-09-07T10:00:00Z"),
      observedAt: new Date("2026-09-07T12:00:00Z"),
      accountId: "acc-z"
    };
    const older = {
      orderUpdateTime: new Date("2026-09-07T09:00:00Z"),
      observedAt: new Date("2026-09-07T13:00:00Z"),
      accountId: "acc-a"
    };

    // compareObservationPrecedence: negative if `newer` has higher precedence than `older`
    expect(compareObservationPrecedence(newer, older)).toBeLessThan(0);
    expect(compareObservationPrecedence(older, newer)).toBeGreaterThan(0);
  });

  it("breaks ties with observedAt DESC when orderUpdateTime is identical", () => {
    const time = new Date("2026-09-07T10:00:00Z");
    const recentlySeen = {
      orderUpdateTime: time,
      observedAt: new Date("2026-09-07T12:00:00Z"),
      accountId: "acc-z"
    };
    const earlierSeen = {
      orderUpdateTime: time,
      observedAt: new Date("2026-09-07T11:00:00Z"),
      accountId: "acc-a"
    };

    expect(compareObservationPrecedence(recentlySeen, earlierSeen)).toBeLessThan(0);
    expect(compareObservationPrecedence(earlierSeen, recentlySeen)).toBeGreaterThan(0);
  });

  it("breaks ties with accountId ASC when both updateTime and observedAt are identical", () => {
    const time = new Date("2026-09-07T10:00:00Z");
    const seen = new Date("2026-09-07T12:00:00Z");
    const accountA = {
      orderUpdateTime: time,
      observedAt: seen,
      accountId: "00000000-0000-0000-0000-000000000001"
    };
    const accountB = {
      orderUpdateTime: time,
      observedAt: seen,
      accountId: "00000000-0000-0000-0000-000000000002"
    };

    expect(compareObservationPrecedence(accountA, accountB)).toBeLessThan(0);
    expect(compareObservationPrecedence(accountB, accountA)).toBeGreaterThan(0);
  });

  it("sorts candidate observations deterministically into the winner", () => {
    const candidates = [
      {
        orderUpdateTime: new Date("2026-09-07T08:00:00Z"),
        observedAt: new Date("2026-09-07T10:00:00Z"),
        accountId: "acc-3"
      },
      {
        orderUpdateTime: new Date("2026-09-07T10:00:00Z"),
        observedAt: new Date("2026-09-07T11:00:00Z"),
        accountId: "acc-2"
      },
      {
        orderUpdateTime: new Date("2026-09-07T10:00:00Z"),
        observedAt: new Date("2026-09-07T11:00:00Z"),
        accountId: "acc-1"
      }
    ];

    candidates.sort(compareObservationPrecedence);

    expect(candidates[0]!.accountId).toBe("acc-1");
    expect(candidates[1]!.accountId).toBe("acc-2");
    expect(candidates[2]!.accountId).toBe("acc-3");
  });
});
