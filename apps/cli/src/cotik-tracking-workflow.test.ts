import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureCotikWorkflowSettings: vi.fn(),
  setCotikWorkflowSettings: vi.fn(),
  findCotikLogicalShopByMaShopNoiBo: vi.fn(),
  findCotikAccountById: vi.fn(),
  findPostIntentForTracking: vi.fn(),
  getDecryptedCotikToken: vi.fn(),
  readCotikTrackingSheetBatch: vi.fn(),
  stageCotikTracking: vi.fn(),
  writeCotikTrackingSheetResults: vi.fn(),
  confirmOrderTrackingReadback: vi.fn(),
  createMultiAccountCotikClient: vi.fn(),
  runCotikWorkerCycle: vi.fn()
}));

vi.mock("@shop-health/db", () => ({
  ensureCotikWorkflowSettings: mocks.ensureCotikWorkflowSettings,
  setCotikWorkflowSettings: mocks.setCotikWorkflowSettings,
  findCotikLogicalShopByMaShopNoiBo: mocks.findCotikLogicalShopByMaShopNoiBo,
  findCotikAccountById: mocks.findCotikAccountById,
  findPostIntentForTracking: mocks.findPostIntentForTracking,
  getDecryptedCotikToken: mocks.getDecryptedCotikToken
}));

vi.mock("@shop-health/sync", () => ({
  readCotikTrackingSheetBatch: mocks.readCotikTrackingSheetBatch,
  groupCotikTrackingRows: (rows: Array<Record<string, unknown>>) => rows.map((row) => ({
    orderId: String(row.orderId ?? ""),
    rows: [row],
    status: "READY",
    tracking: String(row.tracking ?? ""),
    providerNote: String(row.providerNote ?? "")
  })),
  stageCotikTracking: mocks.stageCotikTracking,
  writeCotikTrackingSheetResults: mocks.writeCotikTrackingSheetResults
}));

vi.mock("@shop-health/cotik", () => ({
  confirmOrderTrackingReadback: mocks.confirmOrderTrackingReadback,
  createMultiAccountCotikClient: mocks.createMultiAccountCotikClient
}));

vi.mock("@shop-health/worker/cycle", () => ({
  runCotikWorkerCycle: mocks.runCotikWorkerCycle
}));

vi.mock("./db-runtime.js", () => ({
  withDatabase: async (
    _runtime: unknown,
    operation: (context: { db: object }) => Promise<unknown>
  ) => operation({ db: {} })
}));

import { createAutoTrackingCapability } from "./cotik-tracking-workflow.js";

const runtime = {
  config: {
    COTIK_DEPLOY_VERSION: "v1.0.0",
    DISPLAY_TIME_ZONE: "UTC"
  },
  logger: {}
} as never;

const input = {
  spreadsheetId: "sheet-1",
  tab: "Tháng 9-US",
  range: "A1:AC2000",
  region: "US" as const,
  fromDate: "2026-09-04"
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "google-token");
  mocks.readCotikTrackingSheetBatch.mockResolvedValue({
    headerRow: 2,
    rows: [{
      rowNumber: 11,
      orderId: "cotik-order-1",
      sheinOrderId: "shein-order-1",
      tracking: "TRACK-1",
      trackingColumn: "Z",
      providerNote: "USPS",
       account: "101"
    }],
    skippedRows: []
  });
  mocks.stageCotikTracking.mockResolvedValue({
    status: "STAGED",
    candidateId: "candidate-1",
    intentId: "intent-1"
  });
  mocks.findCotikLogicalShopByMaShopNoiBo.mockResolvedValue({ id: "shop-101", region: "US" });
  mocks.runCotikWorkerCycle.mockResolvedValue({
    status: "COMPLETED",
    deploymentReset: false,
    syncEnabled: true,
    postEnabled: true,
    trackingBatchesExecuted: 1,
    trackingOrdersConfirmed: 1
  });
  mocks.findPostIntentForTracking.mockResolvedValue({
    id: "intent-1",
    accountId: "account-1",
    status: "CONFIRMED",
    attemptCount: 1,
    orderId: "cotik-order-1",
    tracking: "TRACK-1"
  });
  mocks.findCotikAccountById.mockResolvedValue({ status: "ACTIVE" });
  mocks.getDecryptedCotikToken.mockResolvedValue("cotik-token");
  mocks.createMultiAccountCotikClient.mockReturnValue({});
  mocks.confirmOrderTrackingReadback.mockResolvedValue(true);
  mocks.writeCotikTrackingSheetResults.mockResolvedValue([{ rowNumber: 11, status: "WRITTEN" }]);
  mocks.ensureCotikWorkflowSettings.mockResolvedValue({
    cotikSyncEnabled: true,
    cotikPostEnabled: true,
    deploymentId: "deployment-1"
  });
  mocks.setCotikWorkflowSettings.mockResolvedValue({
    cotikSyncEnabled: false,
    cotikPostEnabled: false,
    deploymentId: "deployment-1"
  });
});

