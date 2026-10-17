import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import type { Event, Filter, SimplePool } from 'nostr-tools';
import type { SubscribeManyParams } from 'nostr-tools/abstract-pool';

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
  parseNip07RelayMap,
  parseWriteRelays,
  validateDmRelays,
  withDeadline,
} from '@/../src-bex/services/messaging-relays';
import { RELAY_SEEDS } from '@/data/relay-seeds';

const FALLBACK = ['wss://fallback.one', 'wss://fallback.two'];

/**
 * A pool whose relays answer by URL: `slow` relays never answer, `down` ones fail to connect, and the
 * rest answer at once. `dmListOn` limits which relays hold the kind 10050.
 *
 * A `down` relay is reported as nostr-tools reports it: `oneose` and then, at once, `onclose`.
 */
function fakePool(
  events: {
    relayList?: Partial<Event> | null;
    dmList?: Partial<Event> | null;
    dmListOn?: (url: string) => boolean;
  } = {},
) {
  const subscribeMany = vi.fn((relays: string[], filter: Filter, params: SubscribeManyParams) => {
    const url = relays[0]!;
    const kind = filter.kinds?.[0];
    if (!url.includes('slow')) {
      void Promise.resolve().then(() => {
        if (url.includes('down')) {
          params.oneose?.();
          params.onclose?.([{ url, reason: 'connection timed out' }]);
          return;
        }
        const event =
          kind === 10002
            ? events.relayList
            : kind === 10050 && (events.dmListOn?.(url) ?? true)
              ? events.dmList
              : null;
        if (event) params.onevent?.(event as Event);
        params.oneose?.();
      });
    }
    return { close: vi.fn() };
  });
  const publish = vi.fn(
    (relays: string[], _event?: Event, _params?: { onauth?: unknown; abort?: AbortSignal }) =>
      relays.map((url) => {
        if (url.includes('slow')) return new Promise<string>(() => {});
        if (url.includes('unreachable'))
          return Promise.reject('connection failure: Error: connection timed out');
        if (url.includes('down')) return Promise.reject(new Error('connection failed'));
        return Promise.resolve('');
      }),
  );
  const destroy = vi.fn();
  const pool = { subscribeMany, publish, destroy } as unknown as SimplePool;
  /** The relays asked for `kind`, in the order they were asked. */
  const askedFor = (kind: number) =>
    subscribeMany.mock.calls
      .filter(([, filter]) => filter.kinds?.[0] === kind)
      .map(([relays]) => relays[0]);
  return { pool, subscribeMany, publish, destroy, askedFor };
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
    const { pool, askedFor } = fakePool({
      relayList: { tags: [['r', 'wss://write.example', 'write']] },
      dmList: { created_at: 1_700_000_000, tags: [['relay', 'wss://inbox.example']] },
      dmListOn: (url) => url === 'wss://write.example',
    });

    await expect(new MessagingRelays(() => pool).fetchDmRelays('a'.repeat(64))).resolves.toEqual({
      relays: ['wss://inbox.example'],
      updatedAt: 1_700_000_000,
    });
    expect(askedFor(10050)).toEqual([...FALLBACK, 'wss://write.example']);
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
    const { pool, publish, destroy } = fakePool({
      relayList: { tags: [['r', 'wss://write.example']] },
    });

    const result = await new MessagingRelays(() => pool).publishDmRelays(secretKey, [
      'wss://inbox.example',
      'wss://down.example',
    ]);

    const [targets, event] = publish.mock.calls[0]! as unknown as [string[], Event];
    expect(targets).toEqual([
      ...FALLBACK,
      'wss://write.example',
      'wss://inbox.example',
      'wss://down.example',
    ]);
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
    const params = publish.mock.calls[0]![2] as unknown as {
      onauth: (t: object) => Promise<Event>;
    };
    const auth = await params.onauth({ kind: 22242, created_at: 1, tags: [], content: '' });
    expect(auth.pubkey).toBe(getPublicKey(secretKey));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('reuses a looked-up list for a while, then looks again', async () => {
    let clock = 0;
    const { pool, askedFor } = fakePool({
      dmList: { created_at: 1, tags: [['relay', 'wss://inbox.example']] },
    });
    const relays = new MessagingRelays(
      () => pool,
      () => clock,
    );

    await relays.lookupDmRelays('a'.repeat(64));
    await relays.lookupDmRelays('a'.repeat(64));
    expect(askedFor(10050)).toHaveLength(FALLBACK.length);

    clock = 11 * 60 * 1000;
    await relays.lookupDmRelays('a'.repeat(64));
    expect(askedFor(10050)).toHaveLength(FALLBACK.length * 2);
  });

  it('reuses an answer of no list for 30 s only, so a newly published list is found soon', async () => {
    let clock = 0;
    const { pool, askedFor } = fakePool();
    const relays = new MessagingRelays(
      () => pool,
      () => clock,
    );

    await expect(relays.lookupDmRelays('a'.repeat(64))).resolves.toEqual({
      relays: [],
      updatedAt: null,
    });
    clock = 29 * 1000;
    await relays.lookupDmRelays('a'.repeat(64));
    expect(askedFor(10050)).toHaveLength(FALLBACK.length);

    clock = 30 * 1000;
    await relays.lookupDmRelays('a'.repeat(64));
    expect(askedFor(10050)).toHaveLength(FALLBACK.length * 2);
  });

  it('does not take a relay it could not connect to for one that holds no list', async () => {
    storage.fallback = ['wss://down.example'];
    const { pool, askedFor } = fakePool({
      dmList: { created_at: 1, tags: [['relay', 'wss://inbox.example']] },
    });
    const relays = new MessagingRelays(() => pool);

    await expect(relays.fetchDmRelays('a'.repeat(64))).rejects.toThrow('No relay answered in time');
    await expect(relays.lookupDmRelays('a'.repeat(64))).resolves.toEqual({
      relays: [],
      updatedAt: null,
    });
    await relays.lookupDmRelays('a'.repeat(64));
    expect(askedFor(10050)).toHaveLength(3);
  });

  it('finds the list on the relays that answer when another could not be reached', async () => {
    storage.fallback = ['wss://down.example', 'wss://fallback.one'];
    const { pool } = fakePool({
      dmList: { created_at: 1, tags: [['relay', 'wss://inbox.example']] },
    });

    await expect(new MessagingRelays(() => pool).lookupDmRelays('a'.repeat(64))).resolves.toEqual({
      relays: ['wss://inbox.example'],
      updatedAt: 1,
    });
  });
});

