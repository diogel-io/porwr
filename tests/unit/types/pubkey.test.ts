import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { createPubkey, toNpub } from '@/types/pubkey';

const hexPubkey = getPublicKey(generateSecretKey());
const npub = nip19.npubEncode(hexPubkey);

describe('createPubkey', () => {
  it('accepts a lowercase hex pubkey', () => {
    expect(createPubkey(hexPubkey)).toBe(hexPubkey);
  });

  it('normalizes an uppercase hex pubkey to lowercase', () => {
    expect(createPubkey(hexPubkey.toUpperCase())).toBe(hexPubkey);
  });

  it('trims whitespace', () => {
    expect(createPubkey(`  ${hexPubkey}  `)).toBe(hexPubkey);
  });

  it('decodes a valid npub to lowercase hex', () => {
    expect(createPubkey(npub)).toBe(hexPubkey);
  });

  it('returns null for the wrong hex length', () => {
    expect(createPubkey(hexPubkey.slice(0, 63))).toBeNull();
  });

  it('returns null for non-hex characters', () => {
    expect(createPubkey('z'.repeat(64))).toBeNull();
  });

  it('returns null for an nsec (wrong bech32 prefix)', () => {
    const nsec = nip19.nsecEncode(generateSecretKey());
    expect(createPubkey(nsec)).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(createPubkey('not a pubkey')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(createPubkey('')).toBeNull();
  });
});

describe('toNpub', () => {
  it('round-trips a Pubkey back to its npub form', () => {
    const pubkey = createPubkey(hexPubkey);
    expect(pubkey).not.toBeNull();
    expect(toNpub(pubkey!)).toBe(npub);
  });
});
