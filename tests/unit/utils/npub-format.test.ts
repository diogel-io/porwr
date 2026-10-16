import { describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';

import { encodeNpub, formatNpubDisplay } from '@/utils/npub-format';

describe('encodeNpub', () => {
  it('encodes a hex pubkey as an npub', () => {
    const pubkey = 'a'.repeat(64);

    expect(encodeNpub(pubkey)).toBe(nip19.npubEncode(pubkey));
  });

  it('is empty for a value that is not a pubkey', () => {
    expect(encodeNpub('not-hex')).toBe('');
    expect(encodeNpub('')).toBe('');
    expect(encodeNpub('ab'.repeat(16))).toBe('');
  });
});

describe('formatNpubDisplay', () => {
  it('keeps the head and tail of a full npub', () => {
    const npub = nip19.npubEncode('a'.repeat(64));

    expect(formatNpubDisplay(npub)).toBe(`${npub.slice(0, 14)}…${npub.slice(-10)}`);
  });

  it('leaves a value that would not get shorter unchanged', () => {
    // 14 + 10 + the ellipsis: shortening this would not save a character.
    const value = 'x'.repeat(25);

    expect(formatNpubDisplay(value)).toBe(value);
    expect(formatNpubDisplay('x'.repeat(26))).toBe(`${'x'.repeat(14)}…${'x'.repeat(10)}`);
  });

  it('is empty for an empty value', () => {
    expect(formatNpubDisplay('')).toBe('');
  });
});
