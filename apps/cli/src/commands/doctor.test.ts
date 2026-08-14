import { describe, expect, test } from "vitest";

import { getAiDoctorCheck } from "./doctor.js";

describe("AI doctor check", () => {
  test("reports missing configuration without making a provider request", () => {
    expect(getAiDoctorCheck({ TOOL_AI_ENABLED: "true" })).toEqual({
      name: "baseline-ai",
      status: "SKIP",
      detail: "UNCONFIGURED: opencode-zen/deepseek-v4-flash-free (TOOL_AI_API_KEY missing)",
    });
  });

  test("reports provider provenance when configured without validating it over the network", () => {
    expect(getAiDoctorCheck({
      TOOL_AI_ENABLED: "true",
      TOOL_AI_API_KEY: "test-key",
      TOOL_AI_MODEL: "deepseek-v4-flash-free",
    })).toEqual({
      name: "baseline-ai",
      status: "OK",
      detail: "CONFIGURED: opencode-zen/deepseek-v4-flash-free (provider call not attempted)",
    });
  });
});
