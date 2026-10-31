import type { Event as NostrEvent } from 'nostr-tools';

export interface Nip02Contact {
  pubkey: string;
  relayUrl: string;
  petname: string;
}

export interface ContactProfile {
  pubkey: string;
  name: string;
  displayName: string;
  about: string;
  picture: string;
  nip05: string;
  updatedAt: number;
}

export type ContactSearchMatchType = 'pubkey' | 'nip05' | 'profile-search';

export interface ContactSearchResult {
  pubkey: string;
  relayUrl: string;
  profile?: ContactProfile;
  matchType: ContactSearchMatchType;
}

export interface ContactListState {
  accountAlias: string;
  pubkey: string;
  contacts: Nip02Contact[];
  sourceEventId?: string;
  sourceCreatedAt?: number;
  dirty: boolean;
}

export interface ContactListPublishResult {
  event: NostrEvent;
  relayResults: ContactListRelayPublishResult[];
}

export interface ContactListRelayPublishResult {
  relayUrl: string;
  success: boolean;
  error?: string;
}

export interface ContactInputValidationResult {
  valid: boolean;
  contact?: Nip02Contact;
  error?: string;
}

/**
 * A contact list as relays last told us, kept for one account so pages can show it at once (#257).
 *
 * Contact lists and profiles are public Nostr events, so the cache lives unencrypted in IndexedDB
 * rather than in the vault. Keyed by the account's hex public key, never its alias, because an alias
 * can be renamed.
 */
export interface CachedContactList {
  accountPubkey: string;
  contacts: Nip02Contact[];
  sourceEventId?: string;
  sourceCreatedAt?: number;
  /** When relays were last asked, in milliseconds. Drives revalidation, not which list wins. */
  fetchedAt: number;
  /**
   * The published list had more than `MAX_CONTACTS_PER_ACCOUNT` contacts and only the first were
   * kept (workspace#182). Publishing it back would drop the rest, so the Contacts page refuses to.
   */
  truncated?: true;
}

/** A contact's kind 0 profile, cached for the account that follows them. */
export interface CachedContactProfile extends ContactProfile {
  accountPubkey: string;
  fetchedAt: number;
}

/** The contact list fields a fetch or a publish produces. */
export type ContactListSnapshot = Pick<
  CachedContactList,
  'contacts' | 'sourceEventId' | 'sourceCreatedAt' | 'truncated'
>;

/** Asks the background to refresh the active account's contact cache. */
export interface ContactRefreshRequest {
  /** Refresh even if the cache was filled recently, as the Refresh button does. */
  force?: boolean;
}

/** The refresh was queued for this account; its results arrive through the cache. */
export interface ContactRefreshResult {
  accountPubkey: string;
}
