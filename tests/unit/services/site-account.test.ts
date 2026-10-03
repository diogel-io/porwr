import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('app/src-bex/vault', () => ({
  isVaultUnlocked: vi.fn(() => true),
  getVaultData: vi.fn(),
}));

vi.mock('src/services/storage-service', () => ({
  storageService: { get: vi.fn(), set: vi.fn(() => Promise.resolve()) },
  NOSTR_ACTIVE: 'nostr_active_account',
  SITE_BINDINGS_KEY: 'nostr:site-bindings',
}));

vi.mock('src/services/log-service', () => ({
  LogLevel: { INFO: 'info', WARN: 'warn' },
  logService: { log: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  getGrantedPermissions: vi.fn(),
  revokePermission: vi.fn(),
  interruptRequestsForOrigin: vi.fn(),
}));

vi.mock('app/src-bex/handlers/permission-handler', () => ({
  getGrantedPermissions: mocks.getGrantedPermissions,
  revokePermission: mocks.revokePermission,
}));

vi.mock('app/src-bex/services/request-queue', () => ({
  interruptRequestsForOrigin: mocks.interruptRequestsForOrigin,
}));

import { getVaultData, isVaultUnlocked } from 'app/src-bex/vault';
import { storageService } from 'src/services/storage-service';
import { clearSiteBindingCache, getBinding } from 'app/src-bex/services/site-binding-store';
import { resolveSigningAccount } from 'app/src-bex/services/signing-account';
import { getSiteAccount, switchSiteToActiveAccount } from 'app/src-bex/services/site-account';
import { ErrorCode } from 'src/types/error-codes.d';

const alice = { id: 'a'.repeat(64), alias: 'alice', account: { privkey: '11'.repeat(32) } };
const bob = { id: 'b'.repeat(64), alias: 'bob', account: { privkey: '22'.repeat(32) } };

const ORIGIN = 'https://example.com';

const withAccounts = (accounts: unknown[], activeAlias?: string): void => {
  vi.mocked(storageService).get.mockImplementation((key: string) =>
    Promise.resolve(key === 'nostr_active_account' ? activeAlias : []),
  );
  vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts } });
};

/** The site connected while alice was active, then bob selected. */
const boundToAliceWithBobActive = async (): Promise<void> => {
  withAccounts([alice, bob], 'alice');
  await resolveSigningAccount(ORIGIN);
  withAccounts([alice, bob], 'bob');
};

beforeEach(() => {
  vi.clearAllMocks();
  clearSiteBindingCache();
  vi.mocked(isVaultUnlocked).mockReturnValue(true);
  mocks.getGrantedPermissions.mockResolvedValue([]);
  mocks.revokePermission.mockResolvedValue(undefined);
  mocks.interruptRequestsForOrigin.mockResolvedValue([]);
});

describe('which account a site is connected as', () => {
  it('is null for a site that is not connected', async () => {
    withAccounts([alice, bob], 'alice');

    expect(await getSiteAccount(ORIGIN)).toBeNull();
  });

  it('matches the active account when it is the bound one', async () => {
    withAccounts([alice, bob], 'alice');
    await resolveSigningAccount(ORIGIN);

    expect(await getSiteAccount(ORIGIN)).toEqual({
      origin: ORIGIN,
      boundPubkey: alice.id,
      boundAlias: 'alice',
      activePubkey: alice.id,
      activeAlias: 'alice',
      mismatch: false,
    });
  });

  it('says when the active account is not the one the site is connected as', async () => {
    await boundToAliceWithBobActive();

    expect(await getSiteAccount(ORIGIN)).toMatchObject({
      boundPubkey: alice.id,
      boundAlias: 'alice',
      activePubkey: bob.id,
      activeAlias: 'bob',
      mismatch: true,
    });
  });

  it('still names the bound key with the vault locked, and claims no mismatch it cannot see', async () => {
    await boundToAliceWithBobActive();
    vi.mocked(isVaultUnlocked).mockReturnValue(false);

    expect(await getSiteAccount(ORIGIN)).toMatchObject({
      boundPubkey: alice.id,
      boundAlias: null,
      activePubkey: null,
      mismatch: false,
    });
  });

  it('only reads: asking does not bind an unconnected site', async () => {
    withAccounts([alice, bob], 'alice');
    await getSiteAccount(ORIGIN);

    expect(await getBinding(ORIGIN)).toBeNull();
  });
});

