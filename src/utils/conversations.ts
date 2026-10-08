import type { DirectMessage, MessagingReadState } from '@/types/messaging';

/** One row of the Messaging page's conversation list. */
export interface ConversationSummary {
  peer: string;
  /** The newest message either way, or undefined for a contact never messaged. */
  lastMessage?: DirectMessage;
  /** Messages from the peer newer than what has been read. Own messages are never unread. */
  unread: number;
  /** In the contact list. Anyone else who writes is a message request. */
  isContact: boolean;
}

/**
 * Adds `incoming` to `known`, keyed by message id. Returns the same map when nothing new arrived, so
 * a caller can skip work.
 */
export function mergeMessages(
  known: ReadonlyMap<string, DirectMessage>,
  incoming: readonly DirectMessage[],
): Map<string, DirectMessage> {
  const fresh = incoming.filter((message) => !known.has(message.id));
  if (fresh.length === 0) return known as Map<string, DirectMessage>;
  const next = new Map(known);
  for (const message of fresh) next.set(message.id, message);
  return next;
}

/** A conversation's messages, oldest first. */
export function conversationMessages(messages: Iterable<DirectMessage>, peer: string): DirectMessage[] {
  return [...messages]
    .filter((message) => message.peer === peer)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

/**
 * Every conversation to list: each contact, whether or not they have written, plus anyone else who
 * has. Ordered by the newest message, then contacts without messages in the order given.
 */
export function buildConversations(
  messages: Iterable<DirectMessage>,
  contacts: readonly string[],
  readState: MessagingReadState,
): ConversationSummary[] {
  const byPeer = new Map<string, ConversationSummary>();
  const contactSet = new Set(contacts);

  for (const peer of contacts) {
    byPeer.set(peer, { peer, unread: 0, isContact: true });
  }

  for (const message of messages) {
    const summary = byPeer.get(message.peer) ?? { peer: message.peer, unread: 0, isContact: contactSet.has(message.peer) };
    if (!summary.lastMessage || message.created_at >= summary.lastMessage.created_at) {
      summary.lastMessage = message;
    }
    const fromPeer = message.pubkey === message.peer;
    if (fromPeer && message.created_at > (readState[message.peer] ?? 0)) {
      summary.unread += 1;
    }
    byPeer.set(message.peer, summary);
  }

  const order = new Map(contacts.map((peer, index) => [peer, index]));
  return [...byPeer.values()].sort((a, b) => {
    const aTime = a.lastMessage?.created_at ?? -1;
    const bTime = b.lastMessage?.created_at ?? -1;
    if (aTime !== bTime) return bTime - aTime;
    return (order.get(a.peer) ?? Infinity) - (order.get(b.peer) ?? Infinity);
  });
}

/** The newest `created_at` the account has seen from `peer`, which is what reading it marks. */
export function newestFrom(messages: readonly DirectMessage[], peer: string): number | undefined {
  let newest: number | undefined;
  for (const message of messages) {
    if (message.peer === peer && message.pubkey === peer && (newest === undefined || message.created_at > newest)) {
      newest = message.created_at;
    }
  }
  return newest;
}
