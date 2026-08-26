import { randomUUID } from "node:crypto";

import {
  RefreshBusinessDateSchema,
  RefreshCheckpointAttemptRecordSchema,
  RefreshCheckpointRunRecordSchema,
  RefreshRetryOffsetsSchema,
  calculateRetryAt,
  getBangkokBusinessDate,
  getDueRefreshCheckpoints,
  getRefreshCycleIneligibility,
  type RefreshCheckpointAttemptRecord,
  type RefreshCheckpointRunRecord,
  type RefreshCheckpointSchedule,
} from "@shop-health/domain";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DatabaseTransaction } from "../client.js";
import { refreshCheckpointAttempts, refreshCheckpointRuns, refreshCheckpoints, refreshSettings } from "../schema.js";

/** Matches the bounded 90s Seller Center endpoint operation; a dead worker never owns a profile indefinitely. */
export const REFRESH_CLAIM_LEASE_MS = 90_000;

const UuidSchema = z.string().uuid();
const FiniteDateSchema = z.date().refine((value) => Number.isFinite(value.getTime()), "date must be finite");
const ClaimInputSchema = z.strictObject({
  now: FiniteDateSchema,
  shops: z.array(z.strictObject({ id: UuidSchema })).min(1),
});
const StartInputSchema = z.strictObject({
  runId: UuidSchema,
  claimToken: UuidSchema,
  now: FiniteDateSchema,
});
const CompleteInputSchema = z.strictObject({
  runId: UuidSchema,
  attemptId: UuidSchema,
  claimToken: UuidSchema,
  outcome: z.enum(["SUCCESS", "FAILURE"]),
  failureMessage: z.string().trim().min(1).max(2_000).optional(),
  now: FiniteDateSchema,
});
const RenewLeaseInputSchema = z.strictObject({
  runId: UuidSchema,
  attemptId: UuidSchema,
  claimToken: UuidSchema,
  now: FiniteDateSchema,
});
const ReleaseClaimInputSchema = z.strictObject({
  runId: UuidSchema,
  claimToken: UuidSchema,
  now: FiniteDateSchema,
});
const GetRunInputSchema = z.strictObject({
  shopId: UuidSchema,
  checkpointId: UuidSchema,
  businessDate: RefreshBusinessDateSchema,
});

export type ClaimDueRefreshAttemptsInput = z.input<typeof ClaimInputSchema>;
export type RecordRefreshAttemptStartedInput = z.input<typeof StartInputSchema>;
export type CompleteRefreshAttemptInput = z.input<typeof CompleteInputSchema>;
export type RenewRefreshAttemptLeaseInput = z.input<typeof RenewLeaseInputSchema>;
export type ReleaseRefreshClaimInput = z.input<typeof ReleaseClaimInputSchema>;
export type GetRefreshCheckpointRunInput = z.input<typeof GetRunInputSchema>;

function toRun(row: typeof refreshCheckpointRuns.$inferSelect): RefreshCheckpointRunRecord {
  return RefreshCheckpointRunRecordSchema.parse(row);
}

function toAttempt(row: typeof refreshCheckpointAttempts.$inferSelect): RefreshCheckpointAttemptRecord {
  return RefreshCheckpointAttemptRecordSchema.parse(row);
}

function checkpointInstant(businessDate: string, localTime: string): Date {
  const date = new Date(`${RefreshBusinessDateSchema.parse(businessDate)}T${localTime}:00+07:00`);
  if (!Number.isFinite(date.getTime())) throw new Error("Unable to construct Bangkok checkpoint instant");
  return date;
}

function nextAttemptAt(run: RefreshCheckpointRunRecord): Date | null {
  return calculateRetryAt(run.cycleStartedAt, run.attemptCount + 1, run.retryOffsetsSeconds);
}

function assertClaimedRun(run: RefreshCheckpointRunRecord, claimToken: string): void {
  if (run.status !== "RUNNING" || run.claimToken !== claimToken) {
    throw new Error("Refresh checkpoint run is not claimed by this worker");
  }
}

