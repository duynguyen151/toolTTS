import { describe, expect, it } from "vitest";

import { settingsShopHref } from "./settings-form.js";

describe("settings shop selection", () => {
  it("navigates to the selected shop's server-resolved effective policy", () => {
    expect(settingsShopHref("00000000-0000-4000-8000-000000000001")).toBe("/settings?shopId=00000000-0000-4000-8000-000000000001");
  });
});
