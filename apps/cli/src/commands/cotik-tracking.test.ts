import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureCotikWorkflowSettings: vi.fn(),
  findCotikAccountById: vi.fn(),
  getDecryptedCotikToken: vi.fn(),
  findPostIntentForTracking: vi.fn(),
  recordPostAttempt: vi.fn(),
  listProviderCatalog: vi.fn(),
  seedProviderCatalog: vi.fn(),
  setCotikWorkflowSettings: vi.fn(),
  runCotikDiscoverySync: vi.fn(),
  runCotikMultiAccountOrdersSync: vi.fn(),
  stageCotikTracking: vi.fn(),
  readCotikTrackingSheetBatch: vi.fn(),
  writeCotikTrackingSheetResults: vi.fn(),
  createMultiAccountCotikClient: vi.fn(),
  confirmOrderTrackingReadback: vi.fn(),
  printJson: vi.fn(),
  printKeyValues: vi.fn(),
  printTable: vi.fn()
}));

const cotikMocks = vi.hoisted(() => ({
  createMultiAccountCotikClient: vi.fn(),
  confirmOrderTrackingReadback: vi.fn(),
}));

vi.mock("@shop-health/db", () => ({
  ensureCotikWorkflowSettings: mocks.ensureCotikWorkflowSettings,
  findCotikAccountById: mocks.findCotikAccountById,
  getDecryptedCotikToken: mocks.getDecryptedCotikToken,
  findPostIntentForTracking: mocks.findPostIntentForTracking,
  recordPostAttempt: mocks.recordPostAttempt,
  listProviderCatalog: mocks.listProviderCatalog,
  seedProviderCatalog: mocks.seedProviderCatalog,
  setCotikWorkflowSettings: mocks.setCotikWorkflowSettings
}));

vi.mock("@shop-health/sync", () => ({
  runCotikDiscoverySync: mocks.runCotikDiscoverySync,
  runCotikMultiAccountOrdersSync: mocks.runCotikMultiAccountOrdersSync,
  stageCotikTracking: mocks.stageCotikTracking,
  readCotikTrackingSheetBatch: mocks.readCotikTrackingSheetBatch,
  writeCotikTrackingSheetResults: mocks.writeCotikTrackingSheetResults
}));

vi.mock("@shop-health/cotik", () => ({
  createMultiAccountCotikClient: cotikMocks.createMultiAccountCotikClient,
  confirmOrderTrackingReadback: cotikMocks.confirmOrderTrackingReadback
}));

vi.mock("../presentation/output.js", () => ({
  formatDate: () => "2026-09-07 12:00:00",
  printJson: mocks.printJson,
  printKeyValues: mocks.printKeyValues,
  printTable: mocks.printTable
}));

vi.mock("../db-runtime.js", () => ({
  withDatabase: async (
    _runtime: unknown,
    operation: (context: { db: object }) => Promise<unknown>
  ) => operation({ db: {} })
}));

import { registerCotikTrackingCommands } from "./cotik-tracking.js";
import type { CliRuntime } from "../runtime.js";

