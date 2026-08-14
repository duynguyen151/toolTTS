import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProfileOperationsPresentation } from "../../lib/operations-contract.js";
import { OperationsControls } from "./operations-controls.js";
import { OperationsProvider } from "./operations-provider.js";
import { ProfileOperationState } from "./profile-operation-state.js";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const presentation: ProfileOperationsPresentation = {
  status: "READY",
  selectedProfileNo: "987",
  profiles: [
    {
      profileNo: "957",
      state: "OPEN",
      linkState: "LINKED",
      linkedShop: { profileNo: "957", displayName: "TikTok Shop 957" },
    },
    {
      profileNo: "987",
      state: "CLOSED",
      linkState: "UNLINKED",
      linkedShop: null,
    },
  ],
  error: null,
};

function renderOperations(): string {
  return renderToStaticMarkup(
    createElement(
      OperationsProvider,
      {
        initialPresentation: presentation,
        children: [
          createElement(OperationsControls, {
            generatedAtLabel: "14 Aug 2026, 23:50 GMT+7",
            key: "controls",
          }),
          createElement(ProfileOperationState, { key: "state" }),
        ],
      },
    ),
  );
}

describe("dashboard operations controls", () => {
  it("lists profile numbers and textual link states without internal AdsPower data", () => {
    const html = renderOperations();

    expect(html).toContain('aria-label="AdsPower profile"');
    expect(html).toContain("Profile 957 · linked");
    expect(html).toContain("Profile 987 · unlinked");
    expect(html).toContain("CLOSED");
    expect(html).toContain("Not linked to a Tool_TTS shop");
    expect(html).not.toMatch(/profileId|cdpEndpoint|user_id|password|proxy/i);
  });

  it("allows opening an AdsPower profile but prevents updates for an unlinked profile", () => {
    const html = renderOperations();

    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
  });

  it("announces operational state without fake progress percentages", () => {
    const html = renderOperations();

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Ready for operator action");
    expect(html).not.toMatch(/\d+%/);
  });
});
