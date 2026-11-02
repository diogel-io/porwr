import type { Event, SimplePool } from 'nostr-tools';

/**
 * Looking up an account's replaceable event on a set of relays, telling "none published" apart
 * from "no relay answered" (#285, #435).
 *
 * Nothing here reads settings or Pinia: the caller supplies the relays and the pool, so the
 * extension's pages and the background share it.
 */

/**
 * What a lookup of an account's replaceable event found. `not-found` means at least one relay
 * answered without one; `unreachable` means none of the relays answered at all (#285).
 */
export type ReplaceableEventLookup =
  { status: 'found'; event: Event } | { status: 'not-found' } | { status: 'unreachable' };

export type ReplaceableEventReader = Pick<SimplePool, 'subscribeEose'>;

/**
 * The reason nostr-tools gives a relay's subscription when it closes after EOSE, i.e. the relay
 * answered. Any other reason (connection failed or timed out, auth failed) means it did not.
 * nostr-tools does not export it, so it is pinned here; the relay list tests catch a change.
 */
const CLOSED_ON_EOSE = 'closed automatically on eose';

export interface ReplaceableEventLookupOptions {
  /** Longest wait, in milliseconds, for each relay to connect and answer. */
  maxWait?: number;
}

/**
 * Looks up the newest event of a replaceable `kind` by `pubkey` on `relays`.
 *
 * `SimplePool.get` cannot tell the two empty cases apart: it resolves `null` both when the relays
 * answered with nothing and when none of them connected, so this reads each relay's close reason
 * instead (#285). The caller owns `pool` and closes it.
 */
export async function lookupReplaceableEvent(
  pool: ReplaceableEventReader,
  relays: string[],
  pubkey: string,
  kind: number,
  options: ReplaceableEventLookupOptions = {},
): Promise<ReplaceableEventLookup> {
  // No relay to ask means nothing answered; nostr-tools would also never close the subscription.
  if (relays.length === 0) {
    return { status: 'unreachable' };
  }

  try {
    return await new Promise<ReplaceableEventLookup>((resolve) => {
      let newest: Event | null = null;
      pool.subscribeEose(
        relays,
        { kinds: [kind], authors: [pubkey], limit: 1 },
        {
          ...(options.maxWait !== undefined ? { maxWait: options.maxWait } : {}),
          onevent(event) {
            if (!newest || event.created_at > newest.created_at) {
              newest = event;
            }
          },
          onclose(closes) {
            if (newest) {
              resolve({ status: 'found', event: newest });
            } else if (closes.some((close) => close.reason === CLOSED_ON_EOSE)) {
              resolve({ status: 'not-found' });
            } else {
              resolve({ status: 'unreachable' });
            }
          },
        },
      );
    });
  } catch {
    return { status: 'unreachable' };
  }
}
