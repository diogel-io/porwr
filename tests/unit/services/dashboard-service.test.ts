import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DashboardService from '@/services/dashboard-service';
import type * as DexieStorage from '@/services/dexie-storage';
import type * as VaultService from '@/services/vault-service';
import { useEventService } from '@/composables/useEventService';

const { countSitesHoldingGrantsFor } = vi.hoisted(() => ({
  countSitesHoldingGrantsFor: vi.fn(),
}));

vi.mock('@/services/connected-sites-service', () => ({ countSitesHoldingGrantsFor }));

const ALICE = 'a'.repeat(64);

vi.mock('@/services/dexie-storage', () => ({
  get: vi.fn(),
  getActive: vi.fn(),
}));

vi.mock('@/services/vault-service', () => ({
  isVaultUnlocked: vi.fn(),
}));

const { approvalsWhereMock, approvalsEqualsMock, approvalsToArrayMock, exceptionsToArrayMock } = vi.hoisted(() => ({
  approvalsWhereMock: vi.fn(),
  approvalsEqualsMock: vi.fn(),
  approvalsToArrayMock: vi.fn(),
  exceptionsToArrayMock: vi.fn(),
}));

const {
  relayMetadataGetMock,
  relayMetadataSubscribeManyMock,
  fallbackRelays,
  getSettingsMock,
  parseRelayListEventMock,
  normalizeAndDeduplicateRelaysMock,
  fetchAccountRelayListEventMock,
} = vi.hoisted(() => ({
  relayMetadataGetMock: vi.fn(),
  relayMetadataSubscribeManyMock: vi.fn(),
  fallbackRelays: [] as string[],
  getSettingsMock: vi.fn(async () => undefined),
  parseRelayListEventMock: vi.fn(),
  normalizeAndDeduplicateRelaysMock: vi.fn(),
  fetchAccountRelayListEventMock: vi.fn(),
}));

vi.mock('@/services/database', () => ({
  db: {
    approvals: {
      where: approvalsWhereMock.mockReturnValue({
        equals: approvalsEqualsMock.mockReturnValue({
          toArray: approvalsToArrayMock,
        }),
      }),
    },
    exceptions: {
      where: () => ({
        equals: () => ({
          toArray: exceptionsToArrayMock,
        }),
      }),
    },
  },
}));

vi.mock('@/stores/settings-store', () => ({
  default: () => ({
    fallbackRelays,
    getSettings: getSettingsMock,
    getFallbackRelays: vi.fn(async () => fallbackRelays),
  }),
}));

vi.mock('nostr-tools', () => ({
  SimplePool: class {
    get = relayMetadataGetMock;
    subscribeMany = relayMetadataSubscribeManyMock;
    close = vi.fn();
  },
}));

vi.mock('@/services/relay-discovery', () => ({
  parseRelayListEvent: parseRelayListEventMock,
  normalizeAndDeduplicateRelays: normalizeAndDeduplicateRelaysMock,
  fetchAccountRelayListEvent: fetchAccountRelayListEventMock,
}));

vi.mock('@/composables/useEventService', () => ({
  useEventService: vi.fn(),
}));

