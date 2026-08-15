import { describe, expect, test } from "vitest";

import { getAiDoctorCheck } from "./doctor.js";

describe("AI doctor check", () => {
  test("reports approved loopback no-auth without making a provider request", () => {
    expect(getAiDoctorCheck({ TOOL_AI_ENABLED: "true" })).toEqual({
      name: "baseline-ai",
      status: "OK",
      detail: "LOCAL_NO_AUTH: 9router/oc/deepseek-v4-flash-free (provider call not attempted)",
    });
  });

  test("reports provider provenance when configured without validating it over the network", () => {
    expect(getAiDoctorCheck({
      TOOL_AI_ENABLED: "true",
      TOOL_AI_API_KEY: "test-key",
      TOOL_AI_DEFAULT_MODEL: "oc/deepseek-v4-flash-free",
    })).toEqual({
      name: "baseline-ai",
      status: "OK",
      detail: "BEARER: 9router/oc/deepseek-v4-flash-free (provider call not attempted)",
    });
  });

  test("requires an application key for a non-loopback endpoint", () => {
    expect(getAiDoctorCheck({
      TOOL_AI_ENABLED: "true",
      TOOL_AI_BASE_URL: "https://router.example.test/v1",
    })).toEqual({
      name: "baseline-ai",
      status: "SKIP",
      detail: "CONFIG_MISSING: 9router/oc/deepseek-v4-flash-free (non-loopback requires TOOL_AI_API_KEY)",
    });
  });
});
