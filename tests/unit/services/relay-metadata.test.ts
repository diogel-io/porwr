import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNip11Url, fetchRelayMetadata } from '@/services/relay-metadata';

describe('Relay Metadata Service', () => {
  describe('getNip11Url', () => {
    it('should convert wss:// to https://', () => {
      expect(getNip11Url('wss://relay.damus.io')).toBe('https://relay.damus.io/');
    });

    it('should convert ws:// to http://', () => {
      expect(getNip11Url('ws://localhost:8080')).toBe('http://localhost:8080/');
    });

    it('should handle paths correctly', () => {
      expect(getNip11Url('wss://relay.damus.io/path')).toBe('https://relay.damus.io/path');
    });

    it('should throw for invalid URLs', () => {
      expect(() => getNip11Url('not-a-url')).toThrow('Invalid relay URL');
    });

    it('should throw for unsupported protocols', () => {
      expect(() => getNip11Url('gopher://relay.com')).toThrow('Invalid relay URL');
    });
  });

  describe('fetchRelayMetadata', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    it('should return successful metadata mapping', async () => {
      const mockMetadata = {
        name: 'Damus Relay',
        description: 'A relay for Damus',
        pubkey: 'pk123',
        contact: 'contact@damus.io',
        supported_nips: [1, 11, 20],
        software: 'nostr-rs-relay',
        version: '0.8.1',
        extra_field: 'extra',
      };

      (vi.mocked(fetch) as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetadata,
      });

      const result = await fetchRelayMetadata('wss://relay.damus.io');

      expect(result.success).toBe(true);
      expect(result.url).toBe('wss://relay.damus.io');
      expect(result.metadata).toEqual({
        name: 'Damus Relay',
        description: 'A relay for Damus',
        pubkey: 'pk123',
        contact: 'contact@damus.io',
        supported_nips: [1, 11, 20],
        software: 'nostr-rs-relay',
        version: '0.8.1',
        extra_field: 'extra',
      });
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle timeout correctly', async () => {
      (vi.mocked(fetch) as any).mockImplementationOnce(() => {
        return new Promise((resolve, reject) => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 10);
        });
      });

      const result = await fetchRelayMetadata('wss://relay.damus.io', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout after 5ms');
    });

    it('should handle HTTP error responses', async () => {
      (vi.mocked(fetch) as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await fetchRelayMetadata('wss://relay.damus.io');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP error 404: Not Found');
    });

    it('should handle malformed JSON safely', async () => {
      (vi.mocked(fetch) as any).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Unexpected token');
        },
      });

      const result = await fetchRelayMetadata('wss://relay.damus.io');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected token');
    });

    it('should handle non-object JSON responses', async () => {
        (vi.mocked(fetch) as any).mockResolvedValueOnce({
          ok: true,
          json: async () => ['not', 'an', 'object'],
        });

        const result = await fetchRelayMetadata('wss://relay.damus.io');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid NIP-11 response: expected JSON object');
      });

    it('should handle missing or weird fields in mapping', async () => {
      const mockMetadata = {
        name: 123, // should be ignored as it's not a string
        supported_nips: ['1', 'invalid', 2], // should be mapped to [1, 2]
      };

      (vi.mocked(fetch) as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetadata,
      });

      const result = await fetchRelayMetadata('wss://relay.damus.io');

      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBeUndefined();
      expect(result.metadata?.supported_nips).toEqual([1, 2]);
    });

    it('should fail cleanly for invalid relay URLs', async () => {
      const result = await fetchRelayMetadata('invalid-url');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid relay URL');
    });
  });
});
