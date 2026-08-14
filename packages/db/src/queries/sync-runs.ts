import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { syncRuns, type SyncRunRow } from "../schema.js";

export type SyncMode = SyncRunRow["mode"];

export interface BeginSyncRunInput {
  shopId: string;
  mode: SyncMode;
  checkpoint?: Record<string, unknown> | null;
}

export async function beginSyncRun(db: Database, input: BeginSyncRunInput): Promise<SyncRunRow> {
  const [run] = await db
    .insert(syncRuns)
    .values({
      shopId: input.shopId,
      mode: input.mode,
      checkpoint: input.checkpoint ?? null
    })
    .returning();

  if (!run) {
    throw new Error("Failed to begin sync run");
  }

  return run;
}

export interface CompleteSyncRunInput {
  runId: string;
  checkpoint?: Record<string, unknown> | null;
  rowsRead: number;
  rowsWritten: number;
}

export async function completeSyncRun(db: Database, input: CompleteSyncRunInput): Promise<void> {
  const now = new Date();
  const result = await db
    .update(syncRuns)
    .set({
      status: "SUCCEEDED",
      checkpoint: input.checkpoint ?? null,
      rowsRead: input.rowsRead,
      rowsWritten: input.rowsWritten,
      finishedAt: now,
      updatedAt: now
    })
    .where(and(eq(syncRuns.id, input.runId), eq(syncRuns.status, "RUNNING")))
    .returning({ id: syncRuns.id });

  if (result.length === 0) {
    throw new Error(`Running sync run not found: ${input.runId}`);
  }
}

export interface FailSyncRunInput {
  runId: string;
  failureType: string;
  failureMessage: string;
  retryCount?: number;
  paused?: boolean;
  checkpoint?: Record<string, unknown> | null;
}

export async function failSyncRun(db: Database, input: FailSyncRunInput): Promise<void> {
  const now = new Date();
  const result = await db
    .update(syncRuns)
    .set({
      status: input.paused === true ? "PAUSED" : "FAILED",
      failureType: input.failureType,
      failureMessage: input.failureMessage,
      retryCount: input.retryCount ?? 0,
      checkpoint: input.checkpoint ?? null,
      finishedAt: now,
      updatedAt: now
    })
    .where(and(eq(syncRuns.id, input.runId), eq(syncRuns.status, "RUNNING")))
    .returning({ id: syncRuns.id });

  if (result.length === 0) {
    throw new Error(`Running sync run not found: ${input.runId}`);
  }
}

export async function updateSyncCheckpoint(
  db: Database,
  runId: string,
  checkpoint: Record<string, unknown> | null,
  rowsRead: number,
  rowsWritten: number
): Promise<void> {
  await db
    .update(syncRuns)
    .set({ checkpoint, rowsRead, rowsWritten, updatedAt: new Date() })
    .where(and(eq(syncRuns.id, runId), eq(syncRuns.status, "RUNNING")));
}

export async function abortStaleSyncRuns(
  db: Database,
  staleBefore: Date,
  message = "Worker stopped before sync run completed"
): Promise<number> {
  const now = new Date();
  const aborted = await db
    .update(syncRuns)
    .set({
      status: "ABORTED",
      failureType: "WORKER_CRASH",
      failureMessage: message,
      finishedAt: now,
      updatedAt: now
    })
    .where(and(eq(syncRuns.status, "RUNNING"), lt(syncRuns.updatedAt, staleBefore)))
    .returning({ id: syncRuns.id });
  return aborted.length;
}

export async function listSyncRuns(
  db: Database,
  shopId: string,
  limit = 20
): Promise<SyncRunRow[]> {
  return db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.shopId, shopId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function findLatestCheckpoint(
  db: Database,
  shopId: string,
  mode: SyncMode
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ checkpoint: syncRuns.checkpoint })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.shopId, shopId),
        eq(syncRuns.mode, mode),
        sql`${syncRuns.checkpoint} is not null`
      )
    )
    .orderBy(desc(syncRuns.updatedAt))
    .limit(1);
  return row?.checkpoint ?? null;
}
