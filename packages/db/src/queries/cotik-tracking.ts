import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  cotikPostAttempts,
  cotikPostIntents,
  cotikTrackingCandidates,
  type CotikPostAttemptRow,
  type CotikPostIntentRow,
  type CotikTrackingCandidateRow
} from "../schema.js";

type TrackingDatabase = Database | DatabaseTransaction;

function withTrackingTransaction<T>(
  db: TrackingDatabase,
  operation: (tx: DatabaseTransaction) => Promise<T>
): Promise<T> {
  if ("transaction" in db) return db.transaction(operation);
  return operation(db);
}

/**
 * Global dedup fingerprint: hash(orderId, tracking, providerId).
 * accountId is NOT part of the fingerprint to enable global idempotency
 * across account re-routing scenarios.
 */
export function computeTrackingFingerprint(
  orderId: string,
  tracking: string,
  providerId: string
): string {
  return createHash("sha256")
    .update(`${orderId.trim()}:${tracking.trim()}:${providerId.trim()}`)
    .digest("hex");
}

export interface CreateTrackingCandidateInput {
  orderId: string;
  tracking: string;
  providerId: string;
  accountId: string;
  logicalShopId: string;
  region: "US" | "UK";
  status?: "PENDING" | "POSTED" | "REJECTED" | "FAILED" | undefined;
}

