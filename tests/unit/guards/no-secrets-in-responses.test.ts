import { describe, it, expect, vi } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * No response a page gets from the vault carries a secret (#240).
 *
 * Built from a vault full of secrets and run through the real dispatcher: the answers to `vault.getView`
 * and `vault.unlock` are searched, at any depth, for a secret field name or a secret value.
 */

const accountKey = generateSecretKey();
const FIXTURE = {
  mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
  passphrase: 'fixture-passphrase',
  accounts: [{ id: getPublicKey(accountKey), alias: 'main', account: { privkey: bytesToHex(accountKey) }, createdAt: '2026-01-01' }],
  nip47Connections: [{ id: 'w', clientSecret: 'f'.repeat(64), relays: [], walletServicePubkey: 'e'.repeat(64) }],
};
const SECRET_VALUES = [
  FIXTURE.mnemonic,
  FIXTURE.passphrase,
  bytesToHex(accountKey),
  nip19.nsecEncode(accountKey),
  'f'.repeat(64),
];
const SECRET_KEYS = ['privkey', 'mnemonic', 'passphrase', 'clientSecret', 'nsec', 'vaultData'];

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(() => Promise.resolve({ success: true, vaultData: structuredClone(FIXTURE) })),
  updateVaultData: vi.fn(() => Promise.resolve({ success: true })),
  unlockVault: vi.fn(() => Promise.resolve({ success: true, vaultData: structuredClone(FIXTURE) })),
  isVaultUnlocked: vi.fn(() => true),
  onVaultLocked: vi.fn(),
  lockVault: vi.fn(),
}));
vi.mock('@/../src-bex/handlers/vault-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/../src-bex/handlers/vault-handler')>();
  return {
    ...actual,
    handleVaultUnlock: vi.fn(() => Promise.resolve({ success: true, data: { vaultData: structuredClone(FIXTURE) } })),
  };
});
vi.mock('@/../src-bex/services/auto-lock', () => ({
  resetAutoLockTimer: vi.fn(),
  startAutoLockTimer: vi.fn(),
  stopAutoLockTimer: vi.fn(),
}));

import { dispatchMessage } from '@/../src-bex/dispatcher';

const findSecrets = (value: unknown, path = '$'): string[] => {
  if (typeof value === 'string') {
    return SECRET_VALUES.some((secret) => value.includes(secret)) ? [path] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => findSecrets(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(SECRET_KEYS.includes(key) ? [`${path}.${key}`] : []),
      ...findSecrets(child, `${path}.${key}`),
    ]);
  }
  return [];
};

describe('vault responses to pages carry no secrets', () => {
  it('the scan finds secrets when they are there, so a clean result means something', () => {
    expect(findSecrets(FIXTURE).length).toBeGreaterThanOrEqual(5);
  });

  it('vault.getView', async () => {
    const response = await dispatchMessage('vault.getView', {} as never, '');

    expect(response).toEqual({ accounts: [{ id: FIXTURE.accounts[0]!.id, alias: 'main', createdAt: '2026-01-01' }] });
    expect(findSecrets(response)).toEqual([]);
  });

  it('vault.unlock', async () => {
    const response = await dispatchMessage('vault.unlock', { password: 'pw' } as never, '');

    expect(response).toEqual({ success: true });
    expect(findSecrets(response)).toEqual([]);
  });
});
