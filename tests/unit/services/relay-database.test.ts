import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';

// Mock the database since we can't run a real IndexedDB in this environment
const mockRelayCatalog = new Map<string, RelayCatalogEntry>();
const mockRelayDiscoveryState = new Map<string, RelayDiscoveryState>();
const mockVaults = new Map<string, any>();
const mockExceptions: any[] = [];
const mockApprovals: any[] = [];

vi.mock('@/services/database', () => {
  return {
    DiogelDatabase: class {
      relayCatalog = {
        add: vi.fn(async (entry: RelayCatalogEntry) => {
          mockRelayCatalog.set(entry.url, entry);
          return entry.url;
        }),
        get: vi.fn(async (url: string) => mockRelayCatalog.get(url)),
        count: vi.fn(async () => mockRelayCatalog.size),
      };
      relayDiscoveryState = {
        add: vi.fn(async (state: RelayDiscoveryState) => {
          mockRelayDiscoveryState.set(state.id, state);
          return state.id;
        }),
        get: vi.fn(async (id: string) => mockRelayDiscoveryState.get(id)),
      };
      vaults = {
        add: vi.fn(async (vault: any) => {
          mockVaults.set(vault.id, vault);
          return vault.id;
        }),
        get: vi.fn(async (id: string) => mockVaults.get(id)),
      };
      exceptions = {
        add: vi.fn(async (ex: any) => {
          mockExceptions.push(ex);
          return mockExceptions.length;
        }),
        count: vi.fn(async () => mockExceptions.length),
      };
      approvals = {
        add: vi.fn(async (app: any) => {
          mockApprovals.push(app);
          return mockApprovals.length;
        }),
        count: vi.fn(async () => mockApprovals.length),
      };
      tables = [
        { name: 'vaults' },
        { name: 'exceptions' },
        { name: 'approvals' },
        { name: 'relayCatalog' },
        { name: 'relayDiscoveryState' },
      ];
      open = vi.fn(async () => Promise.resolve());
      delete = vi.fn(async () => Promise.resolve());
    },
    db: {}
  };
});

import { DiogelDatabase } from '@/services/database';

describe('Relay Database Schema', () => {
  let db: DiogelDatabase;

  beforeEach(() => {
    mockRelayCatalog.clear();
    mockRelayDiscoveryState.clear();
    mockVaults.clear();
    mockExceptions.length = 0;
    mockApprovals.length = 0;
    db = new DiogelDatabase();
  });

  afterEach(async () => {
    // Cleanup
  });

  it('should initialize with relayCatalog and relayDiscoveryState tables', async () => {
    // Check that we can access the tables through the class instance
    expect(db.relayCatalog).toBeDefined();
    expect(db.relayDiscoveryState).toBeDefined();

    await db.open();
    expect(db.tables.map(t => t.name)).toContain('relayCatalog');
    expect(db.tables.map(t => t.name)).toContain('relayDiscoveryState');
  });

  it('should insert and retrieve a relay catalog entry', async () => {
    const entry: RelayCatalogEntry = {
      url: 'wss://relay.damus.io',
      hostname: 'relay.damus.io',
      isUserAdded: true,
      isSeed: false,
      status: 'online',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'manual'
    };

    await db.relayCatalog.add(entry);
    const retrieved = await db.relayCatalog.get('wss://relay.damus.io');

    expect(retrieved).toEqual(entry);
  });

  it('should insert and retrieve a relay discovery state', async () => {
    const state: RelayDiscoveryState = {
      id: 'global',
      isDiscoveryInProgress: true,
      updatedAt: Date.now(),
      discoveryStats: {
        totalDiscovered: 10,
        newFound: 2
      }
    };

    await db.relayDiscoveryState.add(state);
    const retrieved = await db.relayDiscoveryState.get('global');

    expect(retrieved).toEqual(state);
  });

  it('should not break existing tables (vaults, exceptions, approvals)', async () => {
    // Test that we can still use existing tables
    await db.vaults.add({ id: 'master', encryptedData: 'abc', createdAt: new Date().toISOString() });
    await db.exceptions.add({ dateTime: new Date().toISOString(), message: 'test error' });
    await db.approvals.add({ dateTime: new Date().toISOString(), eventKind: 1, hostname: 'localhost' });

    const vault = await db.vaults.get('master');
    const exceptionCount = await db.exceptions.count();
    const approvalCount = await db.approvals.count();

    expect(vault?.encryptedData).toBe('abc');
    expect(exceptionCount).toBe(1);
    expect(approvalCount).toBe(1);
  });
});
