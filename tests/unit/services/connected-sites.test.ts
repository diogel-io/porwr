import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGrantedPermissions: vi.fn(),
  revokePermission: vi.fn(),
  listBindings: vi.fn(),
  removeBinding: vi.fn(),
  getBinding: vi.fn(),
  removeBindingsExcept: vi.fn(),
  revokeGrantsExcept: vi.fn(),
  isVaultUnlocked: vi.fn(),
  vault: { value: {} as Record<string, unknown> },
}));

vi.mock('@/../src-bex/handlers/permission-handler', () => ({
  getGrantedPermissions: mocks.getGrantedPermissions,
  revokePermission: mocks.revokePermission,
  revokeGrantsExcept: mocks.revokeGrantsExcept,
}));
vi.mock('@/../src-bex/vault', () => ({ isVaultUnlocked: mocks.isVaultUnlocked }));
// The real WebLN store over an in-memory vault, so what disconnecting leaves is what is asserted.
vi.mock('@/../src-bex/services/wallet-vault', () => ({
  mutateWalletVault: vi.fn(
    async (
      mutator: (vault: unknown) => Promise<{ vaultData: unknown }> | { vaultData: unknown },
    ) => {
      const { vaultData } = await mutator(mocks.vault.value);
      mocks.vault.value = vaultData as Record<string, unknown>;
    },
  ),
}));
vi.mock('@/services/log-service', () => ({
  LogLevel: { WARN: 'WARN' },
  logService: { log: vi.fn() },
}));
vi.mock('@/../src-bex/services/site-binding-store', () => ({
  listBindings: mocks.listBindings,
  removeBinding: mocks.removeBinding,
  getBinding: mocks.getBinding,
  removeBindingsExcept: mocks.removeBindingsExcept,
}));

import {
  countSitesHoldingGrantsFor,
  disconnectSite,
  disconnectSiteFor,
  listConnectedSites,
  listConnectedSitesFor,
  sweepSiteStateForRemovedAccounts,
} from '@/../src-bex/services/connected-sites';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const grant = (over: Record<string, unknown> = {}) => ({
  origin: 'https://example.com',
  accountPubkey: ALICE,
  requestType: 'sign_event',
  eventKind: 1,
  granted: true,
  timestamp: 1000,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listBindings.mockResolvedValue([]);
  mocks.getGrantedPermissions.mockResolvedValue([]);
  mocks.revokePermission.mockResolvedValue(undefined);
  mocks.removeBinding.mockResolvedValue(undefined);
  mocks.getBinding.mockResolvedValue(null);
  mocks.isVaultUnlocked.mockReturnValue(true);
  mocks.vault.value = {};
});

describe('what a site holds', () => {
  it('joins a binding with the grants for the same origin', async () => {
    mocks.listBindings.mockResolvedValue([
      { origin: 'https://example.com', pubkey: ALICE, boundAt: 500 },
    ]);
    mocks.getGrantedPermissions.mockResolvedValue([grant()]);

    const [site] = await listConnectedSites();

    expect(site).toEqual({
      origin: 'https://example.com',
      boundPubkey: ALICE,
      boundAt: 500,
      grants: [{ accountPubkey: ALICE, requestType: 'sign_event', eventKind: 1, grantedAt: 1000 }],
    });
  });

  it('shows a site that is bound but holds no standing permission', async () => {
    // "Just this once" leaves a binding and no grant. It still signs as that identity next time,
    // so hiding it would understate what the site can do.
    mocks.listBindings.mockResolvedValue([
      { origin: 'https://example.com', pubkey: ALICE, boundAt: 500 },
    ]);

    const [site] = await listConnectedSites();

    expect(site?.grants).toEqual([]);
    expect(site?.boundPubkey).toBe(ALICE);
  });

  it('shows a site that holds grants but was never bound', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([grant()]);

    const [site] = await listConnectedSites();

    expect(site?.boundPubkey).toBeNull();
    expect(site?.grants).toHaveLength(1);
  });

  it('carries the expiry when a grant has one, and omits it when not', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([
      grant({ expiry: 9999 }),
      grant({ eventKind: 5 }),
    ]);

    const [site] = await listConnectedSites();

    expect(site?.grants[0]).toMatchObject({ expiresAt: 9999 });
    expect(site?.grants[1]).not.toHaveProperty('expiresAt');
  });

  it('ignores a record that is not a live grant', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([grant({ granted: false })]);

    expect(await listConnectedSites()).toEqual([]);
  });

  it('keeps sites separate and orders them predictably', async () => {
    mocks.listBindings.mockResolvedValue([
      { origin: 'https://zeta.example', pubkey: BOB, boundAt: 1 },
      { origin: 'https://alpha.example', pubkey: ALICE, boundAt: 2 },
    ]);

    const origins = (await listConnectedSites()).map((site) => site.origin);

    expect(origins).toEqual(['https://alpha.example', 'https://zeta.example']);
  });
});

