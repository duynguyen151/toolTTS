import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  refreshCheckpoints,
  refreshSettings,
  type RefreshCheckpointRow,
  type RefreshSettingsRow,
} from "../schema.js";

export const REFRESH_TIME_ZONE = "Asia/Bangkok" as const;
export const MAX_REFRESH_RETRY_OFFSETS = 10;
export const MAX_REFRESH_RETRY_OFFSET_SECONDS = 86_400;

const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
  message: "localTime must be an exact HH:mm Bangkok wall-clock value",
});
const CheckpointIdSchema = z.string().uuid();
const RetryOffsetsSchema = z.array(
  z.number().int().min(0).max(MAX_REFRESH_RETRY_OFFSET_SECONDS),
).min(1).max(MAX_REFRESH_RETRY_OFFSETS).superRefine((offsets, context) => {
  if (new Set(offsets).size !== offsets.length) {
    context.addIssue({
      code: "custom",
      message: "retryOffsetsSeconds must be unique while preserving caller order",
    });
  }
});
const NoInputSchema = z.strictObject({});
const SetAutoRefreshEnabledInputSchema = z.strictObject({ enabled: z.boolean() });
const SetRefreshRetryOffsetsInputSchema = z.strictObject({ retryOffsetsSeconds: RetryOffsetsSchema });
const AddRefreshCheckpointInputSchema = z.strictObject({
  localTime: LocalTimeSchema,
  enabled: z.boolean().optional().default(true),
});
const UpdateRefreshCheckpointInputSchema = z.strictObject({
  checkpointId: CheckpointIdSchema,
  localTime: LocalTimeSchema,
});
const SetRefreshCheckpointEnabledInputSchema = z.strictObject({
  checkpointId: CheckpointIdSchema,
  enabled: z.boolean(),
});
const DeleteRefreshCheckpointInputSchema = z.strictObject({ checkpointId: CheckpointIdSchema });

