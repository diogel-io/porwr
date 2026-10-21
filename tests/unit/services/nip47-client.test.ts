import { describe, expect, it, vi, beforeEach } from 'vitest';
import { finalizeEvent, nip04, nip44 } from 'nostr-tools';

/* eslint-disable @typescript-eslint/unbound-method */

import type { Nip47Connection } from '@/types/nip47';

const { mockPoolInstance } = vi.hoisted(() => ({
  mockPoolInstance: {
    publish: vi.fn(),
    subscribe: vi.fn(),
    get: vi.fn(),
    querySync: vi.fn(),
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
  nip44: {
    getConversationKey: vi.fn(() => new Uint8Array(32).fill(7)),
    encrypt: vi.fn(() => 'nip44-request'),
    decrypt: vi.fn(),
  },
}));

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn(() => new Uint8Array(32)),
}));

function buildConnection(): Nip47Connection {
  return {
    id: 'wallet-a',
    accountPubkey: 'a'.repeat(64),
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

    await expect(
      client.sendRequest(buildConnection(), { method: 'get_balance', params: {} }),
    ).rejects.toThrow('Failed to publish NIP-47 request to any relay');

    expect(closeSpy).toHaveBeenCalled();
  });

  it('resolves with the wallet response once a matching relay event is published successfully', async () => {
    let onEvent:
      ((event: { pubkey: string; tags: string[][]; content: string }) => void) | undefined;
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

    const requestPromise = client.sendRequest(buildConnection(), {
      method: 'get_balance',
      params: {},
    });

    onEvent?.({
      pubkey: 'wallet-service-pubkey',
      tags: [['e', 'event-id']],
      content: 'encrypted-response',
    });

    const response = await requestPromise;
    expect(response.result).toEqual({ balance: 1000 });
  });
});

describe('NIP-47 encryption negotiation (diogel-io/workspace#142, T22)', () => {
  type RelayEvent = { pubkey: string; tags: string[][]; content: string };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function roundTrip(encryption: string[] | undefined) {
    let onEvent: ((event: RelayEvent) => void) | undefined;
    mockPoolInstance.subscribe.mockImplementation(
      (_relays: string[], _filter: unknown, opts: { onevent: (event: RelayEvent) => void }) => {
        onEvent = opts.onevent;
        return { close: vi.fn() };
      },
    );
    mockPoolInstance.publish.mockReturnValue([Promise.resolve('ok')]);
    const reply = JSON.stringify({ result: { balance: 42 } });
    vi.mocked(nip04.decrypt).mockReturnValue(reply);
    vi.mocked(nip44.decrypt).mockReturnValue(reply);

    const { Nip47Client } = await import('@/../src-bex/services/nip47-client');
    const pending = new Nip47Client().sendRequest(
      { ...buildConnection(), ...(encryption ? { encryption } : {}) },
      { method: 'get_balance', params: {} },
    );
    onEvent?.({ pubkey: 'wallet-service-pubkey', tags: [['e', 'event-id']], content: 'reply' });
    const response = await pending;
    const template = vi.mocked(finalizeEvent).mock.calls[0]![0] as {
      tags: string[][];
      content: string;
    };
    return { response, template };
  }

  it('uses NIP-44 and tags the request when the wallet advertises nip44_v2', async () => {
    const { response, template } = await roundTrip(['nip44_v2', 'nip04']);

    expect(nip44.encrypt).toHaveBeenCalledTimes(1);
    expect(nip04.encrypt).not.toHaveBeenCalled();
    expect(template.content).toBe('nip44-request');
    expect(template.tags).toContainEqual(['encryption', 'nip44_v2']);
    expect(nip44.decrypt).toHaveBeenCalledWith('reply', expect.any(Uint8Array));
    expect(nip04.decrypt).not.toHaveBeenCalled();
    expect(response.result).toEqual({ balance: 42 });
  });

  it.each([
    ['the info event had no encryption tag', []],
    ['the wallet lists nip04 only', ['nip04']],
    ['the info event has not been read', undefined],
  ])('uses NIP-04 with no encryption tag when %s', async (_case, encryption) => {
    const { response, template } = await roundTrip(encryption);

    expect(nip04.encrypt).toHaveBeenCalledTimes(1);
    expect(nip44.encrypt).not.toHaveBeenCalled();
    expect(template.tags.map(([name]) => name)).not.toContain('encryption');
    expect(nip04.decrypt).toHaveBeenCalled();
    expect(nip44.decrypt).not.toHaveBeenCalled();
    expect(response.result).toEqual({ balance: 42 });
  });

  it('selects the scheme as NIP-47 says', async () => {
    const { selectNip47Encryption } = await import('@/../src-bex/services/nip47-client');

    expect(selectNip47Encryption(['nip04', 'nip44_v2'])).toBe('nip44_v2');
    expect(selectNip47Encryption(['nip04'])).toBe('nip04');
    expect(selectNip47Encryption([])).toBe('nip04');
    expect(selectNip47Encryption(undefined)).toBe('nip04');
  });
});