const dummyRuntime = {
  config: { DISPLAY_TIME_ZONE: "UTC" }
} as unknown as CliRuntime;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "server-google-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cotik-tracking CLI commands", () => {
  it("lists explicit provider catalog entries", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    mocks.listProviderCatalog.mockResolvedValue([
      {
        id: "catalog-1",
        region: "US",
        providerId: "7352739623900022544",
        carrierName: "Gofo",
        isActive: true
      }
    ]);

    await program.parseAsync(["node", "cli", "cotik-tracking", "providers", "list"]);

    expect(mocks.listProviderCatalog).toHaveBeenCalledWith({}, undefined);
    expect(mocks.printTable).toHaveBeenCalledWith(
      ["REGION", "CARRIER", "PROVIDER ID", "ACTIVE"],
      [["US", "Gofo", "7352739623900022544", "YES"]]
    );
  });

  it("seeds the explicit provider catalog without touching provider rules", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    mocks.seedProviderCatalog.mockResolvedValue([
      { id: "catalog-1", region: "US", providerId: "7352739623900022544", carrierName: "Gofo", isActive: true },
    ]);

    await program.parseAsync(["node", "cli", "cotik-tracking", "providers", "seed", "--json"]);

    expect(mocks.seedProviderCatalog).toHaveBeenCalledWith({});
    expect(mocks.printJson).toHaveBeenCalledWith({
      schemaVersion: "cotik-provider-catalog-seed.v1",
      providers: [{ id: "catalog-1", region: "US", providerId: "7352739623900022544", carrierName: "Gofo", isActive: true }],
    });
  });

  it("checks kill-switch status", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    mocks.ensureCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: false,
      cotikPostEnabled: false,
      deploymentId: "dep-prod-1",
      lastResetAt: new Date(),
      updatedAt: new Date()
    });

    await program.parseAsync(["node", "cli", "cotik-tracking", "kill-switch", "status"]);

    expect(mocks.printKeyValues).toHaveBeenCalledWith([
      ["Cotik Sync Enabled", "OFF"],
      ["Cotik POST Enabled", "OFF"],
      ["Active Deployment ID", "dep-prod-1"],
      ["Last Reset At", "2026-09-07 12:00:00"],
      ["Updated At", "2026-09-07 12:00:00"]
    ]);
  });

  it("toggles kill-switch settings", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    mocks.setCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: true,
      cotikPostEnabled: false,
      updatedAt: new Date()
    });

    await program.parseAsync([
      "node",
      "cli",
      "cotik-tracking",
      "kill-switch",
      "set",
      "--sync",
      "true",
      "--post",
      "false"
    ]);

    expect(mocks.setCotikWorkflowSettings).toHaveBeenCalledWith(expect.anything(), {
      cotikSyncEnabled: true,
      cotikPostEnabled: false
    });
  });

  it("triggers manual discovery sync", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    mocks.runCotikDiscoverySync.mockResolvedValue({
      accountsProcessed: 2,
      shopsDiscovered: 4,
      accountsFailed: 0
    });

    await program.parseAsync(["node", "cli", "cotik-tracking", "sync", "--discovery"]);

    expect(mocks.runCotikDiscoverySync).toHaveBeenCalled();
    expect(mocks.printKeyValues).toHaveBeenCalledWith([
      ["Accounts Processed", "2"],
      ["Shops Discovered", "4"],
      ["Accounts Failed", "0"]
    ]);
  });

  it("stages an explicit tracking input", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);
    mocks.stageCotikTracking.mockResolvedValue({
      status: "STAGED",
      candidateId: "candidate-1",
      intentId: "intent-1"
    });

    await program.parseAsync([
      "node", "cli", "cotik-tracking", "stage",
      "--shop-id", "shop-1",
      "--order-id", "order-1",
      "--tracking", "TRACK-1",
      "--provider", "DHL",
      "--region", "US"
    ]);

    expect(mocks.stageCotikTracking).toHaveBeenCalledWith({}, {
      logicalShopId: "shop-1",
      orderId: "order-1",
      tracking: "TRACK-1",
      provider: "DHL",
      region: "US"
    });
  });

  it("does not expose the legacy stage-sheet command that bypassed the fixed A/B/Y/Z/AC/W contract", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    const tracking = program.commands.find((command) => command.name() === "cotik-tracking");
    expect(tracking?.commands.some((command) => command.name() === "stage-sheet")).toBe(false);
  });

  it("stages date-scoped rows using Cotik OrderID from B, tracking from Z, and provider from AC", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);
    mocks.readCotikTrackingSheetBatch.mockResolvedValue({
      headerRow: 2,
      rows: [{ rowNumber: 3, orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "TRACK-Z", trackingColumn: "Z", providerNote: "USPS" }],
      skippedRows: []
    });
    mocks.stageCotikTracking.mockResolvedValue({ status: "STAGED", candidateId: "candidate-1", intentId: "intent-1" });

    await program.parseAsync([
      "node", "cli", "cotik-tracking", "stage-sheet-date",
      "--spreadsheet-id", "sheet-1", "--tab", "Tháng 9-US", "--range", "A1:AC2000",
      "--shop-id", "shop-1", "--region", "US", "--target-date", "2026-09-04", "--json"
    ]);

    expect(mocks.stageCotikTracking).toHaveBeenCalledWith({}, {
      logicalShopId: "shop-1", orderId: "cotik-order-1", tracking: "TRACK-Z", provider: "USPS", region: "US"
    });
  });

  it("does not allow date-scoped callers to override fixed source columns", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    const tracking = program.commands.find((command) => command.name() === "cotik-tracking");
    const stageDate = tracking?.commands.find((command) => command.name() === "stage-sheet-date");
    expect(stageDate?.options.some((option) => option.long === "--cotik-order-id-column")).toBe(false);
    expect(stageDate?.options.some((option) => option.long === "--date-column")).toBe(false);
  });

  it("rejects a date-scoped staging batch above the W21 limit before opening the database", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);
    mocks.readCotikTrackingSheetBatch.mockResolvedValue({
      headerRow: 2,
      rows: Array.from({ length: 51 }, (_, index) => ({
        rowNumber: index + 3,
        orderId: `cotik-order-${index + 1}`,
        sheinOrderId: `shein-order-${index + 1}`,
        tracking: `TRACK-${index + 1}`,
        trackingColumn: "Z",
        providerNote: "USPS"
      })),
      skippedRows: []
    });

    await expect(program.parseAsync([
      "node", "cli", "cotik-tracking", "stage-sheet-date",
      "--spreadsheet-id", "sheet-1", "--tab", "Tháng 9-US", "--range", "A1:AC2000",
      "--shop-id", "shop-1", "--region", "US", "--target-date", "2026-09-04"
    ])).rejects.toThrow("At most 50 rows may be staged per invocation");
    expect(mocks.stageCotikTracking).not.toHaveBeenCalled();
  });

  it("reconciles confirmed intents by exact B-column readback and writes only blank W cells", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);
    mocks.readCotikTrackingSheetBatch.mockResolvedValue({
      headerRow: 2,
      rows: [{ rowNumber: 3, orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "TRACK-Z", trackingColumn: "Z", providerNote: "USPS" }],
      skippedRows: []
    });
    mocks.findPostIntentForTracking.mockResolvedValue({
      id: "intent-1",
      accountId: "account-1",
      logicalShopId: "shop-1",
      orderId: "cotik-order-1",
      tracking: "TRACK-Z",
      providerId: "7117858858072016686",
      region: "US",
      status: "CONFIRMED",
      attemptCount: 1
    });
    mocks.findCotikAccountById.mockResolvedValue({ id: "account-1", status: "ACTIVE" });
    mocks.getDecryptedCotikToken.mockResolvedValue("server-token");
    cotikMocks.createMultiAccountCotikClient.mockReturnValue({ accountId: "account-1" });
    cotikMocks.confirmOrderTrackingReadback.mockResolvedValue(true);
    mocks.writeCotikTrackingSheetResults.mockResolvedValue([{ rowNumber: 3, status: "WRITTEN" }]);

    await program.parseAsync([
      "node", "cli", "cotik-tracking", "reconcile-sheet-date",
      "--spreadsheet-id", "sheet-1", "--tab", "Tháng 9-US", "--range", "A1:AC2000",
      "--shop-id", "shop-1", "--region", "US", "--target-date", "2026-09-04", "--json"
    ]);

    expect(cotikMocks.confirmOrderTrackingReadback).toHaveBeenCalledWith(expect.anything(), "cotik-order-1", "TRACK-Z");
    expect(mocks.writeCotikTrackingSheetResults).toHaveBeenCalledWith(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", results: [{ rowNumber: 3, result: "CONFIRMED | READBACK=OK | ATTEMPTS=1" }] },
      { accessToken: "server-google-token" }
    );
  });

  it.each(["FAILED", "ABORTED"] as const)("reads back %s intents before writing terminal evidence", async (status) => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);
    mocks.readCotikTrackingSheetBatch.mockResolvedValue({
      headerRow: 2,
      rows: [{ rowNumber: 3, orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "TRACK-Z", trackingColumn: "Z", providerNote: "USPS" }],
      skippedRows: []
    });
    mocks.findPostIntentForTracking.mockResolvedValue({
      id: "intent-1",
      accountId: "account-1",
      logicalShopId: "shop-1",
      orderId: "cotik-order-1",
      tracking: "TRACK-Z",
      providerId: "7117858858072016686",
      region: "US",
      status,
      attemptCount: status === "FAILED" ? 3 : 1
    });
    mocks.findCotikAccountById.mockResolvedValue({ id: "account-1", status: "ACTIVE" });
    mocks.getDecryptedCotikToken.mockResolvedValue("server-token");
    cotikMocks.createMultiAccountCotikClient.mockReturnValue({ accountId: "account-1" });
    cotikMocks.confirmOrderTrackingReadback.mockResolvedValue(false);
    mocks.writeCotikTrackingSheetResults.mockResolvedValue([{ rowNumber: 3, status: "WRITTEN" }]);

    await program.parseAsync([
      "node", "cli", "cotik-tracking", "reconcile-sheet-date",
      "--spreadsheet-id", "sheet-1", "--tab", "Tháng 9-US", "--range", "A1:AC2000",
      "--shop-id", "shop-1", "--region", "US", "--target-date", "2026-09-04", "--json"
    ]);

    expect(cotikMocks.confirmOrderTrackingReadback).toHaveBeenCalledWith(expect.anything(), "cotik-order-1", "TRACK-Z");
    expect(mocks.writeCotikTrackingSheetResults).toHaveBeenCalledWith(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", results: [{ rowNumber: 3, result: `${status} | READBACK=NOT_CONFIRMED | ATTEMPTS=${status === "FAILED" ? 3 : 1}` }] },
      { accessToken: "server-google-token" }
    );
  });

  it("records a readback conflict for a failed intent instead of claiming acceptance", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);
    mocks.readCotikTrackingSheetBatch.mockResolvedValue({
      headerRow: 2,
      rows: [{ rowNumber: 3, orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "TRACK-Z", trackingColumn: "Z", providerNote: "USPS" }],
      skippedRows: []
    });
    mocks.findPostIntentForTracking.mockResolvedValue({
      id: "intent-1",
      accountId: "account-1",
      logicalShopId: "shop-1",
      orderId: "cotik-order-1",
      tracking: "TRACK-Z",
      providerId: "7117858858072016686",
      region: "US",
      status: "FAILED",
      attemptCount: 3
    });
    mocks.findCotikAccountById.mockResolvedValue({ id: "account-1", status: "ACTIVE" });
    mocks.getDecryptedCotikToken.mockResolvedValue("server-token");
    cotikMocks.createMultiAccountCotikClient.mockReturnValue({ accountId: "account-1" });
    cotikMocks.confirmOrderTrackingReadback.mockResolvedValue(true);
    mocks.writeCotikTrackingSheetResults.mockResolvedValue([{ rowNumber: 3, status: "WRITTEN" }]);

    await program.parseAsync([
      "node", "cli", "cotik-tracking", "reconcile-sheet-date",
      "--spreadsheet-id", "sheet-1", "--tab", "Tháng 9-US", "--range", "A1:AC2000",
      "--shop-id", "shop-1", "--region", "US", "--target-date", "2026-09-04", "--json"
    ]);

    expect(mocks.writeCotikTrackingSheetResults).toHaveBeenCalledWith(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", results: [{ rowNumber: 3, result: "FAILED | READBACK=CONFLICT | ATTEMPTS=3" }] },
      { accessToken: "server-google-token" }
    );
  });

  it("rejects invalid kill-switch boolean strings", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    await expect(program.parseAsync([
      "node", "cli", "cotik-tracking", "kill-switch", "set", "--post", "yes"
    ])).rejects.toThrow("--post must be exactly true or false");
    expect(mocks.setCotikWorkflowSettings).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before enabling POST", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);

    await expect(program.parseAsync([
      "node", "cli", "cotik-tracking", "kill-switch", "set", "--post", "true"
    ])).rejects.toThrow("--confirm-post");
    expect(mocks.setCotikWorkflowSettings).not.toHaveBeenCalled();
  });

  it("accepts POST enablement only with explicit confirmation", async () => {
    const program = new Command();
    registerCotikTrackingCommands(program, dummyRuntime);
    mocks.setCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: false,
      cotikPostEnabled: true,
      updatedAt: new Date()
    });

    await program.parseAsync([
      "node", "cli", "cotik-tracking", "kill-switch", "set",
      "--post", "true", "--confirm-post"
    ]);

    expect(mocks.setCotikWorkflowSettings).toHaveBeenCalledWith({}, { cotikPostEnabled: true });
  });
});