describe('disconnecting a site', () => {
  it('revokes every grant it holds and forgets the binding', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([
      grant(),
      grant({ eventKind: 5 }),
      grant({ origin: 'https://other.example' }),
    ]);

    await expect(disconnectSite('https://example.com')).resolves.toBe(true);

    expect(mocks.revokePermission).toHaveBeenCalledTimes(2);
    expect(mocks.removeBinding).toHaveBeenCalledWith('https://example.com');
  });

  it('revokes each grant against the account that holds it', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([
      grant(),
      grant({ accountPubkey: BOB, eventKind: 5 }),
    ]);

    await disconnectSite('https://example.com');

    expect(mocks.revokePermission).toHaveBeenCalledWith(
      'https://example.com',
      ALICE,
      'sign_event',
      1,
    );
    expect(mocks.revokePermission).toHaveBeenCalledWith(
      'https://example.com',
      BOB,
      'sign_event',
      5,
    );
  });

  it('leaves other origins alone', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([grant({ origin: 'https://other.example' })]);

    await disconnectSite('https://example.com');

    expect(mocks.revokePermission).not.toHaveBeenCalled();
  });

  it('matches the site however the origin was written', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([grant()]);

    await disconnectSite('https://Example.com/some/path');

    expect(mocks.removeBinding).toHaveBeenCalledWith('https://example.com');
  });

  it('refuses anything that is not a web origin', async () => {
    await expect(disconnectSite('moz-extension://abc')).resolves.toBe(false);
    expect(mocks.removeBinding).not.toHaveBeenCalled();
  });

  it('removes the binding even when the site holds no grants', async () => {
    // Otherwise a "just this once" site could never be disconnected.
    await expect(disconnectSite('https://example.com')).resolves.toBe(true);

    expect(mocks.removeBinding).toHaveBeenCalledWith('https://example.com');
  });
});

/**
 * The dashboard's "Approved Clients" figure.
 *
 * It counted distinct hostnames in the approvals log, which overstates it twice over: the log
 * records rejections and the query never filtered on outcome, and an entry outlives the grant it
 * describes (#116).
 */
describe('counting sites that hold a standing permission', () => {
  it('counts a site once however many grants it holds', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([grant(), grant({ eventKind: 5 })]);

    await expect(countSitesHoldingGrantsFor(ALICE)).resolves.toBe(1);
  });

  it('counts only grants belonging to that account', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([
      grant(),
      grant({ origin: 'https://other.example', accountPubkey: BOB }),
    ]);

    await expect(countSitesHoldingGrantsFor(ALICE)).resolves.toBe(1);
    await expect(countSitesHoldingGrantsFor(BOB)).resolves.toBe(1);
  });

  it('does not count a site that is merely bound', async () => {
    // A bound site with no standing permission asks every time, so it holds nothing.
    mocks.listBindings.mockResolvedValue([
      { origin: 'https://example.com', pubkey: ALICE, boundAt: 1 },
    ]);

    await expect(countSitesHoldingGrantsFor(ALICE)).resolves.toBe(0);
  });

  it('counts nothing without an account', async () => {
    mocks.getGrantedPermissions.mockResolvedValue([grant()]);

    await expect(countSitesHoldingGrantsFor('')).resolves.toBe(0);
  });
});

describe('one account’s sites (#309)', () => {
  const binding = (origin: string, pubkey: string) => ({ origin, pubkey, boundAt: 500 });

  beforeEach(() => {
    mocks.listBindings.mockResolvedValue([
      binding('https://alice.example', ALICE),
      binding('https://bob.example', BOB),
    ]);
    mocks.getGrantedPermissions.mockResolvedValue([
      grant({ origin: 'https://alice.example', accountPubkey: ALICE }),
      grant({ origin: 'https://bob.example', accountPubkey: BOB }),
      // Left over from before bindings: inert, since signing uses the bound account.
      grant({ origin: 'https://bob.example', accountPubkey: ALICE, requestType: 'nip04_encrypt' }),
      // Unbound, holding grants for each account.
      grant({ origin: 'https://unbound.example', accountPubkey: ALICE }),
      grant({
        origin: 'https://unbound.example',
        accountPubkey: BOB,
        requestType: 'nip44_encrypt',
      }),
      // Unbound, Bob's only.
      grant({ origin: 'https://bob-only.example', accountPubkey: BOB }),
    ]);
  });

  it('lists sites bound to the account, and unbound ones it holds grants on', async () => {
    const sites = await listConnectedSitesFor(ALICE);

    expect(sites.map((site) => site.origin)).toEqual([
      'https://alice.example',
      'https://unbound.example',
    ]);
  });

  it('lists only the account’s own grants on each site', async () => {
    const sites = await listConnectedSitesFor(ALICE);

    for (const site of sites) {
      expect(site.grants.every((item) => item.accountPubkey === ALICE)).toBe(true);
    }
    expect(sites.find((site) => site.origin === 'https://unbound.example')?.grants).toHaveLength(1);
  });

  it('does not list a site bound to another account, even with a stale grant for this one', async () => {
    const sites = await listConnectedSitesFor(ALICE);

    expect(sites.some((site) => site.origin === 'https://bob.example')).toBe(false);
  });

  it('lists nothing for no account', async () => {
    await expect(listConnectedSitesFor('')).resolves.toEqual([]);
  });
});