export async function createTrackingCandidate(
  db: TrackingDatabase,
  input: CreateTrackingCandidateInput
): Promise<CotikTrackingCandidateRow> {
  const fingerprint = computeTrackingFingerprint(
    input.orderId,
    input.tracking,
    input.providerId
  );

  const [created] = await db
    .insert(cotikTrackingCandidates)
    .values({
      orderId: input.orderId.trim(),
      tracking: input.tracking.trim(),
      providerId: input.providerId.trim(),
      accountId: input.accountId,
      logicalShopId: input.logicalShopId,
      region: input.region,
      fingerprint,
      status: input.status ?? "PENDING"
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [existing] = await db
    .select()
    .from(cotikTrackingCandidates)
    .where(eq(cotikTrackingCandidates.fingerprint, fingerprint))
    .limit(1);

  if (!existing) {
    throw new Error("Failed to create tracking candidate");
  }

  if (existing.logicalShopId !== input.logicalShopId || existing.region !== input.region ||
    existing.orderId !== input.orderId.trim() || existing.tracking !== input.tracking.trim() ||
    existing.providerId !== input.providerId.trim()) {
    throw new Error("Cotik tracking candidate fingerprint identity conflict");
  }

  if (
    existing.status !== "PENDING" ||
    existing.logicalShopId !== input.logicalShopId ||
    existing.region !== input.region
  ) {
    return existing;
  }

  const [rerouted] = await db
    .update(cotikTrackingCandidates)
    .set({ accountId: input.accountId, updatedAt: new Date() })
    .where(
      and(
        eq(cotikTrackingCandidates.id, existing.id),
        eq(cotikTrackingCandidates.status, "PENDING"),
        eq(cotikTrackingCandidates.logicalShopId, input.logicalShopId),
        eq(cotikTrackingCandidates.region, input.region)
      )
    )
    .returning();

  return rerouted ?? existing;
}

export interface CreatePostIntentInput {
  orderId: string;
  tracking: string;
  providerId: string;
  accountId: string;
  logicalShopId: string;
  region: "US" | "UK";
  maxAttempts?: number | undefined;
}

export async function createOrGetPostIntent(
  db: TrackingDatabase,
  input: CreatePostIntentInput
): Promise<CotikPostIntentRow> {
  const fingerprint = computeTrackingFingerprint(
    input.orderId,
    input.tracking,
    input.providerId
  );

  const maxAttempts = Math.min(Math.max(input.maxAttempts ?? 3, 1), 3);
  const [created] = await db
    .insert(cotikPostIntents)
    .values({
      fingerprint,
      orderId: input.orderId.trim(),
      tracking: input.tracking.trim(),
      providerId: input.providerId.trim(),
      accountId: input.accountId,
      logicalShopId: input.logicalShopId,
      region: input.region,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return created;
  }

  const [existing] = await db
    .select()
    .from(cotikPostIntents)
    .where(eq(cotikPostIntents.fingerprint, fingerprint))
    .limit(1);

  if (!existing) {
    throw new Error("Failed to resolve post intent");
  }

  if (existing.logicalShopId !== input.logicalShopId || existing.region !== input.region ||
    existing.orderId !== input.orderId.trim() || existing.tracking !== input.tracking.trim() ||
    existing.providerId !== input.providerId.trim()) {
    throw new Error("Cotik post intent fingerprint identity conflict");
  }

  if (
    existing.status !== "PENDING" ||
    existing.attemptCount !== 0 ||
    existing.logicalShopId !== input.logicalShopId ||
    existing.region !== input.region
  ) {
    return existing;
  }

  const [rerouted] = await db
    .update(cotikPostIntents)
    .set({
      accountId: input.accountId,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(cotikPostIntents.id, existing.id),
        eq(cotikPostIntents.status, "PENDING"),
        eq(cotikPostIntents.attemptCount, 0)
      )
    )
    .returning();

  return rerouted ?? existing;
}

export interface RecordPostAttemptInput {
  intentId: string;
  attemptNo: number;
  requestPayload: Record<string, unknown>;
  responsePayload?: Record<string, unknown> | null | undefined;
  httpStatus?: number | null | undefined;
  outcome: "SUCCESS" | "HTTP_ERROR" | "TIMEOUT" | "UNCONFIRMED";
  readbackConfirmed?: boolean | undefined;
  keepInProgress?: boolean | undefined;
  abort?: boolean | undefined;
}

export async function recordPostAttempt(
  db: TrackingDatabase,
  input: RecordPostAttemptInput
): Promise<CotikPostAttemptRow> {
  if (input.attemptNo < 1 || input.attemptNo > 3) {
    throw new Error(`Attempt number must be between 1 and 3, got ${input.attemptNo}`);
  }

  return await withTrackingTransaction(db, async (tx) => {
    const [intent] = await tx
      .select()
      .from(cotikPostIntents)
      .where(eq(cotikPostIntents.id, input.intentId))
      .for("update")
      .limit(1);

    if (!intent) {
      throw new Error(`Post intent not found: ${input.intentId}`);
    }

    const [existingAttempt] = await tx
      .select()
      .from(cotikPostAttempts)
      .where(
        and(
          eq(cotikPostAttempts.intentId, input.intentId),
          eq(cotikPostAttempts.attemptNo, input.attemptNo)
        )
      )
      .for("update")
      .limit(1);

    if (intent.attemptCount !== input.attemptNo || intent.status === "CONFIRMED" || intent.status === "FAILED") {
      throw new Error(`Post intent is not reserved for attempt ${input.attemptNo}: ${input.intentId}`);
    }

    const attempt = existingAttempt
      ? (await tx
          .update(cotikPostAttempts)
          .set({
            requestPayload: input.requestPayload,
            responsePayload: input.responsePayload ?? null,
            httpStatus: input.httpStatus ?? null,
            outcome: input.outcome,
            readbackConfirmed: input.readbackConfirmed ?? false
          })
          .where(eq(cotikPostAttempts.id, existingAttempt.id))
          .returning())[0]
      : (await tx
          .insert(cotikPostAttempts)
          .values({
            intentId: input.intentId,
            attemptNo: input.attemptNo,
            requestPayload: input.requestPayload,
            responsePayload: input.responsePayload ?? null,
            httpStatus: input.httpStatus ?? null,
            outcome: input.outcome,
            readbackConfirmed: input.readbackConfirmed ?? false
          })
          .returning())[0];

    if (!attempt) {
      throw new Error("Failed to insert post attempt");
    }

    const readbackConfirmed = input.readbackConfirmed === true;
    let nextStatus: "PENDING" | "IN_PROGRESS" | "CONFIRMED" | "FAILED" | "ABORTED";

    if (readbackConfirmed) {
      nextStatus = "CONFIRMED";
    } else if (input.abort === true) {
      nextStatus = "ABORTED";
    } else if (input.keepInProgress === true) {
      nextStatus = "IN_PROGRESS";
    } else if (input.attemptNo >= intent.maxAttempts) {
      nextStatus = "FAILED";
    } else {
      nextStatus = "PENDING";
    }

    const now = new Date();
    await tx
      .update(cotikPostIntents)
      .set({
        attemptCount: input.attemptNo,
        status: nextStatus,
        lastAttemptAt: now,
        confirmedAt: readbackConfirmed ? now : intent.confirmedAt,
        updatedAt: now
      })
      .where(eq(cotikPostIntents.id, input.intentId));

    return attempt;
  });
}

export async function listInProgressPostIntents(
  db: TrackingDatabase,
  limit = 50
): Promise<CotikPostIntentRow[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 50);
  return await db
    .select()
    .from(cotikPostIntents)
    .where(eq(cotikPostIntents.status, "IN_PROGRESS"))
    .orderBy(asc(cotikPostIntents.lastAttemptAt), asc(cotikPostIntents.createdAt))
    .limit(boundedLimit);
}

export async function listPendingPostIntents(
  db: TrackingDatabase,
  limit = 50,
  options: {
    reserve?: boolean | undefined;
    intentIds?: string[] | undefined;
    requestPayloadByIntent?: Record<string, Record<string, unknown>> | undefined;
  } = {}
): Promise<CotikPostIntentRow[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 50);
  const intentFilter = options.intentIds && options.intentIds.length > 0
    ? inArray(cotikPostIntents.id, options.intentIds)
    : undefined;
  const pendingWhere = and(
    eq(cotikPostIntents.status, "PENDING"),
    lt(cotikPostIntents.attemptCount, cotikPostIntents.maxAttempts),
    ...(intentFilter ? [intentFilter] : [])
  );

  if (options.reserve !== true) {
    return await db
      .select()
      .from(cotikPostIntents)
      .where(pendingWhere)
      .orderBy(asc(cotikPostIntents.createdAt))
      .limit(boundedLimit);
  }

  return await withTrackingTransaction(db, async (tx) => {
    const pending = await tx
      .select()
      .from(cotikPostIntents)
      .where(pendingWhere)
      .orderBy(asc(cotikPostIntents.createdAt))
      .for("update", { skipLocked: true })
      .limit(boundedLimit);

    const reserved: CotikPostIntentRow[] = [];
    for (const intent of pending) {
      const now = new Date();
      const [updated] = await tx
        .update(cotikPostIntents)
        .set({
          status: "IN_PROGRESS",
          attemptCount: sql`${cotikPostIntents.attemptCount} + 1`,
          lastAttemptAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(cotikPostIntents.id, intent.id),
            eq(cotikPostIntents.status, "PENDING"),
            lt(cotikPostIntents.attemptCount, cotikPostIntents.maxAttempts)
          )
        )
        .returning();

      if (updated) {
        const [attempt] = await tx
          .insert(cotikPostAttempts)
          .values({
            intentId: updated.id,
            attemptNo: updated.attemptCount,
            requestPayload: options.requestPayloadByIntent?.[updated.id] ?? {},
            outcome: "UNCONFIRMED",
            readbackConfirmed: false
          })
          .returning({ id: cotikPostAttempts.id });
        if (attempt) reserved.push(updated);
      }
    }

    return reserved;
  });
}

export async function getPostIntentById(
  db: TrackingDatabase,
  intentId: string
): Promise<CotikPostIntentRow | null> {
  const [intent] = await db
    .select()
    .from(cotikPostIntents)
    .where(eq(cotikPostIntents.id, intentId))
    .limit(1);

  return intent ?? null;
}

export async function getPostIntentByFingerprint(
  db: TrackingDatabase,
  fingerprint: string
): Promise<CotikPostIntentRow | null> {
  const [intent] = await db
    .select()
    .from(cotikPostIntents)
    .where(eq(cotikPostIntents.fingerprint, fingerprint))
    .limit(1);

  return intent ?? null;
}

export interface FindPostIntentForTrackingInput {
  logicalShopId: string;
  orderId: string;
  tracking: string;
  region: "US" | "UK";
}

export async function findPostIntentForTracking(
  db: TrackingDatabase,
  input: FindPostIntentForTrackingInput
): Promise<CotikPostIntentRow | null> {
  const intents = await db
    .select()
    .from(cotikPostIntents)
    .where(and(
      eq(cotikPostIntents.logicalShopId, input.logicalShopId),
      eq(cotikPostIntents.orderId, input.orderId.trim()),
      eq(cotikPostIntents.tracking, input.tracking.trim()),
      eq(cotikPostIntents.region, input.region)
    ))
    .orderBy(desc(cotikPostIntents.updatedAt))
    .limit(2);

  return intents.length === 1 ? intents[0] ?? null : null;
}

export async function listAttemptsForIntent(
  db: TrackingDatabase,
  intentId: string
): Promise<CotikPostAttemptRow[]> {
  return await db
    .select()
    .from(cotikPostAttempts)
    .where(eq(cotikPostAttempts.intentId, intentId))
    .orderBy(asc(cotikPostAttempts.attemptNo));
}
