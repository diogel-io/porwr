import Dexie, { type Table } from 'dexie';
import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';

export interface Vault {
  id: string; // 'master' or some unique ID
  encryptedData: string;
  createdAt: string;
}

export interface ExceptionLog {
  id?: number;
  dateTime: string;
  message: string;
  account?: string | null;
  hostname?: string | null;
}

/**
 * What happened to an approval request.
 *
 * `unknown` exists for rows written before Porwr logged outcomes: those recorded that a site
 * asked, not what the user decided, and the two cannot be told apart after the fact.
 */
export type ApprovalOutcome = 'approved' | 'rejected' | 'expired' | 'interrupted' | 'unknown';

export interface ApprovalLog {
  id?: number;
  dateTime: string;
  eventKind: number | string;
  hostname: string;
  account?: string | null;
  outcome?: ApprovalOutcome;
}

/**
 * Backfill for rows written before Porwr logged outcomes.
 *
 * Exported so the behaviour can be tested directly: the repository mocks Dexie rather than
 * running a real IndexedDB, so the upgrade callback itself is the testable unit. An end-to-end
 * upgrade rehearsal against real 0.0.32 profiles belongs to the release issue.
 */
export const backfillApprovalOutcome = (approval: ApprovalLog): void => {
  approval.outcome = approval.outcome ?? 'unknown';
};

export interface AppSetting {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class DiogelDatabase extends Dexie {
  vaults!: Table<Vault, string>;
  exceptions!: Table<ExceptionLog, number>;
  approvals!: Table<ApprovalLog, number>;
  relayCatalog!: Table<RelayCatalogEntry, string>;
  relayDiscoveryState!: Table<RelayDiscoveryState, string>;
  appSettings!: Table<AppSetting, string>;

  constructor() {
    super('DiogelDatabase');
    this.version(3)
      .stores({
        vaults: 'id',
      })
      .upgrade((tx) => {
        // Version 3 removes storedKeys table
        return tx.table('storedKeys').clear();
      });

    this.version(4).stores({
      vaults: 'id',
      exceptions: '++id, dateTime',
      approvals: '++id, dateTime, eventKind, hostname',
    });

    this.version(5).stores({
      vaults: 'id',
      exceptions: '++id, dateTime, account',
      approvals: '++id, dateTime, eventKind, hostname, account',
    });

    this.version(6).stores({
      vaults: 'id',
      exceptions: '++id, dateTime, account, hostname',
      approvals: '++id, dateTime, eventKind, hostname, account',
    });

    this.version(7).stores({
      vaults: 'id',
      exceptions: '++id, dateTime, account, hostname',
      approvals: '++id, dateTime, eventKind, hostname, account',
      relayCatalog: 'url, hostname, status, lastSeen, createdAt',
      relayDiscoveryState: 'id, lastGlobalDiscoveryAt',
    });

    this.version(8).stores({
      vaults: 'id',
      exceptions: '++id, dateTime, account, hostname',
      approvals: '++id, dateTime, eventKind, hostname, account',
      relayCatalog: 'url, hostname, status, lastSeen, createdAt',
      relayDiscoveryState: 'id, lastGlobalDiscoveryAt',
      appSettings: 'key, updatedAt',
    });

    // Approval logging moved from request time to the terminal decision, so the table now
    // records an outcome. Rows written before this point recorded only that a site asked, so
    // they are backfilled as `unknown` rather than presented as approvals.
    this.version(9)
      .stores({
        vaults: 'id',
        exceptions: '++id, dateTime, account, hostname',
        approvals: '++id, dateTime, eventKind, hostname, account, outcome',
        relayCatalog: 'url, hostname, status, lastSeen, createdAt',
        relayDiscoveryState: 'id, lastGlobalDiscoveryAt',
        appSettings: 'key, updatedAt',
      })
      .upgrade((tx) =>
        tx
          .table('approvals')
          .toCollection()
          .modify((approval: ApprovalLog) => {
            backfillApprovalOutcome(approval);
          }),
      );
  }
}

export const db = new DiogelDatabase();
