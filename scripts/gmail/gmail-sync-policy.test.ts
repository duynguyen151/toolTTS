import { describe, expect, it } from 'vitest';

import {
  GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE,
  GMAIL_MIN_RUN_INTERVAL_MS,
  GMAIL_MAX_MESSAGES_PER_RUN,
  GMAIL_SYNC_INTERFACE_VERSION,
  getIncrementalBufferSize,
  getLegacyMigrationQuery,
  getMinimumRunWaitMs,
  getRetryDelayMs,
  selectIncrementalBatch,
  shouldFillBlankSheetCell,
  splitMessageBatch
} from './gmail-sync-policy.mts';

describe('Gmail sync safety policy', () => {
  it('caps one run and preserves the remaining message queue', () => {
    expect(GMAIL_MAX_MESSAGES_PER_RUN).toBe(50);
    expect(splitMessageBatch(['a', 'b', 'c', 'd'], 3)).toEqual({
      batch: ['a', 'b', 'c'],
      pending: ['d']
    });
  });

  it('identifies the v1.02 incremental sync interface', () => {
    expect(GMAIL_SYNC_INTERFACE_VERSION).toBe('v1.02');
    expect(GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE).toBe(20);
  });

  it('keeps retry delay between 30 and 60 seconds', () => {
    expect(getRetryDelayMs(1, null, () => 0)).toBe(30_000);
    expect(getRetryDelayMs(1, '5', () => 0.999999)).toBe(60_000);
    expect(getRetryDelayMs(1, '90', () => 0.25)).toBe(60_000);
  });

  it('selects a larger overlap only when the previous run is older', () => {
    const now = Date.parse('2026-09-11T12:00:00.000Z');

    expect(getIncrementalBufferSize('2026-09-11T10:00:00.000Z', now)).toBe(20);
    expect(getIncrementalBufferSize('2026-09-11T00:00:00.000Z', now)).toBe(30);
    expect(getIncrementalBufferSize('2026-09-09T00:00:00.000Z', now)).toBe(50);
  });

  it('enforces a 15-second minimum gap between completed runs', () => {
    const lastRun = Date.parse('2026-09-11T11:59:55.000Z');
    const now = Date.parse('2026-09-11T12:00:00.000Z');

    expect(GMAIL_MIN_RUN_INTERVAL_MS).toBe(15_000);
    expect(getMinimumRunWaitMs(new Date(lastRun).toISOString(), now)).toBe(10_000);
    expect(getMinimumRunWaitMs(new Date(lastRun - 20_000).toISOString(), now)).toBe(0);
  });

  it('limits legacy state migration to the day before the previous run', () => {
    expect(getLegacyMigrationQuery(
      'in:anywhere from:shein',
      '2026-09-11T10:14:11.950Z'
    )).toBe('in:anywhere from:shein after:2026/09/10');
  });

  it('keeps the overlap inside the 50-email processing cap and preserves new mail', () => {
    const newMessages = Array.from({ length: 35 }, (_, index) => `new-${index + 1}`);
    const bufferMessages = Array.from({ length: 20 }, (_, index) => `buffer-${index + 1}`);

    expect(selectIncrementalBatch(newMessages, bufferMessages, 50)).toEqual({
      batch: [...newMessages.slice(0, 30), ...bufferMessages],
      pending: newMessages.slice(30)
    });
  });

  it('does not overwrite a non-empty Sheet cell', () => {
    expect(shouldFillBlankSheetCell('Kh hủy được', 'GFUS01072087982467')).toBe(false);
    expect(shouldFillBlankSheetCell('', 'GFUS01072087982467')).toBe(true);
  });
});