describe('withDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('settles as the promise does when it is in time', async () => {
    await expect(
      withDeadline(Promise.resolve('ok'), Date.now() + 1_000, () => 'late'),
    ).resolves.toBe('ok');
  });

  it('settles with the timeout value once the deadline passes', async () => {
    const result = withDeadline(new Promise<string>(() => {}), Date.now() + 1_000, () => 'late');
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBe('late');
  });
});

describe('MessagingRelays load deadline (#265)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers within 4 s with what the other relays returned when one never answers', async () => {
    storage.fallback = ['wss://fallback.one', 'wss://slow.example'];
    const { pool } = fakePool({
      dmList: { created_at: 5, tags: [['relay', 'wss://inbox.example']] },
    });
    let settled = false;
    const result = new MessagingRelays(() => pool).fetchDmRelays('a'.repeat(64)).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(3_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ relays: ['wss://inbox.example'], updatedAt: 5 });
  });

  it('asks the fallback relays without waiting for the write relays, so a slow relay is waited on once', async () => {
    storage.fallback = ['wss://fallback.one', 'wss://slow.example'];
    const { pool, askedFor } = fakePool();

    const result = new MessagingRelays(() => pool).fetchDmRelays('a'.repeat(64));
    await vi.advanceTimersByTimeAsync(0);
    expect(askedFor(10050)).toEqual(['wss://fallback.one', 'wss://slow.example']);
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toEqual({ relays: [], updatedAt: null });
  });

  it('fails the Relays page load when no relay answers, rather than reporting no list', async () => {
    storage.fallback = ['wss://slow.one', 'wss://down.example'];
    const { pool } = fakePool();

    const result = new MessagingRelays(() => pool).fetchDmRelays('a'.repeat(64));
    const assertion = expect(result).rejects.toThrow('No relay answered in time');
    await vi.advanceTimersByTimeAsync(4_000);
    await assertion;
  });

  it('reports no list for messaging when no relay answers, and does not keep it', async () => {
    storage.fallback = ['wss://slow.one'];
    const { pool, askedFor } = fakePool();
    const relays = new MessagingRelays(() => pool);

    const first = relays.lookupDmRelays('a'.repeat(64));
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(first).resolves.toEqual({ relays: [], updatedAt: null });

    const second = relays.lookupDmRelays('a'.repeat(64));
    await vi.advanceTimersByTimeAsync(4_000);
    await second;
    expect(askedFor(10050)).toHaveLength(2);
  });
});

