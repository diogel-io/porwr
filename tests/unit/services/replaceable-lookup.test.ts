import { afterEach, describe, it, expect, vi } from 'vitest';
import type { Event as NostrEvent, Filter } from 'nostr-tools';
import {
  lookupReplaceableEvent,
  REPLACEABLE_LOOKUP_TIMEOUT_MS,
  type ReplaceableEventReader,
} from '@/services/replaceable-lookup';

const A = 'wss://a.example';
const B = 'wss://b.example';
const ALICE = 'a'.repeat(64);
const CLOSED_ON_EOSE = 'closed automatically on eose';

type EoseParams = {
  maxWait?: number;
  onevent: (event: NostrEvent) => void;
  onclose: (closes: { url: string; reason: string }[]) => void;
};

/** What a fake relay does with the lookup: events it sends, then how it closes, if it ever does. */
type Behaviour = { events?: NostrEvent[]; close?: string };

const event = (createdAt: number): NostrEvent => ({
  id: `e${createdAt}`,
  pubkey: ALICE,
  kind: 10063,
  created_at: createdAt,
  tags: [],
  content: '',
  sig: '',
});

/** A pool whose relays behave as `behaviours` says, each on its own subscription. */
const poolOf = (behaviours: Record<string, Behaviour>) => {
  const closers: Record<string, ReturnType<typeof vi.fn>> = {};
  const subscribeEose = vi.fn((relays: string[], _filter: Filter, params: EoseParams) => {
    const [url = ''] = relays;
    const behaviour = behaviours[url] ?? {};
    behaviour.events?.forEach((sent) => params.onevent(sent));
    // `close` reports "closed by caller", as nostr-tools does when Porwr gives up on a relay.
    const close = vi.fn(() => params.onclose([{ url, reason: 'closed by caller' }]));
    closers[url] = close;
    if (behaviour.close !== undefined) params.onclose([{ url, reason: behaviour.close }]);
    return { close };
  });
  return { pool: { subscribeEose } as unknown as ReplaceableEventReader, subscribeEose, closers };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('lookupReplaceableEvent (#285, #424, #435)', () => {
  it('finds the newest event any relay sends, asking each relay on its own', async () => {
    const { pool, subscribeEose } = poolOf({
      [A]: { events: [event(100), event(300)], close: CLOSED_ON_EOSE },
      [B]: { events: [event(200)], close: CLOSED_ON_EOSE },
    });

    await expect(lookupReplaceableEvent(pool, [A, B], ALICE, 10063)).resolves.toEqual({
      status: 'found',
      event: event(300),
    });
    expect(subscribeEose).toHaveBeenCalledTimes(2);
    expect(subscribeEose).toHaveBeenCalledWith(
      [A],
      { kinds: [10063], authors: [ALICE], limit: 1 },
      expect.anything(),
    );
    expect(subscribeEose).toHaveBeenCalledWith([B], expect.anything(), expect.anything());
  });

  it('reports not-found when a relay answered without one', async () => {
    const { pool } = poolOf({
      [A]: { close: 'connection failed' },
      [B]: { close: CLOSED_ON_EOSE },
    });

    await expect(lookupReplaceableEvent(pool, [A, B], ALICE, 10063)).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('reports unreachable when no relay could be reached', async () => {
    const { pool } = poolOf({
      [A]: { close: 'connection failed' },
      [B]: { close: 'connection timed out' },
    });

    await expect(lookupReplaceableEvent(pool, [A, B], ALICE, 10063)).resolves.toEqual({
      status: 'unreachable',
    });
  });

  describe('a relay that connects and never answers (#424)', () => {
    it('counts as not having answered once the deadline passes, and is closed', async () => {
      vi.useFakeTimers();
      const { pool, closers } = poolOf({ [A]: {} });

      const lookup = lookupReplaceableEvent(pool, [A], ALICE, 10063);
      await vi.advanceTimersByTimeAsync(REPLACEABLE_LOOKUP_TIMEOUT_MS);

      await expect(lookup).resolves.toEqual({ status: 'unreachable' });
      expect(closers[A]).toHaveBeenCalled();
    });

    it('is not waited on past the deadline', async () => {
      vi.useFakeTimers();
      const { pool } = poolOf({ [A]: {} });
      let settled = false;

      void lookupReplaceableEvent(pool, [A], ALICE, 10063).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(REPLACEABLE_LOOKUP_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    });

    it('gives nostr-tools a later timeout, so its EOSE timeout never decides', async () => {
      const { pool, subscribeEose } = poolOf({ [A]: { close: CLOSED_ON_EOSE } });

      await lookupReplaceableEvent(pool, [A], ALICE, 10063);

      const params = subscribeEose.mock.calls[0]![2] as EoseParams;
      expect(params.maxWait).toBeGreaterThan(REPLACEABLE_LOOKUP_TIMEOUT_MS);
    });

    it('leaves the result not-found when another relay answered', async () => {
      vi.useFakeTimers();
      const { pool } = poolOf({ [A]: {}, [B]: { close: CLOSED_ON_EOSE } });

      const lookup = lookupReplaceableEvent(pool, [A, B], ALICE, 10063);
      await vi.advanceTimersByTimeAsync(REPLACEABLE_LOOKUP_TIMEOUT_MS);

      await expect(lookup).resolves.toEqual({ status: 'not-found' });
    });

    it('keeps an event it sent before going quiet', async () => {
      vi.useFakeTimers();
      const { pool } = poolOf({ [A]: { events: [event(100)] } });

      const lookup = lookupReplaceableEvent(pool, [A], ALICE, 10063);
      await vi.advanceTimersByTimeAsync(REPLACEABLE_LOOKUP_TIMEOUT_MS);

      await expect(lookup).resolves.toEqual({ status: 'found', event: event(100) });
    });

    it('honours a shorter deadline from the caller', async () => {
      vi.useFakeTimers();
      const { pool } = poolOf({ [A]: {} });

      const lookup = lookupReplaceableEvent(pool, [A], ALICE, 10063, { timeoutMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(lookup).resolves.toEqual({ status: 'unreachable' });
    });
  });

  it('reports unreachable, asking nothing, when there is no relay', async () => {
    const { pool, subscribeEose } = poolOf({});

    await expect(lookupReplaceableEvent(pool, [], ALICE, 10063)).resolves.toEqual({
      status: 'unreachable',
    });
    expect(subscribeEose).not.toHaveBeenCalled();
  });

  it('treats a relay whose subscription throws as one that did not answer', async () => {
    const subscribeEose = vi.fn((relays: string[], _filter: Filter, params: EoseParams) => {
      if (relays[0] === A) throw new Error('bad relay url');
      params.onclose([{ url: B, reason: CLOSED_ON_EOSE }]);
      return { close: vi.fn() };
    });
    const pool = { subscribeEose } as unknown as ReplaceableEventReader;

    await expect(lookupReplaceableEvent(pool, [A], ALICE, 10063)).resolves.toEqual({
      status: 'unreachable',
    });
    await expect(lookupReplaceableEvent(pool, [A, B], ALICE, 10063)).resolves.toEqual({
      status: 'not-found',
    });
  });
});
