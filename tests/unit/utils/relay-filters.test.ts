import { describe, it, expect } from 'vitest';
import type { RelayCatalogEntry } from '@/types/relay';
import { filterRelays } from '@/utils/relay-filters';

const mockRelays: RelayCatalogEntry[] = [
  {
    url: 'wss://zebra.relay.com',
    hostname: 'zebra.relay.com',
    status: 'online',
    isUserAdded: false,
    isSeed: false,
    createdAt: 0,
    updatedAt: 0,
    metadata: { name: 'Zebra Relay' },
  },
  {
    url: 'wss://apple.relay.com',
    hostname: 'apple.relay.com',
    status: 'online',
    isUserAdded: false,
    isSeed: false,
    createdAt: 0,
    updatedAt: 0,
    metadata: { name: 'Apple Relay', supported_nips: [50] },
  },
  {
    url: 'wss://search.example.com',
    hostname: 'search.example.com',
    status: 'online',
    isUserAdded: false,
    isSeed: false,
    createdAt: 0,
    updatedAt: 0,
    metadata: { name: 'Searchable Relay', supported_nips: [1, 50] },
  },
  {
    url: 'wss://nostr.v0l.me',
    hostname: 'nostr.v0l.me',
    status: 'online',
    isUserAdded: false,
    isSeed: false,
    createdAt: 0,
    updatedAt: 0,
    metadata: { name: 'Volme' },
  },
];

describe('relay-filters util', () => {
  it('should filter by text match in name', () => {
    const result = filterRelays(mockRelays, 'Zebra', false);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('wss://zebra.relay.com');
  });

  it('should filter by text match in hostname', () => {
    const result = filterRelays(mockRelays, 'v0l.me', false);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('wss://nostr.v0l.me');
  });

  it('should filter by text match in URL', () => {
    const result = filterRelays(mockRelays, 'wss://zebra', false);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('wss://zebra.relay.com');
  });

  it('should filter for search-capable (NIP-50) only', () => {
    const result = filterRelays(mockRelays, '', true);
    expect(result).toHaveLength(2);
    expect(result.some((r) => r.url === 'wss://apple.relay.com')).toBe(true);
    expect(result.some((r) => r.url === 'wss://search.example.com')).toBe(true);
  });

  it('should apply both text filter and NIP-50 toggle', () => {
    const result = filterRelays(mockRelays, 'apple', true);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('wss://apple.relay.com');
  });

  it('should return empty list when no matches found', () => {
    const result = filterRelays(mockRelays, 'no-match-at-all', false);
    expect(result).toHaveLength(0);
  });

  it('should preserve input order (canonical sorting is owned by background service)', () => {
    const result = filterRelays(mockRelays, '', false);
    expect(result).toHaveLength(4);
    // Should match mockRelays order exactly
    expect(result[0]!.url).toBe('wss://zebra.relay.com');
    expect(result[1]!.url).toBe('wss://apple.relay.com');
    expect(result[2]!.url).toBe('wss://search.example.com');
    expect(result[3]!.url).toBe('wss://nostr.v0l.me');
  });

  it('should be deterministic after filtering', () => {
    const result1 = filterRelays(mockRelays, 'relay', false);
    const result2 = filterRelays(mockRelays, 'relay', false);
    expect(result1).toEqual(result2);
  });
});
