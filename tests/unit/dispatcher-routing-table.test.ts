import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BridgeAction } from '@/types/bridge';

/**
 * Executes every case in the dispatcher's switch, one per declared action.
 *
 * There are two other tests around this switch and this covers what neither can.
 * `bridge-action-routing.test.ts` reads the source and proves each declared action *has* a case,
 * which cannot show that the case calls the right thing: `case 'nip47.getBalance'` invoking
 * `handleNip47GetInfo` reads as correctly routed to a source scan, and there are 46 near-identical
 * cases for that to hide in. `dispatcher.test.ts` executes a dozen cases in depth. This one is the
 * breadth pass — every action reaches its own handler, with its payload, and touches nothing else
 * (#173).
 */

vi.mock('@/../src-bex/handlers/vault-handler', () => ({
  handleVaultUnlock: vi.fn(), handleVaultLock: vi.fn(), handleVaultIsUnlocked: vi.fn(),
  handleVaultCreate: vi.fn(), handleVaultGetData: vi.fn(), handleVaultUpdateData: vi.fn(),
  handleVaultExport: vi.fn(), handleVaultImport: vi.fn(),
}));
vi.mock('@/../src-bex/services/auto-lock', () => ({
  resetAutoLockTimer: vi.fn(), startAutoLockTimer: vi.fn(), stopAutoLockTimer: vi.fn(),
}));
vi.mock('@/../src-bex/handlers/nip07', () => ({ handleGetPublicKey: vi.fn(), handleSignEvent: vi.fn() }));
vi.mock('@/../src-bex/services/request-queue', () => ({
  getCurrentRequest: vi.fn(), getPendingCount: vi.fn(), getRequestContent: vi.fn(),
  listPendingRequests: vi.fn(), markPresented: vi.fn(), requeuePresented: vi.fn(), submitDecision: vi.fn(),
}));
vi.mock('@/../src-bex/services/page-origin-registry', () => ({ getPageOrigin: vi.fn() }));
vi.mock('@/../src-bex/services/connected-sites', () => ({
  countSitesHoldingGrantsFor: vi.fn(), disconnectSite: vi.fn(), listConnectedSites: vi.fn(),
}));
vi.mock('@/../src-bex/services/site-account', () => ({
  getSiteAccount: vi.fn(), switchSiteToActiveAccount: vi.fn(),
}));
vi.mock('@/../src-bex/handlers/blossom-handler', () => ({ handleBlossomUpload: vi.fn() }));
vi.mock('@/../src-bex/handlers/nip04', () => ({ handleNip04Encrypt: vi.fn(), handleNip04Decrypt: vi.fn() }));
vi.mock('@/../src-bex/handlers/nip44', () => ({ handleNip44Encrypt: vi.fn(), handleNip44Decrypt: vi.fn() }));
vi.mock('@/../src-bex/handlers/relay-browser-handler', () => ({
  handleRelayBrowserList: vi.fn(), handleRelayBrowserGetStatus: vi.fn(), handleRelayBrowserRefresh: vi.fn(),
}));
vi.mock('@/../src-bex/handlers/nip47', () => ({
  handleNip47ConnectionImport: vi.fn(), handleNip47ConnectionRemove: vi.fn(),
  handleNip47ConnectionSetActive: vi.fn(), handleNip47ConnectionsList: vi.fn(),
  handleNip47GetBalance: vi.fn(), handleNip47GetInfo: vi.fn(),
  handleNip47PayInvoice: vi.fn(), handleNip47PaymentHistoryList: vi.fn(),
}));
vi.mock('@/../src-bex/handlers/nip57', () => ({
  handleNip57GetCapabilities: vi.fn(), handleNip57SendZap: vi.fn(), handleNip57ZapHistoryList: vi.fn(),
}));
vi.mock('@/../src-bex/handlers/webln', () => ({
  handleWebLnEnable: vi.fn(), handleWebLnGetInfo: vi.fn(), handleWebLnSendPayment: vi.fn(),
}));

