import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendAiTaskConfigRevision: vi.fn(),
  getCurrentAiTaskConfig: vi.fn(),
}));

vi.mock("@shop-health/db", () => mocks);
vi.mock("../db-runtime.js", () => ({
  withDatabase: async (_runtime: unknown, operation: (context: { db: object }) => Promise<unknown>) => operation({ db: {} }),
}));

import { registerAiTaskCommands } from "./ai-task.js";

const runtime = { config: { LOG_LEVEL: "silent" }, logger: {} } as never;
const effectiveFrom = "2026-08-25T00:00:00.000Z";
const payload = {
  provider: "9router",
  baseUrl: "http://127.0.0.1:20128/v1",
  model: "oc/big-pickle",
  parameters: {},
  secretRef: "TOOL_AI_API_KEY",
  enabled: true,
  status: "ENABLED",
};

async function run(args: string[]): Promise<string> {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    registerAiTaskCommands(program, runtime);
    await program.parseAsync(["node", "shop-health", ...args]);
    return output;
  } finally {
    write.mockRestore();
  }
}

describe("AI task commands", () => {
  beforeEach(() => {
    mocks.appendAiTaskConfigRevision.mockReset();
    mocks.getCurrentAiTaskConfig.mockReset();
    mocks.appendAiTaskConfigRevision.mockResolvedValue({
      revisionId: "00000000-0000-4000-8000-000000000001", sequence: 1n,
      taskId: "SHOP_HEALTH_REVIEWER", enabled: true, status: "ENABLED", effectiveFrom: new Date(effectiveFrom),
    });
    mocks.getCurrentAiTaskConfig.mockResolvedValue(null);
  });

  it("appends reviewer metadata without a secret value", async () => {
    await run(["ai-task", "set", "SHOP_HEALTH_REVIEWER", "--effective-from", effectiveFrom, "--payload", JSON.stringify(payload), "--json"]);
    expect(mocks.appendAiTaskConfigRevision).toHaveBeenCalledWith({}, {
      ...payload,
      taskId: "SHOP_HEALTH_REVIEWER",
      effectiveFrom: new Date(effectiveFrom),
    });
    expect(JSON.stringify(mocks.appendAiTaskConfigRevision.mock.calls)).not.toContain("apiKey");
  });

  it("reads an exact effective task revision and rejects unknown task IDs", async () => {
    await run(["ai-task", "read-effective", "SHOP_HEALTH_REVIEWER", "--effective-at", effectiveFrom, "--json"]);
    expect(mocks.getCurrentAiTaskConfig).toHaveBeenCalledWith({}, {
      taskId: "SHOP_HEALTH_REVIEWER", effectiveAt: new Date(effectiveFrom),
    });
    await expect(run(["ai-task", "set", "UNKNOWN", "--effective-from", effectiveFrom, "--payload", JSON.stringify(payload)])).rejects.toThrow("Unknown AI task ID");
  });

  it("rejects impossible calendar timestamps before appending", async () => {
    await expect(run([
      "ai-task", "set", "SHOP_HEALTH_REVIEWER", "--effective-from", "2026-02-30T00:00:00Z", "--payload", JSON.stringify(payload),
    ])).rejects.toThrow("--effective-from must be an ISO timestamp with an explicit UTC or offset");
    expect(mocks.appendAiTaskConfigRevision).not.toHaveBeenCalled();
  });
});
