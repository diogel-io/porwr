import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGrantedPermissions: vi.fn(),
  revokePermission: vi.fn(),
  listBindings: vi.fn(),
  removeBinding: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/permission-handler', () => ({
  getGrantedPermissions: mocks.getGrantedPermissions,
  revokePermission: mocks.revokePermission,
}));
vi.mock('@/../src-bex/services/site-binding-store', () => ({
  listBindings: mocks.listBindings,
  removeBinding: mocks.removeBinding,
}));

import {
  countSitesHoldingGrantsFor,
  disconnectSite,
  listConnectedSites,
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
      grants: [
        { accountPubkey: ALICE, requestType: 'sign_event', eventKind: 1, grantedAt: 1000 },
      ],
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
