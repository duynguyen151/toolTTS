import { describe, expect, it } from "vitest";

import { parseSettingsRequest, safeAiTaskConfig } from "./settings-contract.js";

describe("settings request contract", () => {
  it("accepts refresh edits and rejects invalid Bangkok checkpoints", () => {
    expect(parseSettingsRequest({ action: "refresh", autoRefreshEnabled: false, retryOffsetsSeconds: [0, 30], addCheckpoint: "17:00" })).toMatchObject({ action: "refresh", autoRefreshEnabled: false });
    expect(() => parseSettingsRequest({ action: "refresh", addCheckpoint: "17:0" })).toThrow();
  });

  it("validates policy, AI task, and connection-test actions at the route boundary", () => {
    expect(parseSettingsRequest({ action: "policy-global", version: "risk-policy.v1", currency: "USD", thresholds: { stopOnHoldValueAt: "3500", stopDeliveryRateBelow: 0.7, minimumOrdersForRateRule: 10, resumeOnHoldValueBelow: "1000", resumeDeliveryRateAt: 0.8, stableCyclesBeforeResume: 2 }, caution: { onHoldValue: { mode: "DISABLED" }, deliveryRate: { mode: "DISABLED" } }, effectiveFrom: "2026-08-28T00:00:00Z" })).toMatchObject({ action: "policy-global" });
    expect(parseSettingsRequest({ action: "ai-test", taskId: "SHOP_HEALTH_REVIEWER", effectiveAt: "2026-08-28T00:00:00Z" })).toMatchObject({ action: "ai-test" });
    expect(() => parseSettingsRequest({ action: "ai-task", taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "m", secretRef: "bad ref", enabled: true, effectiveFrom: "2026-08-28T00:00:00Z" })).toThrow();
  });

  it("validates preserved AI task fields without accepting a client secret reference", () => {
    expect(() => parseSettingsRequest({ action: "ai-task", taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "not a url", model: "reviewer", preserveSecretRef: true, enabled: "false", effectiveFrom: "2026-08-28T00:00:00Z" })).toThrow();
    expect(() => parseSettingsRequest({ action: "ai-task", taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "reviewer", secretRef: "CUSTOM_AI_REF", preserveSecretRef: true, enabled: true, effectiveFrom: "2026-08-28T00:00:00Z" })).toThrow();
  });

  it("does not expose the configured secret reference in settings reads", () => {
    expect(safeAiTaskConfig({ taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "model", secretRef: "TOOL_AI_API_KEY", enabled: true, status: "ENABLED", parameters: { timeoutMs: 30_000 }, revisionId: "id", sequence: 1n, effectiveFrom: new Date(), createdAt: new Date() })).not.toHaveProperty("secretRef");
  });
});
