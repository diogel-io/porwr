import type { SimplePool } from 'nostr-tools';

import { authSigner } from './relay-auth';

/** How nostr-tools closes a `subscribeEose` once the relay has sent everything it holds. */
export const CLOSED_ON_EOSE = 'closed automatically on eose';

/**
 * A relay that will not show the sender a wrap addressed to someone else. NIP-17 asks inbox relays to
 * serve gift wraps only to their recipient, so this is expected and counts as delivered, unverified.
 */
export const REFUSED_TO_SERVE = /^(auth-required|restricted):/;

/**
 * What one relay did with a wrap it said OK to. `missing` is a relay that answered without it: some,
 * like relay.damus.io, accept gift wraps and never store them (#276).
 */
export type Storage =
  | { url: string; storage: 'held' }
  | { url: string; storage: 'refused' }
  | { url: string; storage: 'missing'; reason: string }
  | { url: string; storage: 'unanswered'; reason: string };

/**
 * Asks one relay for the wrap it accepted, authenticating as `secretKey` where it asks. Each relay
 * gets its own request, so one slow relay cannot hide what the others answered.
 */
export function checkStored(
  pool: SimplePool,
  secretKey: Uint8Array,
  url: string,
  wrapId: string,
  deadlineAt: number,
  now: () => number = Date.now,
): Promise<Storage> {
  return new Promise((resolve) => {
    let held = false;
    let settled = false;
    const finish = (storage: Storage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(storage);
    };
    const timer = setTimeout(
      () => {
        finish({ url, storage: 'unanswered', reason: 'could not confirm the relay stored it' });
        closer.close();
      },
      Math.max(0, deadlineAt - now()),
    );
    const closer = pool.subscribeEose(
      [url],
      { ids: [wrapId] },
      {
        // nostr-tools treats its own timeout as the end of what a relay holds, so it must never
        // come first: a slow relay would look like one that dropped the wrap.
        maxWait: Math.max(0, deadlineAt - now()) + 1_000,
        onauth: authSigner(secretKey),
        onevent: (event) => {
          if (event.id === wrapId) held = true;
        },
        onclose: (reasons) => {
          const reason = reasons[0] ?? '';
          if (held) finish({ url, storage: 'held' });
          else if (REFUSED_TO_SERVE.test(reason)) finish({ url, storage: 'refused' });
          else if (reason === CLOSED_ON_EOSE) finish({ url, storage: 'missing', reason: 'accepted but not stored' });
          else finish({ url, storage: 'unanswered', reason: reason || 'could not confirm the relay stored it' });
        },
      },
    );
  });
}
