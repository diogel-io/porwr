import { getEventHash, getPublicKey, nip44, nip59, SimplePool, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import { CHAT_MESSAGE_KIND, GIFT_WRAP_KIND, SEAL_KIND } from '@/types/messaging';
import type {
  DirectMessage,
  FetchMessagesRequest,
  FetchMessagesResult,
  SendMessageRequest,
  SendMessageResult,
} from '@/types/messaging';
import { messagingRelays, type MessagingRelays } from './messaging-relays';
import { authSigner } from './relay-auth';

export { authSigner };

/** Gift wrap and seal timestamps are randomised up to this far into the past (NIP-59). */
const TIMESTAMP_TWEAK_S = 2 * 24 * 60 * 60;

/** Waits stay inside the 5 s a page waits for any background answer (`bridge-client.ts`). */
const FETCH_WAIT_MS = 3_000;
const PUBLISH_WAIT_MS = 1_500;

/** How long a finished send is remembered, so a page retrying the same message gets its result. */
const SEND_MEMORY_MS = 5 * 60 * 1000;

const HEX_64 = /^[0-9a-f]{64}$/;

interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

function isRumor(value: unknown): value is Rumor {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.pubkey === 'string' &&
    typeof candidate.created_at === 'number' &&
    typeof candidate.kind === 'number' &&
    typeof candidate.content === 'string' &&
    Array.isArray(candidate.tags)
  );
}

/**
 * Opens a gift wrap addressed to `secretKey` and returns its chat message, or null.
 *
 * Done by hand rather than with `nip59.unwrapEvent`, which skips two checks NIP-17 requires: the seal
 * must carry a valid signature, and the seal's author must be the rumor's author. Without the second,
 * anyone can wrap a rumor that claims to come from someone else.
 */
export function openGiftWrap(wrap: Event, secretKey: Uint8Array): Rumor | null {
  try {
    if (wrap.kind !== GIFT_WRAP_KIND) return null;

    const seal = JSON.parse(
      nip44.decrypt(wrap.content, nip44.getConversationKey(secretKey, wrap.pubkey)),
    ) as Event;
    if (seal.kind !== SEAL_KIND || !verifyEvent(seal)) return null;

    const rumor: unknown = JSON.parse(
      nip44.decrypt(seal.content, nip44.getConversationKey(secretKey, seal.pubkey)),
    );
    if (!isRumor(rumor)) return null;
    if (rumor.pubkey !== seal.pubkey) return null;
    if (getEventHash(rumor) !== rumor.id) return null;
    if (rumor.kind !== CHAT_MESSAGE_KIND) return null;

    return rumor;
  } catch {
    return null;
  }
}

/**
 * The other person in a one-to-one conversation, or null for anything else.
 *
 * A NIP-17 room is the author plus every `p` tag. This version supports exactly two people; a group
 * message or a note to self has no single peer.
 */
export function conversationPeer(rumor: Pick<Rumor, 'pubkey' | 'tags'>, me: string): string | null {
  const participants = new Set<string>([rumor.pubkey]);
  for (const tag of rumor.tags) {
    if (tag[0] === 'p' && typeof tag[1] === 'string' && HEX_64.test(tag[1])) participants.add(tag[1]);
  }
  if (!participants.has(me)) return null;
  participants.delete(me);
  if (participants.size !== 1) return null;
  return [...participants][0]!;
}

