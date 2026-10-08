import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import type { Event, Filter, SimplePool } from 'nostr-tools';

const storage = vi.hoisted(() => ({ fallback: undefined as unknown }));

vi.mock('@/services/storage-service', () => ({
  FALLBACK_RELAYS: 'nostr:fallback-relays',
  storageService: { get: vi.fn(() => Promise.resolve(storage.fallback)) },
}));

import {
  MessagingRelays,
  buildDmRelayListTemplate,
  getFallbackRelays,
  parseDmRelayList,
  parseWriteRelays,
  validateDmRelays,
} from '@/../src-bex/services/messaging-relays';
import { RELAY_SEEDS } from '@/data/relay-seeds';

const FALLBACK = ['wss://fallback.one', 'wss://fallback.two'];

function fakePool(events: { relayList?: Partial<Event> | null; dmList?: Partial<Event> | null } = {}) {
  const get = vi.fn((_relays: string[], filter: Filter) => {
    const kind = filter.kinds?.[0];
    if (kind === 10002) return Promise.resolve(events.relayList ?? null);
    if (kind === 10050) return Promise.resolve(events.dmList ?? null);
    return Promise.resolve(null);
  });
  const publish = vi.fn((relays: string[], _event?: Event, _params?: { onauth?: unknown }) =>
    relays.map((url) => (url.includes('down') ? Promise.reject(new Error('connection failed')) : Promise.resolve('ok'))),
  );
  const destroy = vi.fn();
  return { pool: { get, publish, destroy } as unknown as SimplePool, get, publish, destroy };
}

beforeEach(() => {
  storage.fallback = FALLBACK;
});

describe('getFallbackRelays', () => {
  it('reads the stored fallback relays', async () => {
    await expect(getFallbackRelays()).resolves.toEqual(FALLBACK);
  });

  it('uses the relay seeds when nothing usable is stored', async () => {
    storage.fallback = ['not a relay'];
    await expect(getFallbackRelays()).resolves.toEqual(
      expect.arrayContaining([expect.stringMatching(/^wss:\/\//)]),
    );
    expect((await getFallbackRelays()).length).toBeLessThanOrEqual(RELAY_SEEDS.length);
  });
});

describe('parsing', () => {
  it('reads relay tags in published order, normalised and de-duplicated', () => {
    expect(
      parseDmRelayList({
        tags: [
          ['relay', 'wss://inbox.example'],
          ['r', 'wss://ignored.example'],
          ['relay', 'wss://second.example/'],
          ['relay', 'wss://inbox.example'],
          ['relay', 'https://not-a-relay.example'],
        ],
      }),
    ).toEqual(['wss://inbox.example', 'wss://second.example']);
  });

  it('reads NIP-65 write relays: unmarked and write-marked r tags only', () => {
    expect(
      parseWriteRelays({
        tags: [
          ['r', 'wss://both.example'],
          ['r', 'wss://write.example', 'write'],
          ['r', 'wss://read.example', 'read'],
        ],
      }),
    ).toEqual(['wss://both.example', 'wss://write.example']);
  });

  it('builds a kind 10050 template with one relay tag per relay', () => {
    expect(buildDmRelayListTemplate(['wss://a.example', 'wss://b.example'], 100)).toEqual({
      kind: 10050,
      created_at: 100,
      tags: [
        ['relay', 'wss://a.example'],
        ['relay', 'wss://b.example'],
      ],
      content: '',
    });
  });
});

describe('validateDmRelays', () => {
  it('rejects the whole list when any entry is not a relay URL', () => {
    const result = validateDmRelays(['wss://ok.example', 'https://web.example']);
    expect(result.valid).toBe(false);
  });

  it('normalises and de-duplicates a valid list, keeping order', () => {
    expect(validateDmRelays(['wss://b.example/', 'wss://a.example', 'wss://b.example'])).toEqual({
      valid: true,
      relays: ['wss://b.example', 'wss://a.example'],
    });
  });

  it('accepts an empty list, which tells senders not to message this account', () => {
    expect(validateDmRelays([])).toEqual({ valid: true, relays: [] });
  });
});

describe('MessagingRelays', () => {
  it('returns the newest kind 10050, looking on the fallback and NIP-65 write relays', async () => {
    const { pool, get } = fakePool({
      relayList: { tags: [['r', 'wss://write.example', 'write']] },
      dmList: { created_at: 1_700_000_000, tags: [['relay', 'wss://inbox.example']] },
    });

    await expect(new MessagingRelays(() => pool).fetchDmRelays('a'.repeat(64))).resolves.toEqual({
      relays: ['wss://inbox.example'],
      updatedAt: 1_700_000_000,
    });

    const dmCall = get.mock.calls.find(([, filter]) => filter.kinds?.[0] === 10050)!;
    expect(dmCall[0]).toEqual([...FALLBACK, 'wss://write.example']);
    expect(dmCall[1]).toEqual({ kinds: [10050], authors: ['a'.repeat(64)] });
  });

  it('reports no list when the user has never published one', async () => {
    const { pool } = fakePool();
    await expect(new MessagingRelays(() => pool).fetchDmRelays('a'.repeat(64))).resolves.toEqual({
      relays: [],
      updatedAt: null,
    });
  });

  it('signs a kind 10050 with the given key and spreads it to every relay that should hold it', async () => {
    const secretKey = generateSecretKey();
    const { pool, publish, destroy } = fakePool({ relayList: { tags: [['r', 'wss://write.example']] } });

    const result = await new MessagingRelays(() => pool).publishDmRelays(secretKey, [
      'wss://inbox.example',
      'wss://down.example',
    ]);

    const [targets, event] = publish.mock.calls[0]! as unknown as [string[], Event];
    expect(targets).toEqual([...FALLBACK, 'wss://write.example', 'wss://inbox.example', 'wss://down.example']);
    expect(event.kind).toBe(10050);
    expect(event.pubkey).toBe(getPublicKey(secretKey));
    expect(event.tags).toEqual([
      ['relay', 'wss://inbox.example'],
      ['relay', 'wss://down.example'],
    ]);
    expect(verifyEvent(event)).toBe(true);

    expect(result.relays).toEqual(['wss://inbox.example', 'wss://down.example']);
    expect(result.accepted).toEqual([...FALLBACK, 'wss://write.example', 'wss://inbox.example']);
    expect(result.rejected).toEqual([{ url: 'wss://down.example', reason: 'connection failed' }]);

    // Inbox relays may want NIP-42 AUTH; the connection that authenticates is closed afterwards.
    const params = publish.mock.calls[0]![2] as unknown as { onauth: (t: object) => Promise<Event> };
    const auth = await params.onauth({ kind: 22242, created_at: 1, tags: [], content: '' });
    expect(auth.pubkey).toBe(getPublicKey(secretKey));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('reuses a looked-up list for a while, then looks again', async () => {
    let clock = 0;
    const { pool, get } = fakePool({ dmList: { created_at: 1, tags: [['relay', 'wss://inbox.example']] } });
    const relays = new MessagingRelays(() => pool, () => clock);

    await relays.lookupDmRelays('a'.repeat(64));
    await relays.lookupDmRelays('a'.repeat(64));
    expect(get.mock.calls.filter(([, f]) => f.kinds?.[0] === 10050)).toHaveLength(1);

    clock = 11 * 60 * 1000;
    await relays.lookupDmRelays('a'.repeat(64));
    expect(get.mock.calls.filter(([, f]) => f.kinds?.[0] === 10050)).toHaveLength(2);
  });
});
