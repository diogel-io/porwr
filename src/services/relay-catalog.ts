import { db } from '@/services/database';
import { normalizeRelayUrl, isRestrictedHostname } from '@/services/relay-url';
import { logService, LogLevel } from '@/services/log-service';
import { FALLBACK_RELAYS, storageService } from '@/services/storage-service';
import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';
import { RELAY_SEEDS } from '@/data/relay-seeds';

/**
 * Constants for relay discovery and metadata staleness thresholds (in milliseconds).
 * These are easily adjustable for later tuning.
 */
export const DISCOVERY_STALENESS_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
export const METADATA_STALENESS_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function loadSeedRelays(): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  // Use the same fallback relay source for consistency across the app.
  // This allows the catalog seeds to stay in sync with what the user considers "fallback" relays.
  const storedSeeds = await storageService.get<string[]>(FALLBACK_RELAYS);
  const seedsToUse = Array.isArray(storedSeeds) && storedSeeds.length > 0 ? storedSeeds : RELAY_SEEDS;

  for (const seedUrl of seedsToUse) {
    const result = normalizeRelayUrl(seedUrl);

    if (!result.valid || !result.url || !result.hostname) {
      skipped++;
      continue;
    }

    const { url, hostname } = result;

    try {
      const existing = await db.relayCatalog.get(url);
      if (existing) {
        if (!existing.isSeed) {
          await relayCatalogService.upsertEntry({
            url,
            hostname,
            isSeed: true,
            source: 'seed',
          });
          updated++;
        }
      } else {
        await relayCatalogService.upsertEntry({
          url,
          hostname,
          isSeed: true,
          source: 'seed',
        });
        added++;
      }
    } catch (e) {
      logService.log(LogLevel.ERROR, `[RelayCatalog] Failed to upsert seed ${url}`, { error: e });
      skipped++;
    }
  }

  return { added, updated, skipped };
}


/**
 * Service for reading relay catalog entries from the database.
 * This service is read-only and provides predictable formatting and sorting for the UI.
 */
export class RelayCatalogService {
  /**
   * Upserts a relay catalog entry with sophisticated merging rules.
   *
   * Merge logic:
   * 1. If entry exists, merge metadata: only non-empty fields replace existing ones.
   * 2. Source markers are accumulated (comma-separated).
   * 3. 'isSeed' and 'isUserAdded' flags are combined (OR-ed).
   * 4. Richer metadata (like description or software) is preserved if the update has less info.
   *
   * @param entry Partial entry to upsert (must have url and hostname).
   */
  async upsertEntry(entry: Partial<RelayCatalogEntry> & { url: string; hostname: string }): Promise<void> {
    await db.transaction('rw', db.relayCatalog, async () => {
      const existing = await db.relayCatalog.get(entry.url);
      const now = Date.now();

      if (existing) {
        const updates: Partial<RelayCatalogEntry> = {
          updatedAt: now,
        };

        // 1. Merge source markers (comma-separated)
        if (entry.source && entry.source !== existing.source) {
          const sources = new Set(
            (existing.source || '')
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
          );
          entry.source
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .forEach(s => sources.add(s));
          updates.source = Array.from(sources).join(',');
        }

        // 2. Combine flags
        if (entry.isSeed !== undefined) updates.isSeed = existing.isSeed || entry.isSeed;
        if (entry.isUserAdded !== undefined) updates.isUserAdded = existing.isUserAdded || entry.isUserAdded;

        // 3. Status handling: only update if not 'error' or if the new status is better
        // A 'failed' fetch shouldn't destroy 'online' status immediately unless we're sure
        if (entry.status && entry.status !== 'unknown') {
          // If existing is 'online' and new is 'error' or 'offline', we only downgrade if it's been a while
          const isDowngrade =
            existing.status === 'online' && (entry.status === 'offline' || entry.status === 'error');
          const isRecentlySeen = existing.lastSeen && now - existing.lastSeen < 60 * 60 * 1000; // 1 hour

          if (!isDowngrade || !isRecentlySeen) {
            updates.status = entry.status;
          }
        }

        if (entry.lastChecked) updates.lastChecked = entry.lastChecked;
        if (entry.lastSeen) updates.lastSeen = entry.lastSeen;
        else if (entry.status === 'online') updates.lastSeen = now;

        // 4. Metadata merging: Preserve richer data
        if (entry.metadata) {
          const mergedMetadata = { ...(existing.metadata || {}) };
          let hasNewMetadata = false;

          for (const [key, value] of Object.entries(entry.metadata)) {
            const existingValue = mergedMetadata[key];

            // Only overwrite if the new value is "richer" or non-empty
            // For now, "richer" means non-null, non-undefined, and if it's a string, non-empty.
            const isNewValueRicher =
              value !== undefined &&
              value !== null &&
              (typeof value !== 'string' || value.trim().length > 0) &&
              (existingValue === undefined || existingValue === null || (typeof existingValue === 'string' && existingValue.trim().length === 0));

            // Also allow overwriting if they are both strings but new one is different and not empty
            // (e.g. name changed)
            const isValueChanged =
              value !== undefined &&
              value !== null &&
              (typeof value !== 'string' || value.trim().length > 0) &&
              value !== existingValue;

            if (isNewValueRicher || isValueChanged) {
              mergedMetadata[key] = value;
              hasNewMetadata = true;
            }
          }

          if (hasNewMetadata) {
            updates.metadata = mergedMetadata;
          }
        }

        await db.relayCatalog.update(entry.url, updates);
      } else {
        // New entry
        const newEntry: RelayCatalogEntry = {
          url: entry.url,
          hostname: entry.hostname,
          isUserAdded: entry.isUserAdded || false,
          isSeed: entry.isSeed || false,
          status: entry.status || 'unknown',
          createdAt: now,
          updatedAt: now,
        };

        if (entry.metadata !== undefined) newEntry.metadata = entry.metadata;
        if (entry.source !== undefined) newEntry.source = entry.source;
        if (entry.lastChecked !== undefined) newEntry.lastChecked = entry.lastChecked;
        if (entry.lastSeen !== undefined) newEntry.lastSeen = entry.lastSeen;
        else if (entry.status === 'online') newEntry.lastSeen = now;

        await db.relayCatalog.add(newEntry);
      }
    });
  }

