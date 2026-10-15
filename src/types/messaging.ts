/**
 * NIP-17 private messaging types shared by the background and the extension pages.
 *
 * Everything here is safe to hand to a page: relay URLs and publish outcomes, never key material.
 */

/** Kind 10050: the relays a user wants to receive NIP-17 direct messages on. */
export const DM_RELAY_LIST_KIND = 10050;

/** The user's kind 10050 list as last published, or an empty list when none was found. */
export interface DmRelayList {
  relays: string[];
  /** `created_at` of the event the list came from, or null when the user has never published one. */
  updatedAt: number | null;
}

export interface DmRelayPublishRequest {
  relays: string[];
}

/** Where a published kind 10050 landed. At least one relay accepted it, or the publish fails. */
export interface DmRelayPublishResult {
  relays: string[];
  accepted: string[];
  rejected: { url: string; reason: string }[];
}

export interface DmRelayCheckRequest {
  relays: string[];
}

/**
 * What a relay did with a test gift wrap. `keeps` stored it and served it back, `drops` refused it or
 * said OK and never stored it, so nobody can message the user there, and `unchecked` could not be
 * tested: unreachable, slow, rate-limited or refusing to serve it (#277).
 */
export type DmRelayCheckStatus = 'keeps' | 'drops' | 'unchecked';

export interface DmRelayCheck {
  url: string;
  status: DmRelayCheckStatus;
  reason?: string;
}

/** One check per relay asked about, in the same order. */
export interface DmRelayCheckResult {
  checks: readonly DmRelayCheck[];
}

/** NIP-59 gift wrap, NIP-59 seal and NIP-17 chat message kinds. */
export const GIFT_WRAP_KIND = 1059;
export const SEAL_KIND = 13;
export const CHAT_MESSAGE_KIND = 14;

/**
 * A decrypted one-to-one NIP-17 message, as a page sees it.
 *
 * `id` and `created_at` are the rumor's: the gift wrap's own timestamp is randomised and says nothing
 * about when the message was written.
 */
export interface DirectMessage {
  id: string;
  /** Who wrote it: the active account, or the peer. */
  pubkey: string;
  /** The other person in the conversation. */
  peer: string;
  created_at: number;
  content: string;
}

export interface SendMessageRequest {
  /**
   * Chosen by the page, unique per message. A page that retries after a timeout sends the same id,
   * and the background returns the first send's result instead of sending twice.
   */
  clientMessageId: string;
  recipient: string;
  content: string;
}

export type SendMessageResult =
  | {
      status: 'sent';
      message: DirectMessage;
      /** Relays that hold the message, read back after sending, or that refused to show it to the sender. */
      accepted: string[];
      /**
       * The accepted relays that would not show the sender the recipient's copy, as NIP-17 inbox relays
       * may, so whether they hold it is not known.
       */
      unverified: string[];
      /** Relays that refused the message, said OK without storing it, or could not be checked in time. */
      rejected: { url: string; reason: string }[];
      /** Whether the sender's own copy reached the sender's inbox relays. */
      selfCopy: 'stored' | 'no-inbox' | 'failed';
    }
  | { status: 'recipient-not-ready' };

export interface FetchMessagesRequest {
  /** The newest message `created_at` the page already has; omit for everything. */
  since?: number;
}

export interface FetchMessagesResult {
  /** `none` when the account has no kind 10050, so nobody can deliver to it. */
  inbox: 'ready' | 'none';
  /** Messages newer than `since`, oldest first. */
  messages: DirectMessage[];
  /** Gift wraps that failed to decrypt or verify, or were not one-to-one chat messages. */
  dropped: number;
}

/** Per peer, the `created_at` of the newest message the account has read. */
export type MessagingReadState = Record<string, number>;

export interface MarkReadRequest {
  peer: string;
  readAt: number;
}

/** A message a page is still sending, or failed to send and can retry with the same id. */
export interface PendingMessage {
  clientMessageId: string;
  peer: string;
  content: string;
  status: 'sending' | 'failed';
}

/**
 * Contacts this account added to Chats through search, in the order they were added (#258). Kept in
 * the encrypted vault, because who an account means to talk to is private.
 */
export type MessagingSavedPeers = string[];

export interface SavedPeerRequest {
  peer: string;
}
