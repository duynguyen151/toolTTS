import { describe, expect, it } from "vitest";

import { buildAiTaskRequest, settingsShopHref } from "./settings-form.js";

describe("settings shop selection", () => {
  it("navigates to the selected shop's server-resolved effective policy", () => {
    expect(settingsShopHref("00000000-0000-4000-8000-000000000001")).toBe("/settings?shopId=00000000-0000-4000-8000-000000000001");
  });
});

describe("AI task request builder", () => {
  it("preserves an existing server-side reference without sending it", () => {
    const request = buildAiTaskRequest({ taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "reviewer", enabled: true, existing: true, secretRef: "" });
    expect(request).toMatchObject({ preserveSecretRef: true });
    expect(request).not.toHaveProperty("secretRef");
  });

  it("sends a new reference only for an unset task", () => {
    expect(buildAiTaskRequest({ taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "reviewer", enabled: true, existing: false, secretRef: "CUSTOM_AI_REF" })).toMatchObject({ secretRef: "CUSTOM_AI_REF" });
  });
});
