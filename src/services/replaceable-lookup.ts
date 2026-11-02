import type { Event, SimplePool } from 'nostr-tools';

/**
 * Looking up an account's replaceable event on a set of relays, telling "none published" apart
 * from "no relay answered" (#285, #424, #435).
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
 * The reason nostr-tools gives a relay's subscription when it closes after EOSE. It gives the same
 * reason when its own EOSE timeout fires, so it means the relay answered only when it arrives before
 * Porwr's own timer, which `askRelay` makes sure of (#424). Any other reason (connection failed or
 * timed out, auth failed) means it did not answer. nostr-tools does not export it, so it is pinned
 * here; the relay list tests catch a change.
 */
const CLOSED_ON_EOSE = 'closed automatically on eose';

/**
 * How long each relay gets to connect and answer, in milliseconds, before it counts as not having
 * answered (#424). Close to the worst case the lookups allowed before: about 7.4 s for relay lists
 * and 9 s for contacts. A relay that answers settles as soon as it does.
 */
export const REPLACEABLE_LOOKUP_TIMEOUT_MS = 8_000;

/** How much later nostr-tools' own timeout is set than Porwr's, so it never fires first. */
const NOSTR_TOOLS_TIMEOUT_MARGIN_MS = 1_000;

export interface ReplaceableEventLookupOptions {
  /** Longest wait, in milliseconds, for each relay to connect and answer. */
  timeoutMs?: number;
}

/** What one relay did: sent EOSE, never answered in time, or failed to connect or serve. */
type RelayOutcome = 'answered' | 'silent' | 'failed';

/**
 * Asks one relay, on its own subscription so its close reason is its own.
 *
 * nostr-tools treats its EOSE timeout as a real EOSE and closes with the same reason, so a relay
 * that connects and never answers would look like one that has no event (#424). Porwr's own timer
 * therefore decides when a relay has taken too long, and nostr-tools' timeout is set later so it
 * never comes first, as `gift-wrap-storage.ts` does: a close on EOSE before that timer is a relay
 * that really answered.
 */
function askRelay(
  pool: ReplaceableEventReader,
  url: string,
  pubkey: string,
  kind: number,
  timeoutMs: number,
  onevent: (event: Event) => void,
): Promise<RelayOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let closer: { close: (reason?: string) => unknown } | undefined;
    const finish = (outcome: RelayOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      finish('silent');
      // Its "closed by caller" close arrives after `finish`, so it is ignored.
      void closer?.close();
    }, timeoutMs);

    try {
      closer = pool.subscribeEose(
        [url],
        { kinds: [kind], authors: [pubkey], limit: 1 },
        {
          maxWait: timeoutMs + NOSTR_TOOLS_TIMEOUT_MARGIN_MS,
          onevent,
          onclose(closes) {
            finish(closes.some((close) => close.reason === CLOSED_ON_EOSE) ? 'answered' : 'failed');
          },
        },
      );
    } catch {
      finish('failed');
    }
  });
}

/**
 * Looks up the newest event of a replaceable `kind` by `pubkey` on `relays`.
 *
 * `SimplePool.get` cannot tell the empty cases apart: it resolves `null` when the relays answered
 * with nothing, when none of them connected, and when they connected but never answered. This asks
 * each relay on its own and reads how each one ended instead (#285, #424). The caller owns `pool`
 * and closes it.
 */
export async function lookupReplaceableEvent(
  pool: ReplaceableEventReader,
  relays: string[],
  pubkey: string,
  kind: number,
  options: ReplaceableEventLookupOptions = {},
): Promise<ReplaceableEventLookup> {
  // No relay to ask means nothing answered.
  if (relays.length === 0) {
    return { status: 'unreachable' };
  }

  const timeoutMs = options.timeoutMs ?? REPLACEABLE_LOOKUP_TIMEOUT_MS;
  let newest: Event | null = null;
  const keepNewest = (event: Event) => {
    if (!newest || event.created_at > newest.created_at) {
      newest = event;
    }
  };

  const outcomes = await Promise.all(
    relays.map((url) => askRelay(pool, url, pubkey, kind, timeoutMs, keepNewest)),
  );

  // Set from the callbacks above, which TypeScript does not follow.
  const event = newest as Event | null;
  if (event) return { status: 'found', event };
  if (outcomes.includes('answered')) return { status: 'not-found' };
  return { status: 'unreachable' };
}
