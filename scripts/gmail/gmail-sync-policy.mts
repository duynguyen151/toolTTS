export const GMAIL_SYNC_INTERFACE_VERSION = 'v1.03';
export const GMAIL_INCREMENTAL_BACKFILL_HOURS = 72;
export const GMAIL_MAX_MESSAGES_PER_RUN = 50;
export const GMAIL_MAX_DISCOVERY_MESSAGES = 1_000;
export const GMAIL_LIST_PAGE_SIZE = 50;
export const GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE = 20;
export const GMAIL_EXTENDED_INCREMENTAL_BUFFER_SIZE = 30;
export const GMAIL_MAX_INCREMENTAL_BUFFER_SIZE = 50;
export const GMAIL_MIN_RUN_INTERVAL_MS = 15_000;
export const GMAIL_MIN_REQUEST_INTERVAL_MS = 1_500;
export const GMAIL_RETRY_MIN_DELAY_MS = 30_000;
export const GMAIL_RETRY_MAX_DELAY_MS = 60_000;
export const GMAIL_MAX_RETRIES = 3;

export function needsSyncMigration(syncVersion: string, flagged: boolean): boolean {
  return flagged || syncVersion !== GMAIL_SYNC_INTERFACE_VERSION;
}

export function splitMessageBatch<T>(messages: readonly T[], maxMessages = GMAIL_MAX_MESSAGES_PER_RUN): {
  batch: T[];
  pending: T[];
} {
  if (!Number.isInteger(maxMessages) || maxMessages < 1) {
    throw new Error('maxMessages must be a positive integer');
  }

  return {
    batch: [...messages.slice(0, maxMessages)],
    pending: [...messages.slice(maxMessages)]
  };
}

export function getRetryDelayMs(
  _attempt: number,
  retryAfter: string | null | undefined,
  random = Math.random
): number {
  const randomValue = Math.min(0.999999, Math.max(0, random()));
  const randomDelay = GMAIL_RETRY_MIN_DELAY_MS + Math.floor(
    randomValue * (GMAIL_RETRY_MAX_DELAY_MS - GMAIL_RETRY_MIN_DELAY_MS + 1)
  );
  const retryAfterSeconds = Number(retryAfter);
  const retryAfterDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
    ? retryAfterSeconds * 1_000
    : 0;

  return Math.min(
    GMAIL_RETRY_MAX_DELAY_MS,
    Math.max(GMAIL_RETRY_MIN_DELAY_MS, randomDelay, retryAfterDelay)
  );
}

export function getIncrementalBufferSize(lastRunTimestamp?: string, now = Date.now()): number {
  const lastRunAt = lastRunTimestamp ? Date.parse(lastRunTimestamp) : Number.NaN;
  if (!Number.isFinite(lastRunAt) || now < lastRunAt) return GMAIL_MAX_INCREMENTAL_BUFFER_SIZE;

  const elapsedHours = (now - lastRunAt) / (60 * 60 * 1_000);
  if (elapsedHours > 24) return GMAIL_MAX_INCREMENTAL_BUFFER_SIZE;
  if (elapsedHours > 8) return GMAIL_EXTENDED_INCREMENTAL_BUFFER_SIZE;
  return GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE;
}

export function getMinimumRunWaitMs(lastRunTimestamp?: string, now = Date.now()): number {
  const lastRunAt = lastRunTimestamp ? Date.parse(lastRunTimestamp) : Number.NaN;
  if (!Number.isFinite(lastRunAt)) return 0;

  return Math.max(0, GMAIL_MIN_RUN_INTERVAL_MS - Math.max(0, now - lastRunAt));
}

export function getLegacyMigrationQuery(baseQuery: string, lastRunTimestamp?: string): string {
  const lastRunAt = lastRunTimestamp ? Date.parse(lastRunTimestamp) : Number.NaN;
  if (!Number.isFinite(lastRunAt)) return baseQuery;

  const migrationStart = new Date(lastRunAt - GMAIL_INCREMENTAL_BACKFILL_HOURS * 60 * 60 * 1_000);
  const year = migrationStart.getUTCFullYear();
  const month = String(migrationStart.getUTCMonth() + 1).padStart(2, '0');
  const day = String(migrationStart.getUTCDate()).padStart(2, '0');
  return `${baseQuery} after:${year}/${month}/${day}`;
}

export function selectIncrementalBatch<T>(
  newMessages: readonly T[],
  bufferMessages: readonly T[],
  maxMessages = GMAIL_MAX_MESSAGES_PER_RUN
): { batch: T[]; pending: T[] } {
  if (!Number.isInteger(maxMessages) || maxMessages < 1) {
    throw new Error('maxMessages must be a positive integer');
  }

  const selectedBuffer = [...bufferMessages].slice(0, maxMessages);
  const newLimit = Math.max(0, maxMessages - selectedBuffer.length);
  const selectedNew = [...newMessages].slice(0, newLimit);

  return {
    batch: [...selectedNew, ...selectedBuffer].slice(0, maxMessages),
    pending: [...newMessages].slice(selectedNew.length)
  };
}

export function selectCheckpointMessageIds<T extends { id: string }>(messages: readonly T[], limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (!message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    ids.push(message.id);
    if (ids.length === limit) break;
  }
  return ids;
}

export function isGoogleRateLimitResponse(status: number, body: string): boolean {
  return status === 429 || (
    status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|quota exceeded/i.test(body)
  );
}

export function shouldFillBlankSheetCell(currentValue: string, nextValue: string): boolean {
  return currentValue.trim().length === 0 && nextValue.trim().length > 0;
}

let requestQueue = Promise.resolve();
let nextRequestAt = 0;

export function runPacedGoogleRequest<T>(request: () => Promise<T>): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));

    try {
      return await request();
    } finally {
      nextRequestAt = Date.now() + GMAIL_MIN_REQUEST_INTERVAL_MS;
    }
  });

  requestQueue = scheduled.then(() => undefined, () => undefined);
  return scheduled;
}
