import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DashboardService from '@/services/dashboard-service';
import type * as DexieStorage from '@/services/dexie-storage';
import type * as VaultService from '@/services/vault-service';

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

const { approvalsWhereMock, approvalsEqualsMock, approvalsToArrayMock, exceptionsToArrayMock } =
  vi.hoisted(() => ({
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

const { getApprovalsMock, getExceptionsMock } = vi.hoisted(() => ({
  getApprovalsMock: vi.fn(),
  getExceptionsMock: vi.fn(),
}));

vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' },
  logService: {
    getApprovals: getApprovalsMock,
    getExceptions: getExceptionsMock,
    log: vi.fn(),
  },
}));

describe('dashboard-service', () => {
  let dashboardService: typeof DashboardService;
  let dexieStorage: typeof DexieStorage;
  let vaultService: typeof VaultService;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    approvalsToArrayMock.mockResolvedValue([]);
    approvalsWhereMock.mockReturnValue({
      equals: approvalsEqualsMock.mockReturnValue({
        toArray: approvalsToArrayMock,
      }),
    });
    exceptionsToArrayMock.mockResolvedValue([]);
    getApprovalsMock.mockReset().mockResolvedValue([]);
    getExceptionsMock.mockReset().mockResolvedValue([]);
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
    const event = {
      id: 'evt-1',
      kind: 10002,
      tags: [
        ['r', 'wss://relay.one'],
        ['r', 'wss://relay.two'],
      ],
    };
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

  describe('recent activity from the local logs (workspace#37)', () => {
    const readyAlpha = () => {
      vi.mocked(dexieStorage.getActive).mockResolvedValue('alpha');
      vi.mocked(dexieStorage.get).mockResolvedValue({
        alpha: { id: 'pubkey-alpha', alias: 'alpha', createdAt: '2026-01-01' },
      });
    };

    it('returns nothing when there is no active account', async () => {
      vi.mocked(dexieStorage.getActive).mockResolvedValue(undefined);

      await expect(dashboardService.getRecentLocalActivity(5)).resolves.toEqual([]);
      expect(getApprovalsMock).not.toHaveBeenCalled();
    });

    it('returns nothing when the vault is locked', async () => {
      vi.mocked(vaultService.isVaultUnlocked).mockResolvedValue(false);

      await expect(dashboardService.getRecentLocalActivity(5)).resolves.toEqual([]);
      expect(getApprovalsMock).not.toHaveBeenCalled();
    });

    it("reads the active account's approvals and exceptions, never a relay", async () => {
      readyAlpha();

      await dashboardService.getRecentLocalActivity(5);

      expect(getApprovalsMock).toHaveBeenCalledWith('alpha');
      expect(getExceptionsMock).toHaveBeenCalledWith('alpha');
    });

    it('merges approvals and exceptions newest first, with their outcomes, up to the limit', async () => {
      readyAlpha();
      getApprovalsMock.mockResolvedValue([
        {
          dateTime: '2026-10-18T10:04:00.000Z',
          eventKind: 1,
          hostname: 'snort.social',
          account: 'alpha',
          outcome: 'approved',
        },
        {
          dateTime: '2026-10-18T10:02:00.000Z',
          eventKind: 'get_public_key',
          hostname: 'snort.social',
          account: 'alpha',
          outcome: 'rejected',
        },
        {
          dateTime: '2026-10-18T10:00:00.000Z',
          eventKind: 1,
          hostname: 'old.example',
          account: 'alpha',
          outcome: 'expired',
        },
      ]);
      getExceptionsMock.mockResolvedValue([
        {
          dateTime: '2026-10-18T10:03:00.000Z',
          message: 'Relay timed out',
          account: 'alpha',
          hostname: 'snort.social',
        },
      ]);

      const result = await dashboardService.getRecentLocalActivity(3);

      expect(result).toEqual([
        {
          type: 'approval',
          status: 'approved',
          dateTime: '2026-10-18T10:04:00.000Z',
          title: 'Approval request',
          eventKind: 1,
          hostname: 'snort.social',
          accountAlias: 'alpha',
        },
        {
          type: 'exception',
          status: 'exception',
          dateTime: '2026-10-18T10:03:00.000Z',
          title: 'Extension exception',
          detail: 'Relay timed out',
          hostname: 'snort.social',
          accountAlias: 'alpha',
        },
        {
          type: 'approval',
          status: 'rejected',
          dateTime: '2026-10-18T10:02:00.000Z',
          title: 'Approval request',
          eventKind: 'get_public_key',
          hostname: 'snort.social',
          accountAlias: 'alpha',
        },
      ]);
    });

    it('carries expired and interrupted outcomes through as their own statuses', async () => {
      readyAlpha();
      getApprovalsMock.mockResolvedValue([
        { dateTime: '2026-10-18T10:01:00.000Z', eventKind: 1, hostname: 'a', outcome: 'expired' },
        {
          dateTime: '2026-10-18T10:00:00.000Z',
          eventKind: 1,
          hostname: 'b',
          outcome: 'interrupted',
        },
      ]);

      const statuses = (await dashboardService.getRecentLocalActivity(5)).map((a) => a.status);

      expect(statuses).toEqual(['expired', 'interrupted']);
    });

    it('leaves out approvals with no recorded outcome', async () => {
      readyAlpha();
      getApprovalsMock.mockResolvedValue([
        { dateTime: '2026-10-18T10:01:00.000Z', eventKind: 1, hostname: 'a', outcome: 'unknown' },
        { dateTime: '2026-10-18T10:00:00.000Z', eventKind: 1, hostname: 'b' },
        { dateTime: '2026-10-18T09:59:00.000Z', eventKind: 1, hostname: 'c', outcome: 'approved' },
      ]);

      const result = await dashboardService.getRecentLocalActivity(5);

      expect(result.map((activity) => activity.hostname)).toEqual(['c']);
    });

    it('returns nothing for a limit of zero', async () => {
      readyAlpha();

      await expect(dashboardService.getRecentLocalActivity(0)).resolves.toEqual([]);
      expect(getApprovalsMock).not.toHaveBeenCalled();
    });

    it('fills the dashboard summary from the local logs', async () => {
      readyAlpha();
      countSitesHoldingGrantsFor.mockResolvedValue(0);
      fetchAccountRelayListEventMock.mockResolvedValue(null);
      getApprovalsMock.mockResolvedValue([
        { dateTime: '2026-10-18T10:00:00.000Z', eventKind: 1, hostname: 'a', outcome: 'approved' },
      ]);

      const summary = await dashboardService.getDashboardSummary(5);

      expect(summary.recentActivity).toHaveLength(1);
      expect(summary.recentActivity[0]).toMatchObject({ type: 'approval', status: 'approved' });
    });
  });
});
