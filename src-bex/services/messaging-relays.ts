import { finalizeEvent, getPublicKey, SimplePool } from 'nostr-tools';
import type { Event, EventTemplate, Filter } from 'nostr-tools';
import type { SubCloser } from 'nostr-tools/abstract-pool';

import { FALLBACK_RELAYS, storageService } from '@/services/storage-service';
import { normalizeRelayUrl } from '@/services/relay-url';
import { RELAY_SEEDS } from '@/data/relay-seeds';
import { DM_RELAY_LIST_KIND } from '@/types/messaging';
import { authSigner } from './relay-auth';
import type { DmRelayList, DmRelayPublishResult } from '@/types/messaging';

const RELAY_LIST_KIND = 10002;

/** How long reading the user's kind 10002 may take, so the rest of a load or publish has time. */
const FETCH_WAIT_MS = 1_500;

/**
 * The whole of a DM relay list load, inside the 5 s a page waits for any background answer
 * (`src/services/bridge-client.ts`). A relay that never answers used to hold the load past it (#265).
 */
const LOAD_DEADLINE_MS = 4_000;

/**
 * The whole of a DM relay publish, from reading the user's kind 10002 to the last relay's answer.
 *
 * A page waits 5 s for any background answer (`src/services/bridge-client.ts`). nostr-tools'
 * own waits cannot keep inside that: it allows 3 s to connect and 4.4 s for each relay to accept,
 * whatever `maxWait` says, so one slow relay used to run the publish past the page's limit (#265).
 * This deadline leaves about a second for signing and the reply.
 */
const PUBLISH_DEADLINE_MS = 4_000;

/**
 * How long a looked-up DM relay list is reused when sending. A kind 10050 rarely changes, and
 * sending needs both the sender's and the recipient's list inside one 5 s round trip.
 */
const DM_RELAY_CACHE_MS = 10 * 60 * 1000;

/**
 * How long an answer of "no DM relay list" is reused. Someone who has just published their first
 * kind 10050 should be reachable within a send or two, not after `DM_RELAY_CACHE_MS`.
 */
const EMPTY_DM_RELAY_CACHE_MS = 30 * 1000;

function normalizeAll(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const normalized = normalizeRelayUrl(url);
    if (normalized.valid && normalized.url && !seen.has(normalized.url)) {
      seen.add(normalized.url);
      result.push(normalized.url);
    }
  }
  return result;
}

/**
 * The relays the extension reads public metadata from.
 *
 * Mirrors `settings-store.getFallbackRelays`, which the background cannot use because it is a
 * Pinia store.
 */
export async function getFallbackRelays(): Promise<string[]> {
  const stored = await storageService.get<unknown>(FALLBACK_RELAYS);
  const relays = Array.isArray(stored)
    ? normalizeAll(stored.filter((url): url is string => typeof url === 'string'))
    : [];
  return relays.length > 0 ? relays : normalizeAll(RELAY_SEEDS);
}

/** The `relay` tags of a kind 10050, normalised, in the order the user published them. */
export function parseDmRelayList(event: Pick<Event, 'tags'>): string[] {
  return normalizeAll(
    event.tags.filter((tag) => tag[0] === 'relay' && typeof tag[1] === 'string').map((tag) => tag[1]!),
  );
}

/** A relay list in the shape NIP-07 `getRelays` returns. */
export type Nip07RelayMap = Record<string, { read: boolean; write: boolean }>;

/**
 * A kind 10002 (NIP-65) as NIP-07 `getRelays` returns it. An `r` tag with no marker is both read
 * and write; a relay listed twice with different markers is both.
 */
export function parseNip07RelayMap(event: Pick<Event, 'tags'>): Nip07RelayMap {
  const map: Nip07RelayMap = {};
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || typeof tag[1] !== 'string') continue;
    const normalized = normalizeRelayUrl(tag[1]);
    if (!normalized.valid || !normalized.url) continue;
    const marker = tag[2];
    const entry = map[normalized.url] ?? { read: false, write: false };
    map[normalized.url] = {
      read: entry.read || marker === undefined || marker === 'read',
      write: entry.write || marker === undefined || marker === 'write',
    };
  }
  return map;
}

/** The write relays of a kind 10002 (NIP-65): `r` tags with no marker or a `write` marker. */
export function parseWriteRelays(event: Pick<Event, 'tags'>): string[] {
  return normalizeAll(
    event.tags
      .filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string' && (tag[2] === undefined || tag[2] === 'write'))
      .map((tag) => tag[1]!),
  );
}

export function buildDmRelayListTemplate(relays: readonly string[], createdAt: number): EventTemplate {
  return {
    kind: DM_RELAY_LIST_KIND,
    created_at: createdAt,
    tags: relays.map((url) => ['relay', url]),
    content: '',
  };
}

