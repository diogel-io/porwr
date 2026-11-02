import { describe, it, expect, vi } from 'vitest';
import type { Event as NostrEvent, Filter } from 'nostr-tools';
import { lookupReplaceableEvent, type ReplaceableEventReader } from '@/services/replaceable-lookup';

const RELAYS = ['wss://a.example', 'wss://b.example'];
const ALICE = 'a'.repeat(64);
const CLOSED_ON_EOSE = 'closed automatically on eose';

type EoseParams = {
  maxWait?: number;
  onevent: (event: NostrEvent) => void;
  onclose: (closes: { url: string; reason: string }[]) => void;
};

const event = (createdAt: number): NostrEvent => ({
  id: `e${createdAt}`,
  pubkey: ALICE,
  kind: 10063,
  created_at: createdAt,
  tags: [],
  content: '',
  sig: '',
});

/** A pool that sends `events`, then closes each relay with the reason `reasons` gives it. */
const poolClosing = (events: NostrEvent[], reasons: string[]) => {
  const subscribeEose = vi.fn((relays: string[], _filter: Filter, params: EoseParams) => {
    events.forEach((sent) => params.onevent(sent));
    params.onclose(relays.map((url, index) => ({ url, reason: reasons[index] ?? '' })));
    return { close: vi.fn() };
  });
  return { pool: { subscribeEose } as unknown as ReplaceableEventReader, subscribeEose };
};

describe('lookupReplaceableEvent (#285, #435)', () => {
  it('finds the newest event of the kind', async () => {
    const { pool, subscribeEose } = poolClosing(
      [event(100), event(300), event(200)],
      [CLOSED_ON_EOSE, CLOSED_ON_EOSE],
    );

    await expect(lookupReplaceableEvent(pool, RELAYS, ALICE, 10063)).resolves.toEqual({
      status: 'found',
      event: event(300),
    });
    expect(subscribeEose).toHaveBeenCalledWith(
      RELAYS,
      { kinds: [10063], authors: [ALICE], limit: 1 },
      expect.anything(),
    );
  });

  it('reports not-found when a relay answered without one', async () => {
    const { pool } = poolClosing([], ['connection failed', CLOSED_ON_EOSE]);

    await expect(lookupReplaceableEvent(pool, RELAYS, ALICE, 10063)).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('reports unreachable when no relay answered', async () => {
    const { pool } = poolClosing([], ['connection failed', 'connection timed out']);

    await expect(lookupReplaceableEvent(pool, RELAYS, ALICE, 10063)).resolves.toEqual({
      status: 'unreachable',
    });
  });

  it('reports unreachable, asking nothing, when there is no relay', async () => {
    const { pool, subscribeEose } = poolClosing([], []);

    await expect(lookupReplaceableEvent(pool, [], ALICE, 10063)).resolves.toEqual({
      status: 'unreachable',
    });
    expect(subscribeEose).not.toHaveBeenCalled();
  });

  it('reports unreachable when the subscription throws', async () => {
    const subscribeEose = vi.fn(() => {
      throw new Error('bad relay url');
    });
    const pool = { subscribeEose } as unknown as ReplaceableEventReader;

    await expect(lookupReplaceableEvent(pool, RELAYS, ALICE, 10063)).resolves.toEqual({
      status: 'unreachable',
    });
  });

  it('passes maxWait only when given, leaving nostr-tools’ own timeouts otherwise', async () => {
    const { pool, subscribeEose } = poolClosing([], [CLOSED_ON_EOSE, CLOSED_ON_EOSE]);

    await lookupReplaceableEvent(pool, RELAYS, ALICE, 3, { maxWait: 5000 });
    await lookupReplaceableEvent(pool, RELAYS, ALICE, 3);

    expect(subscribeEose.mock.calls[0]![2]).toHaveProperty('maxWait', 5000);
    expect(subscribeEose.mock.calls[1]![2]).not.toHaveProperty('maxWait');
  });
});
