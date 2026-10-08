import { describe, it, expect, vi } from 'vitest';
import {
  extractWritePreferredRelayUrls,
  parseRelayListEntries,
  parseRelayListEvent,
  normalizeAndDeduplicateRelays,
  relayDiscoveryService,
} from '@/services/relay-discovery';
import type { Event } from 'nostr-tools';

// Mock nostr-tools
vi.mock('nostr-tools', () => {
  const querySyncMock = vi.fn().mockResolvedValue([
    {
      kind: 10002,
      id: 'event1',
      tags: [['r', 'wss://relay1.com']],
      pubkey: 'pk1'
    },
    {
      kind: 10002,
      id: 'event2',
      tags: [['r', 'wss://relay2.com']],
      pubkey: 'pk2'
    }
  ]);

  return {
    SimplePool: vi.fn().mockImplementation(function() {
      return {
        querySync: querySyncMock,
        close: vi.fn()
      };
    })
  };
});

describe('RelayDiscoveryService Parsing and Extraction Logic', () => {

  describe('parseRelayListEvent', () => {
    it('should extract URLs from valid kind 10002 event', () => {
      const mockEvent = {
        kind: 10002,
        tags: [
          ['r', 'wss://relay1.com', 'read'],
          ['r', 'wss://relay2.com', 'write'],
          ['r', 'wss://relay3.com'],
          ['p', 'another-pubkey'], // non-r tag
        ],
        pubkey: 'pubkey1'
      };

      const result = parseRelayListEvent(mockEvent as Event);

      expect(result).toEqual([
        'wss://relay1.com',
        'wss://relay2.com',
        'wss://relay3.com'
      ]);
    });

    it('should ignore non-r tags and malformed tags', () => {
      const mockEvent = {
        kind: 10002,
        tags: [
          ['r', 'wss://relay1.com'],
          ['not-r', 'wss://relay2.com'],
          ['r'], // missing URL
          ['r', 123], // URL not a string
          null as any,
          [],
        ],
        pubkey: 'pubkey1'
      };

      const result = parseRelayListEvent(mockEvent as Event);

      expect(result).toEqual(['wss://relay1.com']);
    });

    it('should return empty array for non-kind-10002 event', () => {
      const mockEvent = {
        kind: 1,
        content: 'hello',
        tags: [['r', 'wss://relay1.com']],
        pubkey: 'pubkey1'
      };

      const result = parseRelayListEvent(mockEvent as Event);

      expect(result).toEqual([]);
    });

    it('should return empty array for malformed event object', () => {
      expect(parseRelayListEvent(null as any)).toEqual([]);
      expect(parseRelayListEvent({} as any)).toEqual([]);
      expect(parseRelayListEvent({ kind: 10002 } as any)).toEqual([]); // missing tags
    });
  });

  describe('parseRelayListEntries', () => {
    it('maps read/write marker semantics from kind 10002 r-tags', () => {
      const mockEvent = {
        kind: 10002,
        tags: [
          ['r', 'wss://read.example', 'read'],
          ['r', 'wss://write.example', 'write'],
          ['r', 'wss://both.example'],
        ],
      } as Event;

      expect(parseRelayListEntries(mockEvent)).toEqual([
        { url: 'wss://read.example', read: true, write: false },
        { url: 'wss://write.example', read: false, write: true },
        { url: 'wss://both.example', read: true, write: true },
      ]);
    });
  });

  describe('extractWritePreferredRelayUrls', () => {
    it('returns only write-capable relays when at least one write marker exists', () => {
      const mockEvent = {
        kind: 10002,
        tags: [
          ['r', 'wss://read.example', 'read'],
          ['r', 'wss://write.example', 'write'],
        ],
      } as Event;

      expect(extractWritePreferredRelayUrls(mockEvent)).toEqual(['wss://write.example']);
    });

    it('falls back to all valid relays when no write-capable markers exist', () => {
      const mockEvent = {
        kind: 10002,
        tags: [
          ['r', 'wss://read.example', 'read'],
          ['r', 'bad-url', 'read'],
        ],
      } as Event;

      expect(extractWritePreferredRelayUrls(mockEvent)).toEqual(['wss://read.example']);
    });
  });

  describe('normalizeAndDeduplicateRelays', () => {
    it('should normalize and deduplicate URLs', () => {
      const urls = [
        'wss://relay1.com/',
        'wss://relay1.com', // same after normalization
        'wss://relay2.com/path/',
        'wss://RELAY2.com/path', // same after normalization
        'invalid-url',
        'https://relay3.com', // invalid protocol (not ws/wss)
        'wss://relay1.com' // duplicate
      ];

      const result = normalizeAndDeduplicateRelays(urls);

      expect(result).toEqual([
        'wss://relay1.com',
        'wss://relay2.com/path'
      ]);
    });

    it('should handle empty input gracefully', () => {
      expect(normalizeAndDeduplicateRelays([])).toEqual([]);
    });
  });

  describe('relayDiscoveryService.processEvents', () => {
    it('should process multiple kind 10002 events and return unique normalized URLs', () => {
      const event1 = {
        kind: 10002,
        tags: [
          ['r', 'wss://relay1.com/'],
          ['r', 'wss://relay2.com'],
        ],
        pubkey: 'pubkey1'
      };
      const event2 = {
        kind: 10002,
        tags: [
          ['r', 'wss://relay2.com/'],
          ['r', 'wss://relay3.com'],
        ],
        pubkey: 'pubkey2'
      };
      const event3 = { kind: 1, content: 'ignore me' };

      const result = relayDiscoveryService.processEvents([event1, event2, event3] as Event[]);

      expect(result.discoveredUrls).toEqual([
        'wss://relay1.com',
        'wss://relay2.com',
        'wss://relay3.com'
      ]);
      expect(result.processedEvents).toBe(2);
      expect(result.errors).toEqual([]);
    });

    it('should handle malformed events safely in a batch', () => {
      const events = [
        { kind: 10002, tags: [['r', 'wss://relay1.com']] },
        null,
        { kind: 10002, tags: [['r', 'wss://relay2.com']] },
      ];

      const result = relayDiscoveryService.processEvents(events as any as Event[]);

      expect(result.discoveredUrls).toEqual([
        'wss://relay1.com',
        'wss://relay2.com'
      ]);
      expect(result.processedEvents).toBe(2);
    });
  });

  describe('relayDiscoveryService.discoverFromRelays', () => {
    it('should query relays and return discovered URLs', async () => {
      const seedRelays = ['wss://seed1.com', 'wss://seed2.com'];
      const result = await relayDiscoveryService.discoverFromRelays(seedRelays);

      expect(result.discoveredUrls).toEqual([
        'wss://relay1.com',
        'wss://relay2.com'
      ]);
      expect(result.processedEvents).toBe(2);
      expect(result.errors).toEqual([]);
    });

    it('should handle query failures gracefully', async () => {
      // Access the mock pool instance and make it throw
      const { SimplePool } = await import('nostr-tools');
      const poolInstance = (SimplePool as any).mock.results[0].value;
      // Since querySyncMock is reused, we need to mock its next call
      poolInstance.querySync.mockRejectedValueOnce(new Error('Network error'));

      const result = await relayDiscoveryService.discoverFromRelays(['wss://seed1.com']);

      expect(result.errors[0]).toContain('Discovery query failed: Network error');
    });
  });
});
