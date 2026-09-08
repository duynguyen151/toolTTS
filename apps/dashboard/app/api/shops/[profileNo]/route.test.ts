import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, PATCH, DELETE } from "./route.js";

vi.mock("../../../../lib/operations-console-read.js", () => ({
  readConsoleShopDetail: vi.fn().mockImplementation((_dbUrl, profileNo) => {
    if (profileNo === "118") {
      return Promise.resolve({
        shop: { profileNo: "118", displayName: "Shop 118" },
        overview: { orderHealth: { total: "10" } },
        dataTab: { dataCoverage: "READY" },
        tagsTab: { profileTags: [] },
        syncTab: { syncRuns: [] },
        statsTab: { metrics: [] },
        baTab: { currentDecision: "CONTINUE" },
        auditTab: { auditLogs: [] },
      });
    }
    return Promise.resolve(null);
  }),
}));

const mockUpdateShopDisplayName = vi.fn();
const mockUnlinkShopByProfileNo = vi.fn();

vi.mock("@shop-health/db", () => ({
  createDatabase: vi.fn(() => ({ db: {} })),
  closeDatabase: vi.fn(() => Promise.resolve()),
  updateShopDisplayName: (...args: any[]) => mockUpdateShopDisplayName(...args),
  unlinkShopByProfileNo: (...args: any[]) => mockUnlinkShopByProfileNo(...args),
}));

describe("/api/shops/[profileNo]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/shop_health";
  });

  describe("GET", () => {
    it("returns 200 OK with shop detail when found", async () => {
      const request = new Request("http://127.0.0.1:3080/api/shops/118");
      const response = await GET(request, { params: Promise.resolve({ profileNo: "118" }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.shop.profileNo).toBe("118");
    });

    it("returns 404 Not Found when profile does not exist", async () => {
      const request = new Request("http://127.0.0.1:3080/api/shops/999");
      const response = await GET(request, { params: Promise.resolve({ profileNo: "999" }) });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("PROFILE_NOT_FOUND");
    });
  });

  describe("PATCH", () => {
    it("updates display name successfully", async () => {
      mockUpdateShopDisplayName.mockResolvedValueOnce({
        profileNo: "118",
        displayName: "Updated Shop Name",
      });

      const request = new Request("http://127.0.0.1:3080/api/shops/118", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Updated Shop Name" }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ profileNo: "118" }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.displayName).toBe("Updated Shop Name");
      expect(mockUpdateShopDisplayName).toHaveBeenCalledWith(expect.anything(), "118", "Updated Shop Name");
    });

    it("returns 400 when displayName is missing in body", async () => {
      const request = new Request("http://127.0.0.1:3080/api/shops/118", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await PATCH(request, { params: Promise.resolve({ profileNo: "118" }) });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("INVALID_REQUEST");
    });

    it("returns 404 when shop not found in DB", async () => {
      mockUpdateShopDisplayName.mockRejectedValueOnce(new Error("Shop not found with profileNo: 999"));

      const request = new Request("http://127.0.0.1:3080/api/shops/999", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "New Name" }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ profileNo: "999" }) });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("PROFILE_NOT_FOUND");
    });
  });

  describe("DELETE", () => {
    it("unlinks shop successfully and returns updated state", async () => {
      mockUnlinkShopByProfileNo.mockResolvedValueOnce({
        profileNo: "118",
        enabled: false,
        syncState: "DISABLED",
      });

      const request = new Request("http://127.0.0.1:3080/api/shops/118", {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ profileNo: "118" }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.enabled).toBe(false);
      expect(body.data.syncState).toBe("DISABLED");
      expect(mockUnlinkShopByProfileNo).toHaveBeenCalledWith(expect.anything(), "118");
    });

    it("returns 404 when shop not found to unlink", async () => {
      mockUnlinkShopByProfileNo.mockRejectedValueOnce(new Error("Shop not found with profileNo: 999"));

      const request = new Request("http://127.0.0.1:3080/api/shops/999", {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ profileNo: "999" }) });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("PROFILE_NOT_FOUND");
    });
  });
});
