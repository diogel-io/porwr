import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

/**
 * The active and per-account key lookups, which NIP-17 messaging, Blossom and own-page signing use.
 * A remote-signer account has no key here, so each of them refuses it with one clear error rather
 * than a hex parse error, and never signs with Porwr's client key instead (#138).
 */

const state = vi.hoisted(() => ({ accounts: [] as unknown[], active: 'phone' }));

vi.mock('@/../src-bex/handlers/vault-handler', () => ({
  handleVaultIsUnlocked: vi.fn(() => Promise.resolve({ success: true, data: true })),
  handleVaultGetData: vi.fn(() =>
    Promise.resolve({ success: true, data: { vaultData: { accounts: state.accounts } } }),
  ),
}));
vi.mock('@/services/storage-service', () => ({
  NOSTR_ACTIVE: 'nostr:active',
  storageService: { get: vi.fn(() => Promise.resolve(state.active)) },
}));

import { getActiveSecretKey, getSecretKeyForAccount } from '@/../src-bex/handlers/active-key';
import { REMOTE_ACCOUNT_UNSUPPORTED } from '@/../src-bex/services/account-key';
import { createPubkey } from '@/types/pubkey';

const userKey = generateSecretKey();
const USER = getPublicKey(userKey);
const localKey = generateSecretKey();
const LOCAL = getPublicKey(localKey);

beforeEach(() => {
  state.active = 'phone';
  state.accounts = [
    {
      id: USER,
      alias: 'phone',
      account: {
        type: 'remote',
        nip46: {
          remoteSignerPubkey: 'cd'.repeat(32),
          relays: ['wss://relay.example.com'],
          clientSecret: '11'.repeat(32),
        },
      },
      createdAt: '',
    },
    { id: LOCAL, alias: 'local', account: { privkey: bytesToHex(localKey) }, createdAt: '' },
  ];
});

describe('local-only key lookups (#138)', () => {
  it('refuse an active remote-signer account', async () => {
    await expect(getActiveSecretKey()).rejects.toThrow(REMOTE_ACCOUNT_UNSUPPORTED);
  });

  it('refuse a remote-signer account by its key', async () => {
    await expect(getSecretKeyForAccount(createPubkey(USER)!)).rejects.toThrow(
      REMOTE_ACCOUNT_UNSUPPORTED,
    );
  });

  it('still return a local account’s key', async () => {
    state.active = 'local';
    expect(bytesToHex(await getActiveSecretKey())).toBe(bytesToHex(localKey));
    expect(bytesToHex(await getSecretKeyForAccount(createPubkey(LOCAL)!))).toBe(
      bytesToHex(localKey),
    );
  });
});
