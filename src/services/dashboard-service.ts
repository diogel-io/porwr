import { get, getActive } from './dexie-storage';
import {
  fetchAccountRelayListEvent,
  normalizeAndDeduplicateRelays,
  parseRelayListEvent,
} from './relay-discovery';
import useSettingsStore from '@/stores/settings-store';
import type { Event } from 'nostr-tools';
import { isVaultUnlocked } from './vault-service';
import { useEventService } from '@/composables/useEventService';
import { countSitesHoldingGrantsFor } from './connected-sites-service';
import type { DashboardActivityType, DashboardSummary } from '@/types';

export type DashboardActivityStatus = 'approved' | 'exception' | 'rejected' | 'signed';

export interface DashboardActivityItem {
  type: DashboardActivityType;
  status: DashboardActivityStatus;
  dateTime: string;
  title: string;
  detail?: string;
  eventKind?: number | string;
  hostname?: string | null;
  accountAlias?: string;
  accountNpub?: string;
}

export type DashboardDataState = 'ready' | 'locked' | 'no-account';
export type ConnectedRelaysDataState = 'ready' | 'unavailable';

async function getKind10002RelayCount(pubkey: string): Promise<number | null> {
  const event = await fetchAccountRelayListEvent(pubkey);

  if (!event) {
    return null;
  }

  const relayUrls = parseRelayListEvent(event);
  return normalizeAndDeduplicateRelays(relayUrls).length;
}

async function getDashboardDataState(): Promise<DashboardDataState> {
  const unlocked = await isVaultUnlocked();
  if (!unlocked) {
    return 'locked';
  }

  const activeAccount = await getActiveAccountAlias();
  if (!activeAccount) {
    return 'no-account';
  }

  const keys = await get();
  if (!keys[activeAccount]) {
    return 'no-account';
  }

  return 'ready';
}

async function resolveActiveKeyAlias(): Promise<string | undefined> {
  return await getActive();
}

async function getActiveAccountAlias(): Promise<string | undefined> {
  const alias = await resolveActiveKeyAlias();
  return alias || undefined;
}

export async function getActiveKeyCount(): Promise<number> {
  const keys = await get();
  return Object.keys(keys).length;
}

/**
 * Returns the number of sites that currently hold a standing permission for the active account.
 *
 * This counted distinct hostnames in the approvals log, which answers a different question in two
 * ways that both overstate it (#116): the log records rejections as well as approvals and the query
 * never filtered on outcome, so a site the user *refused* was counted as an approved client — and a
 * grant that had since expired or been revoked went on being counted for as long as its log entry
 * survived.
 *
 * It now reads the grant store, so the figure answers what its label claims.
 */
export async function getApprovedClientCountForActiveKey(): Promise<number> {
  const unlocked = await isVaultUnlocked();
  if (!unlocked) {
    return 0;
  }

  const alias = await getActiveAccountAlias();
  if (!alias) {
    return 0;
  }

  // Grants are keyed by public key, never alias, because an alias is user-editable.
  const keys = await get();
  const activePubkey = keys[alias]?.id;
  if (!activePubkey) {
    return 0;
  }

  return countSitesHoldingGrantsFor(activePubkey);
}

export async function getConnectedRelayCountForActiveKey(): Promise<number> {
  const relaySummary = await getConnectedRelaySummaryForActiveKey();
  return relaySummary.count;
}

export async function getConnectedRelaySummaryForActiveKey(): Promise<{
  count: number;
  state: ConnectedRelaysDataState;
}> {
  const state = await getDashboardDataState();
  if (state !== 'ready') {
    return { count: 0, state: 'unavailable' };
  }

  const activeAccount = await getActiveAccountAlias();
  if (!activeAccount) {
    return { count: 0, state: 'unavailable' };
  }

  const keys = await get();
  const activeKey = keys[activeAccount];
  if (!activeKey?.id) {
    return { count: 0, state: 'unavailable' };
  }

  const count = await getKind10002RelayCount(activeKey.id);
  if (count === null) {
    return { count: 0, state: 'unavailable' };
  }

  return { count, state: 'ready' };
}

function fromNostrEventToActivityItem(
  event: Event,
  accountAlias: string,
  accountNpub?: string,
): DashboardActivityItem {
  return {
    type: 'event',
    status: 'signed',
    dateTime: new Date(event.created_at * 1000).toISOString(),
    title: 'Signed event',
    detail: `Event kind ${String(event.kind)}`,
    eventKind: event.kind,
    accountAlias,
    ...(accountNpub ? { accountNpub } : {}),
  };
}

export async function getRecentEventsFromRelays(limit = 10): Promise<DashboardActivityItem[]> {
  if (limit <= 0) {
    return [];
  }

  const state = await getDashboardDataState();
  if (state !== 'ready') {
    return [];
  }

  const activeAccount = await getActiveAccountAlias();
  if (!activeAccount) {
    return [];
  }

  const keys = await get();
  const activeKey = keys[activeAccount];
  if (!activeKey?.id) {
    return [];
  }

  const settingsStore = useSettingsStore();
  const relays = await settingsStore.getFallbackRelays();

  if (relays.length === 0) {
    return [];
  }

  const filter = {
    authors: [activeKey.id],
    limit,
  };

  const { getEvents, close } = useEventService(relays);
  try {
    const events = await getEvents(filter);
    return events
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit)
      .map((event) => fromNostrEventToActivityItem(event, activeAccount, activeKey.id));
  } finally {
    close();
  }
}

export async function getDashboardSummary(activityLimit = 50): Promise<DashboardSummary> {
  const state = await getDashboardDataState();
  const activeKeys = await getActiveKeyCount();

  if (state !== 'ready') {
    return {
      state,
      approvedClients: 0,
      activeKeys,
      connectedRelays: 0,
      connectedRelaysState: 'unavailable',
      recentActivity: [],
    };
  }

  const [approvedClients, connectedRelaysSummary, recentActivity] = await Promise.all([
    getApprovedClientCountForActiveKey(),
    getConnectedRelaySummaryForActiveKey(),
    getRecentEventsFromRelays(activityLimit),
  ]);

  return {
    state,
    approvedClients,
    activeKeys,
    connectedRelays: connectedRelaysSummary.count,
    connectedRelaysState: connectedRelaysSummary.state,
    recentActivity,
  };
}