  /**
   * Retrieves all valid relay catalog entries from the database, sorted by default criteria.
   *
   * Default sort order:
   * 1. Seeded entries with metadata
   * 2. Discovered entries with metadata
   * 3. Entries without metadata
   * 4. Unreachable or failed entries last
   *
   * @returns A promise that resolves to a stable array of sorted RelayCatalogEntry objects.
   */
  async getEntries(): Promise<RelayCatalogEntry[]> {
    const allEntries = await db.relayCatalog.toArray();

    // Filter out obviously invalid entries (e.g., missing URL)
    // And return clones to prevent mutation of the underlying data
    const validEntries = allEntries
      .filter(entry => this.isValidEntry(entry))
      .map(entry => ({ ...entry }));

    // Sort entries based on the required criteria
    return validEntries.sort((a, b) => this.compareEntries(a, b));
  }

  /**
   * Checks if a relay catalog entry is considered valid for UI presentation.
   *
   * A relay is considered valid for the default view if:
   * 1. It has a valid URL (wss:// or ws://) and hostname.
   * 2. It is not malformed or using restricted hostnames (localhost/IPs) unless user-added/seed.
   * 3. It is not excessively long.
   * 4. It is either:
   *    - Online with metadata (or very recently discovered)
   *    - A Seed relay
   *    - User-added relay
   *    - Offline/Error but has metadata AND was seen recently (< 30 days)
   *
   * @param entry The entry to validate.
   * @returns True if the entry is valid, false otherwise.
   */
  private isValidEntry(entry: RelayCatalogEntry): boolean {
    // 1. Structural and scheme validation
    // Use the centralized validator to handle protocol, length, and malformed URL checks.
    const { valid } = normalizeRelayUrl(entry.url);
    if (!valid) return false;

    const isSpecial = entry.isSeed || entry.isUserAdded;

    // 2. Exclude restricted hostnames (localhost, IP addresses) unless it's a special relay.
    // This reduces noise from local-only or IP-only relays in the discovery catalog.
    if (!isSpecial && isRestrictedHostname(entry.hostname)) {
      return false;
    }

    // 3. Status and metadata quality filtering
    const isUnusable = entry.status === 'offline' || entry.status === 'error';
    const hasMetadata = !!(entry.metadata && (entry.metadata.name || entry.metadata.description));
    const hasAnyMetadata =
      hasMetadata ||
      !!(entry.metadata && entry.metadata.supported_nips && entry.metadata.supported_nips.length > 0);

    // 3.a Give a 24-hour grace period for newly discovered online relays to be crawled for metadata.
    if (entry.status === 'online' && !hasAnyMetadata && !isSpecial) {
      const isRecentlyCreated = Date.now() - entry.createdAt < 24 * 60 * 60 * 1000;
      if (!isRecentlyCreated) return false;
    }

    // 3.b If it's offline/error, only keep if it's special or has rich metadata.
    if (isUnusable && !isSpecial && !hasMetadata) {
      return false;
    }

    // 3.c If it's offline/error and hasn't been seen for a long time (30 days),
    // exclude even if it has metadata, as it's likely permanently gone.
    if (isUnusable && !isSpecial && entry.lastSeen) {
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - entry.lastSeen > thirtyDays) {
        return false;
      }
    }