import { dispatchMessage } from '@/../src-bex/dispatcher';
import * as vault from '@/../src-bex/handlers/vault-handler';
import * as autoLock from '@/../src-bex/services/auto-lock';
import * as nip07 from '@/../src-bex/handlers/nip07';
import * as queue from '@/../src-bex/services/request-queue';
import * as pages from '@/../src-bex/services/page-origin-registry';
import * as sites from '@/../src-bex/services/connected-sites';
import * as siteAccount from '@/../src-bex/services/site-account';
import * as blossom from '@/../src-bex/handlers/blossom-handler';
import * as nip04 from '@/../src-bex/handlers/nip04';
import * as nip44 from '@/../src-bex/handlers/nip44';
import * as relays from '@/../src-bex/handlers/relay-browser-handler';
import * as nip47 from '@/../src-bex/handlers/nip47';
import * as nip57 from '@/../src-bex/handlers/nip57';
import * as webln from '@/../src-bex/handlers/webln';

const ORIGIN = 'https://example.com';

type Mock = ReturnType<typeof vi.fn>;

/** Every mocked handler, so a case reaching the wrong one can be detected. */
const allMocks = (): Array<[string, Mock]> =>
  Object.entries({ ...vault, ...nip07, ...queue, ...pages, ...sites, ...siteAccount, ...blossom, ...nip04,
    ...nip44, ...relays, ...nip47, ...nip57, ...webln })
    .filter(([, value]) => typeof value === 'function') as Array<[string, Mock]>;

const ok = (data: unknown): unknown => ({ success: true, data });

/**
 * Cases the dispatcher answers itself, calling no handler.
 *
 * They are exercised in `dispatcher.test.ts`; they are listed here so the completeness check below
 * can tell "covered elsewhere" from "not covered at all".
 */
const NO_HANDLER = new Set(['ping', 'nostr.getRelays', 'activity.mark', 'vault.lock']);

interface Case {
  action: BridgeAction;
  payload?: unknown;
  handler: Mock;
  name: string;
  resolves?: unknown;
  expectArgs?: unknown[];
  expected: unknown;
}

