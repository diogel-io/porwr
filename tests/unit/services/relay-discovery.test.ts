import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { relayCatalogService, DISCOVERY_STALENESS_THRESHOLD, METADATA_STALENESS_THRESHOLD } from '@/services/relay-catalog';
import type { RelayDiscoveryState, RelayCatalogEntry } from '@/types/relay';

// Mock the database
const mockRelayDiscoveryState = new Map<string, RelayDiscoveryState>();

vi.mock('@/services/database', () => {
  return {
    db: {
      relayDiscoveryState: {
        get: vi.fn(async (id: string) => mockRelayDiscoveryState.get(id)),
        add: vi.fn(async (state: RelayDiscoveryState) => {
          mockRelayDiscoveryState.set(state.id, state);
          return state.id;
        }),
        update: vi.fn(async (id: string, changes: Partial<RelayDiscoveryState>) => {
          const existing = mockRelayDiscoveryState.get(id);
          if (existing) {
            mockRelayDiscoveryState.set(id, { ...existing, ...changes });
          }
          return 1;
        }),
      },
      transaction: vi.fn(async (mode, tables, callback) => {
        return callback();
      }),
    },
  };
});

describe('Relay Catalog Service - Discovery State', () => {
  beforeEach(() => {
    mockRelayDiscoveryState.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should retrieve null if no state exists', async () => {
    const state = await relayCatalogService.getDiscoveryState('global');
    expect(state).toBeNull();
  });

  it('should update and retrieve discovery state', async () => {
    const now = Date.now();
    await relayCatalogService.updateDiscoveryState({
      isDiscoveryInProgress: true,
      lastGlobalDiscoveryAt: now,
    });

    const state = await relayCatalogService.getDiscoveryState('global');
    expect(state).toBeDefined();
    expect(state?.isDiscoveryInProgress).toBe(true);
    expect(state?.lastGlobalDiscoveryAt).toBe(now);
  });

  it('should create a new state if it doesn\'t exist during update', async () => {
    await relayCatalogService.updateDiscoveryState({ isDiscoveryInProgress: true });
    const state = await relayCatalogService.getDiscoveryState('global');
    expect(state?.id).toBe('global');
    expect(state?.isDiscoveryInProgress).toBe(true);
  });
});

describe('Relay Catalog Service - Staleness Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isDiscoveryStale', () => {
    it('should consider empty state as stale', () => {
      expect(relayCatalogService.isDiscoveryStale(null)).toBe(true);
    });

    it('should consider fresh discovery as not stale', () => {
      const now = Date.now();
      const state: RelayDiscoveryState = {
        id: 'global',
        isDiscoveryInProgress: false,
        lastGlobalDiscoveryAt: now - 1000, // 1 second ago
        updatedAt: now,
      };
      expect(relayCatalogService.isDiscoveryStale(state)).toBe(false);
    });

    it('should consider expired discovery as stale', () => {
      const now = Date.now();
      const state: RelayDiscoveryState = {
        id: 'global',
        isDiscoveryInProgress: false,
        lastGlobalDiscoveryAt: now - DISCOVERY_STALENESS_THRESHOLD - 1000,
        updatedAt: now,
      };
      expect(relayCatalogService.isDiscoveryStale(state)).toBe(true);
    });

    it('should consider state with no prior discovery as stale', () => {
      const state: RelayDiscoveryState = {
        id: 'global',
        isDiscoveryInProgress: false,
        updatedAt: Date.now(),
      };
      expect(relayCatalogService.isDiscoveryStale(state)).toBe(true);
    });

    it('should suppress refresh if discovery is in progress', () => {
      const now = Date.now();
      const state: RelayDiscoveryState = {
        id: 'global',
        isDiscoveryInProgress: true, // IN PROGRESS
        lastGlobalDiscoveryAt: now - DISCOVERY_STALENESS_THRESHOLD - 1000, // expired
        updatedAt: now,
      };
      expect(relayCatalogService.isDiscoveryStale(state)).toBe(false);
    });
  });

  describe('isMetadataStale', () => {
    const now = Date.now();
    const baseEntry: RelayCatalogEntry = {
      url: 'wss://relay.com',
      hostname: 'relay.com',
      isUserAdded: false,
      isSeed: true,
      status: 'online',
      createdAt: now,
      updatedAt: now,
      lastChecked: now,
    };

    it('should consider status "unknown" as stale', () => {
      const entry = { ...baseEntry, status: 'unknown' as const };
      expect(relayCatalogService.isMetadataStale(entry)).toBe(true);
    });

    it('should consider entry with no lastChecked as stale', () => {
      const entry = { ...baseEntry };
      delete entry.lastChecked;
      expect(relayCatalogService.isMetadataStale(entry)).toBe(true);
    });

    it('should consider fresh metadata as not stale', () => {
      const entry = { ...baseEntry, lastChecked: Date.now() - 1000 };
      expect(relayCatalogService.isMetadataStale(entry)).toBe(false);
    });

    it('should consider expired metadata as stale', () => {
      const entry = {
        ...baseEntry,
        lastChecked: Date.now() - METADATA_STALENESS_THRESHOLD - 1000,
      };
      expect(relayCatalogService.isMetadataStale(entry)).toBe(true);
    });

    it('should work independently from discovery staleness', () => {
        // This is more of a logical check that they use different thresholds and different state objects
        expect(DISCOVERY_STALENESS_THRESHOLD).not.toBe(METADATA_STALENESS_THRESHOLD);

        const state: RelayDiscoveryState = {
            id: 'global',
            isDiscoveryInProgress: false,
            lastGlobalDiscoveryAt: Date.now() - 1000, // fresh discovery
            updatedAt: Date.now(),
        };
        const entry: RelayCatalogEntry = {
            ...baseEntry,
            lastChecked: Date.now() - METADATA_STALENESS_THRESHOLD - 1000, // stale metadata
        };

        expect(relayCatalogService.isDiscoveryStale(state)).toBe(false);
        expect(relayCatalogService.isMetadataStale(entry)).toBe(true);
    });
  });
});
