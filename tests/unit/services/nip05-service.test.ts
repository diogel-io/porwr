import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nip05Service, parseNip05Identifier } from '@/services/nip05-service';

describe('nip05-service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('parseNip05Identifier', () => {
    it('parses valid identifier', () => {
      expect(parseNip05Identifier('alice@example.com')).toEqual({
        name: 'alice',
        domain: 'example.com',
      });
    });

    it('rejects malformed identifier', () => {
      expect(parseNip05Identifier('alice')).toBeNull();
      expect(parseNip05Identifier('@example.com')).toBeNull();
      expect(parseNip05Identifier('alice@')).toBeNull();
      expect(parseNip05Identifier('alice@@example.com')).toBeNull();
    });
  });

  describe('verifyIdentifier', () => {
    const expectedPubkey = 'pubkey-hex-1';

    it('returns malformed for malformed identifier', async () => {
      const result = await nip05Service.verifyIdentifier('invalid', expectedPubkey);
      expect(result.status).toBe('malformed');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns verified when names mapping matches expected pubkey', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({ names: { alice: expectedPubkey } }),
      } as Response);

      const result = await nip05Service.verifyIdentifier('alice@example.com', expectedPubkey);

      expect(result.status).toBe('verified');
      expect(result.actualPubkey).toBe(expectedPubkey);
      expect(fetch).toHaveBeenCalledWith('https://example.com/.well-known/nostr.json?name=alice', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });
    });

    it('returns pubkey-mismatch when mapped key differs from expected', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({ names: { alice: 'different-pubkey' } }),
      } as Response);

      const result = await nip05Service.verifyIdentifier('alice@example.com', expectedPubkey);

      expect(result.status).toBe('pubkey-mismatch');
      expect(result.actualPubkey).toBe('different-pubkey');
      expect(result.expectedPubkey).toBe(expectedPubkey);
    });

    it('returns not-found when name does not exist in names map', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({ names: { bob: expectedPubkey } }),
      } as Response);

      const result = await nip05Service.verifyIdentifier('alice@example.com', expectedPubkey);
      expect(result.status).toBe('not-found');
    });

    it('returns invalid-response when json shape is invalid', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({ bad: 'shape' }),
      } as Response);

      const result = await nip05Service.verifyIdentifier('alice@example.com', expectedPubkey);
      expect(result.status).toBe('invalid-response');
    });

    it('returns network-error for fetch or json errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('network failed'));

      const result = await nip05Service.verifyIdentifier('alice@example.com', expectedPubkey);
      expect(result.status).toBe('network-error');
      expect(result.message).toBe('network failed');
    });
  });
});