async function lockSettings(transaction: DatabaseTransaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended('refresh-settings', 0))`);
}

async function recoverExpiredClaims(
  transaction: DatabaseTransaction,
  shopIds: readonly string[],
  now: Date,
): Promise<void> {
  const staleBefore = new Date(now.getTime() - REFRESH_CLAIM_LEASE_MS);
  const expiredRuns = await transaction.select().from(refreshCheckpointRuns).where(and(
    inArray(refreshCheckpointRuns.shopId, [...shopIds]),
    eq(refreshCheckpointRuns.status, "RUNNING"),
    lte(refreshCheckpointRuns.claimedAt, staleBefore),
  )).for("update", { skipLocked: true });
  for (const row of expiredRuns) {
    const run = toRun(row);
    const [attempt] = await transaction.select().from(refreshCheckpointAttempts).where(and(
      eq(refreshCheckpointAttempts.runId, run.id),
      eq(refreshCheckpointAttempts.claimToken, run.claimToken!),
      eq(refreshCheckpointAttempts.status, "RUNNING"),
    )).for("update").limit(1);
    const scheduledAt = nextAttemptAt(run);
    if (attempt !== undefined) {
      await transaction.update(refreshCheckpointAttempts).set({
        status: "FAILED",
        finishedAt: now,
        nextAttemptAt: scheduledAt,
        failureMessage: "Worker claim lease expired before attempt completion",
      }).where(eq(refreshCheckpointAttempts.id, attempt.id));
    }
    await transaction.update(refreshCheckpointRuns).set({
      status: scheduledAt === null ? "FAILED_EXHAUSTED" : "RETRY_WAIT",
      nextAttemptAt: scheduledAt,
      claimedAt: null,
      claimToken: null,
      completedAt: scheduledAt === null ? now : null,
      lastFailureMessage: attempt === undefined ? null : "Worker claim lease expired before attempt completion",
      updatedAt: now,
    }).where(eq(refreshCheckpointRuns.id, run.id));
  }
}

async function recoverIneligibleRefreshCyclesInTransaction(
  transaction: DatabaseTransaction,
  shopIds: readonly string[],
  now: Date,
): Promise<void> {
  const activeRuns = await transaction.select({
    run: refreshCheckpointRuns,
    checkpoint: refreshCheckpoints,
  }).from(refreshCheckpointRuns).innerJoin(
    refreshCheckpoints,
    eq(refreshCheckpointRuns.checkpointId, refreshCheckpoints.id),
  ).where(and(
    inArray(refreshCheckpointRuns.shopId, [...shopIds]),
    eq(refreshCheckpointRuns.status, "RETRY_WAIT"),
  )).for("update", { skipLocked: true });
  for (const { run: row, checkpoint: checkpointRow } of activeRuns) {
    const run = toRun(row);
    const reason = getRefreshCycleIneligibility({
      now,
      businessDate: run.businessDate,
      checkpoint: checkpointRow,
    });
    if (reason === null) continue;
    if (run.status === "RUNNING") {
      const [attempt] = await transaction.select().from(refreshCheckpointAttempts).where(and(
        eq(refreshCheckpointAttempts.runId, run.id),
        eq(refreshCheckpointAttempts.claimToken, run.claimToken!),
        eq(refreshCheckpointAttempts.status, "RUNNING"),
      )).for("update").limit(1);
      if (attempt !== undefined) {
        await transaction.update(refreshCheckpointAttempts).set({
          status: "FAILED",
          finishedAt: now,
          nextAttemptAt: null,
          failureMessage: reason,
        }).where(eq(refreshCheckpointAttempts.id, attempt.id));
      }
    }
    await transaction.update(refreshCheckpointRuns).set({
      status: "FAILED_EXHAUSTED",
      nextAttemptAt: null,
      claimedAt: null,
      claimToken: null,
      completedAt: now,
      lastFailureMessage: reason,
      updatedAt: now,
    }).where(eq(refreshCheckpointRuns.id, run.id));
  }
}

/**
 * Atomically snapshots current retry settings into each new Bangkok checkpoint cycle,
 * then claims only due, unowned work. A global transaction advisory lock serializes
 * current-settings reads and ownership creation; each pass first recovers stale
 * claims, then terminalizes ineligible retry waits.
 */
export async function claimDueRefreshAttempts(
  db: Database,
  input: ClaimDueRefreshAttemptsInput,
): Promise<RefreshCheckpointRunRecord[]> {
  const parsed = ClaimInputSchema.parse(input);
  const businessDate = getBangkokBusinessDate(parsed.now);
  const shopIds = parsed.shops.map((shop) => shop.id);
  return db.transaction(async (transaction) => {
    await lockSettings(transaction);
    await recoverExpiredClaims(transaction, shopIds, parsed.now);
    await recoverIneligibleRefreshCyclesInTransaction(transaction, shopIds, parsed.now);
    const [settings] = await transaction.select().from(refreshSettings)
      .where(eq(refreshSettings.singletonId, 1)).limit(1);
    if (settings?.autoRefreshEnabled !== true) return [];
    const checkpoints = await transaction.select({
      id: refreshCheckpoints.id,
      localTime: refreshCheckpoints.localTime,
      enabled: refreshCheckpoints.enabled,
    }).from(refreshCheckpoints).where(eq(refreshCheckpoints.enabled, true))
      .orderBy(asc(refreshCheckpoints.localTime), asc(refreshCheckpoints.id));
    const due = getDueRefreshCheckpoints({
      now: parsed.now,
      checkpoints: checkpoints as RefreshCheckpointSchedule[],
    });
    if (due.length === 0) return [];
    const retryOffsetsSeconds = RefreshRetryOffsetsSchema.parse(settings.retryOffsetsSeconds);
    for (const shopId of shopIds) {
      for (const checkpoint of due) {
        const cycleStartedAt = checkpointInstant(businessDate, checkpoint.localTime);
        const firstAttemptAt = calculateRetryAt(cycleStartedAt, 1, retryOffsetsSeconds);
        if (firstAttemptAt === null) throw new Error("Refresh retry policy must include attempt one");
        await transaction.insert(refreshCheckpointRuns).values({
          shopId,
          checkpointId: checkpoint.id,
          businessDate,
          status: "RETRY_WAIT",
          retryOffsetsSeconds,
          attemptCount: 0,
          nextAttemptAt: firstAttemptAt,
          cycleStartedAt,
        }).onConflictDoNothing({
          target: [refreshCheckpointRuns.shopId, refreshCheckpointRuns.businessDate, refreshCheckpointRuns.checkpointId],
        });
      }
    }
    const checkpointIds = due.map((checkpoint) => checkpoint.id);
    const ready = await transaction.select().from(refreshCheckpointRuns).where(and(
      inArray(refreshCheckpointRuns.shopId, shopIds),
      inArray(refreshCheckpointRuns.checkpointId, checkpointIds),
      eq(refreshCheckpointRuns.businessDate, businessDate),
      eq(refreshCheckpointRuns.status, "RETRY_WAIT"),
      lte(refreshCheckpointRuns.nextAttemptAt, parsed.now),
    )).orderBy(asc(refreshCheckpointRuns.nextAttemptAt), asc(refreshCheckpointRuns.id))
      .for("update", { skipLocked: true });
    const claimed: RefreshCheckpointRunRecord[] = [];
    for (const run of ready) {
      const claimToken = randomUUID();
      const [updated] = await transaction.update(refreshCheckpointRuns).set({
        status: "RUNNING",
        nextAttemptAt: null,
        claimedAt: parsed.now,
        claimToken,
        updatedAt: parsed.now,
      }).where(and(
        eq(refreshCheckpointRuns.id, run.id),
        eq(refreshCheckpointRuns.status, "RETRY_WAIT"),
      )).returning();
      if (updated !== undefined) claimed.push(toRun(updated));
    }
    return claimed;
  });
}

/** Extends the durable claim while its owner is still executing browser work. */
export async function renewRefreshAttemptLease(
  db: Database,
  input: RenewRefreshAttemptLeaseInput,
): Promise<boolean> {
  const parsed = RenewLeaseInputSchema.parse(input);
  return db.transaction(async (transaction) => {
    const [attempt] = await transaction.select({ id: refreshCheckpointAttempts.id }).from(refreshCheckpointAttempts).where(and(
      eq(refreshCheckpointAttempts.id, parsed.attemptId),
      eq(refreshCheckpointAttempts.runId, parsed.runId),
      eq(refreshCheckpointAttempts.claimToken, parsed.claimToken),
      eq(refreshCheckpointAttempts.status, "RUNNING"),
    )).for("update").limit(1);
    if (!attempt) return false;
    const [updated] = await transaction.update(refreshCheckpointRuns).set({
      claimedAt: parsed.now,
      updatedAt: parsed.now,
    }).where(and(
      eq(refreshCheckpointRuns.id, parsed.runId),
      eq(refreshCheckpointRuns.status, "RUNNING"),
      eq(refreshCheckpointRuns.claimToken, parsed.claimToken),
    )).returning({ id: refreshCheckpointRuns.id });
    return updated !== undefined;
  });
}

/** Releases an owned claim without recording an attempt when its profile lock is unavailable. */
export async function releaseRefreshClaim(
  db: Database,
  input: ReleaseRefreshClaimInput,
): Promise<boolean> {
  const parsed = ReleaseClaimInputSchema.parse(input);
  const [updated] = await db.update(refreshCheckpointRuns).set({
    status: "RETRY_WAIT",
    nextAttemptAt: parsed.now,
    claimedAt: null,
    claimToken: null,
    updatedAt: parsed.now,
  }).where(and(
    eq(refreshCheckpointRuns.id, parsed.runId),
    eq(refreshCheckpointRuns.status, "RUNNING"),
    eq(refreshCheckpointRuns.claimToken, parsed.claimToken),
    eq(refreshCheckpointRuns.attemptCount, 0),
  )).returning({ id: refreshCheckpointRuns.id });
  return updated !== undefined;
}

/** Records exactly one durable attempt for a claim before any browser work begins. */
export async function recordRefreshAttemptStarted(
  db: Database,
  input: RecordRefreshAttemptStartedInput,
): Promise<RefreshCheckpointAttemptRecord> {
  const parsed = StartInputSchema.parse(input);
  return db.transaction(async (transaction) => {
    const [run] = await transaction.select().from(refreshCheckpointRuns)
      .where(eq(refreshCheckpointRuns.id, parsed.runId)).for("update").limit(1);
    if (!run) throw new Error(`Refresh checkpoint run not found: ${parsed.runId}`);
    const durableRun = toRun(run);
    assertClaimedRun(durableRun, parsed.claimToken);
    const attemptNumber = durableRun.attemptCount + 1;
    if (attemptNumber > durableRun.retryOffsetsSeconds.length) {
      throw new Error(`Refresh checkpoint run is exhausted: ${durableRun.id}`);
    }
    const [attempt] = await transaction.insert(refreshCheckpointAttempts).values({
      runId: durableRun.id,
      attemptNumber,
      status: "RUNNING",
      claimToken: parsed.claimToken,
      startedAt: parsed.now,
    }).onConflictDoNothing({ target: [refreshCheckpointAttempts.runId, refreshCheckpointAttempts.attemptNumber] }).returning();
    if (!attempt) throw new Error(`Refresh attempt already exists: ${durableRun.id}/${attemptNumber}`);
    const [updated] = await transaction.update(refreshCheckpointRuns).set({
      attemptCount: attemptNumber,
      updatedAt: parsed.now,
    }).where(and(eq(refreshCheckpointRuns.id, durableRun.id), eq(refreshCheckpointRuns.status, "RUNNING"))).returning();
    if (!updated) throw new Error(`Refresh checkpoint run transition failed: ${durableRun.id}`);
    return toAttempt(attempt);
  });
}

/** Completes the claimed attempt atomically, scheduling the snapshotted next retry or terminal exhaustion. */
export async function completeRefreshAttempt(
  db: Database,
  input: CompleteRefreshAttemptInput,
): Promise<RefreshCheckpointRunRecord> {
  const parsed = CompleteInputSchema.parse(input);
  return db.transaction(async (transaction) => {
    const [run] = await transaction.select().from(refreshCheckpointRuns)
      .where(eq(refreshCheckpointRuns.id, parsed.runId)).for("update").limit(1);
    if (!run) throw new Error(`Refresh checkpoint run not found: ${parsed.runId}`);
    const durableRun = toRun(run);
    assertClaimedRun(durableRun, parsed.claimToken);
    const [attempt] = await transaction.select().from(refreshCheckpointAttempts).where(and(
      eq(refreshCheckpointAttempts.id, parsed.attemptId),
      eq(refreshCheckpointAttempts.runId, parsed.runId),
      eq(refreshCheckpointAttempts.claimToken, parsed.claimToken),
    )).for("update").limit(1);
    if (!attempt) throw new Error(`Refresh attempt not found: ${parsed.attemptId}`);
    if (attempt.status !== "RUNNING" || attempt.attemptNumber !== durableRun.attemptCount) {
      throw new Error(`Refresh attempt is not the current running attempt: ${parsed.attemptId}`);
    }
    if (parsed.outcome === "SUCCESS") {
      await transaction.update(refreshCheckpointAttempts).set({ status: "SUCCEEDED", finishedAt: parsed.now })
        .where(eq(refreshCheckpointAttempts.id, parsed.attemptId));
      const [updated] = await transaction.update(refreshCheckpointRuns).set({
        status: "SUCCEEDED",
        completedAt: parsed.now,
        claimedAt: null,
        claimToken: null,
        nextAttemptAt: null,
        updatedAt: parsed.now,
      }).where(eq(refreshCheckpointRuns.id, parsed.runId)).returning();
      if (!updated) throw new Error(`Refresh checkpoint run transition failed: ${parsed.runId}`);
      return toRun(updated);
    }
    const failureMessage = parsed.failureMessage;
    if (!failureMessage) throw new Error("failureMessage is required for a failed attempt");
    const scheduledAt = nextAttemptAt(durableRun);
    await transaction.update(refreshCheckpointAttempts).set({
      status: "FAILED",
      finishedAt: parsed.now,
      nextAttemptAt: scheduledAt,
      failureMessage,
    }).where(eq(refreshCheckpointAttempts.id, parsed.attemptId));
    const [updated] = await transaction.update(refreshCheckpointRuns).set({
      status: scheduledAt === null ? "FAILED_EXHAUSTED" : "RETRY_WAIT",
      nextAttemptAt: scheduledAt,
      claimedAt: null,
      claimToken: null,
      completedAt: scheduledAt === null ? parsed.now : null,
      lastFailureMessage: failureMessage,
      updatedAt: parsed.now,
    }).where(eq(refreshCheckpointRuns.id, parsed.runId)).returning();
    if (!updated) throw new Error(`Refresh checkpoint run transition failed: ${parsed.runId}`);
    return toRun(updated);
  });
}

/** Reads an owned cycle and ordered durable attempt audit without browser or process state. */
export async function getRefreshCheckpointRun(
  db: Database,
  input: GetRefreshCheckpointRunInput,
): Promise<{ readonly run: RefreshCheckpointRunRecord | null; readonly attempts: readonly RefreshCheckpointAttemptRecord[] }> {
  const parsed = GetRunInputSchema.parse(input);
  const [run] = await db.select().from(refreshCheckpointRuns).where(and(
    eq(refreshCheckpointRuns.shopId, parsed.shopId),
    eq(refreshCheckpointRuns.checkpointId, parsed.checkpointId),
    eq(refreshCheckpointRuns.businessDate, parsed.businessDate),
  )).limit(1);
  if (!run) return { run: null, attempts: [] };
  const attempts = await db.select().from(refreshCheckpointAttempts).where(eq(refreshCheckpointAttempts.runId, run.id))
    .orderBy(asc(refreshCheckpointAttempts.attemptNumber));
  return { run: toRun(run), attempts: attempts.map(toAttempt) };
}
