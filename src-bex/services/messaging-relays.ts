import { finalizeEvent, getPublicKey, SimplePool } from 'nostr-tools';
import type { Event, EventTemplate } from 'nostr-tools';

import { FALLBACK_RELAYS, storageService } from '@/services/storage-service';
import { normalizeRelayUrl } from '@/services/relay-url';
import { RELAY_SEEDS } from '@/data/relay-seeds';
import { DM_RELAY_LIST_KIND } from '@/types/messaging';
import type { DmRelayList, DmRelayPublishResult } from '@/types/messaging';

const RELAY_LIST_KIND = 10002;

/**
 * Relay waits stay well inside the 5 s a page waits for any background answer
 * (`src/services/bridge-client.ts`). A publish reads the user's kind 10002 first, so the two
 * waits together still leave room for the reply to travel back.
 */
const FETCH_WAIT_MS = 1_500;
const PUBLISH_WAIT_MS = 2_500;

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

export class MessagingRelays {
  constructor(private readonly pool: SimplePool = new SimplePool()) {}

  async fetchDmRelays(pubkey: string): Promise<DmRelayList> {
    const fallback = await getFallbackRelays();
    const ownWriteRelays = await this.fetchWriteRelays(pubkey, fallback);
    const event = await this.pool.get(
      normalizeAll([...fallback, ...ownWriteRelays]),
      { kinds: [DM_RELAY_LIST_KIND], authors: [pubkey] },
      { maxWait: FETCH_WAIT_MS },
    );
    return event ? { relays: parseDmRelayList(event), updatedAt: event.created_at } : { relays: [], updatedAt: null };
  }

  /**
   * Signs and publishes the user's kind 10050.
   *
   * NIP-17 asks for the list to be spread as widely as is viable, so it goes to the fallback
   * relays, the user's NIP-65 write relays, and the DM relays themselves.
   */
  async publishDmRelays(secretKey: Uint8Array, relays: readonly string[]): Promise<DmRelayPublishResult> {
    const pubkey = getPublicKey(secretKey);
    const fallback = await getFallbackRelays();
    const ownWriteRelays = await this.fetchWriteRelays(pubkey, fallback);
    const targets = normalizeAll([...fallback, ...ownWriteRelays, ...relays]);

    const event = finalizeEvent(buildDmRelayListTemplate(relays, Math.floor(Date.now() / 1000)), secretKey);
    const outcomes = await Promise.allSettled(this.pool.publish(targets, event, { maxWait: PUBLISH_WAIT_MS }));

    const accepted: string[] = [];
    const rejected: { url: string; reason: string }[] = [];
    outcomes.forEach((outcome, index) => {
      const url = targets[index]!;
      if (outcome.status === 'fulfilled') accepted.push(url);
      else rejected.push({ url, reason: reasonOf(outcome.reason) });
    });

    return { relays: [...relays], accepted, rejected };
  }

  private async fetchWriteRelays(pubkey: string, fallback: string[]): Promise<string[]> {
    const event = await this.pool.get(
      fallback,
      { kinds: [RELAY_LIST_KIND], authors: [pubkey] },
      { maxWait: FETCH_WAIT_MS },
    );
    return event ? parseWriteRelays(event) : [];
  }
}

export const messagingRelays = new MessagingRelays();
