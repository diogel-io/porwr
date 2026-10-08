import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSeedRelays, relayCatalogService } from '@/services/relay-catalog';
import { FALLBACK_RELAYS } from '@/services/storage-service';
import type { RelayCatalogEntry } from '@/types/relay';


// Mock the database
const mockRelayCatalog = new Map<string, RelayCatalogEntry>();

vi.mock('@/services/database', () => {
  return {
    db: {
      relayCatalog: {
        get: vi.fn((url: string) => Promise.resolve(mockRelayCatalog.get(url))),
        add: vi.fn((entry: RelayCatalogEntry) => {
          mockRelayCatalog.set(entry.url, entry);
          return Promise.resolve(entry.url);
        }),
        update: vi.fn((url: string, changes: Partial<RelayCatalogEntry>) => {
          const existing = mockRelayCatalog.get(url);
          if (existing) {
            mockRelayCatalog.set(url, { ...existing, ...changes });
          }
          return Promise.resolve(1);
        }),
        toArray: vi.fn(() => Promise.resolve(Array.from(mockRelayCatalog.values()))),
      },
      transaction: vi.fn((mode: string, tables: string[], callback: () => unknown) => {
        return Promise.resolve(callback());
      }),
    },
  };
});

// Mock Storage Service
const mockStorage = new Map<string, unknown>();
vi.mock('@/services/storage-service', () => ({
  FALLBACK_RELAYS: 'nostr:fallback-relays',
  storageService: {
    get: vi.fn((key: string) => Promise.resolve(mockStorage.get(key))),
  },
}));

// Mock RELAY_SEEDS to have a controlled set for testing, including an invalid one
vi.mock('@/data/relay-seeds', () => ({
  RELAY_SEEDS: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'invalid-url',
  ],
}));

