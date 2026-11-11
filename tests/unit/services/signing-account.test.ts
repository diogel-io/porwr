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
import { clearSiteBindingCache, getBinding } from '@/../src-bex/services/site-binding-store';
import {
  bindSiteToAccount,
  resolveSigningAccount,
  accountForDispatch,
  BOUND_ACCOUNT_GONE,
  signingSignerFor,
} from '@/../src-bex/services/signing-account';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey, nip44 } from 'nostr-tools';
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
  it('answers with the active account for an unbound site, without binding it (#139)', async () => {
    withAccounts([alice, bob], 'alice');

    const resolved = await resolveSigningAccount(ORIGIN);

    expect('account' in resolved && resolved.account.id).toBe(alice.id);
    // Asking is not consent: the site is bound only when the user approves.
    expect(await getBinding(ORIGIN)).toBeNull();
  });

  it('binds only when told to, and never moves a bound site', async () => {
    withAccounts([alice, bob], 'alice');

    await bindSiteToAccount(ORIGIN, alice.id);
    await bindSiteToAccount(ORIGIN, bob.id);

    expect((await getBinding(ORIGIN))?.pubkey).toBe(alice.id);
  });

  it('keeps the bound account after the active one changes', async () => {
    withAccounts([alice, bob], 'alice');
    await bindSiteToAccount(ORIGIN, alice.id);

    withAccounts([alice, bob], 'bob');
    const resolved = await resolveSigningAccount(ORIGIN);

    expect('account' in resolved && resolved.account.id).toBe(alice.id);
  });

  it('refuses rather than substituting when the bound account is gone', async () => {
    withAccounts([alice, bob], 'alice');
    await bindSiteToAccount(ORIGIN, alice.id);

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

  describe('the signer for encryption', () => {
    it('is the account it is given, never the active account', async () => {
      withAccounts([alice, bob], 'bob');
      const signer = signingSignerFor(alice as never, ORIGIN);
      const peer = '33'.repeat(32);
      const ciphertext = await signer.nip44Encrypt(getPublicKey(hexToBytes(peer)), 'hello');

      // Encrypting under the wrong identity tells the recipient the wrong thing about who is
      // talking to them, and decrypting under it simply fails. Only alice's key opens this.
      const fromAlice = nip44.getConversationKey(
        hexToBytes(peer),
        getPublicKey(hexToBytes(alice.account.privkey)),
      );
      expect(nip44.decrypt(ciphertext, fromAlice)).toBe('hello');
    });
  });
});

/**
 * The account an approved request runs as (diogel-io/workspace#227): the one the approval named,
 * checked again rather than resolved again, failing closed rather than substituting another.
 */
describe('the account an approved request is carried out as', () => {
  it('is the approved account, even when another is active and the site is unbound', async () => {
    withAccounts([alice, bob], 'bob');

    const resolved = await accountForDispatch(ORIGIN, alice.id);

    expect('account' in resolved && resolved.account.id).toBe(alice.id);
  });

  it('is the approved account for a site bound to it', async () => {
    withAccounts([alice, bob], 'bob');
    await bindSiteToAccount(ORIGIN, alice.id);

    const resolved = await accountForDispatch(ORIGIN, alice.id);

    expect('account' in resolved && resolved.account.id).toBe(alice.id);
  });

  it('refuses once the approved account has been removed', async () => {
    withAccounts([bob], 'bob');

    const resolved = await accountForDispatch(ORIGIN, alice.id);

    expect(resolved).toEqual({ error: BOUND_ACCOUNT_GONE, code: ErrorCode.SIG_NO_ACTIVE_KEY });
  });

  it('refuses when the site has since been bound to another account', async () => {
    withAccounts([alice, bob], 'alice');
    await bindSiteToAccount(ORIGIN, bob.id);

    const resolved = await accountForDispatch(ORIGIN, alice.id);

    expect(resolved).toEqual({ error: BOUND_ACCOUNT_GONE, code: ErrorCode.SIG_NO_ACTIVE_KEY });
  });

  it('refuses a request that names no account', async () => {
    withAccounts([alice, bob], 'alice');

    expect(await accountForDispatch(ORIGIN, null)).toEqual({
      error: 'No active account',
      code: ErrorCode.SIG_NO_ACTIVE_KEY,
    });
  });

  it('refuses while the vault is locked', async () => {
    withAccounts([alice, bob], 'alice');
    vi.mocked(isVaultUnlocked).mockReturnValue(false);

    expect(await accountForDispatch(ORIGIN, alice.id)).toEqual({
      error: 'Vault is locked',
      code: ErrorCode.VLT_LOCKED,
    });
  });
});
