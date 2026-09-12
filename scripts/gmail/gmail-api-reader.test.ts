import { describe, expect, it } from 'vitest';

import { DEFAULT_GMAIL_ORDER_QUERY } from './gmail-api-reader.mts';

describe('Gmail order query', () => {
  it('includes every SHEIN message in spam and trash regardless of subject', () => {
    expect(DEFAULT_GMAIL_ORDER_QUERY).toBe('in:anywhere from:shein');
  });
});
