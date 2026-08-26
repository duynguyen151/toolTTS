import { z } from "zod";

export const REFRESH_CONTROLLER_TIME_ZONE = "Asia/Bangkok" as const;
export const RefreshBusinessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day!));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month! - 1 && calendar.getUTCDate() === day;
}, "businessDate must be a Gregorian calendar date");
export const RefreshCheckpointScheduleSchema = z.strictObject({
  id: z.string().uuid(),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  enabled: z.boolean(),
});
export const RefreshRetryOffsetsSchema = z.array(z.number().int().min(0).max(86_400)).min(1).max(10)
  .refine((offsets) => new Set(offsets).size === offsets.length, "retry offsets must be unique");
export const RefreshCheckpointRunStatusSchema = z.enum([
  "RETRY_WAIT",
  "RUNNING",
  "SUCCEEDED",
  "FAILED_EXHAUSTED",
]);
const FiniteDateSchema = z.date().refine((value) => Number.isFinite(value.getTime()), "date must be finite");
const NullableFiniteDateSchema = FiniteDateSchema.nullable();

export const RefreshCheckpointRunStateSchema = z.strictObject({
  status: RefreshCheckpointRunStatusSchema,
  attemptCount: z.number().int().min(0),
  retryOffsetsSeconds: RefreshRetryOffsetsSchema,
  cycleStartedAt: FiniteDateSchema,
  nextAttemptAt: NullableFiniteDateSchema,
});
export const RefreshCheckpointRunRecordSchema = z.strictObject({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  checkpointId: z.string().uuid(),
  businessDate: RefreshBusinessDateSchema,
  status: RefreshCheckpointRunStatusSchema,
  attemptCount: z.number().int().min(0),
  retryOffsetsSeconds: RefreshRetryOffsetsSchema,
  nextAttemptAt: NullableFiniteDateSchema,
  claimedAt: NullableFiniteDateSchema,
  claimToken: z.string().uuid().nullable(),
  cycleStartedAt: FiniteDateSchema,
  completedAt: NullableFiniteDateSchema,
  lastFailureMessage: z.string().nullable(),
  createdAt: FiniteDateSchema,
  updatedAt: FiniteDateSchema,
});
export const RefreshCheckpointAttemptStatusSchema = z.enum(["RUNNING", "SUCCEEDED", "FAILED"]);
export const RefreshCheckpointAttemptRecordSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  attemptNumber: z.number().int().positive(),
  status: RefreshCheckpointAttemptStatusSchema,
  claimToken: z.string().uuid(),
  startedAt: FiniteDateSchema,
  finishedAt: NullableFiniteDateSchema,
  nextAttemptAt: NullableFiniteDateSchema,
  failureMessage: z.string().nullable(),
  createdAt: FiniteDateSchema,
});
export const RefreshAttemptTransitionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("SUCCESS"), at: z.date().refine((value) => Number.isFinite(value.getTime())) }),
  z.strictObject({ type: z.literal("FAILURE"), at: z.date().refine((value) => Number.isFinite(value.getTime())), message: z.string().trim().min(1).max(2_000) }),
]);

export type RefreshBusinessDate = z.output<typeof RefreshBusinessDateSchema>;
export type RefreshCheckpointSchedule = z.output<typeof RefreshCheckpointScheduleSchema>;
export type RefreshCheckpointRunState = z.output<typeof RefreshCheckpointRunStateSchema>;
export type RefreshCheckpointRunRecord = z.output<typeof RefreshCheckpointRunRecordSchema>;
export type RefreshCheckpointAttemptRecord = z.output<typeof RefreshCheckpointAttemptRecordSchema>;
export type RefreshAttemptTransition = z.output<typeof RefreshAttemptTransitionSchema>;

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;

function requireFiniteDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("Date must be finite");
  return value;
}

function bangkokParts(now: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const local = new Date(requireFiniteDate(now).getTime() + BANGKOK_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

export function getBangkokBusinessDate(now: Date): RefreshBusinessDate {
  const { year, month, day } = bangkokParts(now);
  return RefreshBusinessDateSchema.parse(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export function getDueRefreshCheckpoints(input: {
  readonly now: Date;
  readonly checkpoints: readonly RefreshCheckpointSchedule[];
  readonly autoRefreshEnabled?: boolean;
}): RefreshCheckpointSchedule[] {
  if (input.autoRefreshEnabled === false) return [];
  const { hour, minute } = bangkokParts(input.now);
  const wallClock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return input.checkpoints
    .map((checkpoint) => RefreshCheckpointScheduleSchema.parse(checkpoint))
    .filter((checkpoint) => checkpoint.enabled && checkpoint.localTime <= wallClock)
    .sort((left, right) => left.localTime.localeCompare(right.localTime) || left.id.localeCompare(right.id));
}

export function calculateRetryAt(cycleStartedAt: Date, attemptNumber: number, retryOffsetsSeconds: readonly number[]): Date | null {
  const offsets = RefreshRetryOffsetsSchema.parse(retryOffsetsSeconds);
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("attemptNumber must be a positive integer");
  const offset = offsets[attemptNumber - 1];
  return offset === undefined ? null : new Date(requireFiniteDate(cycleStartedAt).getTime() + offset * 1_000);
}

export function transitionRefreshAttempt(
  state: RefreshCheckpointRunState,
  transition: RefreshAttemptTransition,
): RefreshCheckpointRunState {
  const current = RefreshCheckpointRunStateSchema.parse(state);
  const next = RefreshAttemptTransitionSchema.parse(transition);
  if (current.status !== "RUNNING") throw new Error("Only a running refresh attempt can transition");
  if (next.type === "SUCCESS") {
    return RefreshCheckpointRunStateSchema.parse({ ...current, status: "SUCCEEDED", nextAttemptAt: null });
  }
  const nextAttemptAt = calculateRetryAt(current.cycleStartedAt, current.attemptCount + 1, current.retryOffsetsSeconds);
  return RefreshCheckpointRunStateSchema.parse({
    ...current,
    status: nextAttemptAt === null ? "FAILED_EXHAUSTED" : "RETRY_WAIT",
    nextAttemptAt,
  });
}