describe('MessagingRelays load pool (#288)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Hands out `pools` in order: the first is the shared one the constructor takes. */
  function poolsInOrder(...pools: SimplePool[]) {
    let next = 0;
    return vi.fn(() => pools[next++] ?? fakePool().pool);
  }

  /**
   * A pool whose relays all settle at `at` ms: with an EOSE and `dmList`, or as a connection that
   * timed out. Stands in for a connection that opens, or fails, at a given moment.
   */
  function timedPool(at: number, outcome: 'answers' | 'times out', dmList?: Partial<Event>) {
    const subscribeMany = vi.fn((relays: string[], filter: Filter, params: SubscribeManyParams) => {
      const url = relays[0]!;
      setTimeout(
        () => {
          if (outcome === 'times out') {
            params.oneose?.();
            params.onclose?.([{ url, reason: 'connection timed out' }]);
            return;
          }
          if (dmList && filter.kinds?.[0] === 10050) params.onevent?.(dmList as Event);
          params.oneose?.();
        },
        Math.max(0, at - Date.now()),
      );
      return { close: vi.fn() };
    });
    const destroy = vi.fn();
    return { pool: { subscribeMany, destroy } as unknown as SimplePool, subscribeMany, destroy };
  }

  it('reads each Relays page load through a pool of its own, and closes it afterwards', async () => {
    const shared = fakePool();
    const load = fakePool({ dmList: { created_at: 2, tags: [['relay', 'wss://inbox.example']] } });
    const createPool = poolsInOrder(shared.pool, load.pool);

    await expect(new MessagingRelays(createPool).fetchDmRelays('a'.repeat(64))).resolves.toEqual({
      relays: ['wss://inbox.example'],
      updatedAt: 2,
    });
    expect(createPool).toHaveBeenCalledTimes(2);
    expect(load.subscribeMany).toHaveBeenCalled();
    expect(load.destroy).toHaveBeenCalledTimes(1);
    expect(shared.subscribeMany).not.toHaveBeenCalled();
  });

  it('closes the load pool when no relay answers', async () => {
    storage.fallback = ['wss://down.example'];
    const shared = fakePool();
    const load = fakePool();

    await expect(
      new MessagingRelays(poolsInOrder(shared.pool, load.pool)).fetchDmRelays('a'.repeat(64)),
    ).rejects.toThrow('No relay answered in time');
    expect(load.destroy).toHaveBeenCalledTimes(1);
  });

  it('gives overlapping loads a pool each', async () => {
    const shared = fakePool();
    const first = fakePool();
    const second = fakePool();
    const relays = new MessagingRelays(poolsInOrder(shared.pool, first.pool, second.pool));

    await Promise.all([relays.fetchDmRelays('a'.repeat(64)), relays.fetchDmRelays('a'.repeat(64))]);

    expect(first.subscribeMany).toHaveBeenCalled();
    expect(second.subscribeMany).toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps reading lists for messaging through the shared pool', async () => {
    const shared = fakePool();
    const createPool = poolsInOrder(shared.pool);

    await new MessagingRelays(createPool).lookupDmRelays('a'.repeat(64));

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(shared.subscribeMany).toHaveBeenCalled();
    expect(shared.destroy).not.toHaveBeenCalled();
  });

  it("is not failed by an earlier load's connection attempt when the relay answers in its own time", async () => {
    storage.fallback = ['wss://fallback.one'];
    // The shared pool's attempt fails at 3.6 s, as one started by an earlier caller would.
    const shared = timedPool(3_600, 'times out');
    const earlier = timedPool(3_600, 'times out');
    const later = timedPool(4_000, 'answers', {
      created_at: 3,
      tags: [['relay', 'wss://inbox.example']],
    });
    const relays = new MessagingRelays(poolsInOrder(shared.pool, earlier.pool, later.pool));

    const first = relays.fetchDmRelays('a'.repeat(64));
    const firstFails = expect(first).rejects.toThrow('No relay answered in time');
    await vi.advanceTimersByTimeAsync(300);
    const second = relays.fetchDmRelays('a'.repeat(64));
    await vi.advanceTimersByTimeAsync(4_000);

    await firstFails;
    // The later load started at 0.3 s, so its deadline is 4.3 s and the 4 s answer counts.
    await expect(second).resolves.toEqual({ relays: ['wss://inbox.example'], updatedAt: 3 });
  });
});