describe('connecting a site as the active account instead', () => {
  it('rebinds the site, so it signs as the active account from then on', async () => {
    await boundToAliceWithBobActive();

    const result = await switchSiteToActiveAccount(ORIGIN);

    expect(result).toEqual({
      success: true,
      site: {
        origin: ORIGIN,
        boundPubkey: bob.id,
        boundAlias: 'bob',
        activePubkey: bob.id,
        activeAlias: 'bob',
        mismatch: false,
      },
    });
    const resolved = await resolveSigningAccount(ORIGIN);
    expect('account' in resolved && resolved.account.id).toBe(bob.id);
  });

  it('revokes every grant the site held, as disconnecting does', async () => {
    await boundToAliceWithBobActive();
    mocks.getGrantedPermissions.mockResolvedValue([
      {
        origin: ORIGIN,
        accountPubkey: alice.id,
        requestType: 'sign_event',
        eventKind: 1,
        granted: true,
      },
      {
        origin: 'https://other.example',
        accountPubkey: alice.id,
        requestType: 'sign_event',
        eventKind: 1,
        granted: true,
      },
    ]);

    await switchSiteToActiveAccount(ORIGIN);

    expect(mocks.revokePermission).toHaveBeenCalledTimes(1);
    expect(mocks.revokePermission).toHaveBeenCalledWith(ORIGIN, alice.id, 'sign_event', 1);
  });

  it('closes the site’s waiting requests before rebinding, so none can sign as the new account', async () => {
    // A waiting request names alice. Its account is resolved again when it is approved, so left
    // open it would sign as bob under a prompt that said alice.
    await boundToAliceWithBobActive();
    let boundWhenInterrupted: string | undefined;
    mocks.interruptRequestsForOrigin.mockImplementation(async () => {
      boundWhenInterrupted = (await getBinding(ORIGIN))?.pubkey;
      return [];
    });

    await switchSiteToActiveAccount(ORIGIN);

    expect(mocks.interruptRequestsForOrigin).toHaveBeenCalledWith(ORIGIN);
    expect(boundWhenInterrupted).toBe(alice.id);
  });

  it('normalises the origin it is given', async () => {
    await boundToAliceWithBobActive();

    await switchSiteToActiveAccount('HTTPS://Example.com:443/some/page');

    expect((await getBinding(ORIGIN))?.pubkey).toBe(bob.id);
  });

  it('is refused with the vault locked, and changes nothing', async () => {
    await boundToAliceWithBobActive();
    vi.mocked(isVaultUnlocked).mockReturnValue(false);

    const result = await switchSiteToActiveAccount(ORIGIN);

    expect(result).toMatchObject({ success: false, code: ErrorCode.VLT_LOCKED });
    expect((await getBinding(ORIGIN))?.pubkey).toBe(alice.id);
    expect(mocks.interruptRequestsForOrigin).not.toHaveBeenCalled();
  });

  it('is refused with no active account, and changes nothing', async () => {
    await boundToAliceWithBobActive();
    withAccounts([alice, bob], undefined);

    const result = await switchSiteToActiveAccount(ORIGIN);

    expect(result).toMatchObject({ success: false, code: ErrorCode.SIG_NO_ACTIVE_KEY });
    expect((await getBinding(ORIGIN))?.pubkey).toBe(alice.id);
  });

  it('is refused for something that is not a web origin', async () => {
    withAccounts([alice, bob], 'bob');

    const result = await switchSiteToActiveAccount('chrome-extension://abc');

    expect(result).toMatchObject({ success: false, code: ErrorCode.GEN_INVALID_INPUT });
  });
});
