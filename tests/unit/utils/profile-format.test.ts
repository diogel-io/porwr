import { describe, it, expect } from 'vitest';

import { formatBirthday, normalizeWebsiteUrl } from '@/utils/profile-format';

/**
 * Shared profile formatting (#201).
 *
 * Extracted so the panel and the dashboard preview cannot drift while both exist. Every part of a
 * NIP-24 birthday is independently optional, which is the whole reason this is not a date object.
 */
describe('formatBirthday', () => {
  it('formats a complete birthday', () => {
    expect(formatBirthday({ year: 1990, month: 4, day: 7 })).toBe('1990-04-07');
  });

  it('pads a single-digit month and day', () => {
    expect(formatBirthday({ year: 2000, month: 1, day: 2 })).toBe('2000-01-02');
  });

  it('omits the year when it is not published', () => {
    // Common for people who want the date without giving away their age.
    expect(formatBirthday({ month: 4, day: 7 })).toBe('04-07');
  });

  it('accepts a year alone', () => {
    expect(formatBirthday({ year: 1990 })).toBe('1990');
  });

  it('accepts a day alone, however unhelpful', () => {
    expect(formatBirthday({ day: 7 })).toBe('07');
  });

  it('is empty for no birthday at all', () => {
    expect(formatBirthday(undefined)).toBe('');
    expect(formatBirthday({})).toBe('');
  });

  it('keeps year zero rather than treating it as absent', () => {
    // `if (year)` would drop this; the check is against undefined for exactly that reason.
    expect(formatBirthday({ year: 0, month: 1, day: 1 })).toBe('0-01-01');
  });
});

describe('normalizeWebsiteUrl', () => {
  it('leaves an http or https URL alone', () => {
    expect(normalizeWebsiteUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('http://example.com')).toBe('http://example.com');
  });

  it('is case-insensitive about the scheme', () => {
    expect(normalizeWebsiteUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
  });

  it('adds https to a bare host', () => {
    // Without a scheme the browser resolves it against the extension's own origin, so the link
    // would point back into the extension rather than out to the site.
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com');
  });

  it('adds https to something that merely looks schemeless', () => {
    expect(normalizeWebsiteUrl('ftp.example.com')).toBe('https://ftp.example.com');
  });
});
