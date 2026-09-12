import { describe, expect, it } from 'vitest';

import { DEFAULT_GMAIL_ORDER_QUERY } from './gmail-api-reader.mts';

describe('Gmail order query', () => {
  it('includes spam and trash in manual order scans', () => {
    expect(DEFAULT_GMAIL_ORDER_QUERY).toContain('in:anywhere');
  });
});
