import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Event, EventTemplate, Filter, SimplePool, VerifiedEvent } from 'nostr-tools';

import { DmRelayProbe } from '@/../src-bex/services/dm-relay-probe';

type PublishParams = { maxWait: number; abort: AbortSignal; onauth: (t: EventTemplate) => Promise<VerifiedEvent> };
type ReadParams = {
  onauth: (t: EventTemplate) => Promise<VerifiedEvent>;
  onevent: (event: Event) => void;
  onclose: (reasons: { url: string; reason: string }[]) => void;
};

/**
 * How each fake relay treats a test gift wrap:
 * - `keeps` stores it and serves it back; `drops` says OK and serves nothing back, like relay.damus.io
 * - `refuses:<reason>` answers OK false; `down` never connects; `slow` never answers the publish
 * - `hides` will not serve the wrap back; `silent` never answers the read-back
 */
let behaviour: Record<string, string>;
let pools: { publish: ReturnType<typeof vi.fn>; subscribeEose: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[];
let published: { url: string; event: Event; params: PublishParams }[];
let clock: number;

function fakePool() {
  const held = new Map<string, Event>();
  const publish = vi.fn((relays: string[], event: Event, params: PublishParams) => {
    const url = relays[0]!;
    published.push({ url, event, params });
    const mode = behaviour[url] ?? 'keeps';
    if (mode === 'down') return [Promise.reject(new Error('connection failure: Error: refused'))];
    if (mode === 'slow') return [new Promise(() => {})];
    if (mode.startsWith('refuses:')) return [Promise.reject(new Error(mode.slice('refuses:'.length)))];
    if (mode !== 'drops') held.set(event.id, event);
    return [Promise.resolve('')];
  });
  const subscribeEose = vi.fn((relays: string[], filter: Filter, params: ReadParams) => {
    const mode = behaviour[relays[0]!] ?? 'keeps';
    if (mode === 'silent') return { close: vi.fn() };
    if (mode === 'hides') {
      params.onclose([{ url: relays[0]!, reason: 'restricted: gift wraps are only served to their recipient' }]);
      return { close: vi.fn() };
    }
    for (const id of filter.ids ?? []) {
      const event = held.get(id);
      if (event) params.onevent(event);
    }
    params.onclose([{ url: relays[0]!, reason: 'closed automatically on eose' }]);
    return { close: vi.fn() };
  });
  const pool = { publish, subscribeEose, destroy: vi.fn() };
  pools.push(pool);
  return pool as unknown as SimplePool;
}

const probe = () => new DmRelayProbe(fakePool, () => clock);

beforeEach(() => {
  behaviour = {};
  pools = [];
  published = [];
  clock = 1_800_000_000_000;
});

afterEach(() => vi.useRealTimers());

describe('DmRelayProbe', () => {
  it('reports a relay that serves the test message back as keeping messages', async () => {
    await expect(probe().check(['wss://keeps.example'])).resolves.toEqual({
      checks: [{ url: 'wss://keeps.example', status: 'keeps' }],
    });
  });

  it('reports a relay that says OK and keeps nothing as dropping messages', async () => {
    behaviour['wss://damus.example'] = 'drops';

    await expect(probe().check(['wss://damus.example'])).resolves.toEqual({
      checks: [{ url: 'wss://damus.example', status: 'drops', reason: 'accepted but not stored' }],
    });
  });

  it("reports a relay it can't reach as couldn't check, not as dropping", async () => {
    behaviour['wss://down.example'] = 'down';

    await expect(probe().check(['wss://down.example'])).resolves.toEqual({
      checks: [{ url: 'wss://down.example', status: 'unchecked', reason: 'connection failure: Error: refused' }],
    });
  });

  it.each(['blocked: kind 1059 not allowed', 'restricted: members only', 'invalid: created_at too old', 'pow: difficulty 20'])(
    'reports a relay that refuses the gift wrap as dropping messages (%s)',
    async (reason) => {
      behaviour['wss://picky.example'] = `refuses:${reason}`;

      await expect(probe().check(['wss://picky.example'])).resolves.toEqual({
        checks: [{ url: 'wss://picky.example', status: 'drops', reason }],
      });
    },
  );

  it.each(['rate-limited: slow down', 'auth-required: still not authenticated', 'error: database down', 'publish timed out'])(
    "reports a refusal that says nothing about gift wraps as couldn't check (%s)",
    async (reason) => {
      behaviour['wss://busy.example'] = `refuses:${reason}`;

      await expect(probe().check(['wss://busy.example'])).resolves.toMatchObject({
        checks: [{ url: 'wss://busy.example', status: 'unchecked', reason }],
      });
    },
  );

  it("reports a relay that won't serve the test message back as couldn't check", async () => {
    behaviour['wss://inbox.example'] = 'hides';

    await expect(probe().check(['wss://inbox.example'])).resolves.toEqual({
      checks: [{ url: 'wss://inbox.example', status: 'unchecked', reason: 'would not serve the test message back' }],
    });
  });

  it('checks every relay at once, in list order, inside the 4 s deadline', async () => {
    vi.useFakeTimers();
    behaviour = { 'wss://slow.example': 'slow', 'wss://silent.example': 'silent', 'wss://damus.example': 'drops' };

    const result = probe().check(['wss://slow.example', 'wss://keeps.example', 'wss://silent.example', 'wss://damus.example']);
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toEqual({
      checks: [
        { url: 'wss://slow.example', status: 'unchecked', reason: 'timed out' },
        { url: 'wss://keeps.example', status: 'keeps' },
        { url: 'wss://silent.example', status: 'unchecked', reason: 'could not confirm the relay stored it' },
        { url: 'wss://damus.example', status: 'drops', reason: 'accepted but not stored' },
      ],
    });
  });

  it('gives up on a publish by 1.5 s, leaving time to read back', async () => {
    vi.useFakeTimers();
    behaviour['wss://slow.example'] = 'slow';

    const result = probe().check(['wss://slow.example']);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toMatchObject({ checks: [{ status: 'unchecked', reason: 'timed out' }] });
    expect(published[0]!.params.maxWait).toBe(1_500);
  });

  it('sends each relay a gift wrap from its own throwaway key, addressed to that key', async () => {
    await probe().check(['wss://one.example', 'wss://two.example']);

    expect(published.map(({ url }) => url)).toEqual(['wss://one.example', 'wss://two.example']);
    const recipients = published.map(({ event }) => event.tags.find((tag) => tag[0] === 'p')?.[1]);
    expect(published.every(({ event }) => event.kind === 1059)).toBe(true);
    expect(new Set(recipients).size).toBe(2);
    for (const { event } of published) expect(recipients).not.toContain(event.pubkey);
  });

  it('authenticates as the throwaway recipient, both to publish and to read back', async () => {
    await probe().check(['wss://inbox.example']);

    const { event, params } = published[0]!;
    const recipient = event.tags.find((tag) => tag[0] === 'p')![1];
    const challenge = { kind: 22242, created_at: 1, tags: [['challenge', 'c']], content: '' };
    await expect(params.onauth(challenge)).resolves.toMatchObject({ pubkey: recipient });
    const [, filter, readParams] = pools[0]!.subscribeEose.mock.calls[0]! as [string[], Filter, ReadParams];
    expect(filter).toEqual({ ids: [event.id] });
    await expect(readParams.onauth(challenge)).resolves.toMatchObject({ pubkey: recipient });
  });

  it('opens a pool for each relay and closes it afterwards', async () => {
    await probe().check(['wss://one.example', 'wss://two.example']);

    expect(pools).toHaveLength(2);
    for (const pool of pools) expect(pool.destroy).toHaveBeenCalledOnce();
    expect(published.every(({ params }) => params.abort.aborted)).toBe(true);
  });

  it('remembers what a relay did for 10 minutes, so saving again sends nothing', async () => {
    behaviour['wss://damus.example'] = 'drops';
    const checker = probe();

    await checker.check(['wss://keeps.example', 'wss://damus.example']);
    clock += 10 * 60 * 1000;
    await expect(checker.check(['wss://keeps.example', 'wss://damus.example'])).resolves.toMatchObject({
      checks: [{ status: 'keeps' }, { status: 'drops' }],
    });
    expect(published).toHaveLength(2);

    clock += 1;
    await checker.check(['wss://keeps.example']);
    expect(published).toHaveLength(3);
  });

  it("asks again about a relay it couldn't check", async () => {
    behaviour['wss://down.example'] = 'down';
    const checker = probe();

    await checker.check(['wss://down.example']);
    await checker.check(['wss://down.example']);

    expect(published).toHaveLength(2);
  });

  it('forgets every answer when cleared', async () => {
    const checker = probe();

    await checker.check(['wss://keeps.example']);
    checker.clear();
    await checker.check(['wss://keeps.example']);

    expect(published).toHaveLength(2);
  });
});
