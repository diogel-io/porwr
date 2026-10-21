import { describe, it, expect } from 'vitest';

import { formatEncryptedKeyBackup } from '@/services/key-backup';

/** The exported file says what it holds, not whose it is, and holds no plaintext key (#141). */
describe('formatEncryptedKeyBackup', () => {
  const text = formatEncryptedKeyBackup({ ncryptsec: 'ncryptsec1abc', npub: 'npub1xyz' });

  it('holds the ncryptsec on a line of its own, and the public key', () => {
    expect(text.split('\n')).toContain('ncryptsec1abc');
    expect(text).toContain('Public key: npub1xyz');
  });

  it('names NIP-49 and how to restore it', () => {
    expect(text).toMatch(/NIP-49/);
    expect(text).toMatch(/password/);
  });

  it('holds no nsec', () => {
    expect(text).not.toMatch(/nsec1/);
  });
});
