import { describe, it, expect } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { generateKey } from '@/services/generate-key';
import { createPubkey } from '@/types/pubkey';

describe('generateKey', () => {
  it('returns a stored key whose id is a valid pubkey derived from its own privkey', () => {
    const storedKey = generateKey();

    expect(createPubkey(storedKey.id)).toBe(storedKey.id);
    expect(storedKey.id).toBe(getPublicKey(hexToBytes(storedKey.account.privkey)));
  });

  it('returns an empty alias and an ISO createdAt timestamp', () => {
    const storedKey = generateKey();

    expect(storedKey.alias).toBe('');
    expect(() => new Date(storedKey.createdAt).toISOString()).not.toThrow();
    expect(new Date(storedKey.createdAt).toISOString()).toBe(storedKey.createdAt);
  });

  it('generates a different key on every call', () => {
    const a = generateKey();
    const b = generateKey();

    expect(a.id).not.toBe(b.id);
    expect(a.account.privkey).not.toBe(b.account.privkey);
  });
});
