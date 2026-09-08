import { describe, expect, it, vi } from "vitest";
import { GET } from "./route.js";

vi.mock("../../../lib/operations-console-read.js", () => ({
  readConsoleShops: vi.fn().mockResolvedValue({
    items: [
      {
        id: "shop-1",
        profileNo: "118",
        displayName: "Shop 118",
        verificationState: "READY",
        syncState: "ACTIVE",
      },
    ],
    totalItems: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }),
}));

describe("GET /api/shops", () => {
  it("returns 200 OK with paginated real shops", async () => {
    const request = new Request("http://127.0.0.1:3080/api/shops?page=1&pageSize=20");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.totalItems).toBe(1);
    expect(body.data.items[0].profileNo).toBe("118");
  });
});