describe('Relay Catalog Service - loadSeedRelays', () => {
  beforeEach(() => {
    mockRelayCatalog.clear();
    vi.clearAllMocks();
  });

  it('should insert missing seeds into an empty catalog', async () => {
    const result = await loadSeedRelays();

    expect(result.added).toBe(2); // damus and nos.lol
    expect(result.skipped).toBe(1); // invalid-url
    expect(mockRelayCatalog.size).toBe(2);

    const damus = mockRelayCatalog.get('wss://relay.damus.io');
    expect(damus).toBeDefined();
    expect(damus?.isSeed).toBe(true);
    expect(damus?.source).toBe('seed');
  });

  it('should not create duplicates when run twice', async () => {
    await loadSeedRelays();
    const secondResult = await loadSeedRelays();

    expect(secondResult.added).toBe(0);
    expect(secondResult.updated).toBe(0);
    expect(mockRelayCatalog.size).toBe(2);
  });

  it('should use customized fallback relays from storage if available', async () => {
    mockStorage.set(FALLBACK_RELAYS, ['wss://custom.relay.io']);

    const result = await loadSeedRelays();

    expect(result.added).toBe(1);
    expect(mockRelayCatalog.has('wss://custom.relay.io')).toBe(true);
    // Should NOT have the defaults from RELAY_SEEDS if custom storage exists
    expect(mockStorage.get(FALLBACK_RELAYS)).toContain('wss://custom.relay.io');

    mockStorage.clear();
  });

  it('should preserve richer existing metadata and update isSeed status', async () => {
    // Pre-insert an entry with metadata but isSeed: false
    const existingEntry: RelayCatalogEntry = {
      url: 'wss://relay.damus.io',
      hostname: 'relay.damus.io',
      isUserAdded: true,
      isSeed: false,
      status: 'online',
      metadata: { name: 'Damus Relay', description: 'Very rich description' },
      createdAt: Date.now() - 10000,
      updatedAt: Date.now() - 10000,
      source: 'manual',
    };
    mockRelayCatalog.set(existingEntry.url, existingEntry);

    const result = await loadSeedRelays();

    expect(result.added).toBe(1); // nos.lol added
    expect(result.updated).toBe(1); // damus updated to isSeed: true

    const updatedDamus = mockRelayCatalog.get('wss://relay.damus.io');
    expect(updatedDamus?.isSeed).toBe(true);
    expect(updatedDamus?.isUserAdded).toBe(true); // preserved
    expect(updatedDamus?.metadata?.name).toBe('Damus Relay'); // preserved
    expect(updatedDamus?.source).toBe('manual,seed'); // accumulated
  });

  describe('upsertEntry', () => {
    beforeEach(() => {
      mockRelayCatalog.clear();
      vi.clearAllMocks();
    });

    it('should insert a new relay entry', async () => {
      await relayCatalogService.upsertEntry({
        url: 'wss://new.relay.com',
        hostname: 'new.relay.com',
        source: 'discovery',
      });

      const entry = mockRelayCatalog.get('wss://new.relay.com');
      expect(entry).toBeDefined();
      expect(entry?.url).toBe('wss://new.relay.com');
      expect(entry?.source).toBe('discovery');
      expect(entry?.status).toBe('unknown');
    });

    it('should merge a seed entry into an existing richer entry', async () => {
      const existing: RelayCatalogEntry = {
        url: 'wss://rich.com',
        hostname: 'rich.com',
        isUserAdded: true,
        isSeed: false,
        status: 'online',
        metadata: { name: 'Rich Relay', description: 'Extremely rich' },
        createdAt: 1000,
        updatedAt: 1000,
        source: 'manual',
      };
      mockRelayCatalog.set(existing.url, existing);

      await relayCatalogService.upsertEntry({
        url: 'wss://rich.com',
        hostname: 'rich.com',
        isSeed: true,
        source: 'seed',
      });

      const updated = mockRelayCatalog.get('wss://rich.com');
      expect(updated?.isSeed).toBe(true);
      expect(updated?.isUserAdded).toBe(true);
      expect(updated?.metadata?.name).toBe('Rich Relay');
      expect(updated?.metadata?.description).toBe('Extremely rich');
      expect(updated?.source).toBe('manual,seed');
    });

    it('should merge fetched metadata into a placeholder entry', async () => {
      const placeholder: RelayCatalogEntry = {
        url: 'wss://placeholder.com',
        hostname: 'placeholder.com',
        isUserAdded: false,
        isSeed: true,
        status: 'unknown',
        createdAt: 1000,
        updatedAt: 1000,
        source: 'seed',
      };
      mockRelayCatalog.set(placeholder.url, placeholder);

      await relayCatalogService.upsertEntry({
        url: 'wss://placeholder.com',
        hostname: 'placeholder.com',
        status: 'online',
        metadata: { name: 'Now Real', software: 'noscl' },
        lastChecked: 2000,
      });

      const updated = mockRelayCatalog.get('wss://placeholder.com');
      expect(updated?.status).toBe('online');
      expect(updated?.metadata?.name).toBe('Now Real');
      expect(updated?.metadata?.software).toBe('noscl');
      expect(updated?.lastChecked).toBe(2000);
    });

    it('should not duplicate source markers or entries', async () => {
      await relayCatalogService.upsertEntry({
        url: 'wss://dup.com',
        hostname: 'dup.com',
        source: 'discovery',
      });

      await relayCatalogService.upsertEntry({
        url: 'wss://dup.com',
        hostname: 'dup.com',
        source: 'discovery',
      });

      await relayCatalogService.upsertEntry({
        url: 'wss://dup.com',
        hostname: 'dup.com',
        source: 'nprofile,discovery',
      });

      const entry = mockRelayCatalog.get('wss://dup.com');
      expect(entry?.source).toBe('discovery,nprofile');
      expect(mockRelayCatalog.size).toBe(1);
    });

    it('should not destroy good prior metadata when merging less-rich metadata', async () => {
      const rich: RelayCatalogEntry = {
        url: 'wss://stable.com',
        hostname: 'stable.com',
        isUserAdded: false,
        isSeed: true,
        status: 'online',
        metadata: { name: 'Stable', description: 'Very stable', version: '1.0' },
        createdAt: 1000,
        updatedAt: 1000,
        source: 'seed',
      };
      mockRelayCatalog.set(rich.url, rich);

      // Attempt to upsert with "poorer" metadata (missing description and version)
      await relayCatalogService.upsertEntry({
        url: 'wss://stable.com',
        hostname: 'stable.com',
        metadata: { name: 'Stable' }, // Missing other fields
      });

      const entry = mockRelayCatalog.get('wss://stable.com');
      expect(entry?.metadata?.name).toBe('Stable');
      expect(entry?.metadata?.description).toBe('Very stable'); // Preserved
      expect(entry?.metadata?.version).toBe('1.0'); // Preserved
    });

    it('should protect online status from transient failures if recently seen', async () => {
      const now = Date.now();
      const online: RelayCatalogEntry = {
        url: 'wss://recently-online.com',
        hostname: 'recently-online.com',
        isUserAdded: false,
        isSeed: true,
        status: 'online',
        lastSeen: now - 10 * 60 * 1000, // 10 minutes ago
        createdAt: 1000,
        updatedAt: 1000,
      };
      mockRelayCatalog.set(online.url, online);

      // Simulate a "failed" refresh which tries to set status to 'error'
      await relayCatalogService.upsertEntry({
        url: 'wss://recently-online.com',
        hostname: 'recently-online.com',
        status: 'error',
      });

      const entry = mockRelayCatalog.get('wss://recently-online.com');
      expect(entry?.status).toBe('online'); // Protected
    });

    it('should allow status downgrade if not recently seen', async () => {
      const now = Date.now();
      const online: RelayCatalogEntry = {
        url: 'wss://old-online.com',
        hostname: 'old-online.com',
        isUserAdded: false,
        isSeed: true,
        status: 'online',
        lastSeen: now - 2 * 60 * 60 * 1000, // 2 hours ago
        createdAt: 1000,
        updatedAt: 1000,
      };
      mockRelayCatalog.set(online.url, online);

      await relayCatalogService.upsertEntry({
        url: 'wss://old-online.com',
        hostname: 'old-online.com',
        status: 'error',
      });

      const entry = mockRelayCatalog.get('wss://old-online.com');
      expect(entry?.status).toBe('error'); // Downgraded
    });

    it('should update lastSeen when status is online', async () => {
      const before = Date.now();
      await relayCatalogService.upsertEntry({
        url: 'wss://new-online.com',
        hostname: 'new-online.com',
        status: 'online',
      });

      const entry = mockRelayCatalog.get('wss://new-online.com');
      expect(entry?.lastSeen).toBeGreaterThanOrEqual(before);
    });
  });

  it('should ignore invalid seed entries safely', async () => {
    const result = await loadSeedRelays();
    expect(result.skipped).toBe(1);
    expect(mockRelayCatalog.has('invalid-url')).toBe(false);
  });
});

