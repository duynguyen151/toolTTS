import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProfileOperationsPresentation } from "../../lib/operations-contract.js";
import type { DashboardPresentation } from "../../lib/dashboard-contract.js";
import { OperationsControls } from "./operations-controls.js";
import {
  dashboardProfileHref,
  dashboardShopHref,
  isProfileSelectionAligned,
  OperationsProvider,
  preflightUpdateState,
} from "./operations-provider.js";
import { ProfileOperationState } from "./profile-operation-state.js";

const operationsCss = readFileSync(
  new URL("./operations.module.css", import.meta.url),
  "utf8",
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

function renderOperations(preferredProfileNo?: string): string {
  return renderToStaticMarkup(
    createElement(
      OperationsProvider,
      {
        initialPresentation: presentation,
        ...(preferredProfileNo === undefined ? {} : { preferredProfileNo }),
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

const unavailablePresentation: ProfileOperationsPresentation = {
  status: "ERROR",
  selectedProfileNo: null,
  profiles: [],
  error: { code: "ADSPOWER_UNAVAILABLE", message: "AdsPower profile listing is unavailable." },
};

function renderUnavailableLiveOperations(): string {
  return renderToStaticMarkup(createElement(
    OperationsProvider,
    {
      initialPresentation: unavailablePresentation,
      persistedShop: { profileNo: "957", displayName: "TikTok Shop 957", dataOrigin: "LIVE" },
      children: [
        createElement(OperationsControls, { generatedAtLabel: "14 Aug 2026, 23:50 GMT+7", key: "controls" }),
        createElement(ProfileOperationState, { key: "state" }),
      ],
    },
  ));
}

describe("dashboard operations controls", () => {
  it("builds a profile-first route before a seller identity is verified", () => {
    expect(dashboardProfileHref("987")).toBe("/dashboard?profile=987");
    expect(dashboardProfileHref("profile/unsafe?value=1")).toBe("/dashboard?profile=profile%2Funsafe%3Fvalue%3D1");
  });

  it("builds the canonical dashboard route when a profile is selected", () => {
    expect(dashboardShopHref("957")).toBe("/dashboard?shop=957");
    expect(dashboardShopHref("shop/unsafe?value=1")).toBe("/dashboard?shop=shop%2Funsafe%3Fvalue%3D1");
  });

  it.each([
    ["957", "957", true],
    ["957", "987", false],
    ["957", null, false],
    [undefined, "987", true],
    ["UNAVAILABLE", "987", true],
  ] as const)("allows operations only for the rendered shop selection (%s, %s)", (renderedShop, selectedProfile, expected) => {
    expect(isProfileSelectionAligned(renderedShop, selectedProfile)).toBe(expected);
  });

  it.each([
    ["OPEN", "CONNECTING"],
    ["CLOSED", "OPENING_PROFILE"],
    ["ERROR", "OPENING_PROFILE"],
    [undefined, "OPENING_PROFILE"],
  ] as const)("preflights %s profiles as %s", (profileState, expectedState) => {
    expect(preflightUpdateState(profileState)).toBe(expectedState);
  });

  it("lists profile numbers and textual link states without internal AdsPower data", () => {
    const html = renderOperations();

    expect(html).toContain('aria-label="AdsPower profile"');
    expect(html).toContain("Profile 957 · OPEN · linked");
    expect(html).toContain("Profile 987 · CLOSED · unlinked");
    expect(html).toContain("CLOSED");
    expect(html).toContain("Not linked to a Tool_TTS shop");
    expect(html).not.toMatch(/profileId|cdpEndpoint|user_id|password|proxy/i);
  });

  it("allows opening an AdsPower profile but prevents updates for an unlinked profile", () => {
    const html = renderOperations();

    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Retry AdsPower/s);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Sync selected/s);
  });

  it("keeps the selected dashboard profile selected when profile data loads independently", () => {
    const html = renderOperations("957");

    expect(html).toContain('<option value="957" selected="">Profile 957 · OPEN · linked</option>');
    expect(html).toContain("Linked to TikTok Shop 957");
  });

  it("keeps any unlinked AdsPower profile operable when no LIVE shop is selected", () => {
    const html = renderToStaticMarkup(createElement(
      OperationsProvider,
      {
        initialPresentation: presentation,
        preferredProfileNo: "987",
        persistedShop: { profileNo: "UNAVAILABLE", displayName: "Live data unavailable", dataOrigin: "UNAVAILABLE" },
        children: createElement(OperationsControls, { generatedAtLabel: "14 Aug 2026, 23:50 GMT+7" }),
      },
    ));

    expect(html).toContain('<option value="987" selected="">Profile 987 · CLOSED · unlinked</option>');
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Verify profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
  });

  it("disables profile operations when the client selection cannot match the rendered shop", () => {
    const html = renderToStaticMarkup(createElement(
      OperationsProvider,
      {
        initialPresentation: presentation,
        preferredProfileNo: "987",
        persistedShop: { profileNo: "957", displayName: "TikTok Shop 957", dataOrigin: "LIVE" },
        children: createElement(OperationsControls, { generatedAtLabel: "14 Aug 2026, 23:50 GMT+7" }),
      },
    ));

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Verify profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
    expect(html).toContain("Profile 957 · OPEN · linked");
    expect(html).toContain('<option value="987" selected="">');
  });

  it("does not fall back to another profile when the rendered shop is absent from the inventory", () => {
    const html = renderToStaticMarkup(createElement(
      OperationsProvider,
      {
        initialPresentation: {
          ...presentation,
          selectedProfileNo: "987",
          profiles: [presentation.profiles[1]!],
        },
        persistedShop: { profileNo: "957", displayName: "TikTok Shop 957", dataOrigin: "LIVE" },
        children: createElement(OperationsControls, { generatedAtLabel: "14 Aug 2026, 23:50 GMT+7" }),
      },
    ));

    expect(html).toContain('<select aria-label="AdsPower profile">');
    expect(html).not.toContain('selected=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
  });

  it("keeps a persisted LIVE shop actionable when passive profile listing fails", () => {
    const html = renderUnavailableLiveOperations();

    expect(html).toContain("Profile 957 · ERROR · linked");
    expect(html).toContain("Linked to TikTok Shop 957");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Update data/s);
  });

  it("does not create a live-operation fallback for sanitized demo data", () => {
    const html = renderToStaticMarkup(createElement(
      OperationsProvider,
      {
        initialPresentation: presentation,
        persistedShop: { profileNo: "DEMO-001", displayName: "Sanitized Demo Shop", dataOrigin: "DEMO_SANITIZED" },
        children: createElement(OperationsControls, { generatedAtLabel: "14 Aug 2026, 23:50 GMT+7" }),
      },
    ));

    expect(html).toContain("Live operations are disabled for sanitized demo data.");
    expect(html).toContain("No profiles available");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Retry AdsPower/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Update data/s);
    expect(html).not.toContain("DEMO-001");
  });

  it("preserves the dashboard not-verified profile state for sanitized demo data", () => {
    const fallbackProfile: DashboardPresentation["profile"] = {
      status: "NOT_VERIFIED",
      label: "Not verified",
      detail: "Profile runtime state is not exposed by the current read seam.",
      tone: "warning",
    };
    const html = renderToStaticMarkup(createElement(
      OperationsProvider,
      {
        initialPresentation: unavailablePresentation,
        persistedShop: { profileNo: "DEMO-001", displayName: "Sanitized Demo Shop", dataOrigin: "DEMO_SANITIZED" },
        children: createElement(ProfileOperationState, { fallbackProfile }),
      },
    ));

    expect(html).toContain("Not verified");
    expect(html).toContain("NOT_VERIFIED");
    expect(html).not.toContain("Profile unavailable");
    expect(html).not.toContain("ERROR");
  });

  it("announces operational state without fake progress percentages", () => {
    const html = renderOperations();

    expect(html).toMatch(/<button[^>]*>.*Log/s);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('title="Ready for operator action"');
    expect(html).toContain("Ready for operator action");
    expect(html).not.toMatch(/\d+%/);
  });

  it("uses a reduced-motion-safe connecting indicator for profile bootstrap", () => {
    expect(operationsCss).toContain('[data-operation-state="CONNECTING"] .operationMessage::before');
    expect(operationsCss).toContain("@keyframes profileConnecting");
    expect(operationsCss).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps profile operations keyboard-native and stacks their controls on narrow screens", () => {
    const html = renderOperations("957");

    expect(html).toContain('<select aria-label="AdsPower profile"');
    expect(html).toMatch(/<button[^>]*>.*Open profile/s);
    expect(html).toMatch(/<button[^>]*>.*Update data/s);
    expect(operationsCss).toContain(".profileSelect select:focus-visible");
    expect(operationsCss).toMatch(/@media \(max-width: 460px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  });
});
