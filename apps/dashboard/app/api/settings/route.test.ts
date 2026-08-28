import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  appendAiTaskConfigRevision: vi.fn(), appendGlobalRiskPolicyRevision: vi.fn(), appendShopRiskPolicyOverrideRevision: vi.fn(),
  addRefreshCheckpoint: vi.fn(), closeDatabase: vi.fn(), createDatabase: vi.fn(), deleteRefreshCheckpoint: vi.fn(),
  disableShopRiskPolicyOverride: vi.fn(), getCurrentAiTaskConfig: vi.fn(), getCurrentRefreshSettings: vi.fn(),
  setAutoRefreshEnabled: vi.fn(), setRefreshCheckpointEnabled: vi.fn(), setRefreshRetryOffsets: vi.fn(), updateRefreshCheckpoint: vi.fn(),
}));

vi.mock("@shop-health/db", () => db);
vi.mock("@shop-health/decision-ai", async (importOriginal) => ({ ...await importOriginal<typeof import("@shop-health/decision-ai")>(), resolveAiTaskConfig: vi.fn(), testAiTaskConnection: vi.fn() }));

import { POST } from "./route.js";

describe("settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://settings-test";
    db.createDatabase.mockReturnValue({ db: {} });
    db.closeDatabase.mockResolvedValue(undefined);
  });

  it("rejects malformed settings before opening the database", async () => {
    const response = await POST(new Request("http://127.0.0.1/api/settings", { method: "POST", body: JSON.stringify({ action: "ai-test", taskId: "NOPE", effectiveAt: "now" }) }));

    expect(response.status).toBe(400);
    expect(db.createDatabase).not.toHaveBeenCalled();
  });

  it("never returns an AI task secret reference after appending a revision", async () => {
    db.appendAiTaskConfigRevision.mockResolvedValue({ taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "reviewer", secretRef: "TOOL_AI_API_KEY", enabled: true, status: "ENABLED", parameters: {}, revisionId: "00000000-0000-4000-8000-000000000001", sequence: 1n, effectiveFrom: new Date("2026-08-28T00:00:00.000Z"), createdAt: new Date("2026-08-28T00:00:00.000Z") });
    const response = await POST(new Request("http://127.0.0.1/api/settings", { method: "POST", body: JSON.stringify({ action: "ai-task", taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "reviewer", secretRef: "TOOL_AI_API_KEY", enabled: true, effectiveFrom: "2026-08-28T00:00:00Z" }) }));
    const body = await response.json() as { data: Record<string, unknown> };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data).not.toHaveProperty("secretRef");
  });

  it("returns the post-mutation checkpoint snapshot", async () => {
    db.getCurrentRefreshSettings
      .mockResolvedValueOnce({ autoRefreshEnabled: true, retryOffsetsSeconds: [0], timeZone: "Asia/Bangkok", revision: 1, checkpoints: [] })
      .mockResolvedValueOnce({ autoRefreshEnabled: true, retryOffsetsSeconds: [0], timeZone: "Asia/Bangkok", revision: 2, checkpoints: [{ id: "checkpoint-1", localTime: "17:00", enabled: true }] });
    db.addRefreshCheckpoint.mockResolvedValue({ id: "checkpoint-1", localTime: "17:00", enabled: true });

    const response = await POST(new Request("http://127.0.0.1/api/settings", { method: "POST", body: JSON.stringify({ action: "refresh", addCheckpoint: "17:00" }) }));
    const body = await response.json() as { data: { checkpoints: Array<{ localTime: string }> } };

    expect(response.status).toBe(200);
    expect(body.data.checkpoints).toEqual([{ id: "checkpoint-1", localTime: "17:00", enabled: true }]);
  });

  it("preserves a custom existing secret reference when an AI task is edited", async () => {
    db.getCurrentAiTaskConfig.mockResolvedValue({ secretRef: "CUSTOM_AI_REF" });
    db.appendAiTaskConfigRevision.mockResolvedValue({ taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "reviewer", secretRef: "CUSTOM_AI_REF", enabled: true, status: "ENABLED", parameters: {}, revisionId: "00000000-0000-4000-8000-000000000001", sequence: 1n, effectiveFrom: new Date("2026-08-28T00:00:00.000Z"), createdAt: new Date("2026-08-28T00:00:00.000Z") });
    const response = await POST(new Request("http://127.0.0.1/api/settings", { method: "POST", body: JSON.stringify({ action: "ai-task", taskId: "SHOP_HEALTH_REVIEWER", provider: "openai-compatible", baseUrl: "https://ai.example", model: "reviewer", preserveSecretRef: true, enabled: true, effectiveFrom: "2026-08-28T00:00:00Z" }) }));

    expect(response.status).toBe(200);
    expect(db.appendAiTaskConfigRevision).toHaveBeenCalledWith({}, expect.objectContaining({ secretRef: "CUSTOM_AI_REF" }));
    expect(JSON.stringify(await response.json())).not.toContain("CUSTOM_AI_REF");
  });
});
