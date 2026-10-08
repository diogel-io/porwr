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
      accepted: string[];
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