describe('disconnecting for one account (#309)', () => {
  beforeEach(() => {
    mocks.getGrantedPermissions.mockResolvedValue([
      grant({ accountPubkey: ALICE }),
      grant({ accountPubkey: BOB, requestType: 'nip44_encrypt' }),
    ]);
  });

  it('revokes only that account’s grants and its binding', async () => {
    mocks.getBinding.mockResolvedValue({
      origin: 'https://example.com',
      pubkey: ALICE,
      boundAt: 500,
    });

    await expect(disconnectSiteFor('https://example.com', ALICE)).resolves.toBe(true);

    expect(mocks.revokePermission).toHaveBeenCalledTimes(1);
    expect(mocks.revokePermission).toHaveBeenCalledWith(
      'https://example.com',
      ALICE,
      'sign_event',
      1,
    );
    expect(mocks.removeBinding).toHaveBeenCalledWith('https://example.com');
  });

  it('keeps a binding that belongs to another account', async () => {
    mocks.getBinding.mockResolvedValue({
      origin: 'https://example.com',
      pubkey: BOB,
      boundAt: 500,
    });

    await disconnectSiteFor('https://example.com', ALICE);

    expect(mocks.removeBinding).not.toHaveBeenCalled();
    expect(mocks.revokePermission).not.toHaveBeenCalledWith(
      'https://example.com',
      BOB,
      'nip44_encrypt',
      1,
    );
  });

  it('refuses an origin it cannot normalise, or no account', async () => {
    await expect(disconnectSiteFor('not a url', ALICE)).resolves.toBe(false);
    await expect(disconnectSiteFor('https://example.com', '')).resolves.toBe(false);
    expect(mocks.revokePermission).not.toHaveBeenCalled();
  });

  it('leaves the whole-origin disconnect the panel’s switch relies on unchanged (#166)', async () => {
    await disconnectSite('https://example.com');

    expect(mocks.revokePermission).toHaveBeenCalledTimes(2);
    expect(mocks.removeBinding).toHaveBeenCalledWith('https://example.com');
  });
});

// A site's WebLN permission is part of its connection: disconnecting removes it too (#139).
describe('WebLN permissions when a site is disconnected', () => {
  const SITE = 'https://example.com';
  const OTHER = 'https://other.example';
  const permission = (origin: string, connectionId: string) => ({
    origin,
    connectionId,
    methods: ['enable', 'getInfo'],
  });

  beforeEach(() => {
    mocks.vault.value = {
      nip47Connections: [
        { id: 'alice-wallet', accountPubkey: ALICE },
        { id: 'bob-wallet', accountPubkey: BOB },
      ],
      webLnPermissions: [
        permission(SITE, 'alice-wallet'),
        permission(SITE, 'bob-wallet'),
        permission(OTHER, 'alice-wallet'),
      ],
    };
  });

  it('removes every WebLN permission the site holds when it is disconnected', async () => {
    await disconnectSite(SITE);

    expect(mocks.vault.value.webLnPermissions).toEqual([permission(OTHER, 'alice-wallet')]);
  });

  it("removes only that account's wallet permission when disconnected for one account", async () => {
    await disconnectSiteFor(SITE, ALICE);

    expect(mocks.vault.value.webLnPermissions).toEqual([
      permission(SITE, 'bob-wallet'),
      permission(OTHER, 'alice-wallet'),
    ]);
  });

  it('leaves them while the vault is locked, rather than failing the disconnect', async () => {
    mocks.isVaultUnlocked.mockReturnValue(false);

    await expect(disconnectSite(SITE)).resolves.toBe(true);
    expect(mocks.removeBinding).toHaveBeenCalledWith(SITE);
  });
});

describe('sweeping state left by removed accounts (#139)', () => {
  it('keeps only the grants and bindings of accounts still in the vault', async () => {
    mocks.revokeGrantsExcept.mockResolvedValue(2);
    mocks.removeBindingsExcept.mockResolvedValue(1);

    await expect(sweepSiteStateForRemovedAccounts([ALICE])).resolves.toEqual({
      grants: 2,
      bindings: 1,
    });
    expect(mocks.revokeGrantsExcept).toHaveBeenCalledWith(new Set([ALICE]));
    expect(mocks.removeBindingsExcept).toHaveBeenCalledWith(new Set([ALICE]));
  });
});
