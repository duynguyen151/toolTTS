import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route.js";

const mocks = vi.hoisted(() => ({
  closeDatabase: vi.fn(),
  createDatabase: vi.fn(),
  getCotikWorkflowSettings: vi.fn(),
  setCotikWorkflowSettings: vi.fn(),
}));

vi.mock("@shop-health/db", () => ({
  closeDatabase: mocks.closeDatabase,
  createDatabase: mocks.createDatabase,
  getCotikWorkflowSettings: mocks.getCotikWorkflowSettings,
  setCotikWorkflowSettings: mocks.setCotikWorkflowSettings,
}));

describe("/api/cotik/kill-switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
    mocks.createDatabase.mockReturnValue({ db: {} });
    mocks.closeDatabase.mockResolvedValue(undefined);
  });

  it("returns both switches disabled when no settings row exists", async () => {
    mocks.getCotikWorkflowSettings.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost:3000/api/cotik/kill-switch"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      cotikSyncEnabled: false,
      cotikPostEnabled: false,
      deploymentId: null,
      lastResetAt: null,
      updatedAt: null,
    });
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("secret");
  });

  it("rejects cross-origin reads", async () => {
    const response = await GET(new Request("http://localhost:3000/api/cotik/kill-switch", {
      headers: { origin: "https://evil.example" },
    }));

    expect(response.status).toBe(403);
    expect(mocks.createDatabase).not.toHaveBeenCalled();
  });

  it("requires strict booleans and explicit confirmation before enabling", async () => {
    const response = await POST(new Request("http://localhost:3000/api/cotik/kill-switch", {
      method: "POST",
      body: JSON.stringify({ cotikPostEnabled: "true" }),
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(mocks.setCotikWorkflowSettings).not.toHaveBeenCalled();
  });

  it("does not enable a switch without explicit confirmation", async () => {
    const response = await POST(new Request("http://localhost:3000/api/cotik/kill-switch", {
      method: "POST",
      body: JSON.stringify({ cotikPostEnabled: true, confirmEnable: false }),
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("ENABLE_CONFIRMATION_REQUIRED");
    expect(mocks.setCotikWorkflowSettings).not.toHaveBeenCalled();
  });

  it("allows an explicit disable without confirmation and never triggers live work", async () => {
    mocks.setCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: false,
      cotikPostEnabled: false,
      deploymentId: null,
      lastResetAt: null,
      updatedAt: new Date("2026-09-07T00:00:00.000Z"),
    });

    const response = await POST(new Request("http://localhost:3000/api/cotik/kill-switch", {
      method: "POST",
      body: JSON.stringify({ cotikPostEnabled: false }),
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).cotikPostEnabled).toBe(false);
    expect(mocks.setCotikWorkflowSettings).toHaveBeenCalledWith({}, { cotikPostEnabled: false });
  });

  it("enables only after explicit confirmation", async () => {
    mocks.setCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: false,
      cotikPostEnabled: true,
      deploymentId: "deployment-1",
      lastResetAt: new Date("2026-09-07T00:00:00.000Z"),
      updatedAt: new Date("2026-09-07T00:00:00.000Z"),
    });

    const response = await POST(new Request("http://localhost:3000/api/cotik/kill-switch", {
      method: "POST",
      body: JSON.stringify({ cotikPostEnabled: true, confirmEnable: true }),
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).cotikPostEnabled).toBe(true);
    expect(mocks.setCotikWorkflowSettings).toHaveBeenCalledWith({}, { cotikPostEnabled: true });
  });

  it("does not expose caught database error details", async () => {
    mocks.setCotikWorkflowSettings.mockRejectedValue(new Error("postgres://user:secret@db/raw SQL"));

    const response = await POST(new Request("http://localhost:3000/api/cotik/kill-switch", {
      method: "POST",
      body: JSON.stringify({ cotikPostEnabled: false }),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "COTIK_SETTINGS_UPDATE_FAILED", message: "Cotik kill-switch settings could not be updated." },
    });
  });
});