/**
 * Validates a list a page asked to publish. Every URL must be a ws:// or wss:// relay; a single bad
 * entry rejects the list rather than being dropped silently.
 */
export function validateDmRelays(relays: readonly string[]): { valid: true; relays: string[] } | { valid: false; error: string } {
  for (const url of relays) {
    const normalized = normalizeRelayUrl(url);
    if (!normalized.valid) {
      return { valid: false, error: `${url}: ${normalized.error ?? 'invalid relay URL'}` };
    }
  }
  return { valid: true, relays: normalizeAll(relays) };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Settles as `promise` does, or with `onTimeout()` once the clock passes `deadlineAt`, whichever
 * comes first.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  deadlineAt: number,
  onTimeout: () => T | Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(
      () => {
        try {
          resolve(onTimeout());
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      Math.max(0, deadlineAt - now()),
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class MessagingRelays {
  private readonly dmRelayCache = new Map<string, { list: DmRelayList; at: number }>();

  /** Unauthenticated reads of public lists only. Never given an AUTH signer, so it is safe to share. */
  private readonly pool: SimplePool;

  constructor(
    private readonly createPool: () => SimplePool = () => new SimplePool(),
    private readonly now: () => number = Date.now,
  ) {
    this.pool = createPool();
  }

  /**
   * A DM relay list for sending or reading messages, reused for a few minutes.
   *
   * The Relays page uses `fetchDmRelays` instead, so what it shows is never stale.
   *
   * When no relay answers in time this reports no list, as before, but does not keep it. An answer
   * of no list is kept only for `EMPTY_DM_RELAY_CACHE_MS`.
   */
  async lookupDmRelays(pubkey: string): Promise<DmRelayList> {
    const cached = this.dmRelayCache.get(pubkey);
    const ttl = cached && cached.list.relays.length === 0 ? EMPTY_DM_RELAY_CACHE_MS : DM_RELAY_CACHE_MS;
    if (cached && this.now() - cached.at < ttl) {
      return cached.list;
    }
    const { list, answered } = await this.readDmRelays(pubkey);
    if (answered) this.dmRelayCache.set(pubkey, { list, at: this.now() });
    return list;
  }

  clearCache(): void {
    this.dmRelayCache.clear();
  }

  /**
   * The user's DM relay list, read now, for the Relays page.
   *
   * Throws when no relay answered in time: "no list" would then be a guess, and the page would
   * offer to publish over a list that may exist.
   */
  async fetchDmRelays(pubkey: string): Promise<DmRelayList> {
    const { list, answered } = await this.readDmRelays(pubkey);
    if (!answered) {
      throw new Error('No relay answered in time');
    }
    this.dmRelayCache.set(pubkey, { list, at: this.now() });
    return list;
  }

  /**
   * Looks for the newest kind 10050 on the fallback relays and, once known, the user's NIP-65 write
   * relays, all within `LOAD_DEADLINE_MS`. The fallback relays are asked straight away rather than
   * after the write relays are known, so one slow relay is waited on once, not twice.
   */
  private async readDmRelays(pubkey: string): Promise<{ list: DmRelayList; answered: boolean }> {
    const start = this.now();
    const deadlineAt = start + LOAD_DEADLINE_MS;
    const fallback = await getFallbackRelays();
    const filter: Filter = { kinds: [DM_RELAY_LIST_KIND], authors: [pubkey], limit: 1 };

    const [onFallback, ownWriteRelays] = await Promise.all([
      this.queryNewest(fallback, filter, deadlineAt),
      this.fetchWriteRelays(pubkey, fallback, Math.min(deadlineAt, start + FETCH_WAIT_MS)),
    ]);
    const writeOnly = ownWriteRelays.filter((url) => !fallback.includes(url));
    const onWrite = await this.queryNewest(writeOnly, filter, deadlineAt);

    const event = newest(onFallback.event, onWrite.event);
    return {
      list: event
        ? { relays: parseDmRelayList(event), updatedAt: event.created_at }
        : { relays: [], updatedAt: null },
      answered: onFallback.answered || onWrite.answered,
    };
  }

  /**
   * Signs and publishes the user's kind 10050.
   *
   * NIP-17 asks for the list to be spread as widely as is viable, so it goes to the fallback
   * relays, the user's NIP-65 write relays, and the DM relays themselves. Inbox relays often require
   * NIP-42 AUTH before accepting an event, so this authenticates as the account, on a pool opened
   * for this publish alone and closed afterwards.
   *
   * Everything happens inside `PUBLISH_DEADLINE_MS`. A relay that has not answered by then counts
   * as rejected; when the user's kind 10002 is not back in time, the list goes to the fallback and
   * DM relays only.
   */
  async publishDmRelays(secretKey: Uint8Array, relays: readonly string[]): Promise<DmRelayPublishResult> {
    const deadlineAt = this.now() + PUBLISH_DEADLINE_MS;
    const pubkey = getPublicKey(secretKey);
    const fallback = await getFallbackRelays();
    const ownWriteRelays = await this.fetchWriteRelays(
      pubkey,
      fallback,
      Math.min(deadlineAt, this.now() + FETCH_WAIT_MS),
    );
    const targets = normalizeAll([...fallback, ...ownWriteRelays, ...relays]);

    const event = finalizeEvent(buildDmRelayListTemplate(relays, Math.floor(Date.now() / 1000)), secretKey);
    const publishPool = this.createPool();
    const abort = new AbortController();
    let outcomes: PromiseSettledResult<string>[];
    try {
      outcomes = await Promise.allSettled(
        publishPool
          .publish(targets, event, {
            maxWait: Math.max(0, deadlineAt - this.now()),
            abort: abort.signal,
            onauth: authSigner(secretKey),
          })
          .map((publish) =>
            withDeadline(publish, deadlineAt, () => Promise.reject(new Error('timed out')), this.now),
          ),
      );
    } finally {
      // Stops connections still being opened, then closes the ones that were.
      abort.abort();
      publishPool.destroy();
    }

    const accepted: string[] = [];
    const rejected: { url: string; reason: string }[] = [];
    outcomes.forEach((outcome, index) => {
      const url = targets[index]!;
      // nostr-tools rejects a publish to a relay it could not connect to, with "connection failure: …".
      if (outcome.status === 'rejected') {
        rejected.push({ url, reason: reasonOf(outcome.reason) });
      } else {
        accepted.push(url);
      }
    });

    if (accepted.length > 0) {
      this.dmRelayCache.set(pubkey, { list: { relays: [...relays], updatedAt: event.created_at }, at: this.now() });
    }
    return { relays: [...relays], accepted, rejected };
  }

  /**
   * The account's published relay list (kind 10002) for NIP-07 `getRelays`, or an empty map when
   * none is found in time. Clients use it for the `relays` tag of a zap request (#270).
   */
  async loadRelayMap(pubkey: string): Promise<Nip07RelayMap> {
    const fallback = await getFallbackRelays();
    const { event } = await this.queryNewest(
      fallback,
      { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 },
      this.now() + LOAD_DEADLINE_MS,
    );
    return event ? parseNip07RelayMap(event) : {};
  }

  private async fetchWriteRelays(pubkey: string, fallback: string[], deadlineAt: number): Promise<string[]> {
    const { event } = await this.queryNewest(
      fallback,
      { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 },
      deadlineAt,
    );
    return event ? parseWriteRelays(event) : [];
  }

  /**
   * The newest event matching `filter` that the relays return by `deadlineAt`, without waiting
   * past it for relays that have not answered.
   *
   * Each relay is asked on its own, so events from fast relays are kept when a slow one is still
   * pending. `answered` says whether any relay finished answering; without that, finding nothing
   * means nothing.
   *
   * nostr-tools reports a subscription that closes without an EOSE — a relay it could not connect
   * to, or one that refused the request — by calling `oneose` and then, in the same turn, `onclose`.
   * So an EOSE only counts once that turn has passed without a close; otherwise a connection that
   * timed out would read as a relay saying it holds nothing.
   */
  private queryNewest(
    relays: readonly string[],
    filter: Filter,
    deadlineAt: number,
  ): Promise<{ event: Event | null; answered: boolean }> {
    return new Promise((resolve) => {
      let found: Event | null = null;
      let answered = false;
      let pending = relays.length;
      let finished = false;
      const subs: SubCloser[] = [];

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        subs.forEach((sub) => sub.close());
        resolve({ event: found, answered });
      };
      const timer = setTimeout(finish, Math.max(0, deadlineAt - this.now()));
      if (pending === 0) finish();

      // nostr-tools' own waits run a little past the deadline, so only ours decides.
      const maxWait = Math.max(0, deadlineAt - this.now()) + 1_000;
      for (const url of relays) {
        let done = false;
        const settle = (eose: boolean) => {
          if (done) return;
          done = true;
          if (eose) answered = true;
          pending -= 1;
          if (pending === 0) finish();
        };
        subs.push(
          this.pool.subscribeMany([url], filter, {
            maxWait,
            onevent: (event) => {
              found = newest(found, event);
            },
            oneose: () => queueMicrotask(() => settle(true)),
            onclose: () => settle(false),
          }),
        );
      }
      // Covers a relay that settled before every subscription had been opened.
      if (finished) subs.forEach((sub) => sub.close());
    });
  }
}

function newest(a: Event | null, b: Event | null): Event | null {
  if (!a) return b;
  if (!b) return a;
  return b.created_at > a.created_at ? b : a;
}

export const messagingRelays = new MessagingRelays();