describe('Relay Catalog Service - getEntries', () => {
  beforeEach(() => {
    mockRelayCatalog.clear();
    vi.clearAllMocks();
  });

  it('should return an empty list when the catalog is empty', async () => {
    const entries = await relayCatalogService.getEntries();
    expect(entries).toEqual([]);
  });

  it('should return sorted results when catalog is populated', async () => {
    const now = Date.now();
    const entries: RelayCatalogEntry[] = [
      {
        url: 'wss://offline.com',
        hostname: 'offline.com',
        isUserAdded: false,
        isSeed: true,
        status: 'offline',
        createdAt: now,
        updatedAt: now,
      },
      {
        url: 'wss://seed-with-meta.com',
        hostname: 'seed-with-meta.com',
        isUserAdded: false,
        isSeed: true,
        status: 'online',
        metadata: { name: 'Seed' },
        createdAt: now,
        updatedAt: now,
      },
      {
        url: 'wss://discovered-with-meta.com',
        hostname: 'discovered-with-meta.com',
        isUserAdded: false,
        isSeed: false,
        status: 'online',
        metadata: { name: 'Discovered' },
        createdAt: now,
        updatedAt: now,
      },
      {
        url: 'wss://no-meta.com',
        hostname: 'no-meta.com',
        isUserAdded: false,
        isSeed: false,
        status: 'unknown',
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const entry of entries) {
      mockRelayCatalog.set(entry.url, entry);
    }

    const sorted = await relayCatalogService.getEntries();

    expect(sorted.length).toBe(4);
    expect(sorted[0]?.url).toBe('wss://seed-with-meta.com');
    expect(sorted[1]?.url).toBe('wss://discovered-with-meta.com');
    expect(sorted[2]?.url).toBe('wss://no-meta.com');
    expect(sorted[3]?.url).toBe('wss://offline.com');
  });

  it('should exclude invalid entries', async () => {
    const now = Date.now();
    mockRelayCatalog.set('invalid-scheme://relay.com', {
      url: 'invalid-scheme://relay.com',
      hostname: 'relay.com',
      isUserAdded: true,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });
    mockRelayCatalog.set('wss://valid.com', {
      url: 'wss://valid.com',
      hostname: 'valid.com',
      isUserAdded: true,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });

    const results = await relayCatalogService.getEntries();
    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe('wss://valid.com');
  });

  it('should not mutate underlying stored records', async () => {
    const now = Date.now();
    const entry: RelayCatalogEntry = {
      url: 'wss://immutable.com',
      hostname: 'immutable.com',
      isUserAdded: false,
      isSeed: true,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    };
    mockRelayCatalog.set(entry.url, entry);

    const results = await relayCatalogService.getEntries();
    expect(results.length).toBe(1);

    // @ts-expect-error - testing immutability via side-effect
    results[0].status = 'offline';

    // Verify stored record is unchanged
    expect(mockRelayCatalog.get('wss://immutable.com')?.status).toBe('online');
  });

  it('should sort deterministically by URL when scores are equal', async () => {
    const now = Date.now();
    mockRelayCatalog.set('wss://b.com', {
      url: 'wss://b.com',
      hostname: 'b.com',
      isUserAdded: true,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });
    mockRelayCatalog.set('wss://a.com', {
      url: 'wss://a.com',
      hostname: 'a.com',
      isUserAdded: true,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });

    const results = await relayCatalogService.getEntries();
    expect(results[0]?.url).toBe('wss://a.com');
    expect(results[1]?.url).toBe('wss://b.com');
  });

  it('should apply strict exclusion policy for default display', async () => {
    const now = Date.now();
    const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

    // 1. Offline with no metadata - exclude
    mockRelayCatalog.set('wss://offline-no-meta.com', {
      url: 'wss://offline-no-meta.com',
      hostname: 'offline-no-meta.com',
      isUserAdded: false,
      isSeed: false,
      status: 'offline',
      createdAt: now,
      updatedAt: now,
    });

    // 2. Online with no metadata but OLD - exclude
    mockRelayCatalog.set('wss://old-no-meta.com', {
      url: 'wss://old-no-meta.com',
      hostname: 'old-no-meta.com',
      isUserAdded: false,
      isSeed: false,
      status: 'online',
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    });

    // 3. IP-only - exclude
    mockRelayCatalog.set('wss://1.2.3.4', {
      url: 'wss://1.2.3.4',
      hostname: '1.2.3.4',
      isUserAdded: false,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });

    // 4. Stale offline (seen 40 days ago) - exclude even if it has metadata
    mockRelayCatalog.set('wss://stale-offline.com', {
      url: 'wss://stale-offline.com',
      hostname: 'stale-offline.com',
      isUserAdded: false,
      isSeed: false,
      status: 'offline',
      metadata: { name: 'Old' },
      lastSeen: fortyDaysAgo,
      createdAt: fortyDaysAgo,
      updatedAt: now,
    });

    // 5. Excessively long URL - exclude
    const longUrl = 'wss://' + 'a'.repeat(300) + '.com';
    mockRelayCatalog.set(longUrl, {
      url: longUrl,
      hostname: 'too-long.com',
      isUserAdded: false,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });

    // 6. Healthy: Online with metadata - keep
    mockRelayCatalog.set('wss://healthy.com', {
      url: 'wss://healthy.com',
      hostname: 'healthy.com',
      isUserAdded: false,
      isSeed: false,
      status: 'online',
      metadata: { name: 'Healthy' },
      createdAt: now,
      updatedAt: now,
    });

    // 7. Valuable: Seed even if offline - keep
    mockRelayCatalog.set('wss://seed-offline.com', {
      url: 'wss://seed-offline.com',
      hostname: 'seed-offline.com',
      isUserAdded: false,
      isSeed: true,
      status: 'offline',
      createdAt: now,
      updatedAt: now,
    });

    // 8. Valuable: User-added even if IP-only - keep
    mockRelayCatalog.set('wss://8.8.8.8', {
      url: 'wss://8.8.8.8',
      hostname: '8.8.8.8',
      isUserAdded: true,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });

    const results = await relayCatalogService.getEntries();
    const urls = results.map(r => r.url);

    expect(urls).not.toContain('wss://offline-no-meta.com');
    expect(urls).not.toContain('wss://old-no-meta.com');
    expect(urls).not.toContain('wss://1.2.3.4');
    expect(urls).not.toContain('wss://stale-offline.com');
    expect(urls).not.toContain(longUrl);

    expect(urls).toContain('wss://healthy.com');
    expect(urls).toContain('wss://seed-offline.com');
    expect(urls).toContain('wss://8.8.8.8');
  });

  it('should exclude malformed or restricted URLs', async () => {
    const now = Date.now();
    mockRelayCatalog.set('wss://', {
      url: 'wss://',
      hostname: '',
      isUserAdded: false,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });
    mockRelayCatalog.set('wss://.com', {
      url: 'wss://.com',
      hostname: '.com',
      isUserAdded: false,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });
    mockRelayCatalog.set('wss://localhost', {
      url: 'wss://localhost',
      hostname: 'localhost',
      isUserAdded: false,
      isSeed: false,
      status: 'online',
      createdAt: now,
      updatedAt: now,
    });

    const results = await relayCatalogService.getEntries();
    const urls = results.map(r => r.url);

    expect(urls).not.toContain('wss://');
    expect(urls).not.toContain('wss://.com');
    expect(urls).not.toContain('wss://localhost');
  });

  it('should prioritize based on metadata richness and source', async () => {
    const now = Date.now();
    mockRelayCatalog.clear();
    const entries: RelayCatalogEntry[] = [
      {
        url: 'wss://seed-rich.com',
        hostname: 'seed-rich.com',
        status: 'online',
        isSeed: true,
        isUserAdded: false,
        metadata: { name: 'Seed', description: 'Very rich' },
        createdAt: now,
        updatedAt: now,
      },
      {
        url: 'wss://user-added.com',
        hostname: 'user-added.com',
        status: 'online',
        isSeed: false,
        isUserAdded: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        url: 'wss://discovered-rich.com',
        hostname: 'discovered-rich.com',
        status: 'online',
        isSeed: false,
        isUserAdded: false,
        metadata: { name: 'Discovered', description: 'Rich' },
        createdAt: now,
        updatedAt: now,
      },
      {
        url: 'wss://discovered-poor.com',
        hostname: 'discovered-poor.com',
        status: 'online',
        isSeed: false,
        isUserAdded: false,
        metadata: { name: 'Poor' },
        createdAt: now,
        updatedAt: now,
      },
      {
        url: 'wss://discovered-nips-only.com',
        hostname: 'discovered-nips-only.com',
        status: 'online',
        isSeed: false,
        isUserAdded: false,
        metadata: { supported_nips: [1, 11] },
        createdAt: now,
        updatedAt: now,
      }
    ];

    for (const entry of entries) {
      mockRelayCatalog.set(entry.url, entry);
    }

    const results = await relayCatalogService.getEntries();
    const urls = results.map(r => r.url);

    expect(urls.indexOf('wss://seed-rich.com')).toBeLessThan(urls.indexOf('wss://user-added.com'));
    expect(urls.indexOf('wss://user-added.com')).toBeLessThan(urls.indexOf('wss://discovered-rich.com'));
    expect(urls.indexOf('wss://discovered-rich.com')).toBeLessThan(urls.indexOf('wss://discovered-poor.com'));
    expect(urls.indexOf('wss://discovered-poor.com')).toBeLessThan(urls.indexOf('wss://discovered-nips-only.com'));
  });
});
