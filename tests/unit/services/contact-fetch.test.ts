import { describe, it, expect, vi } from 'vitest';
import type { Event as NostrEvent, Filter } from 'nostr-tools';
import {
  PROFILE_BATCH_CONCURRENCY,
  PROFILE_BATCH_SIZE,
  fetchContactListSnapshot,
  fetchProfilesInBatches,
  type RelayReader,
} from '@/services/contact-fetch';

const RELAYS = ['wss://relay.example'];
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const pubkeyAt = (index: number) => index.toString(16).padStart(64, '0');

const profileEvent = (pubkey: string, name: string, createdAt: number): NostrEvent => ({
  id: `${pubkey.slice(0, 8)}-${createdAt}`,
  pubkey,
  kind: 0,
  created_at: createdAt,
  tags: [],
  content: JSON.stringify({ name }),
  sig: '',
});

/** Answers each profile query with a profile for every author asked for. */
const echoingPool = () => {
  const querySync = vi.fn((_relays: string[], filter: Filter) =>
    Promise.resolve((filter.authors ?? []).map((pubkey) => profileEvent(pubkey, `name-${pubkey.slice(-4)}`, 1))),
  );
  return { pool: { get: vi.fn(), querySync } as unknown as RelayReader, querySync };
};

describe('fetchProfilesInBatches', () => {
  it('asks for profiles in batches and reports each one as it lands', async () => {
    const { pool, querySync } = echoingPool();
    const pubkeys = Array.from({ length: PROFILE_BATCH_SIZE * 2 + 3 }, (_, index) => pubkeyAt(index + 1));
    const onBatch = vi.fn();

    const profiles = await fetchProfilesInBatches(pool, RELAYS, pubkeys, onBatch);

    expect(querySync).toHaveBeenCalledTimes(3);
    for (const [, filter] of querySync.mock.calls) {
      expect((filter.authors ?? []).length).toBeLessThanOrEqual(PROFILE_BATCH_SIZE);
    }
    expect(onBatch).toHaveBeenCalledTimes(3);
    expect(Object.keys(profiles)).toHaveLength(pubkeys.length);
  });

  it('keeps going when one batch fails', async () => {
    const { pool, querySync } = echoingPool();
    querySync.mockRejectedValueOnce(new Error('relay timeout'));
    const pubkeys = Array.from({ length: PROFILE_BATCH_SIZE + 1 }, (_, index) => pubkeyAt(index + 1));

    const profiles = await fetchProfilesInBatches(pool, RELAYS, pubkeys);

    expect(querySync).toHaveBeenCalledTimes(2);
    expect(Object.keys(profiles).length).toBeGreaterThan(0);
  });

  it('never has more batches in flight than the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const querySync = vi.fn(async (_relays: string[], filter: Filter) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return (filter.authors ?? []).map((pubkey) => profileEvent(pubkey, 'x', 1));
    });
    const pool = { get: vi.fn(), querySync } as unknown as RelayReader;
    const pubkeys = Array.from({ length: PROFILE_BATCH_SIZE * 10 }, (_, index) => pubkeyAt(index + 1));

    await fetchProfilesInBatches(pool, RELAYS, pubkeys);

    expect(querySync).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(PROFILE_BATCH_CONCURRENCY);
  });

  it('keeps the newest profile when relays return several', async () => {
    const querySync = vi.fn(() => Promise.resolve([profileEvent(BOB, 'old', 1), profileEvent(BOB, 'new', 2)]));
    const pool = { get: vi.fn(), querySync } as unknown as RelayReader;

    const profiles = await fetchProfilesInBatches(pool, RELAYS, [BOB]);

    expect(profiles[BOB]?.name).toBe('new');
  });

  it('asks nothing for no valid pubkeys', async () => {
    const { pool, querySync } = echoingPool();

    await expect(fetchProfilesInBatches(pool, RELAYS, ['not-a-key'])).resolves.toEqual({});
    expect(querySync).not.toHaveBeenCalled();
  });
});

describe('fetchContactListSnapshot', () => {
  it('parses the account’s kind 3', async () => {
    const get = vi.fn(() =>
      Promise.resolve({ id: 'e1', pubkey: ALICE, kind: 3, created_at: 100, tags: [['p', BOB, '', 'Bob']], content: '', sig: '' }),
    );
    const pool = { get, querySync: vi.fn() } as unknown as RelayReader;

    await expect(fetchContactListSnapshot(pool, RELAYS, ALICE)).resolves.toEqual({
      contacts: [{ pubkey: BOB, relayUrl: '', petname: 'Bob' }],
      sourceEventId: 'e1',
      sourceCreatedAt: 100,
    });
    expect(get).toHaveBeenCalledWith(RELAYS, { authors: [ALICE], kinds: [3] }, expect.anything());
  });

  it('reports no list when relays have none', async () => {
    const pool = { get: vi.fn(() => Promise.resolve(null)), querySync: vi.fn() } as unknown as RelayReader;

    await expect(fetchContactListSnapshot(pool, RELAYS, ALICE)).resolves.toEqual({ contacts: [] });
  });
});
