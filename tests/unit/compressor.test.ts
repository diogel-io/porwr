import { describe, it, expect } from 'vitest';
import type { StoredKey } from '@/types';
import generateKeyExportText from '@/services/compressor';

describe('Compressor Service', () => {
  const mockKey: StoredKey = {
    id: 'd7dd97609a56ed91811e72e90c8b3684a3b83f3e9c606354877e5e3477f15494', // hex public key
    alias: 'test-key',
    account: {
      privkey: '468d601b025a743419df948d3c1628d61f1c7d2424b94f9979d465355a29777d' // hex private key
    },
    createdAt: '2024-01-01T00:00:00.000Z'
  };

  it('should generate correctly formatted text for key export', () => {
    const text = generateKeyExportText(mockKey);

    expect(text).toContain('DIOGEL KEY BACKUP');
    expect(text).toContain('Alias: test-key');
    expect(text).toContain('Created At: 2024-01-01T00:00:00.000Z');
    expect(text).toContain('npub (Public Key):  npub16lwewcy62mkerqg7wt5sezeksj3ms0e7n3sxx4y80e0rgal32j2qp4x2av');
    expect(text).toContain('nsec (Private Key): nsec1g6xkqxcztf6rgxwljjxnc93g6c03clfyyju5lxte63jn2k3fwa7skrec3d');
  });

  it('should handle invalid keys gracefully', () => {
    const invalidKey: StoredKey = {
      ...mockKey,
      id: 'invalid-id',
      account: {
        privkey: 'invalid-privkey'
      }
    };

    const text = generateKeyExportText(invalidKey);
    expect(text).toContain('npub (Public Key):  Error');
    expect(text).toContain('nsec (Private Key): Error');
  });
});
