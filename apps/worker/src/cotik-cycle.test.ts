import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseContext } from "@shop-health/db";

const mockDb = vi.hoisted(() => ({
  createOrGetPostIntent: vi.fn(),
  ensureCotikWorkflowSettings: vi.fn(),
  findCotikAccountById: vi.fn(),
  getCotikTrackingRunById: vi.fn(),
  getDecryptedCotikToken: vi.fn(),
  listAttemptsForIntent: vi.fn(),
  listInProgressPostIntents: vi.fn(),
  listPendingPostIntents: vi.fn(),
  listProviderCatalog: vi.fn(),
  recordPostAttempt: vi.fn(),
  resetCotikWorkflowSettingsForDeployment: vi.fn(),
  withCotikCycleExecutionLock: vi.fn()
}));

const mockCotik = vi.hoisted(() => ({
  checkOrderTrackingReady: vi.fn(),
  confirmOrderTrackingReadback: vi.fn(),
  createMultiAccountCotikClient: vi.fn(),
  postCotikTrackingBatch: vi.fn()
}));

const mockSync = vi.hoisted(() => ({
  resolveCotikTrackingInput: vi.fn(),
  runCotikDiscoverySync: vi.fn(),
  runCotikMultiAccountOrdersSync: vi.fn()
}));

vi.mock("@shop-health/db", () => mockDb);
vi.mock("@shop-health/cotik", () => mockCotik);
vi.mock("@shop-health/sync", () => mockSync);

import { runCotikWorkerCycle } from "./cotik-cycle.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.createOrGetPostIntent.mockImplementation(async (_db, input) => ({ ...input, id: "intent-1", attemptCount: 0, status: "PENDING" }));
  mockCotik.checkOrderTrackingReady.mockResolvedValue(true);
  mockDb.withCotikCycleExecutionLock.mockImplementation(
    async (_context: unknown, op: () => Promise<unknown>) => op()
  );
  mockDb.listInProgressPostIntents.mockResolvedValue([]);
  mockDb.findCotikAccountById.mockResolvedValue({ status: "ACTIVE", lastSeenAt: new Date("2026-01-01") });
  mockDb.getCotikTrackingRunById.mockResolvedValue({ mode: "REPLAY" });
  mockSync.resolveCotikTrackingInput.mockImplementation(
    async (_db: unknown, input: { logicalShopId: string; orderId: string; tracking: string; region: "US" | "UK" }) => ({
      status: "RESOLVED",
      input: { ...input, accountId: "acc-1", providerId: "7352739623900022544" }
    })
  );
});

