import { describe, expect, it } from 'vitest';

import { isHexPubkey } from '@/../src-bex/services/pubkey';

describe('isHexPubkey (#373)', () => {
  it('accepts a 64-character lowercase hex key', () => {
    expect(isHexPubkey('a1'.repeat(32))).toBe(true);
  });

  it.each([
    ['uppercase hex', 'A1'.repeat(32)],
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['not hex', 'g'.repeat(64)],
    ['an npub', 'npub1' + 'q'.repeat(58)],
    ['empty', ''],
  ])('refuses %s', (_label, pubkey) => {
    expect(isHexPubkey(pubkey)).toBe(false);
  });

  it.each([undefined, null, 42, {}])('refuses the non-string %j', (pubkey) => {
    expect(isHexPubkey(pubkey)).toBe(false);
  });
});
