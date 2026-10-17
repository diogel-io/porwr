import { onBeforeUnmount, ref, shallowRef } from 'vue';
import {
  fetchMessages,
  getReadState,
  markConversationRead,
  sendMessage,
} from '@/services/messaging-service';
import { conversationMessages, mergeMessages, newestFrom } from '@/utils/conversations';
import type { DirectMessage, MessagingReadState, PendingMessage } from '@/types/messaging';

/** How often to look for new messages while the page is visible. */
const POLL_INTERVAL_MS = 15_000;
/**
 * Overlap between fetches. A peer's clock can run behind ours, so the next fetch looks back a little
 * further than the newest message held; duplicates are dropped by id.
 */
const FETCH_OVERLAP_S = 10 * 60;

export interface DirectMessagesOptions {
  /** The account the page shows; nothing is fetched while there is none. */
  hasAccount: () => boolean;
  /** Called with the messages each fetch brings, after they are merged. */
  onMessages?: (messages: DirectMessage[]) => Promise<void> | void;
  /** Called when a send finds the recipient has no kind 10050, so nothing can reach them. */
  onRecipientNotReady?: (peer: string) => void;
}

/**
 * NIP-17 private messages for a page that shows them: the Messaging page and the Support page (#228).
 *
 * Messages are fetched only while the page is open and visible: there is no background listening,
 * badge or notification. Everything cryptographic happens in the background; the page sees
 * decrypted text and outcomes only.
 *
 * Must be called from a component's `setup`; polling stops when the component unmounts.
 */
export function useDirectMessages(options: DirectMessagesOptions) {
  const messages = shallowRef<Map<string, DirectMessage>>(new Map());
  const readState = ref<MessagingReadState>({});
  const inbox = ref<'unknown' | 'ready' | 'none'>('unknown');
  const loadFailed = ref(false);
  const pending = ref<PendingMessage[]>([]);
  const notReadyPeers = ref(new Set<string>());

  let newestFetched: number | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let polling = false;

  async function poll() {
    if (polling || !options.hasAccount()) return;
    polling = true;
    try {
      const since = newestFetched === undefined ? undefined : newestFetched - FETCH_OVERLAP_S;
      const result = await fetchMessages(since);
      inbox.value = result.inbox;
      loadFailed.value = false;
      if (result.messages.length > 0) {
        messages.value = mergeMessages(messages.value, result.messages);
        newestFetched = Math.max(
          newestFetched ?? 0,
          ...result.messages.map((message) => message.created_at),
        );
        await options.onMessages?.(result.messages);
      }
    } catch {
      loadFailed.value = true;
    } finally {
      polling = false;
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void poll();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function stopPolling() {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    pollTimer = undefined;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  /** Loads what has been read, which is kept per account in the vault. */
  async function loadReadState() {
    try {
      readState.value = await getReadState();
    } catch {
      // Read state is a convenience; everything shows as unread until it loads.
    }
  }

  /** Marks `peer`'s conversation read up to the newest message from them. */
  async function markRead(peer: string) {
    const newest = newestFrom(conversationMessages(messages.value.values(), peer), peer);
    if (newest === undefined || newest <= (readState.value[peer] ?? 0)) return;
    readState.value = { ...readState.value, [peer]: newest };
    try {
      readState.value = await markConversationRead(peer, newest);
    } catch {
      // Read state is a convenience; the next open tries again.
    }
  }

  async function deliver(message: PendingMessage) {
    try {
      const result = await sendMessage({
        clientMessageId: message.clientMessageId,
        recipient: message.peer,
        content: message.content,
      });
      pending.value = pending.value.filter(
        (entry) => entry.clientMessageId !== message.clientMessageId,
      );
      if (result.status === 'sent') {
        messages.value = mergeMessages(messages.value, [result.message]);
      } else {
        notReadyPeers.value = new Set([...notReadyPeers.value, message.peer]);
        options.onRecipientNotReady?.(message.peer);
      }
    } catch {
      pending.value = pending.value.map((entry) =>
        entry.clientMessageId === message.clientMessageId ? { ...entry, status: 'failed' } : entry,
      );
    }
  }

  function send(peer: string, content: string) {
    const message: PendingMessage = {
      clientMessageId: crypto.randomUUID(),
      peer,
      content,
      status: 'sending',
    };
    pending.value = [...pending.value, message];
    void deliver(message);
  }

  function retry(clientMessageId: string) {
    const message = pending.value.find((entry) => entry.clientMessageId === clientMessageId);
    if (!message) return;
    const again: PendingMessage = { ...message, status: 'sending' };
    pending.value = pending.value.map((entry) =>
      entry.clientMessageId === clientMessageId ? again : entry,
    );
    void deliver(again);
  }

  /** Forgets everything, for an account switch. */
  function reset() {
    messages.value = new Map();
    readState.value = {};
    inbox.value = 'unknown';
    pending.value = [];
    notReadyPeers.value = new Set();
    newestFetched = undefined;
  }

  onBeforeUnmount(stopPolling);

  return {
    messages,
    readState,
    inbox,
    loadFailed,
    pending,
    notReadyPeers,
    poll,
    startPolling,
    stopPolling,
    loadReadState,
    markRead,
    send,
    retry,
    reset,
  };
}