describe('MessagingRelays publish deadline (#265)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers within 4 s, counting a relay that never answers as timed out', async () => {
    const { pool, publish, destroy } = fakePool();
    let settled = false;
    const result = new MessagingRelays(() => pool)
      .publishDmRelays(generateSecretKey(), ['wss://inbox.example', 'wss://slow.example'])
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(3_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const { accepted, rejected } = await result;
    expect(accepted).toEqual([...FALLBACK, 'wss://inbox.example']);
    expect(rejected).toEqual([{ url: 'wss://slow.example', reason: 'timed out' }]);
    // Signed and sent once; pending connections are stopped and the pool closed.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![2]!.abort?.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('counts a relay it could not connect to as rejected, not accepted', async () => {
    const { pool } = fakePool();

    const result = await new MessagingRelays(() => pool).publishDmRelays(generateSecretKey(), [
      'wss://unreachable.example',
    ]);

    expect(result.accepted).toEqual(FALLBACK);
    expect(result.rejected).toEqual([
      {
        url: 'wss://unreachable.example',
        reason: 'connection failure: Error: connection timed out',
      },
    ]);
  });

  it('stops looking for write relays after 1.5 s, leaving the rest of the deadline to publish', async () => {
    storage.fallback = ['wss://fallback.one', 'wss://slow.example'];
    const { pool, publish } = fakePool();

    const result = new MessagingRelays(() => pool).publishDmRelays(generateSecretKey(), [
      'wss://inbox.example',
    ]);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_500);

    const { accepted, rejected } = await result;
    expect(publish.mock.calls[0]![0]).toEqual([
      'wss://fallback.one',
      'wss://slow.example',
      'wss://inbox.example',
    ]);
    expect(accepted).toEqual(['wss://fallback.one', 'wss://inbox.example']);
    expect(rejected).toEqual([{ url: 'wss://slow.example', reason: 'timed out' }]);
  });
});

describe('relay list for NIP-07 getRelays (#270)', () => {
  it('reads read and write markers, treating an unmarked relay as both', () => {
    expect(
      parseNip07RelayMap({
        tags: [
          ['r', 'wss://both.example'],
          ['r', 'wss://read.example', 'read'],
          ['r', 'wss://write.example', 'write'],
          ['p', 'not-a-relay'],
          ['r', 'not a url'],
        ],
      }),
    ).toEqual({
      'wss://both.example': { read: true, write: true },
      'wss://read.example': { read: true, write: false },
      'wss://write.example': { read: false, write: true },
    });
  });

  it('merges a relay listed once for reading and once for writing', () => {
    expect(
      parseNip07RelayMap({
        tags: [
          ['r', 'wss://relay.example', 'read'],
          ['r', 'wss://relay.example/', 'write'],
        ],
      }),
    ).toEqual({ 'wss://relay.example': { read: true, write: true } });
  });

  it("loads the account's kind 10002 from the fallback relays", async () => {
    const { pool, askedFor } = fakePool({
      relayList: { created_at: 1, tags: [['r', 'wss://write.example', 'write']] },
    });

    await expect(new MessagingRelays(() => pool).loadRelayMap('a'.repeat(64))).resolves.toEqual({
      'wss://write.example': { read: false, write: true },
    });
    expect(askedFor(10002)).toEqual(FALLBACK);
  });

  it('answers with an empty list when the account has published none', async () => {
    const { pool } = fakePool();
    await expect(new MessagingRelays(() => pool).loadRelayMap('a'.repeat(64))).resolves.toEqual({});
  });

  describe('deadline', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('answers within 4 s when a relay never answers', async () => {
      storage.fallback = ['wss://slow.example'];
      const { pool } = fakePool();
      let settled = false;
      const result = new MessagingRelays(() => pool).loadRelayMap('a'.repeat(64)).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(3_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({});
    });
  });
});
