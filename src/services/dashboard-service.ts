import { get, getActive } from './dexie-storage';
import {
  fetchAccountRelayListEvent,
  normalizeAndDeduplicateRelays,
  parseRelayListEvent,
} from './relay-discovery';
import { isVaultUnlocked } from './vault-service';
import { logService } from './log-service';
import type { ApprovalLog, ApprovalOutcome, ExceptionLog } from './database';
import { countSitesHoldingGrantsFor } from './connected-sites-service';
import type { DashboardActivityType, DashboardSummary } from '@/types';

export type DashboardActivityStatus =
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'interrupted'
  | 'exception';

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

const approvalStatus: Record<
  Exclude<ApprovalOutcome, 'unknown'>,
  Exclude<DashboardActivityStatus, 'exception'>
> = {
  approved: 'approved',
  rejected: 'rejected',
  expired: 'expired',
  interrupted: 'interrupted',
};

const fromApprovalLog = (
  approval: ApprovalLog & { outcome: Exclude<ApprovalOutcome, 'unknown'> },
): DashboardActivityItem => ({
  type: 'approval',
  status: approvalStatus[approval.outcome],
  dateTime: approval.dateTime,
  title: 'Approval request',
  eventKind: approval.eventKind,
  hostname: approval.hostname,
  ...(approval.account ? { accountAlias: approval.account } : {}),
});

const fromExceptionLog = (exception: ExceptionLog): DashboardActivityItem => ({
  type: 'exception',
  status: 'exception',
  dateTime: exception.dateTime,
  title: 'Extension exception',
  detail: exception.message,
  hostname: exception.hostname ?? null,
  ...(exception.account ? { accountAlias: exception.account } : {}),
});

const hasRecordedOutcome = (
  approval: ApprovalLog,
): approval is ApprovalLog & { outcome: Exclude<ApprovalOutcome, 'unknown'> } =>
  !!approval.outcome && approval.outcome !== 'unknown';

/**
 * The active account's latest approvals and exceptions, newest first (workspace#37).
 *
 * Read from the same local logs as Event History, which is what the card says it shows. This
 * replaced a relay query for events the account had *published*, so approvals never appeared.
 *
 * Approvals without a recorded outcome are left out: they are rows written when a site asked
 * rather than when the user decided, which an older build logged alongside every outcome, and they
 * cannot say whether the request was approved. Event History still lists them.
 */
export async function getRecentLocalActivity(limit = 10): Promise<DashboardActivityItem[]> {
  if (limit <= 0) {
    return [];
  }

  if ((await getDashboardDataState()) !== 'ready') {
    return [];
  }

  const activeAccount = await getActiveAccountAlias();
  if (!activeAccount) {
    return [];
  }

  const [approvals, exceptions] = await Promise.all([
    logService.getApprovals(activeAccount),
    logService.getExceptions(activeAccount),
  ]);

  return [
    ...approvals.filter(hasRecordedOutcome).map(fromApprovalLog),
    ...exceptions.map(fromExceptionLog),
  ]
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime))
    .slice(0, limit);
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
    getRecentLocalActivity(activityLimit),
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