    return true;
  }

  /**
   * Comparison function for sorting relay catalog entries.
   *
   * Logic:
   * - Entries with status 'online' or 'unknown' are preferred over 'offline' or 'error'.
   * - Seeded entries with metadata > Discovered entries with metadata > Entries without metadata.
   * - Within the same category, sort alphabetically by URL for determinism.
   */
  private compareEntries(a: RelayCatalogEntry, b: RelayCatalogEntry): number {
    const scoreA = this.getEntryScore(a);
    const scoreB = this.getEntryScore(b);

    if (scoreA !== scoreB) {
      return scoreB - scoreA; // Higher score first
    }

    // Deterministic fallback: sort by URL
    return a.url.localeCompare(b.url);
  }

  /**
   * Calculates a priority score for an entry to help with sorting.
   * Higher score means higher priority.
   *
   * Logic:
   * 100: Seed relays with rich metadata (name + description)
   * 90: User-added relays
   * 85: Seed relays with some metadata
   * 80: Relays with name AND description
   * 70: Relays with name OR description
   * 60: Relays with NIPs but no name/desc
   * 50: Seeds with no metadata
   * 10: Unknown status (freshly discovered)
   * 1: Default (online but low info)
   * 0: Offline or error
   */
  private getEntryScore(entry: RelayCatalogEntry): number {
    // Unreachable or failed entries last
    if (entry.status === 'offline' || entry.status === 'error') {
      return 0;
    }

    const hasName = !!(entry.metadata && entry.metadata.name && entry.metadata.name.trim().length > 0);
    const hasDescription = !!(entry.metadata && entry.metadata.description && entry.metadata.description.trim().length > 0);
    const hasNips = !!(entry.metadata && entry.metadata.supported_nips && entry.metadata.supported_nips.length > 0);

    if (entry.isSeed && hasName && hasDescription) {
      return 100;
    }

    if (entry.isUserAdded) {
      return 90;
    }

    if (entry.isSeed && (hasName || hasDescription)) {
      return 85;
    }

    if (hasName && hasDescription) {
      return 80;
    }

    if (hasName || hasDescription) {
      return 70;
    }

    if (hasNips) {
      return 60;
    }

    if (entry.isSeed) {
      return 50;
    }

    if (entry.status === 'unknown') {
      return 10;
    }

    return 1;
  }

  /**
   * Retrieves the current discovery state from the database.
   * @param id The ID of the discovery task (defaults to 'global').
   * @returns The discovery state or null if not found.
   */
  async getDiscoveryState(id = 'global'): Promise<RelayDiscoveryState | null> {
    return (await db.relayDiscoveryState.get(id)) || null;
  }

  /**
   * Updates the discovery state in the database.
   * Creates it if it doesn't exist.
   * @param id The ID of the discovery task (defaults to 'global').
   * @param updates The fields to update.
   */
  async updateDiscoveryState(updates: Partial<RelayDiscoveryState>, id = 'global'): Promise<void> {
    await db.transaction('rw', db.relayDiscoveryState, async () => {
      const existing = await db.relayDiscoveryState.get(id);
      const now = Date.now();

      if (existing) {
        await db.relayDiscoveryState.update(id, {
          ...updates,
          updatedAt: now,
        });
      } else {
        const newState: RelayDiscoveryState = {
          id,
          isDiscoveryInProgress: false,
          updatedAt: now,
          ...updates,
        };
        await db.relayDiscoveryState.add(newState);
      }
    });
  }

  /**
   * Determines if global discovery should be refreshed based on staleness rules.
   *
   * Logic:
   * 1. No state -> refresh
   * 2. In progress -> no refresh (avoid duplicates)
   * 3. Older than DISCOVERY_STALENESS_THRESHOLD -> refresh
   *
   * @param state The current discovery state.
   * @returns True if discovery is stale and should be refreshed.
   */
  isDiscoveryStale(state: RelayDiscoveryState | null): boolean {
    if (!state) return true;
    if (state.isDiscoveryInProgress) return false;
    if (!state.lastGlobalDiscoveryAt) return true;

    return Date.now() - state.lastGlobalDiscoveryAt > DISCOVERY_STALENESS_THRESHOLD;
  }

  /**
   * Determines if relay metadata should be refreshed.
   *
   * Logic:
   * 1. Status 'unknown' -> refresh
   * 2. No lastChecked timestamp -> refresh
   * 3. Older than METADATA_STALENESS_THRESHOLD -> refresh
   *
   * @param entry The relay catalog entry.
   * @returns True if metadata is stale and should be refreshed.
   */
  isMetadataStale(entry: RelayCatalogEntry): boolean {
    if (entry.status === 'unknown') return true;
    if (!entry.lastChecked) return true;

    return Date.now() - entry.lastChecked > METADATA_STALENESS_THRESHOLD;
  }
}

export const relayCatalogService = new RelayCatalogService();