const cases: Case[] = [
  { action: 'nostr.getPublicKey', payload: {}, handler: vi.mocked(nip07.handleGetPublicKey),
    name: 'handleGetPublicKey', resolves: ok('pubkey'), expected: 'pubkey', expectArgs: [{}, ORIGIN] },
  { action: 'nostr.signEvent', payload: { event: { kind: 1 } }, handler: vi.mocked(nip07.handleSignEvent),
    name: 'handleSignEvent', resolves: ok({ id: 'signed' }), expected: { id: 'signed' },
    expectArgs: [{ event: { kind: 1 } }, ORIGIN] },
  { action: 'nostr.nip04.encrypt', payload: { pubkey: 'p', plaintext: 't' },
    handler: vi.mocked(nip04.handleNip04Encrypt), name: 'handleNip04Encrypt', resolves: ok('cipher'), expected: 'cipher' },
  { action: 'nostr.nip04.decrypt', payload: { pubkey: 'p', ciphertext: 'c' },
    handler: vi.mocked(nip04.handleNip04Decrypt), name: 'handleNip04Decrypt', resolves: ok('plain'), expected: 'plain' },
  { action: 'nostr.nip44.encrypt', payload: { pubkey: 'p', plaintext: 't' },
    handler: vi.mocked(nip44.handleNip44Encrypt), name: 'handleNip44Encrypt', resolves: ok('cipher44'), expected: 'cipher44' },
  { action: 'nostr.nip44.decrypt', payload: { pubkey: 'p', ciphertext: 'c' },
    handler: vi.mocked(nip44.handleNip44Decrypt), name: 'handleNip44Decrypt', resolves: ok('plain44'), expected: 'plain44' },
  { action: 'vault.isUnlocked', payload: {}, handler: vi.mocked(vault.handleVaultIsUnlocked),
    name: 'handleVaultIsUnlocked', resolves: ok(true), expected: true },
  { action: 'vault.unlock', payload: { password: 'pw' }, handler: vi.mocked(vault.handleVaultUnlock),
    name: 'handleVaultUnlock', resolves: ok({ vaultData: { accounts: [] } }),
    expected: { success: true, vaultData: { accounts: [] } }, expectArgs: [{ password: 'pw' }, ORIGIN] },
  { action: 'vault.create', payload: { password: 'pw', vaultData: { accounts: [] } },
    handler: vi.mocked(vault.handleVaultCreate), name: 'handleVaultCreate',
    resolves: ok({ encryptedVault: 'blob' }), expected: { success: true, encryptedVault: 'blob' } },
  { action: 'nostr.requests.list', handler: vi.mocked(queue.listPendingRequests), name: 'listPendingRequests',
    resolves: [{ id: 'r1' }], expected: [{ id: 'r1' }] },
  { action: 'nostr.requests.current', handler: vi.mocked(queue.getCurrentRequest), name: 'getCurrentRequest',
    resolves: { id: 'r1' }, expected: { id: 'r1' } },
  { action: 'nostr.requests.count', handler: vi.mocked(queue.getPendingCount), name: 'getPendingCount',
    resolves: 3, expected: 3 },
  { action: 'nostr.requests.content', payload: { requestId: 'r1' }, handler: vi.mocked(queue.getRequestContent),
    name: 'getRequestContent', resolves: 'content', expected: 'content', expectArgs: ['r1'] },
  { action: 'nostr.requests.present', payload: { requestId: 'r1' }, handler: vi.mocked(queue.markPresented),
    name: 'markPresented', resolves: true, expected: true, expectArgs: ['r1'] },
  { action: 'nostr.requests.respond', payload: { requestId: 'r1', approved: true, duration: '8h' },
    handler: vi.mocked(queue.submitDecision), name: 'submitDecision', resolves: true, expected: true,
    expectArgs: ['r1', { approved: true, duration: '8h' }] },
  { action: 'nostr.requests.requeuePresented', handler: vi.mocked(queue.requeuePresented),
    name: 'requeuePresented', resolves: undefined, expected: null },
  { action: 'pages.originForTab', payload: { tabId: 7 }, handler: vi.mocked(pages.getPageOrigin),
    name: 'getPageOrigin', resolves: ORIGIN, expected: ORIGIN, expectArgs: [7] },
  { action: 'sites.list', handler: vi.mocked(sites.listConnectedSites), name: 'listConnectedSites',
    resolves: [{ origin: ORIGIN }], expected: [{ origin: ORIGIN }] },
  { action: 'sites.revoke', payload: { origin: ORIGIN }, handler: vi.mocked(sites.disconnectSite),
    name: 'disconnectSite', resolves: true, expected: true, expectArgs: [ORIGIN] },
  { action: 'sites.binding', payload: { origin: ORIGIN }, handler: vi.mocked(siteAccount.getSiteAccount),
    name: 'getSiteAccount', resolves: { origin: ORIGIN }, expected: { origin: ORIGIN }, expectArgs: [ORIGIN] },
  { action: 'sites.useActiveAccount', payload: { origin: ORIGIN },
    handler: vi.mocked(siteAccount.switchSiteToActiveAccount), name: 'switchSiteToActiveAccount',
    resolves: { success: true }, expected: { success: true }, expectArgs: [ORIGIN] },
  { action: 'sites.countForAccount', payload: { accountPubkey: 'a' },
    handler: vi.mocked(sites.countSitesHoldingGrantsFor), name: 'countSitesHoldingGrantsFor',
    resolves: 2, expected: 2, expectArgs: ['a'] },
  { action: 'vault.getData', payload: {}, handler: vi.mocked(vault.handleVaultGetData),
    name: 'handleVaultGetData', resolves: ok({ vaultData: { accounts: [] } }),
    expected: { success: true, vaultData: { accounts: [] } } },
  { action: 'vault.updateData', payload: { vaultData: { accounts: [] } },
    handler: vi.mocked(vault.handleVaultUpdateData), name: 'handleVaultUpdateData',
    resolves: { success: true }, expected: { success: true }, expectArgs: [{ vaultData: { accounts: [] } }, ORIGIN] },
  { action: 'vault.export', payload: {}, handler: vi.mocked(vault.handleVaultExport), name: 'handleVaultExport',
    resolves: ok({ encryptedData: 'enc' }), expected: { success: true, encryptedData: 'enc' } },
  { action: 'vault.import', payload: { encryptedData: 'enc' }, handler: vi.mocked(vault.handleVaultImport),
    name: 'handleVaultImport', resolves: { success: true }, expected: { success: true },
    expectArgs: [{ encryptedData: 'enc' }, ORIGIN] },
  { action: 'blossom.upload', payload: { base64Data: 'd', fileType: 'image/png', blossomServer: 's' },
    handler: vi.mocked(blossom.handleBlossomUpload), name: 'handleBlossomUpload',
    resolves: ok('https://cdn.example/x'), expected: { success: true, url: 'https://cdn.example/x' } },
  { action: 'relay.browser.list', handler: vi.mocked(relays.handleRelayBrowserList),
    name: 'handleRelayBrowserList', resolves: ok([{ url: 'wss://r' }]), expected: [{ url: 'wss://r' }] },
  { action: 'relay.browser.getStatus', handler: vi.mocked(relays.handleRelayBrowserGetStatus),
    name: 'handleRelayBrowserGetStatus', resolves: ok({ online: 1 }), expected: { online: 1 } },
  { action: 'relay.browser.refresh', payload: { url: 'wss://r' },
    handler: vi.mocked(relays.handleRelayBrowserRefresh), name: 'handleRelayBrowserRefresh',
    resolves: { success: true }, expected: true },
  { action: 'nip47.connections.list', handler: vi.mocked(nip47.handleNip47ConnectionsList),
    name: 'handleNip47ConnectionsList', resolves: ok([{ id: 'w' }]), expected: [{ id: 'w' }] },
  { action: 'nip47.connections.import', payload: { uri: 'nostr+walletconnect://x' },
    handler: vi.mocked(nip47.handleNip47ConnectionImport), name: 'handleNip47ConnectionImport',
    resolves: ok({ id: 'w' }), expected: { id: 'w' } },
  { action: 'nip47.connections.remove', payload: { id: 'w' },
    handler: vi.mocked(nip47.handleNip47ConnectionRemove), name: 'handleNip47ConnectionRemove',
    resolves: { success: true }, expected: true },
  { action: 'nip47.connections.setActive', payload: { id: 'w' },
    handler: vi.mocked(nip47.handleNip47ConnectionSetActive), name: 'handleNip47ConnectionSetActive',
    resolves: ok({ id: 'w' }), expected: { id: 'w' } },
  { action: 'nip47.getInfo', payload: { id: 'w' }, handler: vi.mocked(nip47.handleNip47GetInfo),
    name: 'handleNip47GetInfo', resolves: ok({ alias: 'node' }), expected: { alias: 'node' } },
  { action: 'nip47.getBalance', payload: { id: 'w' }, handler: vi.mocked(nip47.handleNip47GetBalance),
    name: 'handleNip47GetBalance', resolves: ok({ balance: 1 }), expected: { balance: 1 } },
  { action: 'nip47.payInvoice', payload: { invoice: 'lnbc' }, handler: vi.mocked(nip47.handleNip47PayInvoice),
    name: 'handleNip47PayInvoice', resolves: ok({ preimage: 'p' }), expected: { preimage: 'p' } },
  { action: 'nip47.payments.list', handler: vi.mocked(nip47.handleNip47PaymentHistoryList),
    name: 'handleNip47PaymentHistoryList', resolves: ok([]), expected: [] },
  { action: 'nip57.getCapabilities', handler: vi.mocked(nip57.handleNip57GetCapabilities),
    name: 'handleNip57GetCapabilities', resolves: ok({ available: true }), expected: { available: true } },
  { action: 'nip57.sendZap', payload: { request: {}, origin: ORIGIN, approved: true },
    handler: vi.mocked(nip57.handleNip57SendZap), name: 'handleNip57SendZap',
    resolves: ok({ status: 'paid' }), expected: { status: 'paid' } },
  { action: 'nip57.zaps.list', handler: vi.mocked(nip57.handleNip57ZapHistoryList),
    name: 'handleNip57ZapHistoryList', resolves: ok([]), expected: [] },
  { action: 'webln.enable', payload: {}, handler: vi.mocked(webln.handleWebLnEnable),
    name: 'handleWebLnEnable', resolves: ok({ enabled: true }), expected: { enabled: true } },
  { action: 'webln.getInfo', payload: {}, handler: vi.mocked(webln.handleWebLnGetInfo),
    name: 'handleWebLnGetInfo', resolves: ok({ node: {} }), expected: { node: {} } },
  { action: 'webln.sendPayment', payload: { paymentRequest: 'lnbc' },
    handler: vi.mocked(webln.handleWebLnSendPayment), name: 'handleWebLnSendPayment',
    resolves: ok({ preimage: 'p' }), expected: { preimage: 'p' } },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('every declared action reaches its own handler', () => {
  it('leaves no case in the switch uncovered by the table', () => {
    // Without this the table silently stops growing: a new case is added, nothing here fails, and
    // the action ships unexercised. Read from source because the switch cannot enumerate itself.
    const source = readFileSync(resolve(__dirname, '../../src-bex/dispatcher.ts'), 'utf8');
    const caseLabels = [...source.matchAll(/case '([^']+)'/g)].map(([, action]) => action ?? '');

    expect(caseLabels.length).toBeGreaterThan(40);

    const listed = new Set<string>(cases.map((entry) => entry.action));
    const missing = caseLabels.filter((action) => !listed.has(action) && !NO_HANDLER.has(action));

    expect(missing).toEqual([]);
    expect(listed.size).toBe(cases.length);
  });

  it.each(cases)('routes $action to $name', async ({ action, payload, handler, resolves, expected, expectArgs }) => {
    handler.mockResolvedValue(resolves);

    const result = await dispatchMessage(action, payload as never, ORIGIN);

    expect(handler).toHaveBeenCalledTimes(1);
    if (expectArgs) expect(handler).toHaveBeenCalledWith(...expectArgs);
    expect(result).toEqual(expected);
  });

  it.each(cases)('routes $action to nothing but $name', async ({ action, payload, handler, resolves }) => {
    handler.mockResolvedValue(resolves);

    await dispatchMessage(action, payload as never, ORIGIN);

    // A case calling the wrong handler is invisible to a source scan: the `case` label is right and
    // only the body is wrong. This is what catches it.
    const strays = allMocks()
      .filter(([, fn]) => fn !== handler && fn.mock.calls.length > 0)
      .map(([name]) => name);

    expect(strays).toEqual([]);
  });
});

describe('dispatcher decisions that are not pass-through', () => {
  it('stops the auto-lock timer when the vault is locked', async () => {
    vi.mocked(vault.handleVaultLock).mockResolvedValue({ success: true } as never);

    await expect(dispatchMessage('vault.lock', {} as never, ORIGIN)).resolves.toEqual({ success: true });
    expect(autoLock.stopAutoLockTimer).toHaveBeenCalledTimes(1);
  });

  it('starts the auto-lock timer only after an unlock that succeeded', async () => {
    vi.mocked(vault.handleVaultUnlock).mockResolvedValue({ success: false, error: 'bad password' } as never);

    await dispatchMessage('vault.unlock', { password: 'wrong' } as never, ORIGIN);

    // A failed unlock must not open the unlocked window.
    expect(autoLock.startAutoLockTimer).not.toHaveBeenCalled();
  });

  it('returns an error object when a signing handler refuses', async () => {
    vi.mocked(nip07.handleSignEvent).mockResolvedValue({ success: false, error: 'denied', code: 'PER_DENIED' } as never);

    await expect(dispatchMessage('nostr.signEvent', { event: {} } as never, ORIGIN)).resolves.toEqual({
      success: false, error: 'denied', code: 'PER_DENIED',
    });
  });

  it('refuses an import carrying no encrypted data, without calling the handler', async () => {
    await expect(dispatchMessage('vault.import', {} as never, ORIGIN)).resolves.toEqual({
      success: false, error: 'Missing encrypted data', code: 'NOT_FOUND',
    });
    expect(vault.handleVaultImport).not.toHaveBeenCalled();
  });

  it('accepts an import whose encrypted data arrives nested', async () => {
    vi.mocked(vault.handleVaultImport).mockResolvedValue({ success: true } as never);

    await expect(
      dispatchMessage('vault.import', { payload: { encryptedData: 'enc' } } as never, ORIGIN),
    ).resolves.toEqual({ success: true });
    expect(vault.handleVaultImport).toHaveBeenCalledWith({ encryptedData: 'enc' }, ORIGIN);
  });

  it('converts a thrown wallet error into an error object rather than propagating it', async () => {
    vi.mocked(nip47.handleNip47PayInvoice).mockRejectedValue(new Error('wallet offline'));

    await expect(dispatchMessage('nip47.payInvoice', { invoice: 'lnbc' } as never, ORIGIN)).resolves.toEqual({
      success: false, error: 'wallet offline',
    });
  });
});
