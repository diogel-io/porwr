import { describe, it, expect } from 'vitest';

import {
  clampRequestExpiryMinutes,
  REQUEST_EXPIRY_DEFAULT_MINUTES,
  REQUEST_EXPIRY_MAX_MINUTES,
  REQUEST_EXPIRY_MIN_MINUTES,
  REQUEST_EXPIRY_OPTION_MINUTES,
} from '@/services/request-expiry';

describe('request expiry bounds', () => {
  it('keeps supported values unchanged', () => {
    for (const minutes of REQUEST_EXPIRY_OPTION_MINUTES) {
      expect(clampRequestExpiryMinutes(minutes)).toBe(minutes);
    }
  });

  it('falls back to the default for absent or malformed values', () => {
    expect(clampRequestExpiryMinutes(undefined)).toBe(REQUEST_EXPIRY_DEFAULT_MINUTES);
    expect(clampRequestExpiryMinutes(null)).toBe(REQUEST_EXPIRY_DEFAULT_MINUTES);
    expect(clampRequestExpiryMinutes('not a number')).toBe(REQUEST_EXPIRY_DEFAULT_MINUTES);
    expect(clampRequestExpiryMinutes(Number.NaN)).toBe(REQUEST_EXPIRY_DEFAULT_MINUTES);
    expect(clampRequestExpiryMinutes(Number.POSITIVE_INFINITY)).toBe(REQUEST_EXPIRY_DEFAULT_MINUTES);
  });

  it('clamps values that would disable or widen expiry', () => {
    // There is deliberately no "off": zero and negatives clamp up rather than disabling expiry.
    expect(clampRequestExpiryMinutes(0)).toBe(REQUEST_EXPIRY_MIN_MINUTES);
    expect(clampRequestExpiryMinutes(-30)).toBe(REQUEST_EXPIRY_MIN_MINUTES);
    expect(clampRequestExpiryMinutes(60)).toBe(REQUEST_EXPIRY_MAX_MINUTES);
    expect(clampRequestExpiryMinutes(Number.MAX_SAFE_INTEGER)).toBe(REQUEST_EXPIRY_MAX_MINUTES);
  });

  it('offers no option outside the supported range', () => {
    for (const minutes of REQUEST_EXPIRY_OPTION_MINUTES) {
      expect(minutes).toBeGreaterThanOrEqual(REQUEST_EXPIRY_MIN_MINUTES);
      expect(minutes).toBeLessThanOrEqual(REQUEST_EXPIRY_MAX_MINUTES);
    }
    expect(REQUEST_EXPIRY_OPTION_MINUTES).toContain(REQUEST_EXPIRY_DEFAULT_MINUTES);
  });
});