describe("auto-tracking capability", () => {
  it("executes the existing stage, worker, and readback workflow", async () => {
    const capability = createAutoTrackingCapability(runtime);

    const result = await capability.execute(input);

    expect(mocks.stageCotikTracking).toHaveBeenCalledWith({}, expect.objectContaining({
      logicalShopId: "shop-101",
      orderId: "cotik-order-1",
      tracking: "TRACK-1",
      provider: "USPS",
      region: "US"
    }));
    expect(mocks.runCotikWorkerCycle).toHaveBeenCalledWith(expect.objectContaining({
      skipDiscovery: true,
      skipOrderSync: true
    }));
    expect(mocks.confirmOrderTrackingReadback).toHaveBeenCalledWith({}, "cotik-order-1", "TRACK-1");
    expect(result.action).toBe("execute");
    expect(result.reconcile.writeback).toEqual([{ rowNumber: 11, status: "WRITTEN" }]);
  });

  it("resolves each group from its Q maShopNoiBo value", async () => {
    mocks.readCotikTrackingSheetBatch.mockResolvedValue({
      headerRow: 2,
      rows: [
         { rowNumber: 11, orderId: "cotik-order-1", tracking: "TRACK-1", providerNote: "USPS", account: "101" },
         { rowNumber: 12, orderId: "cotik-order-2", tracking: "TRACK-2", providerNote: "USPS", account: "202" }
      ],
      skippedRows: []
    });
    mocks.findCotikLogicalShopByMaShopNoiBo
      .mockResolvedValueOnce({ id: "shop-101", region: "US" })
      .mockResolvedValueOnce({ id: "shop-202", region: "US" });

    await createAutoTrackingCapability(runtime).execute(input);

    expect(mocks.findCotikLogicalShopByMaShopNoiBo).toHaveBeenNthCalledWith(1, {}, "101");
    expect(mocks.findCotikLogicalShopByMaShopNoiBo).toHaveBeenNthCalledWith(2, {}, "202");
    expect(mocks.stageCotikTracking).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ logicalShopId: "shop-101" }));
    expect(mocks.stageCotikTracking).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ logicalShopId: "shop-202" }));
  });

  it("does not write the sheet when writeback is false", async () => {
    const capability = createAutoTrackingCapability(runtime);

    const result = await capability.execute({ ...input, writeback: false });

    expect(mocks.writeCotikTrackingSheetResults).not.toHaveBeenCalled();
    expect(result.reconcile.writeback).toEqual([]);
  });

  it("returns status without running the write workflow", async () => {
    const capability = createAutoTrackingCapability(runtime);

    const result = await capability.status();

    expect(result.action).toBe("status");
    expect(result.settings.cotikPostEnabled).toBe(true);
    expect(mocks.runCotikWorkerCycle).not.toHaveBeenCalled();
  });

  it("stops both switches without enabling anything", async () => {
    const capability = createAutoTrackingCapability(runtime);

    const result = await capability.stop();

    expect(mocks.setCotikWorkflowSettings).toHaveBeenCalledWith({}, {
      cotikSyncEnabled: false,
      cotikPostEnabled: false
    });
    expect(result.action).toBe("stop");
  });
});