describe('wallet relays (diogel-io/workspace#142, T19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps wss:// and loopback ws:// relays, and refuses a list with neither', async () => {
    const { allowedWalletRelays, NIP47_NO_ALLOWED_RELAYS } =
      await import('@/../src-bex/services/nip47-client');

    expect(
      allowedWalletRelays({
        relays: ['ws://relay.example.com/', 'wss://relay.example.com/', 'ws://localhost:7777/'],
      }),
    ).toEqual(['wss://relay.example.com/', 'ws://localhost:7777/']);
    expect(() => allowedWalletRelays({ relays: ['ws://relay.example.com/', 'nonsense'] })).toThrow(
      NIP47_NO_ALLOWED_RELAYS,
    );
  });

  it('never asks or publishes to a plaintext relay a stored connection still names', async () => {
    mockPoolInstance.querySync.mockResolvedValue([]);
    mockPoolInstance.subscribe.mockReturnValue({ close: vi.fn() });
    mockPoolInstance.publish.mockReturnValue([Promise.reject(new Error('stop'))]);
    const { Nip47Client } = await import('@/../src-bex/services/nip47-client');
    const client = new Nip47Client();
    const connection = {
      ...buildConnection(),
      relays: ['ws://relay.example.com/', 'wss://relay.example.com/'],
    };

    await client.getInfo(connection).catch(() => undefined);
    await client
      .sendRequest(connection, { method: 'get_balance', params: {} })
      .catch(() => undefined);

    expect(mockPoolInstance.querySync.mock.calls[0]![0]).toEqual(['wss://relay.example.com/']);
    expect(mockPoolInstance.publish.mock.calls[0]![0]).toEqual(['wss://relay.example.com/']);
    expect(mockPoolInstance.subscribe.mock.calls[0]![0]).toEqual(['wss://relay.example.com/']);
  });
});

describe('Nip47Client.getInfo (diogel-io/workspace#142)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('negotiates from the newest info event any relay holds', async () => {
    mockPoolInstance.querySync.mockResolvedValue([
      { pubkey: 'w', created_at: 100, content: 'pay_invoice', tags: [['encryption', 'nip04']] },
      {
        pubkey: 'w',
        created_at: 200,
        content: 'pay_invoice get_balance',
        tags: [['encryption', 'nip44_v2 nip04']],
      },
      { pubkey: 'w', created_at: 150, content: 'pay_invoice', tags: [] },
    ]);
    const { Nip47Client } = await import('@/../src-bex/services/nip47-client');

    const info = await new Nip47Client().getInfo({
      ...buildConnection(),
      relays: ['wss://a.example/', 'wss://b.example/'],
    });

    expect(info.encryption).toEqual(['nip44_v2', 'nip04']);
    expect(info.capabilities).toEqual(['pay_invoice', 'get_balance']);
    expect(mockPoolInstance.querySync.mock.calls[0]![0]).toEqual([
      'wss://a.example/',
      'wss://b.example/',
    ]);
  });

  it('reports no info event when no relay holds one', async () => {
    mockPoolInstance.querySync.mockResolvedValue([]);
    const { Nip47Client } = await import('@/../src-bex/services/nip47-client');

    await expect(new Nip47Client().getInfo(buildConnection())).rejects.toThrow(
      'No NIP-47 wallet info event',
    );
  });
});
