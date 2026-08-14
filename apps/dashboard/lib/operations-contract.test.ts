import { describe, expect, it } from "vitest";

import {
  isTerminalUpdateState,
  type ProfileOperationsPresentation,
  type UpdateDataState,
} from "./operations-contract.js";

describe("dashboard operations contract", () => {
  it("distinguishes terminal workflow states from active stages", () => {
    const expected: Record<UpdateDataState, boolean> = {
      READY: false,
      OPENING_PROFILE: false,
      CONNECTING: false,
      SYNCING_ORDERS: false,
      SYNCING_FINANCE: false,
      RECONCILING: false,
      SUCCESS: true,
      PARTIAL: true,
      ERROR: true,
      LOGIN_REQUIRED: true,
      SECURITY_CHECK_REQUIRED: true,
    };

    for (const [state, terminal] of Object.entries(expected)) {
      expect(isTerminalUpdateState(state as UpdateDataState)).toBe(terminal);
    }
  });

  it("keeps client profile data limited to presentation-safe fields", () => {
    const presentation: ProfileOperationsPresentation = {
      status: "READY",
      selectedProfileNo: "957",
      profiles: [
        {
          profileNo: "957",
          state: "CLOSED",
          linkState: "LINKED",
          linkedShop: {
            displayName: "TikTok Shop 957",
            profileNo: "957",
          },
        },
      ],
      error: null,
    };

    const serialized = JSON.stringify(presentation);

    for (const forbidden of [
      "profileId",
      "cdpEndpoint",
      "cookie",
      "session",
      "proxy",
      "username",
      "password",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
