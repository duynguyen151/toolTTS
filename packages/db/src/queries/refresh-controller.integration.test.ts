import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { withRefreshProfileExecutionLock } from "../locks.js";
import { migrateDatabase } from "../migrations.js";
import { refreshCheckpointAttempts, refreshCheckpointRuns, refreshCheckpoints, refreshSettings, shops } from "../schema.js";
import { setAutoRefreshEnabled, setRefreshCheckpointEnabled, setRefreshRetryOffsets } from "./refresh-settings.js";
import {
  claimDueRefreshAttempts,
  completeRefreshAttempt,
  getRefreshCheckpointRun,
  recordRefreshAttemptStarted,
  recordRefreshAttemptProxyPreflight,
  renewRefreshAttemptLease,
} from "./refresh-controller.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const checkpointTime = "07:00";
const preflightCheckpointTime = "07:02";
const nextCheckpointTime = "07:03";
const initialNow = new Date("2026-01-15T00:00:00.000Z");

describeWithDatabase("refresh checkpoint controller PostgreSQL persistence", () => {
  let context: DatabaseContext;
  let firstShopId: string;
  let secondShopId: string;
  let checkpointId: string;
  let preflightCheckpointId: string;
  let nextCheckpointId: string;
  let originalAutoRefreshEnabled: boolean;
  let originalRetryOffsetsSeconds: number[];

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const settings = await context.db.select().from(refreshSettings).where(eq(refreshSettings.singletonId, 1)).limit(1);
    originalAutoRefreshEnabled = settings[0]?.autoRefreshEnabled ?? true;
    originalRetryOffsetsSeconds = settings[0]?.retryOffsetsSeconds ?? [0, 30, 120, 300, 600];
    const suffix = randomUUID();
    const [firstShop, secondShop, checkpoint, preflightCheckpoint, nextCheckpoint] = await Promise.all([
      context.db.insert(shops).values({ profileId: `refresh-controller-${suffix}-1`, profileNo: `refresh-controller-${suffix}-1`, region: "US", locale: "en-US" }).returning({ id: shops.id }),
      context.db.insert(shops).values({ profileId: `refresh-controller-${suffix}-2`, profileNo: `refresh-controller-${suffix}-2`, region: "US", locale: "en-US" }).returning({ id: shops.id }),
      context.db.insert(refreshCheckpoints).values({ localTime: checkpointTime, enabled: true }).returning({ id: refreshCheckpoints.id }),
      context.db.insert(refreshCheckpoints).values({ localTime: preflightCheckpointTime, enabled: true }).returning({ id: refreshCheckpoints.id }),
      context.db.insert(refreshCheckpoints).values({ localTime: nextCheckpointTime, enabled: true }).returning({ id: refreshCheckpoints.id }),
    ]);
    firstShopId = firstShop[0]!.id;
    secondShopId = secondShop[0]!.id;
    checkpointId = checkpoint[0]!.id;
    preflightCheckpointId = preflightCheckpoint[0]!.id;
    nextCheckpointId = nextCheckpoint[0]!.id;
  });

  afterAll(async () => {
    if (!context) return;
    await setAutoRefreshEnabled(context.db, { enabled: originalAutoRefreshEnabled });
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: originalRetryOffsetsSeconds });
    const runs = await context.db.select({ id: refreshCheckpointRuns.id }).from(refreshCheckpointRuns)
      .where(inArray(refreshCheckpointRuns.shopId, [firstShopId, secondShopId]));
    if (runs.length > 0) {
      await context.db.delete(refreshCheckpointAttempts).where(inArray(refreshCheckpointAttempts.runId, runs.map((run) => run.id)));
    }
    await context.db.delete(refreshCheckpointRuns).where(eq(refreshCheckpointRuns.shopId, firstShopId));
    await context.db.delete(refreshCheckpointRuns).where(eq(refreshCheckpointRuns.shopId, secondShopId));
    await context.db.delete(refreshCheckpoints).where(eq(refreshCheckpoints.id, checkpointId));
    await context.db.delete(refreshCheckpoints).where(eq(refreshCheckpoints.id, preflightCheckpointId));
    await context.db.delete(refreshCheckpoints).where(eq(refreshCheckpoints.id, nextCheckpointId));
    await context.db.delete(shops).where(eq(shops.id, firstShopId));
    await context.db.delete(shops).where(eq(shops.id, secondShopId));
    await closeDatabase(context);
  });

  it("claims only due checkpoints at the strict Bangkok instant and respects Auto OFF", async () => {
    await setAutoRefreshEnabled(context.db, { enabled: false });
    await expect(claimDueRefreshAttempts(context.db, { now: initialNow, shops: [{ id: firstShopId }] })).resolves.toEqual([]);

    await setAutoRefreshEnabled(context.db, { enabled: true });
    const claimed = await claimDueRefreshAttempts(context.db, { now: initialNow, shops: [{ id: firstShopId }] });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ shopId: firstShopId, checkpointId, businessDate: "2026-01-15", status: "RUNNING" });
  });

  it("serializes concurrent automatic claims to one owner", async () => {
    const now = new Date("2026-01-16T00:00:00.000Z");
    const [left, right] = await Promise.all([
      claimDueRefreshAttempts(context.db, { now, shops: [{ id: secondShopId }] }),
      claimDueRefreshAttempts(context.db, { now, shops: [{ id: secondShopId }] }),
    ]);
    const claimed = [...left, ...right].filter((run) => run.checkpointId === checkpointId);
    expect(claimed).toHaveLength(1);
  });

  it("permits only one concurrent AdsPower profile execution lock", async () => {
    const first = withRefreshProfileExecutionLock(context, "profile-shared", async () => {
      const second = await withRefreshProfileExecutionLock(context, "profile-shared", async () => true);
      expect(second).toBeNull();
      return true;
    });
    await expect(first).resolves.toBe(true);
  });

  it("persists retry timing from the cycle snapshot across a repository restart", async () => {
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: [0, 30] });
    const now = new Date("2026-01-17T00:00:00.000Z");
    const [run] = await claimDueRefreshAttempts(context.db, { now, shops: [{ id: firstShopId }] });
    expect(run).toBeDefined();
    const attempt = await recordRefreshAttemptStarted(context.db, { runId: run!.id, claimToken: run!.claimToken!, now });
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: [0, 5, 60] });
    await completeRefreshAttempt(context.db, {
      runId: run!.id,
      attemptId: attempt.id,
      claimToken: run!.claimToken!,
      outcome: "FAILURE",
      failureMessage: "temporary failure",
      now: new Date("2026-01-17T00:00:01.000Z"),
    });

    const durable = await getRefreshCheckpointRun(context.db, { shopId: firstShopId, checkpointId, businessDate: "2026-01-17" });
    expect(durable.run).toMatchObject({ status: "RETRY_WAIT", retryOffsetsSeconds: [0, 30], nextAttemptAt: new Date("2026-01-17T00:00:30.000Z") });
    expect(durable.attempts).toMatchObject([{ attemptNumber: 1, status: "FAILED", nextAttemptAt: new Date("2026-01-17T00:00:30.000Z") }]);
  });

  it("persists only safe proxy preflight metadata on the owned running attempt", async () => {
    const now = new Date("2026-01-18T00:00:00.000Z");
    const claimed = await claimDueRefreshAttempts(context.db, { now, shops: [{ id: firstShopId }] });
    const run = claimed.find((candidate) => candidate.checkpointId === preflightCheckpointId)!;
    const attempt = await recordRefreshAttemptStarted(context.db, {
      runId: run.id,
      claimToken: run.claimToken!,
      now,
    });

    await expect(recordRefreshAttemptProxyPreflight(context.db, {
      runId: run.id,
      attemptId: attempt.id,
      claimToken: run.claimToken!,
      preflight: {
        status: "DEGRADED",
        latencyMs: 1_001,
        exitIp: "8.8.8.8",
        reasonClass: "OBSERVED_SLOW",
      },
    })).resolves.toBe(true);

    const durable = await getRefreshCheckpointRun(context.db, {
      shopId: firstShopId,
      checkpointId: preflightCheckpointId,
      businessDate: "2026-01-18",
    });
    expect(durable.attempts).toMatchObject([{
      id: attempt.id,
      proxyPreflight: {
        status: "DEGRADED",
        latencyMs: 1_001,
        exitIp: "8.8.8.8",
        reasonClass: "OBSERVED_SLOW",
      },
    }]);
    await completeRefreshAttempt(context.db, {
      runId: run.id,
      attemptId: attempt.id,
      claimToken: run.claimToken!,
      outcome: "SUCCESS",
      now: new Date(now.getTime() + 1),
    });
  });

  it("closes success and creates a distinct later-checkpoint reevaluation cycle", async () => {
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: [0] });
    const now = new Date("2026-01-18T00:00:00.000Z");
    const claimed = await claimDueRefreshAttempts(context.db, { now, shops: [{ id: firstShopId }] });
    const run = claimed.find((candidate) => candidate.checkpointId === checkpointId)!;
    const attempt = await recordRefreshAttemptStarted(context.db, { runId: run.id, claimToken: run.claimToken!, now });
    await expect(completeRefreshAttempt(context.db, { runId: run.id, attemptId: attempt.id, claimToken: run.claimToken!, outcome: "SUCCESS", now })).resolves.toMatchObject({ status: "SUCCEEDED" });

    const later = await claimDueRefreshAttempts(context.db, { now: new Date("2026-01-18T00:01:00.000Z"), shops: [{ id: firstShopId }] });
    expect(later).toEqual(expect.arrayContaining([expect.objectContaining({ checkpointId: nextCheckpointId, status: "RUNNING" })]));
  });

  it("does not reclaim a legitimately long-running attempt whose active worker renews its lease", async () => {
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: [0] });
    const now = new Date("2026-01-19T00:00:00.000Z");
    const [run] = await claimDueRefreshAttempts(context.db, { now, shops: [{ id: firstShopId }] });
    const attempt = await recordRefreshAttemptStarted(context.db, { runId: run!.id, claimToken: run!.claimToken!, now });
    const renewedAt = new Date(now.getTime() + 89_000);
    await expect(renewRefreshAttemptLease(context.db, { runId: run!.id, attemptId: attempt.id, claimToken: run!.claimToken!, now: renewedAt })).resolves.toBe(true);

    await expect(claimDueRefreshAttempts(context.db, {
      now: new Date(now.getTime() + 90_001),
      shops: [{ id: firstShopId }],
    })).resolves.toEqual([]);
    await expect(completeRefreshAttempt(context.db, {
      runId: run!.id,
      attemptId: attempt.id,
      claimToken: run!.claimToken!,
      outcome: "SUCCESS",
      now: new Date(now.getTime() + 180_000),
    })).resolves.toMatchObject({ status: "SUCCEEDED" });
  });

  it("terminalizes disabled and prior-date retry cycles without erasing their attempt audit", async () => {
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: [0, 30] });
    const disabledNow = new Date("2026-01-20T00:00:00.000Z");
    const [disabledRun] = await claimDueRefreshAttempts(context.db, { now: disabledNow, shops: [{ id: firstShopId }] });
    const disabledAttempt = await recordRefreshAttemptStarted(context.db, {
      runId: disabledRun!.id,
      claimToken: disabledRun!.claimToken!,
      now: disabledNow,
    });
    await completeRefreshAttempt(context.db, {
      runId: disabledRun!.id,
      attemptId: disabledAttempt.id,
      claimToken: disabledRun!.claimToken!,
      outcome: "FAILURE",
      failureMessage: "retry later",
      now: new Date(disabledNow.getTime() + 1),
    });
    await setRefreshCheckpointEnabled(context.db, { checkpointId, enabled: false });
    await claimDueRefreshAttempts(context.db, { now: new Date(disabledNow.getTime() + 2), shops: [{ id: firstShopId }] });
    const disabledDurable = await getRefreshCheckpointRun(context.db, { shopId: firstShopId, checkpointId, businessDate: "2026-01-20" });
    expect(disabledDurable.run).toMatchObject({ status: "FAILED_EXHAUSTED", lastFailureMessage: "Refresh checkpoint is disabled" });
    expect(disabledDurable.attempts).toMatchObject([{ id: disabledAttempt.id, status: "FAILED", failureMessage: "retry later" }]);

    await setRefreshCheckpointEnabled(context.db, { checkpointId, enabled: true });
    const rolloverNow = new Date("2026-01-21T00:00:00.000Z");
    const [rolloverRun] = await claimDueRefreshAttempts(context.db, { now: rolloverNow, shops: [{ id: firstShopId }] });
    const rolloverAttempt = await recordRefreshAttemptStarted(context.db, {
      runId: rolloverRun!.id,
      claimToken: rolloverRun!.claimToken!,
      now: rolloverNow,
    });
    await completeRefreshAttempt(context.db, {
      runId: rolloverRun!.id,
      attemptId: rolloverAttempt.id,
      claimToken: rolloverRun!.claimToken!,
      outcome: "FAILURE",
      failureMessage: "retry tomorrow",
      now: new Date(rolloverNow.getTime() + 1),
    });
    await claimDueRefreshAttempts(context.db, { now: new Date("2026-01-22T00:00:00.000Z"), shops: [{ id: firstShopId }] });
    const rolloverDurable = await getRefreshCheckpointRun(context.db, { shopId: firstShopId, checkpointId, businessDate: "2026-01-21" });
    expect(rolloverDurable.run).toMatchObject({ status: "FAILED_EXHAUSTED", lastFailureMessage: "Refresh checkpoint cycle is from a prior Bangkok business date" });
    expect(rolloverDurable.attempts).toMatchObject([{ id: rolloverAttempt.id, status: "FAILED", failureMessage: "retry tomorrow" }]);
    await expect(claimDueRefreshAttempts(context.db, { now: new Date("2026-01-22T00:00:00.000Z"), shops: [{ id: firstShopId }] }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ businessDate: "2026-01-22", checkpointId })]));
  });
});
