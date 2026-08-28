import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route.js";

const routeMocks = vi.hoisted(() => ({
  parseLocalProfileRequest: vi.fn(),
  findShopByProfileNo: vi.fn(),
  createDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  createCotikClient: vi.fn(),
  runCotikOrdersSync: vi.fn(),
  runCotikSupplementaryFinanceSync: vi.fn(),
}));

vi.mock("../../../../lib/server/operations/request.js", () => ({
  jsonHeaders: () => ({ "content-type": "application/json" }),
  parseLocalProfileRequest: routeMocks.parseLocalProfileRequest,
}));

vi.mock("@shop-health/db", () => ({
  findShopByProfileNo: routeMocks.findShopByProfileNo,
  createDatabase: routeMocks.createDatabase,
  closeDatabase: routeMocks.closeDatabase,
}));

vi.mock("@shop-health/cotik", () => ({
  createCotikClient: routeMocks.createCotikClient,
}));

vi.mock("@shop-health/sync", () => ({
  runCotikOrdersSync: routeMocks.runCotikOrdersSync,
  runCotikSupplementaryFinanceSync: routeMocks.runCotikSupplementaryFinanceSync,
}));

describe("/api/sync/cotik POST route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COTIK_TOKEN;
    delete process.env.COTIK_API_KEY;
    process.env.DATABASE_URL = "postgres://test";
  });

  it("fails closed with 500 when COTIK token is missing (no dummy token fallback)", async () => {
    routeMocks.parseLocalProfileRequest.mockResolvedValue({ ok: true, profileNo: "957" });

    const request = new Request("http://localhost:3000/api/sync/cotik", {
      method: "POST",
      body: JSON.stringify({ profileNo: "957" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "COTIK_TOKEN_MISSING", message: "COTIK_TOKEN or COTIK_API_KEY is not configured." },
    });
    expect(routeMocks.createCotikClient).not.toHaveBeenCalled();
  });

  it("does not report ok: true if orders and finance sync results are SKIPPED", async () => {
    process.env.COTIK_TOKEN = "valid-token";
    routeMocks.parseLocalProfileRequest.mockResolvedValue({ ok: true, profileNo: "957" });
    routeMocks.createDatabase.mockReturnValue({ db: {} });
    routeMocks.closeDatabase.mockResolvedValue(undefined);
    routeMocks.findShopByProfileNo.mockResolvedValue({ id: "shop-957", profileNo: "957" });
    routeMocks.createCotikClient.mockReturnValue({});
    routeMocks.runCotikOrdersSync.mockResolvedValue({
      status: "SKIPPED",
      skipReason: "COTIK_BINDING_INACTIVE",
    });
    routeMocks.runCotikSupplementaryFinanceSync.mockResolvedValue({
      status: "SKIPPED",
      skipReason: "COTIK_SUPPLEMENTARY_FINANCE_UNAVAILABLE",
    });

    const request = new Request("http://localhost:3000/api/sync/cotik", {
      method: "POST",
      body: JSON.stringify({ profileNo: "957" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.cotikOrders.status).toBe("SKIPPED");
    expect(body.cotikFinance.status).toBe("SKIPPED");
  });

  it("executes orders and finance sequentially and requires orders success for ok: true", async () => {
    process.env.COTIK_TOKEN = "valid-token";
    routeMocks.parseLocalProfileRequest.mockResolvedValue({ ok: true, profileNo: "957" });
    routeMocks.createDatabase.mockReturnValue({ db: {} });
    routeMocks.closeDatabase.mockResolvedValue(undefined);
    routeMocks.findShopByProfileNo.mockResolvedValue({ id: "shop-957", profileNo: "957" });
    routeMocks.createCotikClient.mockReturnValue({});

    const executionOrder: string[] = [];
    routeMocks.runCotikOrdersSync.mockImplementation(async () => {
      executionOrder.push("orders");
      return { status: "SUCCEEDED", rowsWritten: 10 };
    });
    routeMocks.runCotikSupplementaryFinanceSync.mockImplementation(async () => {
      executionOrder.push("finance");
      return { status: "SUCCEEDED", rowsWritten: 3 };
    });

    const request = new Request("http://localhost:3000/api/sync/cotik", {
      method: "POST",
      body: JSON.stringify({ profileNo: "957" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(executionOrder).toEqual(["orders", "finance"]);
    expect(body.ok).toBe(true);
    expect(body.cotikOrders.status).toBe("SUCCEEDED");
    expect(body.cotikFinance.status).toBe("SUCCEEDED");
  });

  it("does not report ok: true when Orders fails or skips even if supplementary finance succeeds", async () => {
    process.env.COTIK_TOKEN = "valid-token";
    routeMocks.parseLocalProfileRequest.mockResolvedValue({ ok: true, profileNo: "957" });
    routeMocks.createDatabase.mockReturnValue({ db: {} });
    routeMocks.closeDatabase.mockResolvedValue(undefined);
    routeMocks.findShopByProfileNo.mockResolvedValue({ id: "shop-957", profileNo: "957" });
    routeMocks.createCotikClient.mockReturnValue({});
    routeMocks.runCotikOrdersSync.mockResolvedValue({
      status: "SKIPPED",
      skipReason: "COTIK_BINDING_INACTIVE",
    });
    routeMocks.runCotikSupplementaryFinanceSync.mockResolvedValue({
      status: "SUCCEEDED",
      rowsWritten: 5,
    });

    const request = new Request("http://localhost:3000/api/sync/cotik", {
      method: "POST",
      body: JSON.stringify({ profileNo: "957" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.cotikOrders.status).toBe("SKIPPED");
    expect(body.cotikFinance.status).toBe("SUCCEEDED");
  });

  it("reports ok: true when Orders succeeds and supplementary finance is skipped due to capability unavailable", async () => {
    process.env.COTIK_TOKEN = "valid-token";
    routeMocks.parseLocalProfileRequest.mockResolvedValue({ ok: true, profileNo: "957" });
    routeMocks.createDatabase.mockReturnValue({ db: {} });
    routeMocks.closeDatabase.mockResolvedValue(undefined);
    routeMocks.findShopByProfileNo.mockResolvedValue({ id: "shop-957", profileNo: "957" });
    routeMocks.createCotikClient.mockReturnValue({});
    routeMocks.runCotikOrdersSync.mockResolvedValue({
      status: "SUCCEEDED",
      rowsWritten: 5,
    });
    routeMocks.runCotikSupplementaryFinanceSync.mockResolvedValue({
      status: "SKIPPED",
      skipReason: "COTIK_SUPPLEMENTARY_FINANCE_UNAVAILABLE",
    });

    const request = new Request("http://localhost:3000/api/sync/cotik", {
      method: "POST",
      body: JSON.stringify({ profileNo: "957" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.cotikOrders.status).toBe("SUCCEEDED");
  });
});
