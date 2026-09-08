import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route.js";

const routeMocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  findShopById: vi.fn(),
  createCotikClient: vi.fn(),
  runCotikOrdersSync: vi.fn(),
  runCotikSupplementaryFinanceSync: vi.fn(),
}));

vi.mock("../../../../../lib/server/operations/request.js", () => ({
  jsonHeaders: () => ({ "content-type": "application/json" }),
}));

vi.mock("@shop-health/db", () => ({
  createDatabase: routeMocks.createDatabase,
  closeDatabase: routeMocks.closeDatabase,
  findShopById: routeMocks.findShopById,
}));

vi.mock("@shop-health/cotik", () => ({
  createCotikClient: routeMocks.createCotikClient,
}));

vi.mock("@shop-health/sync", () => ({
  runCotikOrdersSync: routeMocks.runCotikOrdersSync,
  runCotikSupplementaryFinanceSync: routeMocks.runCotikSupplementaryFinanceSync,
}));

describe("/api/sync/cotik/account POST route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COTIK_TOKEN_TUAN;
    process.env.DATABASE_URL = "postgres://test";
  });

  it("returns 400 when request body is not valid JSON", async () => {
    const request = new Request("http://localhost:3000/api/sync/cotik/account", {
      method: "POST",
      body: "not-json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 when accountKey is missing", async () => {
    const request = new Request("http://localhost:3000/api/sync/cotik/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("ACCOUNT_KEY_REQUIRED");
  });

  it("returns 404 when accountKey is not in known accounts", async () => {
    const request = new Request("http://localhost:3000/api/sync/cotik/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountKey: "unknown-acc" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("returns 500 when token for the account is missing", async () => {
    const request = new Request("http://localhost:3000/api/sync/cotik/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountKey: "tuan" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("COTIK_TOKEN_MISSING");
  });

  it("syncs all shops belonging to the account successfully", async () => {
    process.env.COTIK_TOKEN_TUAN = "test-token-tuan";

    const mockBindings = [
      {
        id: "binding-1",
        shopId: "shop-1",
        provider: "COTIK",
        enabled: true,
        provenance: { tokenKey: "COTIK_TOKEN_TUAN", accountKey: "tuan" },
      },
    ];

    routeMocks.createDatabase.mockReturnValue({
      db: {
        query: {
          shopProviderBindings: {
            findMany: vi.fn().mockResolvedValue(mockBindings),
          },
        },
      },
    });
    routeMocks.closeDatabase.mockResolvedValue(undefined);
    routeMocks.findShopById.mockResolvedValue({ id: "shop-1", profileNo: "619", displayName: "Shop 619" });
    routeMocks.createCotikClient.mockReturnValue({});
    routeMocks.runCotikOrdersSync.mockResolvedValue({
      status: "SUCCEEDED",
      mode: "INITIAL_ALL_AVAILABLE",
      rowsWritten: 10,
    });
    routeMocks.runCotikSupplementaryFinanceSync.mockResolvedValue({
      status: "SUCCEEDED",
      rowsWritten: 2,
    });

    const request = new Request("http://localhost:3000/api/sync/cotik/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountKey: "tuan" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.accountKey).toBe("tuan");
    expect(body.accountName).toBe("Tuấn");
    expect(body.totalShops).toBe(1);
    expect(body.succeededShops).toBe(1);
    expect(body.failedShops).toBe(0);
    expect(body.details[0].status).toBe("SUCCEEDED");
    expect(body.details[0].ordersCount).toBe(10);
    expect(body.details[0].financeCount).toBe(2);
  });
});
