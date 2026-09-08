import { describe, expect, it, vi } from "vitest";
import type { Database } from "../client.js";
import { resetCotikWorkflowSettingsForDeployment } from "./cotik-workflow.js";

describe("deployment switch reset", () => {
  it("rejects a blank deployment identity rather than keeping previously enabled settings", async () => {
    await expect(resetCotikWorkflowSettingsForDeployment({} as Database, "  ")).rejects.toThrow("Deployment ID");
  });
  it("sets both switches OFF for a changed deployment", async () => {
    const current = { id: "singleton", deploymentId: "old", cotikSyncEnabled: true, cotikPostEnabled: true };
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      insert: () => ({ values: () => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }) }),
      select: () => ({ from: () => ({ limit: vi.fn().mockResolvedValue([current]) }) }),
      update: () => ({ set })
    } as unknown as Database;
    const result = await resetCotikWorkflowSettingsForDeployment(db, "new");
    expect(result.reset).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ cotikSyncEnabled: false, cotikPostEnabled: false, deploymentId: "new" }));
  });
});
