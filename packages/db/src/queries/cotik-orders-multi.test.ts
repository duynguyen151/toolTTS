import { describe, expect, it } from "vitest";

import {
  pickWinningCotikObservation,
  shouldPersistCotikOrderItems,
  type CotikWinningObservationCandidate
} from "./cotik-orders-multi.js";

function candidate(
  accountId: string,
  accountLastSeenAt: Date | null,
  orderUpdateTime: string,
  observedAt: string
): CotikWinningObservationCandidate {
  return {
    accountStatus: "ACTIVE",
    discoveryState: "DISCOVERED",
    accountLastSeenAt,
    observation: {
      accountId,
      orderUpdateTime: new Date(orderUpdateTime),
      observedAt: new Date(observedAt)
    } as CotikWinningObservationCandidate["observation"]
  };
}

describe("Cotik order winner selection", () => {
  it("prioritizes the account lastSeenAt before account id", () => {
    const winner = pickWinningCotikObservation([
      candidate("account-a", new Date("2026-09-01T00:00:00.000Z"), "2026-09-07T00:00:00.000Z", "2026-09-07T01:00:00.000Z"),
      candidate("account-b", new Date("2026-09-02T00:00:00.000Z"), "2026-09-06T00:00:00.000Z", "2026-09-06T01:00:00.000Z")
    ]);

    expect(winner?.observation.accountId).toBe("account-b");
  });

  it("uses account id only after account lastSeenAt ties", () => {
    const winner = pickWinningCotikObservation([
      candidate("account-a", new Date("2026-09-02T00:00:00.000Z"), "2026-09-06T00:00:00.000Z", "2026-09-06T01:00:00.000Z"),
      candidate("account-b", new Date("2026-09-02T00:00:00.000Z"), "2026-09-07T00:00:00.000Z", "2026-09-07T01:00:00.000Z")
    ]);

    expect(winner?.observation.accountId).toBe("account-a");
  });

  it("excludes inactive, undiscovered, and never-seen accounts", () => {
    const winner = pickWinningCotikObservation([
      {
        ...candidate("account-inactive", new Date("2026-09-03T00:00:00.000Z"), "2026-09-09T00:00:00.000Z", "2026-09-09T01:00:00.000Z"),
        accountStatus: "BLOCKED"
      },
      {
        ...candidate("account-undiscovered", new Date("2026-09-04T00:00:00.000Z"), "2026-09-08T00:00:00.000Z", "2026-09-08T01:00:00.000Z"),
        discoveryState: "DISCONNECTED"
      },
      candidate("account-never-seen", null, "2026-09-10T00:00:00.000Z", "2026-09-10T01:00:00.000Z"),
      candidate("account-valid", new Date("2026-09-01T00:00:00.000Z"), "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z")
    ]);

    expect(winner?.observation.accountId).toBe("account-valid");
  });

  it("excludes invalid lastSeenAt values", () => {
    const winner = pickWinningCotikObservation([
      candidate("account-invalid", new Date(Number.NaN), "2026-09-10T00:00:00.000Z", "2026-09-10T01:00:00.000Z"),
      candidate("account-valid", new Date("2026-09-01T00:00:00.000Z"), "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z")
    ]);

    expect(winner?.observation.accountId).toBe("account-valid");
  });

  it("persists items only when their source account is the selected winner", () => {
    expect(shouldPersistCotikOrderItems("winner", "winner")).toBe(true);
    expect(shouldPersistCotikOrderItems("loser", "winner")).toBe(false);
    expect(shouldPersistCotikOrderItems(undefined, "winner")).toBe(false);
  });
});