describe('dashboard-service', () => {
  let dashboardService: typeof DashboardService;
  let dexieStorage: typeof DexieStorage;
  let vaultService: typeof VaultService;

  const getEventsMock = vi.fn();
  const closeMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getEventsMock.mockReset();
    closeMock.mockReset();

    vi.mocked(useEventService).mockReturnValue({
      getEvents: getEventsMock,
      close: closeMock,
      relayUrls: ['wss://relay.default'],
    });

    approvalsToArrayMock.mockResolvedValue([]);
    approvalsWhereMock.mockReturnValue({
      equals: approvalsEqualsMock.mockReturnValue({
        toArray: approvalsToArrayMock,
      }),
    });
    exceptionsToArrayMock.mockResolvedValue([]);
    relayMetadataGetMock.mockReset();
    relayMetadataGetMock.mockResolvedValue(undefined);
    relayMetadataSubscribeManyMock.mockReset();
    relayMetadataSubscribeManyMock.mockImplementation((relays, filters, handlers) => {
      handlers.oneose?.();
      return { close: vi.fn() };
    });
    parseRelayListEventMock.mockReset();
    parseRelayListEventMock.mockReturnValue([]);
    normalizeAndDeduplicateRelaysMock.mockReset();
    normalizeAndDeduplicateRelaysMock.mockImplementation((urls: string[]) => urls);
    fallbackRelays.splice(0, fallbackRelays.length, 'wss://relay.default');
    getSettingsMock.mockClear();
  });

  beforeEach(async () => {
    dashboardService = await import('@/services/dashboard-service');
    dexieStorage = await import('@/services/dexie-storage');
    vaultService = await import('@/services/vault-service');

    vi.mocked(vaultService.isVaultUnlocked).mockResolvedValue(true);
    vi.mocked(dexieStorage.get).mockResolvedValue({});
    vi.mocked(dexieStorage.getActive).mockResolvedValue(undefined);
  });

  it('getActiveKeyCount returns total stored keys', async () => {
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: 'npub1', alias: 'alpha', createdAt: '2026-01-01' },
      beta: { id: 'npub2', alias: 'beta', createdAt: '2026-01-01' },
    });

    await expect(dashboardService.getActiveKeyCount()).resolves.toBe(2);
  });

  it('returns 0 approved clients when no active account', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue(undefined);

    await expect(dashboardService.getApprovedClientCountForActiveKey()).resolves.toBe(0);
  });

  /**
   * Repointed at the grant store (#116).
   *
   * This counted distinct hostnames in the approvals log, which overstates the figure in two ways:
   * the log records rejections and the query never filtered on outcome, and an entry survives long
   * after the grant it describes has expired or been revoked.
   */
  it('counts the sites that hold a standing permission for the active account', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: ALICE, alias: 'alpha' },
    } as never);
    countSitesHoldingGrantsFor.mockResolvedValue(2);

    await expect(dashboardService.getApprovedClientCountForActiveKey()).resolves.toBe(2);
  });

  it('asks by public key, not alias', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: ALICE, alias: 'alpha' },
    } as never);
    countSitesHoldingGrantsFor.mockResolvedValue(1);

    await dashboardService.getApprovedClientCountForActiveKey();

    // An alias is user-editable; a rename must not change what the figure counts.
    expect(countSitesHoldingGrantsFor).toHaveBeenCalledWith(ALICE);
  });

  it('no longer reads the approvals log for this figure', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: ALICE, alias: 'alpha' },
    } as never);
    countSitesHoldingGrantsFor.mockResolvedValue(0);

    await dashboardService.getApprovedClientCountForActiveKey();

    expect(approvalsToArrayMock).not.toHaveBeenCalled();
  });

  it('counts nothing when the active alias names no stored key', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('ghost');
    vi.mocked(dexieStorage.get).mockResolvedValue({} as never);

    await expect(dashboardService.getApprovedClientCountForActiveKey()).resolves.toBe(0);
    expect(countSitesHoldingGrantsFor).not.toHaveBeenCalled();
  });

  it('does not call relay event service for approved client metric', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    approvalsToArrayMock.mockResolvedValue([
      { id: 1, dateTime: '2026-01-01', eventKind: 1, hostname: 'site.com', account: 'alpha' },
    ]);

    await dashboardService.getApprovedClientCountForActiveKey();

    expect(useEventService).not.toHaveBeenCalled();
  });

  it('returns 0 approved clients when vault is locked', async () => {
    vi.mocked(vaultService.isVaultUnlocked).mockResolvedValue(false);
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');

    await expect(dashboardService.getApprovedClientCountForActiveKey()).resolves.toBe(0);
    expect(approvalsWhereMock).not.toHaveBeenCalled();
  });

  it('returns approvedClients in dashboard summary instead of signedEvents', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: {
        id: 'pubkey-alpha',
        alias: 'alpha',
        createdAt: '2026-01-01',
      },
    });

    // The figure now comes from the grant store, not the approvals log.
    countSitesHoldingGrantsFor.mockResolvedValue(1);
    fetchAccountRelayListEventMock.mockResolvedValue(null);
    getEventsMock.mockResolvedValue([]);

    const summary = await dashboardService.getDashboardSummary(5);

    expect(summary.approvedClients).toBe(1);
    expect('signedEvents' in summary).toBe(false);
  });

  it('returns 0 connected relays when no active account', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue(undefined);

    await expect(dashboardService.getConnectedRelayCountForActiveKey()).resolves.toBe(0);
  });

  it('counts relays from active account kind 10002 metadata', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: 'pubkey-alpha', alias: 'alpha', createdAt: '2026-01-01' },
    });
    const event = { id: 'evt-1', kind: 10002, tags: [['r', 'wss://relay.one'], ['r', 'wss://relay.two']] };
    fetchAccountRelayListEventMock.mockResolvedValue(event);
    parseRelayListEventMock.mockReturnValue(['wss://relay.one', 'wss://relay.two']);
    normalizeAndDeduplicateRelaysMock.mockReturnValue(['wss://relay.one', 'wss://relay.two']);

    await expect(dashboardService.getConnectedRelayCountForActiveKey()).resolves.toBe(2);
  });

  it('deduplicates relay urls for connected relay metric', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: 'pubkey-alpha', alias: 'alpha', createdAt: '2026-01-01' },
    });
    const event = { id: 'evt-2', kind: 10002, tags: [] };
    fetchAccountRelayListEventMock.mockResolvedValue(event);
    parseRelayListEventMock.mockReturnValue([
      'wss://relay.one',
      'wss://relay.one',
      'wss://relay.two',
      'wss://relay.two',
    ]);
    normalizeAndDeduplicateRelaysMock.mockReturnValue(['wss://relay.one', 'wss://relay.two']);

    await expect(dashboardService.getConnectedRelayCountForActiveKey()).resolves.toBe(2);
  });

  it('ignores malformed relay urls through normalization', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: 'pubkey-alpha', alias: 'alpha', createdAt: '2026-01-01' },
    });
    const event = { id: 'evt-3', kind: 10002, tags: [] };
    fetchAccountRelayListEventMock.mockResolvedValue(event);
    parseRelayListEventMock.mockReturnValue(['wss://relay.good', 'bad-url']);
    normalizeAndDeduplicateRelaysMock.mockReturnValue(['wss://relay.good']);

    await expect(dashboardService.getConnectedRelayCountForActiveKey()).resolves.toBe(1);
  });

  it('returns unavailable when no kind 10002 metadata exists', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: 'pubkey-alpha', alias: 'alpha', createdAt: '2026-01-01' },
    });
    fetchAccountRelayListEventMock.mockResolvedValue(null);

    await expect(dashboardService.getConnectedRelaySummaryForActiveKey()).resolves.toEqual({
      count: 0,
      state: 'unavailable',
    });
  });

  it('returns unavailable when vault is locked', async () => {
    vi.mocked(vaultService.isVaultUnlocked).mockResolvedValue(false);

    await expect(dashboardService.getConnectedRelaySummaryForActiveKey()).resolves.toEqual({
      count: 0,
      state: 'unavailable',
    });
  });

  it('returns unavailable when no active account', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue(undefined);

    await expect(dashboardService.getConnectedRelaySummaryForActiveKey()).resolves.toEqual({
      count: 0,
      state: 'unavailable',
    });
  });

  it('returns unavailable when fallback relays are missing', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: 'pubkey-alpha', alias: 'alpha', createdAt: '2026-01-01' },
    });
    fetchAccountRelayListEventMock.mockResolvedValue(null);
    fallbackRelays.splice(0, fallbackRelays.length);

    await expect(dashboardService.getConnectedRelaySummaryForActiveKey()).resolves.toEqual({
      count: 0,
      state: 'unavailable',
    });
  });

  it('returns empty recent activity when no active account', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue(undefined);

    await expect(dashboardService.getRecentEventsFromRelays(5)).resolves.toEqual([]);
  });

  it('returns empty recent activity when vault is locked', async () => {
    vi.mocked(vaultService.isVaultUnlocked).mockResolvedValue(false);

    await expect(dashboardService.getRecentEventsFromRelays(5)).resolves.toEqual([]);
  });

  it('returns sorted recent events for active account with limit', async () => {
    vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
    vi.mocked(dexieStorage.get).mockResolvedValue({
      alpha: { id: 'pubkey-alpha', alias: 'alpha', createdAt: '2026-01-01' },
    });

    getEventsMock.mockResolvedValue([
      { id: '1', kind: 1, created_at: 1735689600, tags: [], content: 'hello', pubkey: 'pubkey-alpha', sig: 'sig' },
      { id: '2', kind: 0, created_at: 1735693200, tags: [], content: '{}', pubkey: 'pubkey-alpha', sig: 'sig' },
    ]);

    const result = await dashboardService.getRecentEventsFromRelays(2);

    expect(result).toHaveLength(2);
    const [first, second] = result;

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    expect(first).toMatchObject({
      type: 'event',
      status: 'signed',
      title: 'Signed event',
      eventKind: 0,
      accountAlias: 'alpha',
      accountNpub: 'pubkey-alpha',
    });
    expect(second).toMatchObject({
      type: 'event',
      status: 'signed',
      title: 'Signed event',
      eventKind: 1,
      accountAlias: 'alpha',
      accountNpub: 'pubkey-alpha',
    });

    expect(first?.dateTime).toBe(new Date(1735693200 * 1000).toISOString());
    expect(second?.dateTime).toBe(new Date(1735689600 * 1000).toISOString());
  });
});