import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateSecretKey } from 'nostr-tools';
import type { Event, SimplePool } from 'nostr-tools';

import { checkStored } from '@/../src-bex/services/gift-wrap-storage';

type ReadParams = {
  maxWait: number;
  onauth?: unknown;
  onevent: (event: Event) => void;
  onclose: (reasons: string[]) => void;
};

const KEY = generateSecretKey();
const URL = 'wss://inbox.example';
const WRAP_ID = 'a'.repeat(64);
const NOW = 1_800_000_000_000;

/** A pool whose one read-back answers with `respond`. */
function poolAnswering(respond: (params: ReadParams) => void) {
  const close = vi.fn();
  const subscribeEose = vi.fn((_relays: string[], _filter: unknown, params: ReadParams) => {
    respond(params);
    return { close };
  });
  return { pool: { subscribeEose } as unknown as SimplePool, subscribeEose, close };
}

const read = (pool: SimplePool) => checkStored(pool, KEY, URL, WRAP_ID, NOW + 4_000, () => NOW);

afterEach(() => vi.useRealTimers());

describe('checkStored', () => {
  it('asks only that relay for that wrap, authenticating where it asks', async () => {
    const { pool, subscribeEose } = poolAnswering((params) => params.onclose(['closed automatically on eose']));

    await read(pool);

    const [relays, filter, params] = subscribeEose.mock.calls[0]!;
    expect(relays).toEqual([URL]);
    expect(filter).toEqual({ ids: [WRAP_ID] });
    expect(params.onauth).toBeTypeOf('function');
    // nostr-tools' own timeout must never come before ours.
    expect(params.maxWait).toBe(5_000);
  });

  it('reports a wrap the relay served back as held', async () => {
    const { pool } = poolAnswering((params) => {
      params.onevent({ id: WRAP_ID } as Event);
      params.onclose(['closed automatically on eose']);
    });

    await expect(read(pool)).resolves.toEqual({ url: URL, storage: 'held' });
  });

  it('ignores an event that is not the wrap', async () => {
    const { pool } = poolAnswering((params) => {
      params.onevent({ id: 'b'.repeat(64) } as Event);
      params.onclose(['closed automatically on eose']);
    });

    await expect(read(pool)).resolves.toMatchObject({ storage: 'missing' });
  });

  it('reports a relay that answered without the wrap as missing', async () => {
    const { pool } = poolAnswering((params) => params.onclose(['closed automatically on eose']));

    await expect(read(pool)).resolves.toEqual({ url: URL, storage: 'missing', reason: 'accepted but not stored' });
  });

  it.each(['restricted: only for the recipient', 'auth-required: sign in'])(
    'reports a relay that would not serve the wrap as refused (%s)',
    async (reason) => {
      const { pool } = poolAnswering((params) => params.onclose([reason]));

      await expect(read(pool)).resolves.toEqual({ url: URL, storage: 'refused' });
    },
  );

  it('reports any other close as unanswered, with its reason', async () => {
    const { pool } = poolAnswering((params) => params.onclose(['connection failure']));

    await expect(read(pool)).resolves.toEqual({ url: URL, storage: 'unanswered', reason: 'connection failure' });
  });

  it('gives a reason when the relay closed without one', async () => {
    const { pool } = poolAnswering((params) => params.onclose([]));

    await expect(read(pool)).resolves.toEqual({
      url: URL,
      storage: 'unanswered',
      reason: 'could not confirm the relay stored it',
    });
  });

  it('stops waiting at the deadline and closes the request', async () => {
    vi.useFakeTimers();
    const { pool, close } = poolAnswering(() => undefined);

    const result = read(pool);
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toEqual({
      url: URL,
      storage: 'unanswered',
      reason: 'could not confirm the relay stored it',
    });
    expect(close).toHaveBeenCalled();
  });
});
