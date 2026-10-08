import { SimplePool, type Event } from 'nostr-tools';
import { normalizeRelayUrl } from './relay-url';
import useSettingsStore from '@/stores/settings-store';

export interface RelayListEntry {
  url: string;
  read: boolean;
  write: boolean;
}

/**
 * Normalizes and deduplicates a list of relay URLs.
 * @param urls Array of raw relay URL strings
 * @returns Array of unique, normalized, and valid relay URL strings
 */
export function normalizeAndDeduplicateRelays(urls: string[]): string[] {
  const uniqueUrls = new Set<string>();
  for (const url of urls) {
    const result = normalizeRelayUrl(url);
    if (result.valid && result.url) {
      uniqueUrls.add(result.url);
    }
  }
  return Array.from(uniqueUrls);
}

/**
 * Parses a kind 10002 event and extracts relay URLs from its 'r' tags.
 * Kind 10002 tags are formatted as ['r', 'wss://relay.url', 'read|write' (optional)]
 * @param event The Nostr event object (expected kind 10002)
 * @returns Array of raw relay URL strings extracted from the event
 */
export function parseRelayListEvent(event: Event): string[] {
  return parseRelayListEntries(event).map((entry) => entry.url);
}

export function parseRelayListEntries(event: Event): RelayListEntry[] {
  if (!event || typeof event !== 'object') return [];
  if (event.kind !== 10002) return [];
  if (!Array.isArray(event.tags)) return [];

  const entries: RelayListEntry[] = [];
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === 'r' && typeof tag[1] === 'string') {
      const marker = tag[2];
      entries.push({
        url: tag[1],
        read: !marker || marker === 'read',
        write: !marker || marker === 'write',
      });
    }
  }
  return entries;
}

export function extractWritePreferredRelayUrls(event: Event): string[] {
  const entries = parseRelayListEntries(event);
  const writeUrls = entries
    .filter((entry) => entry.write)
    .map((entry) => entry.url);

  if (writeUrls.length > 0) {
    return normalizeAndDeduplicateRelays(writeUrls);
  }

  return normalizeAndDeduplicateRelays(entries.map((entry) => entry.url));
}

/**
 * Fetches the kind 10002 relay list event for a given pubkey using fallback relays.
 * @param pubkey The public key to fetch the relay list for
 * @returns The kind 10002 event or null if not found
 */
export async function fetchAccountRelayListEvent(pubkey: string): Promise<Event | null> {
  const settingsStore = useSettingsStore();
  const relays = await settingsStore.getFallbackRelays();

  if (relays.length === 0) {
    return null;
  }

  const relayMetadataPool = new SimplePool();
  try {
    const event = await relayMetadataPool.get(relays, {
      kinds: [10002],
      authors: [pubkey],
    });
    return event;
  } catch {
    return null;
  } finally {
    relayMetadataPool.close(relays);
  }
}

export interface DiscoveryResult {
  discoveredUrls: string[];
  processedEvents: number;
  errors: string[];
}

const pool = new SimplePool();

/**
 * Bounded relay discovery service that extracts relay candidates from kind 10002 events.
 */
export class RelayDiscoveryService {
  /**
   * Discovers relay candidates by querying a bounded set of relays for kind 10002 events.
   * @param seedRelays Bounded set of relays to query
   * @param limit Maximum number of events to fetch (optional)
   * @returns Structured discovery result
   */
  async discoverFromRelays(seedRelays: string[], limit = 50): Promise<DiscoveryResult> {
    const allUrls: string[] = [];
    const errors: string[] = [];
    let processedCount = 0;

    try {
      // Query for recent kind 10002 events from the seed relays
      const events = await pool.querySync(seedRelays, {
        kinds: [10002],
        limit,
      });

      for (const event of events) {
        try {
          const urls = parseRelayListEvent(event);
          if (urls.length > 0) {
            allUrls.push(...urls);
            processedCount++;
          }
        } catch (err) {
          errors.push(`Error parsing event ${event.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`Discovery query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      discoveredUrls: normalizeAndDeduplicateRelays(allUrls),
      processedEvents: processedCount,
      errors,
    };
  }

  /**
   * Processes a set of kind 10002 events and returns a list of unique, normalized relay URLs.
   * @param events Array of Nostr events (should be kind 10002)
   * @returns Structured discovery result
   */
  processEvents(events: Event[]): DiscoveryResult {
    const allUrls: string[] = [];
    const errors: string[] = [];
    let processedCount = 0;

    for (const event of events) {
      if (!event) continue;
      try {
        const urls = parseRelayListEvent(event);
        if (urls.length > 0) {
          allUrls.push(...urls);
          processedCount++;
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return {
      discoveredUrls: normalizeAndDeduplicateRelays(allUrls),
      processedEvents: processedCount,
      errors,
    };
  }
}

export const relayDiscoveryService = new RelayDiscoveryService();