export const RefreshCheckpointSchema = z.strictObject({
  id: z.string().uuid(),
  localTime: LocalTimeSchema,
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const RefreshSettingsSnapshotSchema = z.strictObject({
  autoRefreshEnabled: z.boolean(),
  retryOffsetsSeconds: RetryOffsetsSchema,
  revision: z.number().int().positive(),
  timeZone: z.literal(REFRESH_TIME_ZONE),
  createdAt: z.date(),
  updatedAt: z.date(),
  checkpoints: z.array(RefreshCheckpointSchema),
});

export type RefreshCheckpoint = z.output<typeof RefreshCheckpointSchema>;
export type RefreshSettingsSnapshot = z.output<typeof RefreshSettingsSnapshotSchema>;
export type SetAutoRefreshEnabledInput = z.input<typeof SetAutoRefreshEnabledInputSchema>;
export type SetRefreshRetryOffsetsInput = z.input<typeof SetRefreshRetryOffsetsInputSchema>;
export type AddRefreshCheckpointInput = z.input<typeof AddRefreshCheckpointInputSchema>;
export type UpdateRefreshCheckpointInput = z.input<typeof UpdateRefreshCheckpointInputSchema>;
export type SetRefreshCheckpointEnabledInput = z.input<typeof SetRefreshCheckpointEnabledInputSchema>;
export type DeleteRefreshCheckpointInput = z.input<typeof DeleteRefreshCheckpointInputSchema>;

function toCheckpoint(row: RefreshCheckpointRow): RefreshCheckpoint {
  return RefreshCheckpointSchema.parse(row);
}

async function lockSettings(transaction: DatabaseTransaction): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended('refresh-settings', 0))`);
}

async function ensureSettings(transaction: DatabaseTransaction): Promise<void> {
  await transaction.insert(refreshSettings).values({ singletonId: 1 }).onConflictDoNothing();
}

async function getSettingsRow(transaction: DatabaseTransaction): Promise<RefreshSettingsRow> {
  await ensureSettings(transaction);
  const [row] = await transaction.select().from(refreshSettings)
    .where(eq(refreshSettings.singletonId, 1));
  if (row === undefined) throw new Error("Failed to initialize refresh settings");
  return row;
}

async function getCurrentRefreshSettingsInTransaction(
  transaction: DatabaseTransaction,
): Promise<RefreshSettingsSnapshot> {
  const [settings, checkpoints] = await Promise.all([
    getSettingsRow(transaction),
    transaction.select().from(refreshCheckpoints).orderBy(
      asc(refreshCheckpoints.localTime),
      asc(refreshCheckpoints.id),
    ),
  ]);
  return RefreshSettingsSnapshotSchema.parse({
    autoRefreshEnabled: settings.autoRefreshEnabled,
    retryOffsetsSeconds: settings.retryOffsetsSeconds,
    revision: settings.revision,
    timeZone: REFRESH_TIME_ZONE,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
    checkpoints: checkpoints.map(toCheckpoint),
  });
}

/** Reads the current persisted configuration on every call; it intentionally has no process cache. */
export async function getCurrentRefreshSettings(
  db: Database,
  input: unknown = {},
): Promise<RefreshSettingsSnapshot> {
  NoInputSchema.parse(input);
  return db.transaction(async (transaction) => getCurrentRefreshSettingsInTransaction(transaction));
}

export async function setAutoRefreshEnabled(
  db: Database,
  input: SetAutoRefreshEnabledInput,
): Promise<RefreshSettingsSnapshot> {
  const parsed = SetAutoRefreshEnabledInputSchema.parse(input);
  return db.transaction(async (transaction) => {
    await lockSettings(transaction);
    await getSettingsRow(transaction);
    await transaction.update(refreshSettings).set({
      autoRefreshEnabled: parsed.enabled,
      revision: sql`${refreshSettings.revision} + 1`,
      updatedAt: sql`now()`,
    }).where(eq(refreshSettings.singletonId, 1));
    return getCurrentRefreshSettingsInTransaction(transaction);
  });
}

export async function setRefreshRetryOffsets(
  db: Database,
  input: SetRefreshRetryOffsetsInput,
): Promise<RefreshSettingsSnapshot> {
  const parsed = SetRefreshRetryOffsetsInputSchema.parse(input);
  return db.transaction(async (transaction) => {
    await lockSettings(transaction);
    await getSettingsRow(transaction);
    await transaction.update(refreshSettings).set({
      retryOffsetsSeconds: parsed.retryOffsetsSeconds,
      revision: sql`${refreshSettings.revision} + 1`,
      updatedAt: sql`now()`,
    }).where(eq(refreshSettings.singletonId, 1));
    return getCurrentRefreshSettingsInTransaction(transaction);
  });
}

export async function addRefreshCheckpoint(
  db: Database,
  input: AddRefreshCheckpointInput,
): Promise<RefreshCheckpoint> {
  const parsed = AddRefreshCheckpointInputSchema.parse(input);
  const [created] = await db.insert(refreshCheckpoints).values({
    localTime: parsed.localTime,
    enabled: parsed.enabled,
  }).returning();
  if (created === undefined) throw new Error("Failed to add refresh checkpoint");
  return toCheckpoint(created);
}

export async function updateRefreshCheckpoint(
  db: Database,
  input: UpdateRefreshCheckpointInput,
): Promise<RefreshCheckpoint | null> {
  const parsed = UpdateRefreshCheckpointInputSchema.parse(input);
  const [updated] = await db.update(refreshCheckpoints).set({
    localTime: parsed.localTime,
    updatedAt: sql`now()`,
  }).where(eq(refreshCheckpoints.id, parsed.checkpointId)).returning();
  return updated === undefined ? null : toCheckpoint(updated);
}

export async function setRefreshCheckpointEnabled(
  db: Database,
  input: SetRefreshCheckpointEnabledInput,
): Promise<RefreshCheckpoint | null> {
  const parsed = SetRefreshCheckpointEnabledInputSchema.parse(input);
  const [updated] = await db.update(refreshCheckpoints).set({
    enabled: parsed.enabled,
    updatedAt: sql`now()`,
  }).where(eq(refreshCheckpoints.id, parsed.checkpointId)).returning();
  return updated === undefined ? null : toCheckpoint(updated);
}

export async function deleteRefreshCheckpoint(
  db: Database,
  input: DeleteRefreshCheckpointInput,
): Promise<boolean> {
  const parsed = DeleteRefreshCheckpointInputSchema.parse(input);
  const [deleted] = await db.delete(refreshCheckpoints)
    .where(eq(refreshCheckpoints.id, parsed.checkpointId)).returning({ id: refreshCheckpoints.id });
  return deleted !== undefined;
}