function toDirectMessage(rumor: Rumor, peer: string): DirectMessage {
  return { id: rumor.id, pubkey: rumor.pubkey, peer, created_at: rumor.created_at, content: rumor.content };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Nip17Messaging {
  /** Decrypted messages per account. Memory only: dropped when the vault locks or the account changes. */
  private readonly messages = new Map<string, Map<string, DirectMessage>>();
  private readonly sends = new Map<string, { result: Promise<SendMessageResult>; at: number }>();
  /**
   * One relay pool per account. Inbox relays authenticate a connection as one identity (NIP-42), so a
   * connection opened for one account must never carry another account's requests.
   */
  private readonly pools = new Map<string, SimplePool>();

  constructor(
    private readonly createPool: () => SimplePool = () => new SimplePool(),
    private readonly relays: MessagingRelays = messagingRelays,
    private readonly now: () => number = Date.now,
  ) {}

  /** Drops every decrypted message and closes every relay connection, as when the vault locks. */
  clear(): void {
    this.messages.clear();
    this.sends.clear();
    for (const pool of this.pools.values()) pool.destroy();
    this.pools.clear();
    this.relays.clearCache();
  }

  /**
   * Sends one message. Idempotent per `clientMessageId`, because a page whose call timed out retries
   * it, and a retry must not deliver the message twice.
   */
  send(secretKey: Uint8Array, request: SendMessageRequest): Promise<SendMessageResult> {
    const me = getPublicKey(secretKey);
    this.keepOnly(me);
    const key = `${me}:${request.clientMessageId}`;
    this.forgetOldSends();

    const previous = this.sends.get(key);
    if (previous) return previous.result;

    const result = this.deliver(secretKey, me, request);
    this.sends.set(key, { result, at: this.now() });
    result.catch(() => this.sends.delete(key));
    return result;
  }

  async fetch(secretKey: Uint8Array, request: FetchMessagesRequest): Promise<FetchMessagesResult> {
    const me = getPublicKey(secretKey);
    this.keepOnly(me);

    const inbox = await this.relays.lookupDmRelays(me);
    if (inbox.relays.length === 0) {
      return { inbox: 'none', messages: [], dropped: 0 };
    }

    const since = typeof request.since === 'number' ? request.since : undefined;
    const wraps = await this.queryWraps(secretKey, me, inbox.relays, since);

    const known = this.messagesFor(me);
    let dropped = 0;
    for (const wrap of wraps) {
      const rumor = openGiftWrap(wrap, secretKey);
      const peer = rumor ? conversationPeer(rumor, me) : null;
      if (!rumor || !peer) {
        dropped += 1;
        continue;
      }
      known.set(rumor.id, toDirectMessage(rumor, peer));
    }

    const messages = [...known.values()]
      .filter((message) => since === undefined || message.created_at > since)
      .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));

    return { inbox: 'ready', messages, dropped };
  }

  private async deliver(secretKey: Uint8Array, me: string, request: SendMessageRequest): Promise<SendMessageResult> {
    const [ownInbox, recipientInbox] = await Promise.all([
      this.relays.lookupDmRelays(me),
      this.relays.lookupDmRelays(request.recipient),
    ]);

    // NIP-17: a recipient without a kind 10050 is not ready to receive messages, and clients
    // shouldn't try.
    if (recipientInbox.relays.length === 0) {
      return { status: 'recipient-not-ready' };
    }

    const createdAt = Math.floor(this.now() / 1000);
    const rumorTemplate = {
      kind: CHAT_MESSAGE_KIND,
      created_at: createdAt,
      tags: [['p', request.recipient]],
      content: request.content,
    };
    // The first wrap is the sender's own copy, the second the recipient's. Both carry the same rumor,
    // so both sides see one message id.
    const [selfWrap, recipientWrap] = nip59.wrapManyEvents(rumorTemplate, secretKey, [request.recipient]);
    const rumorId = getEventHash({ ...rumorTemplate, pubkey: me });

    const [recipientOutcome, selfOutcome] = await Promise.all([
      this.publish(secretKey, me, recipientInbox.relays, recipientWrap!),
      ownInbox.relays.length > 0 ? this.publish(secretKey, me, ownInbox.relays, selfWrap!) : Promise.resolve(null),
    ]);

    if (recipientOutcome.accepted.length === 0) {
      throw new Error('No relay accepted the message');
    }

    const message: DirectMessage = {
      id: rumorId,
      pubkey: me,
      peer: request.recipient,
      created_at: createdAt,
      content: request.content,
    };
    this.messagesFor(me).set(message.id, message);

    return {
      status: 'sent',
      message,
      accepted: recipientOutcome.accepted,
      rejected: recipientOutcome.rejected,
      selfCopy: selfOutcome === null ? 'no-inbox' : selfOutcome.accepted.length > 0 ? 'stored' : 'failed',
    };
  }

  private async publish(
    secretKey: Uint8Array,
    me: string,
    relays: string[],
    event: Event,
  ): Promise<{ accepted: string[]; rejected: { url: string; reason: string }[] }> {
    const outcomes = await Promise.allSettled(
      this.poolFor(me).publish(relays, event, { maxWait: PUBLISH_WAIT_MS, onauth: authSigner(secretKey) }),
    );
    const accepted: string[] = [];
    const rejected: { url: string; reason: string }[] = [];
    outcomes.forEach((outcome, index) => {
      const url = relays[index]!;
      if (outcome.status === 'fulfilled') accepted.push(url);
      else rejected.push({ url, reason: reasonOf(outcome.reason) });
    });
    return { accepted, rejected };
  }

  /**
   * Reads gift wraps addressed to `me` from the account's own inbox relays, authenticating with NIP-42
   * where a relay asks. A wrap's timestamp can be up to two days before its rumor's, so the window
   * opens two days before `since`.
   */
  private queryWraps(secretKey: Uint8Array, me: string, relays: string[], since?: number): Promise<Event[]> {
    return new Promise((resolve) => {
      const wraps = new Map<string, Event>();
      this.poolFor(me).subscribeEose(
        relays,
        {
          kinds: [GIFT_WRAP_KIND],
          '#p': [me],
          ...(since !== undefined ? { since: Math.max(0, since - TIMESTAMP_TWEAK_S) } : {}),
        },
        {
          maxWait: FETCH_WAIT_MS,
          onauth: authSigner(secretKey),
          onevent: (event) => {
            wraps.set(event.id, event);
          },
          onclose: () => resolve([...wraps.values()]),
        },
      );
    });
  }

  private poolFor(me: string): SimplePool {
    let pool = this.pools.get(me);
    if (!pool) {
      pool = this.createPool();
      this.pools.set(me, pool);
    }
    return pool;
  }

  private messagesFor(me: string): Map<string, DirectMessage> {
    let known = this.messages.get(me);
    if (!known) {
      known = new Map();
      this.messages.set(me, known);
    }
    return known;
  }

  /**
   * Serves one account at a time. Switching account drops the previous account's decrypted messages
   * and closes its relay connections, so nothing it authenticated is reused for the new one.
   */
  private keepOnly(me: string): void {
    for (const account of [...this.messages.keys()]) {
      if (account !== me) this.messages.delete(account);
    }
    for (const [account, pool] of [...this.pools]) {
      if (account !== me) {
        pool.destroy();
        this.pools.delete(account);
      }
    }
  }

  private forgetOldSends(): void {
    const cutoff = this.now() - SEND_MEMORY_MS;
    for (const [key, entry] of this.sends) {
      if (entry.at < cutoff) this.sends.delete(key);
    }
  }
}

export const nip17Messaging = new Nip17Messaging();
