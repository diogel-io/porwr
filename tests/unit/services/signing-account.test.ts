import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/../src-bex/vault', () => ({
  isVaultUnlocked: vi.fn(() => true),
  getVaultData: vi.fn(),
}));

vi.mock('@/services/storage-service', () => ({
  storageService: { get: vi.fn(), set: vi.fn(() => Promise.resolve()) },
  NOSTR_ACTIVE: 'nostr_active_account',
  SITE_BINDINGS_KEY: 'nostr:site-bindings',
}));

vi.mock('@/services/log-service', () => ({
  LogLevel: { INFO: 'info' },
  logService: { log: vi.fn() },
}));

import { getVaultData, isVaultUnlocked } from '@/../src-bex/vault';
import { storageService } from '@/services/storage-service';
import { clearSiteBindingCache } from '@/../src-bex/services/site-binding-store';
import {
  resolveSigningAccount,
  resolveSigningSecretKey,
} from '@/../src-bex/services/signing-account';
import { ErrorCode } from '@/types/error-codes.d';

const alice = { id: 'a'.repeat(64), alias: 'alice', account: { privkey: '11'.repeat(32) } };
const bob = { id: 'b'.repeat(64), alias: 'bob', account: { privkey: '22'.repeat(32) } };

const ORIGIN = 'https://example.com';

const withAccounts = (accounts: unknown[], activeAlias?: string): void => {
  vi.mocked(storageService).get.mockImplementation((key: string) =>
    Promise.resolve(key === 'nostr_active_account' ? activeAlias : []),
  );
  vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts } });
};

beforeEach(() => {
  vi.clearAllMocks();
  clearSiteBindingCache();
  vi.mocked(isVaultUnlocked).mockReturnValue(true);
});

describe('resolving the account that acts for a site', () => {
  it('binds to the active account on first contact', async () => {
    withAccounts([alice, bob], 'alice');

    const resolved = await resolveSigningAccount(ORIGIN);

    expect('account' in resolved && resolved.account.id).toBe(alice.id);
  });

  it('keeps the bound account after the active one changes', async () => {
    withAccounts([alice, bob], 'alice');
    await resolveSigningAccount(ORIGIN);

    withAccounts([alice, bob], 'bob');
    const resolved = await resolveSigningAccount(ORIGIN);

    expect('account' in resolved && resolved.account.id).toBe(alice.id);
  });

  it('refuses rather than substituting when the bound account is gone', async () => {
    withAccounts([alice, bob], 'alice');
    await resolveSigningAccount(ORIGIN);

    withAccounts([bob], 'bob');
    const resolved = await resolveSigningAccount(ORIGIN);

    expect('error' in resolved && resolved.error).toMatch(/no longer available/);
  });

  describe('when it cannot resolve', () => {
    it('says the vault is locked, rather than reporting no account', async () => {
      // The encryption handlers used to get this distinction from `getActiveSecretKey`; losing it
      // would turn a locked vault into a confusing "no account" error.
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      const resolved = await resolveSigningAccount(ORIGIN);

      expect(resolved).toEqual({ error: 'Vault is locked', code: ErrorCode.VLT_LOCKED });
    });

    it('reports no active account when the vault holds none', async () => {
      withAccounts([], undefined);

      const resolved = await resolveSigningAccount(ORIGIN);

      expect('error' in resolved && resolved.error).toBe('No active account');
    });
  });

  describe('the secret key for encryption', () => {
    it('is the bound account key, never the active account key', async () => {
      withAccounts([alice, bob], 'alice');
      await resolveSigningAccount(ORIGIN);

      withAccounts([alice, bob], 'bob');
      const key = await resolveSigningSecretKey(ORIGIN);

      // Encrypting under the wrong identity tells the recipient the wrong thing about who is
      // talking to them, and decrypting under it simply fails.
      expect(Buffer.from(key).toString('hex')).toBe(alice.account.privkey);
    });

    it('throws rather than returning a key it could not resolve', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      await expect(resolveSigningSecretKey(ORIGIN)).rejects.toThrow('Vault is locked');
    });
  });
});
