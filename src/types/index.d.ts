import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools';
import type { ErrorCode } from '@/types/error-codes';
import type { QuickSignSupportedKind, QuickSignTagType } from '@/services/quick-sign-service';
import type {
  ConnectedRelaysDataState,
  DashboardActivityItem,
  DashboardDataState,
} from '@/services/dashboard-service';

export interface DropdownItem<T = string | number> {
  label: string;
  value: T;
}

export type Account = {
  privkey: string;
};

export interface NostrProfile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
  bot?: boolean;
  birthday?: NostrBirthday;
}

export interface NostrBirthday {
  year?: number;
  month?: number;
  day?: number;
}

export interface NostrRelay {
  url: string;
  read: boolean;
  write: boolean;
}

export type StoredKey = {
  id: string;
  alias: string;
  account: Account;
  createdAt: string;
};
export interface QuickSignTagInput {
  type: QuickSignTagType;
  value: string;
}

export interface QuickSignFormInput {
  accountAlias: string;
  kind: QuickSignSupportedKind;
  content: string;
  tags: QuickSignTagInput[];
}

export interface QuickSignPublishInput {
  relayUrls: string[];
}

export type QuickSignAvailabilityState =
  | 'ready'
  | 'locked'
  | 'no-account'
  | 'no-relay'
  | 'invalid-account';

export interface QuickSignAvailabilityResult {
  state: QuickSignAvailabilityState;
  error?: string;
}

export interface QuickSignValidationResult {
  valid: boolean;
  errors: string[];
}

export interface QuickSignContentValidationResult {
  valid: boolean;
  errors: string[];
}

export interface QuickSignPreparedEvent {
  event: UnsignedEvent;
  validation: QuickSignValidationResult;
  normalizedJson: string;
}

export type QuickSignPublishStatus = 'not-attempted' | 'success' | 'partial-failure' | 'failed';

export interface QuickSignRelayPublishResult {
  relayUrl: string;
  success: boolean;
  error?: string;
}

export interface QuickSignResult {
  success: boolean;
  signedEvent?: NostrEvent;
  publishStatus: QuickSignPublishStatus;
  relayResults: QuickSignRelayPublishResult[];
  error?: string;
  code?: ErrorCode;
}

export interface QuickSignAccountOption {
  label: string;
  value: string;
  npub: string;
}

export interface QuickSignSanitizedInput {
  kind: QuickSignSupportedKind;
  content: string;
  tags: QuickSignTagInput[];
}

interface DataActivityRow {
  key: string;
  icon: string;
  iconColor: string;
  eventLabel: string;
  keyChip: string;
  time: string;
  statusLabel: string;
  statusVariant: ActivityStatusVariant;
}

export interface DashboardSummary {
  state: DashboardDataState;
  approvedClients: number;
  activeKeys: number;
  connectedRelays: number;
  connectedRelaysState: ConnectedRelaysDataState;
  recentActivity: DashboardActivityItem[];
}
export type DashboardActivityType = 'approval' | 'exception' | 'event';
