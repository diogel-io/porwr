import { describe, expect, it, vi, beforeEach } from 'vitest';
import { nip04 } from 'nostr-tools';

/* eslint-disable @typescript-eslint/unbound-method */

import type { Nip47Connection } from '@/types/nip47';

const { mockPoolInstance } = vi.hoisted(() => ({
  mockPoolInstance: {
    publish: vi.fn(),
    subscribe: vi.fn(),
    get: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock('nostr-tools', () => ({
  SimplePool: vi.fn().mockImplementation(function SimplePool() {
    return mockPoolInstance;
  }),
  finalizeEvent: vi.fn(() => ({ id: 'event-id', pubkey: 'client-pubkey', sig: 'sig' })),
  getPublicKey: vi.fn(() => 'client-pubkey'),
  nip04: {
    encrypt: vi.fn(() => 'encrypted-request'),
    decrypt: vi.fn(),
  },
}));

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn(() => new Uint8Array(32)),
}));

function buildConnection(): Nip47Connection {
  return {
    id: 'wallet-a',
    label: 'Wallet A',
    walletServicePubkey: 'wallet-service-pubkey',
    clientSecret: '00'.repeat(32),
    clientPubkey: 'client-pubkey',
    relays: ['wss://relay.example.com/'],
    capabilities: [],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    isActive: true,
  };
}

describe('Nip47Client.sendRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels the pending response subscription when publish fails on every relay', async () => {
    const closeSpy = vi.fn();
    mockPoolInstance.subscribe.mockReturnValue({ close: closeSpy });
    const publishFailure = Promise.reject(new Error('relay unreachable'));
    publishFailure.catch(() => undefined);
    mockPoolInstance.publish.mockReturnValue([publishFailure]);

    const { Nip47Client } = await import('@/../src-bex/services/nip47-client');
    const client = new Nip47Client();

    await expect(client.sendRequest(buildConnection(), { method: 'get_balance', params: {} })).rejects.toThrow(
      'Failed to publish NIP-47 request to any relay',
    );

    expect(closeSpy).toHaveBeenCalled();
  });

  it('resolves with the wallet response once a matching relay event is published successfully', async () => {
    let onEvent: ((event: { pubkey: string; tags: string[][]; content: string }) => void) | undefined;
    mockPoolInstance.subscribe.mockImplementation(
      (
        _relays: string[],
        _filter: unknown,
        opts: { onevent: (event: { pubkey: string; tags: string[][]; content: string }) => void },
      ) => {
        onEvent = opts.onevent;
        return { close: vi.fn() };
      },
    );
    mockPoolInstance.publish.mockReturnValue([Promise.resolve('ok')]);
    vi.mocked(nip04.decrypt).mockReturnValue(JSON.stringify({ result: { balance: 1000 } }));

    const { Nip47Client } = await import('@/../src-bex/services/nip47-client');
    const client = new Nip47Client();

    const requestPromise = client.sendRequest(buildConnection(), { method: 'get_balance', params: {} });

    onEvent?.({ pubkey: 'wallet-service-pubkey', tags: [['e', 'event-id']], content: 'encrypted-response' });

    const response = await requestPromise;
    expect(response.result).toEqual({ balance: 1000 });
  });
});
