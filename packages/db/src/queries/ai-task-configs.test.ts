import { describe, expect, it } from "vitest";

import type { Database } from "../client.js";
import { appendAiTaskConfigRevision, getCurrentAiTaskConfig } from "./ai-task-configs.js";

const unusedDb = {} as Database;
const reviewer = {
  taskId: "SHOP_HEALTH_REVIEWER",
  provider: "9router",
  baseUrl: "http://127.0.0.1:20128/v1",
  model: "oc/deepseek-v4-flash-free",
  parameters: {},
  secretRef: "TOOL_AI_API_KEY",
  enabled: true,
  status: "ENABLED" as const,
  effectiveFrom: new Date("2026-08-25T00:00:00.000Z"),
} as const;

describe("AI task config repository input validation", () => {
  it("rejects secret-shaped fields and unknown metadata before touching the database", async () => {
    for (const input of [
      { ...reviewer, apiKey: "secret-value" },
      { ...reviewer, secretRef: "sk-live-secret" },
      { ...reviewer, parameters: { temperature: 0 } },
    ]) {
      await expect(appendAiTaskConfigRevision(unusedDb, input as never)).rejects.toThrow();
    }
  });

  it("rejects invalid effective dates and future tasks enabled before touching the database", async () => {
    await expect(appendAiTaskConfigRevision(unusedDb, {
      ...reviewer,
      effectiveFrom: new Date("invalid"),
    })).rejects.toThrow();
    await expect(appendAiTaskConfigRevision(unusedDb, {
      ...reviewer,
      taskId: "FINANCE_SPECIALIST",
    })).rejects.toThrow();
    await expect(getCurrentAiTaskConfig(unusedDb, {
      taskId: "SHOP_HEALTH_REVIEWER",
      effectiveAt: new Date("invalid"),
    })).rejects.toThrow();
  });
});
