import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addRefreshCheckpoint: vi.fn(),
  deleteRefreshCheckpoint: vi.fn(),
  getCurrentRefreshSettings: vi.fn(),
  setAutoRefreshEnabled: vi.fn(),
  setRefreshCheckpointEnabled: vi.fn(),
  setRefreshRetryOffsets: vi.fn(),
  updateRefreshCheckpoint: vi.fn(),
}));

vi.mock("@shop-health/db", () => mocks);
vi.mock("../db-runtime.js", () => ({
  withDatabase: async (_runtime: unknown, operation: (context: { db: object }) => Promise<unknown>) => operation({ db: {} }),
}));

import { registerRefreshSettingsCommands } from "./refresh-settings.js";

const runtime = { config: { LOG_LEVEL: "silent" }, logger: {} } as never;
const checkpoint = {
  id: "00000000-0000-4000-8000-000000000001",
  localTime: "09:17",
  enabled: true,
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
  updatedAt: new Date("2026-08-25T00:00:00.000Z"),
};

async function run(args: string[]): Promise<string> {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    registerRefreshSettingsCommands(program, runtime);
    await program.parseAsync(["node", "shop-health", ...args]);
    return output;
  } finally {
    write.mockRestore();
  }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentRefreshSettings.mockResolvedValue({
    autoRefreshEnabled: true,
    retryOffsetsMinutes: [0, 30, 120, 300, 600],
    revision: 1,
    timeZone: "Asia/Bangkok",
    checkpoints: [checkpoint],
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:00:00.000Z"),
  });
  mocks.setAutoRefreshEnabled.mockResolvedValue({
    autoRefreshEnabled: false,
    retryOffsetsMinutes: [0, 30, 120, 300, 600],
    revision: 2,
    timeZone: "Asia/Bangkok",
    checkpoints: [checkpoint],
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:00:01.000Z"),
  });
  mocks.setRefreshRetryOffsets.mockResolvedValue({
    autoRefreshEnabled: true,
    retryOffsetsMinutes: [0, 5, 60],
    revision: 2,
    timeZone: "Asia/Bangkok",
    checkpoints: [checkpoint],
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:00:01.000Z"),
  });
  mocks.addRefreshCheckpoint.mockResolvedValue(checkpoint);
  mocks.updateRefreshCheckpoint.mockResolvedValue(checkpoint);
  mocks.setRefreshCheckpointEnabled.mockResolvedValue({ ...checkpoint, enabled: false });
  mocks.deleteRefreshCheckpoint.mockResolvedValue(true);
});

describe("refresh-settings commands", () => {
  it("shows a JSON-safe current snapshot", async () => {
    const output = await run(["refresh-settings", "show", "--json"]);

    expect(JSON.parse(output)).toEqual({
      schemaVersion: "refresh-settings-current.v1",
      settings: {
        autoRefreshEnabled: true,
        retryOffsetsMinutes: [0, 30, 120, 300, 600],
        revision: 1,
        timeZone: "Asia/Bangkok",
        checkpoints: [{ ...checkpoint, createdAt: checkpoint.createdAt.toISOString(), updatedAt: checkpoint.updatedAt.toISOString() }],
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
    });
  });

  it("parses exact boolean and retry JSON commands", async () => {
    await run(["refresh-settings", "set-auto", "false", "--json"]);
    await run(["refresh-settings", "set-retries", "--offsets", "[0,5,60]", "--json"]);

    expect(mocks.setAutoRefreshEnabled).toHaveBeenCalledWith({}, { enabled: false });
    expect(mocks.setRefreshRetryOffsets).toHaveBeenCalledWith({}, { retryOffsets: [0, 5, 60] });
  });

  it("maps checkpoint CRUD operations without exposing database details", async () => {
    await run(["refresh-settings", "checkpoint", "add", "09:17", "--disabled", "--json"]);
    await run(["refresh-settings", "checkpoint", "edit", checkpoint.id, "06:42", "--json"]);
    await run(["refresh-settings", "checkpoint", "disable", checkpoint.id, "--json"]);
    await run(["refresh-settings", "checkpoint", "delete", checkpoint.id, "--json"]);

    expect(mocks.addRefreshCheckpoint).toHaveBeenCalledWith({}, { localTime: "09:17", enabled: false });
    expect(mocks.updateRefreshCheckpoint).toHaveBeenCalledWith({}, { checkpointId: checkpoint.id, localTime: "06:42" });
    expect(mocks.setRefreshCheckpointEnabled).toHaveBeenCalledWith({}, { checkpointId: checkpoint.id, enabled: false });
    expect(mocks.deleteRefreshCheckpoint).toHaveBeenCalledWith({}, { checkpointId: checkpoint.id });
  });

  it.each(["true ", "1", "TRUE", "False"]) ("rejects unsafe boolean %s", async (value) => {
    await expect(run(["refresh-settings", "set-auto", value, "--json"])).rejects.toThrow("must be exactly true or false");
    expect(mocks.setAutoRefreshEnabled).not.toHaveBeenCalled();
  });

  it.each(["[0,30.5]", "[]", "{\"offset\":0}", "not-json"]) ("rejects unsafe retry JSON %s", async (value) => {
    await expect(run(["refresh-settings", "set-retries", "--offsets", value, "--json"])).rejects.toThrow("--offsets");
    expect(mocks.setRefreshRetryOffsets).not.toHaveBeenCalled();
  });
});