describe("runCotikWorkerCycle", () => {
  it("can run POST-only without discovery or order GET sync", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({ reset: false });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    mockDb.listPendingPostIntents.mockResolvedValue([]);

    await runCotikWorkerCycle({
      context: { db: {} } as DatabaseContext,
      deploymentId: "dep-post-only",
      skipDiscovery: true,
      skipOrderSync: true
    });

    expect(mockSync.runCotikDiscoverySync).not.toHaveBeenCalled();
    expect(mockSync.runCotikMultiAccountOrdersSync).not.toHaveBeenCalled();
  });

  it("persists a changed winner before reserving an untouched intent", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({ reset: false });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    mockDb.listPendingPostIntents.mockResolvedValueOnce([{ ...intentFixture(), accountId: "old-account", logicalShopId: "shop-1", region: "US" }]).mockResolvedValueOnce([]);
    mockDb.listAttemptsForIntent.mockResolvedValue([]);
    mockDb.listProviderCatalog.mockResolvedValue([]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("test-token");
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    await runCotikWorkerCycle({ context: { db: {} } as DatabaseContext, deploymentId: "dep-1" });
    expect(mockDb.createOrGetPostIntent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accountId: "acc-1", logicalShopId: "shop-1" }));
  });

  it("does not reserve or POST when current remote order readiness fails", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({ reset: false });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    mockDb.listPendingPostIntents.mockResolvedValue([{ ...intentFixture(), region: "US", logicalShopId: "shop-1" }]);
    mockDb.listAttemptsForIntent.mockResolvedValue([]);
    mockDb.listProviderCatalog.mockResolvedValue([]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("test-token");
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockCotik.checkOrderTrackingReady.mockResolvedValue(false);
    await runCotikWorkerCycle({ context: { db: {} } as DatabaseContext, deploymentId: "dep-1" });
    expect(mockCotik.checkOrderTrackingReady).toHaveBeenCalled();
    expect(mockDb.listPendingPostIntents.mock.calls.some((call) => call[2]?.reserve === true)).toBe(false);
    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
  });

  it("skips and returns LOCKED when the advisory lock cannot be acquired", async () => {
    mockDb.withCotikCycleExecutionLock.mockResolvedValue(null);

    const result = await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-100"
    });

    expect(result.status).toBe("LOCKED");
    expect(mockDb.resetCotikWorkflowSettingsForDeployment).not.toHaveBeenCalled();
  });

  it("allows a manual cycle without a deployment version when both switches are enabled", async () => {
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: true,
      cotikPostEnabled: true
    });
    mockDb.listPendingPostIntents.mockResolvedValue([]);

    const result = await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      skipDiscovery: true,
      skipOrderSync: true
    } as Parameters<typeof runCotikWorkerCycle>[0]);

    expect(result.status).toBe("COMPLETED");
    expect(result.deploymentReset).toBe(false);
    expect(mockDb.resetCotikWorkflowSettingsForDeployment).not.toHaveBeenCalled();
  });

  it("reports that manual POST is paused when either kill switch is off", async () => {
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: true,
      cotikPostEnabled: false
    });

    const result = await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      skipDiscovery: true,
      skipOrderSync: true
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.message).toBe("Cotik POST skipped: enable both kill switches before manual POST.");
    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
  });

  it("resets switches to OFF when a new deploymentId is observed", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({
      reset: true,
      previousDeploymentId: "dep-old",
      currentDeploymentId: "dep-new"
    });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: false,
      cotikPostEnabled: false
    });
    mockSync.runCotikDiscoverySync.mockResolvedValue({
      accountsProcessed: 0,
      shopsDiscovered: 0,
      accountsFailed: 0,
      accountSummaries: []
    });

    const result = await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-new",
      forceDiscovery: false
    });

    expect(result.deploymentReset).toBe(true);
    expect(result.syncEnabled).toBe(false);
    expect(result.postEnabled).toBe(false);
    expect(result.message).toBe("Cotik POST skipped: enable both kill switches before manual POST.");
    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
  });

  it("does NOT run any tracking writes when cotikPostEnabled is false", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({
      reset: false,
      previousDeploymentId: "dep-1",
      currentDeploymentId: "dep-1"
    });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: false,
      cotikPostEnabled: false
    });

    const result = await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-1"
    });

    expect(result.postEnabled).toBe(false);
    expect(mockDb.listPendingPostIntents).not.toHaveBeenCalled();
    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
  });

  it("does not reserve when either switch is off", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({
      reset: false,
      previousDeploymentId: "dep-1",
      currentDeploymentId: "dep-1"
    });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: false, cotikPostEnabled: true });

    await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-1"
    });

    expect(mockDb.listPendingPostIntents).not.toHaveBeenCalled();
    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
  });

  it("processes pending intents and records attempts when cotikPostEnabled is true", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({
      reset: false,
      previousDeploymentId: "dep-1",
      currentDeploymentId: "dep-1"
    });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({
      cotikSyncEnabled: true,
      cotikPostEnabled: true
    });
    mockDb.listPendingPostIntents.mockImplementation(
      async (_db: unknown, _limit: number, options?: { reserve?: boolean }) => [
        {
          ...intentFixture(),
          region: "US",
          status: options?.reserve === true ? "IN_PROGRESS" : "PENDING",
          attemptCount: options?.reserve === true ? 1 : 0
        }
      ]
    );
    mockDb.listProviderCatalog.mockResolvedValue([
      { providerId: "7352739623900022544", carrierName: "Gofo", region: "US", isActive: true }
    ]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockDb.listAttemptsForIntent.mockResolvedValue([]);
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockCotik.postCotikTrackingBatch.mockResolvedValue({
      status: "CONFIRMED",
      confirmedOrders: ["ord-1"],
      unconfirmedOrders: [],
      failedOrders: [],
      rejectedItems: [],
      logUpdate: []
    });
    mockDb.recordPostAttempt.mockResolvedValue({});

    const result = await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-1"
    });

    expect(result.postEnabled).toBe(true);
    expect(mockCotik.postCotikTrackingBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        isPostAuthorized: expect.any(Function),
        items: [
          {
            orderId: "ord-1",
            tracking: "GFU123456789012345",
            providerId: "7352739623900022544"
          }
        ]
      })
    );
    const postInput = mockCotik.postCotikTrackingBatch.mock.calls[0]?.[0] as {
      isPostAuthorized: () => Promise<boolean>;
    };
    await expect(postInput.isPostAuthorized()).resolves.toBe(true);
    expect(mockDb.recordPostAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        intentId: "intent-1",
        attemptNo: 1,
        outcome: "SUCCESS",
        readbackConfirmed: true
      })
    );
    expect(result.trackingOrdersConfirmed).toBe(1);
    expect(mockDb.listPendingPostIntents).toHaveBeenCalledWith(
      expect.anything(),
      50,
      expect.objectContaining({ reserve: false })
    );
  });

  it("processes only the requested replay run in account batches capped at 50", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({ reset: false });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    const replayIntents = Array.from({ length: 51 }, (_, index) => ({
      ...intentFixture(),
      id: `intent-${index + 1}`,
      orderId: `order-${index + 1}`,
      region: "US",
      runId: "replay-run-1"
    }));
    mockDb.listPendingPostIntents.mockImplementation(
      async (_db: unknown, _limit: number, options?: { reserve?: boolean }) =>
        options?.reserve === true
          ? replayIntents.slice(0, 50).map((intent) => ({ ...intent, status: "IN_PROGRESS", attemptCount: 1 }))
          : replayIntents
    );
    mockDb.listProviderCatalog.mockResolvedValue([]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockDb.listAttemptsForIntent.mockResolvedValue([]);
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockCotik.postCotikTrackingBatch.mockResolvedValue({
      status: "CONFIRMED",
      confirmedOrders: replayIntents.slice(0, 50).map((intent) => intent.orderId),
      unconfirmedOrders: [], failedOrders: [], rejectedItems: [], logUpdate: []
    });
    mockDb.recordPostAttempt.mockResolvedValue({});

    await runCotikWorkerCycle({
      context: { db: {} } as DatabaseContext,
      deploymentId: "dep-replay",
      trackingRunId: "replay-run-1",
      skipDiscovery: true,
      skipOrderSync: true
    });

    expect(mockDb.listPendingPostIntents).toHaveBeenCalledWith(
      expect.anything(),
      50,
      expect.objectContaining({ reserve: false, runId: "replay-run-1" })
    );
    expect(mockCotik.postCotikTrackingBatch).toHaveBeenCalledTimes(1);
    expect(mockCotik.postCotikTrackingBatch.mock.calls[0]?.[0].items).toHaveLength(50);
  });

  it("processes replay accounts sequentially", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({ reset: false });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    const replayIntents = [
      { ...intentFixture(), id: "intent-a", orderId: "order-a", accountId: "acc-a", region: "US", runId: "replay-run-1" },
      { ...intentFixture(), id: "intent-b", orderId: "order-b", accountId: "acc-b", region: "US", runId: "replay-run-1" }
    ];
    mockDb.listPendingPostIntents.mockImplementation(
      async (_db: unknown, _limit: number, options?: { reserve?: boolean }) =>
        options?.reserve === true
          ? replayIntents.map((intent) => ({ ...intent, status: "IN_PROGRESS", attemptCount: 1 }))
          : replayIntents
    );
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockDb.listAttemptsForIntent.mockResolvedValue([]);
    mockDb.recordPostAttempt.mockResolvedValue({});
    mockSync.resolveCotikTrackingInput.mockImplementation(
      async (_db: unknown, input: { orderId: string }) => ({
        status: "RESOLVED",
        input: {
          logicalShopId: "shop-1", orderId: input.orderId, tracking: "GFU123456789012345",
          provider: "Gofo", providerId: "7352739623900022544", region: "US",
          accountId: input.orderId === "order-a" ? "acc-a" : "acc-b"
        }
      })
    );
    mockCotik.createMultiAccountCotikClient.mockImplementation(({ accountId }: { accountId: string }) => ({ accountId }));
    const events: string[] = [];
    mockCotik.postCotikTrackingBatch.mockImplementation(async ({ client, items }: { client: { accountId: string }; items: Array<{ orderId: string }> }) => {
      events.push(`start:${client.accountId}`);
      await Promise.resolve();
      events.push(`end:${client.accountId}`);
      return { status: "CONFIRMED", confirmedOrders: items.map((item) => item.orderId), unconfirmedOrders: [], failedOrders: [], rejectedItems: [], logUpdate: [] };
    });

    await runCotikWorkerCycle({
      context: { db: {} } as DatabaseContext,
      deploymentId: "dep-replay-sequential",
      trackingRunId: "replay-run-1",
      skipDiscovery: true,
      skipOrderSync: true
    });

    expect(events).toEqual(["start:acc-a", "end:acc-a", "start:acc-b", "end:acc-b"]);
  });

  it("does not read back a non-US replay intent", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({ reset: false });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    mockDb.listInProgressPostIntents.mockResolvedValue([{ ...intentFixture(), region: "UK", runId: "replay-run-1", attemptCount: 1 }]);
    mockDb.listPendingPostIntents.mockResolvedValue([]);

    await runCotikWorkerCycle({
      context: { db: {} } as DatabaseContext,
      deploymentId: "dep-replay-us-only",
      trackingRunId: "replay-run-1",
      skipDiscovery: true,
      skipOrderSync: true
    });

    expect(mockCotik.confirmOrderTrackingReadback).not.toHaveBeenCalled();
  });

  it("does not dispatch a tracking run that is not an authorized replay run", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({ reset: false });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    mockDb.getCotikTrackingRunById.mockResolvedValue(null);

    const result = await runCotikWorkerCycle({
      context: { db: {} } as DatabaseContext,
      deploymentId: "dep-replay-unauthorized",
      trackingRunId: "unknown-run",
      skipDiscovery: true,
      skipOrderSync: true
    });

    expect(result.message).toBe("Cotik tracking run is not an authorized replay run");
    expect(mockDb.listPendingPostIntents).not.toHaveBeenCalled();
    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
  });

  it("rechecks both switches immediately before dispatch and fails closed", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({
      reset: false,
      previousDeploymentId: "dep-1",
      currentDeploymentId: "dep-1"
    });
    mockDb.ensureCotikWorkflowSettings
      .mockResolvedValueOnce({ cotikSyncEnabled: true, cotikPostEnabled: true })
      .mockResolvedValueOnce({ cotikSyncEnabled: true, cotikPostEnabled: false });
    mockDb.listPendingPostIntents
      .mockResolvedValueOnce([{ ...intentFixture(), region: "US" }])
      .mockResolvedValueOnce([{ ...intentFixture(), region: "US", status: "IN_PROGRESS", attemptCount: 1 }]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockDb.listProviderCatalog.mockResolvedValue([]);
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });

    await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-1"
    });

    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
  });

  it("reads back an uncertain prior attempt before retrying its POST", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({
      reset: false,
      previousDeploymentId: "dep-1",
      currentDeploymentId: "dep-1"
    });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    mockDb.listPendingPostIntents
      .mockResolvedValueOnce([{ ...intentFixture(), region: "US" }])
      .mockResolvedValueOnce([{ ...intentFixture(), region: "US", status: "IN_PROGRESS", attemptCount: 2 }]);
    mockDb.listAttemptsForIntent.mockResolvedValue([{ outcome: "TIMEOUT" }]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockDb.listProviderCatalog.mockResolvedValue([]);
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockCotik.confirmOrderTrackingReadback.mockResolvedValue(true);
    mockDb.recordPostAttempt.mockResolvedValue({});

    await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-1"
    });

    expect(mockCotik.confirmOrderTrackingReadback).toHaveBeenCalledWith(
      expect.anything(),
      "ord-1",
      "GFU123456789012345"
    );
    expect(mockCotik.postCotikTrackingBatch).not.toHaveBeenCalled();
    expect(mockDb.recordPostAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "SUCCESS", readbackConfirmed: true })
    );
  });

  it("records a thrown POST against the reserved attempt budget", async () => {
    mockDb.resetCotikWorkflowSettingsForDeployment.mockResolvedValue({
      reset: false,
      previousDeploymentId: "dep-1",
      currentDeploymentId: "dep-1"
    });
    mockDb.ensureCotikWorkflowSettings.mockResolvedValue({ cotikSyncEnabled: true, cotikPostEnabled: true });
    mockDb.listPendingPostIntents
      .mockResolvedValueOnce([{ ...intentFixture(), region: "US" }])
      .mockResolvedValueOnce([{ ...intentFixture(), region: "US", status: "IN_PROGRESS", attemptCount: 1 }]);
    mockDb.listAttemptsForIntent.mockResolvedValue([]);
    mockDb.getDecryptedCotikToken.mockResolvedValue("token-123");
    mockDb.listProviderCatalog.mockResolvedValue([]);
    mockCotik.createMultiAccountCotikClient.mockReturnValue({ accountId: "acc-1" });
    mockCotik.postCotikTrackingBatch.mockRejectedValue(new Error("request timeout"));
    mockDb.recordPostAttempt.mockResolvedValue({});

    await runCotikWorkerCycle({
      context: { db: {} } as unknown as DatabaseContext,
      deploymentId: "dep-1"
    });

    expect(mockDb.recordPostAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ intentId: "intent-1", outcome: "TIMEOUT", keepInProgress: true })
    );
    expect(mockCotik.postCotikTrackingBatch).toHaveBeenCalledTimes(1);
  });
});

function intentFixture() {
  return {
    id: "intent-1",
    orderId: "ord-1",
    tracking: "GFU123456789012345",
    providerId: "7352739623900022544",
    accountId: "acc-1",
    attemptCount: 0,
    maxAttempts: 3
  };
}
