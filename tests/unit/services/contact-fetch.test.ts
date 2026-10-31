import { describe, it, expect, vi } from 'vitest';
import type { Event as NostrEvent, Filter } from 'nostr-tools';
import {
  MAX_ABOUT_LENGTH,
  MAX_CONTACTS_PER_ACCOUNT,
  MAX_NAME_LENGTH,
  MAX_PROFILE_CONTENT_LENGTH,
  MAX_URL_LENGTH,
  PROFILE_BATCH_CONCURRENCY,
  PROFILE_BATCH_SIZE,
  fetchContactListSnapshot,
  fetchProfilesInBatches,
  parseContactProfile,
  parseContactTags,
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
    Promise.resolve(
      (filter.authors ?? []).map((pubkey) => profileEvent(pubkey, `name-${pubkey.slice(-4)}`, 1)),
    ),
  );
  return { pool: { get: vi.fn(), querySync } as unknown as RelayReader, querySync };
};

describe('fetchProfilesInBatches', () => {
  it('asks for profiles in batches and reports each one as it lands', async () => {
    const { pool, querySync } = echoingPool();
    const pubkeys = Array.from({ length: PROFILE_BATCH_SIZE * 2 + 3 }, (_, index) =>
      pubkeyAt(index + 1),
    );
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
    const pubkeys = Array.from({ length: PROFILE_BATCH_SIZE + 1 }, (_, index) =>
      pubkeyAt(index + 1),
    );

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
    const pubkeys = Array.from({ length: PROFILE_BATCH_SIZE * 10 }, (_, index) =>
      pubkeyAt(index + 1),
    );

    await fetchProfilesInBatches(pool, RELAYS, pubkeys);

    expect(querySync).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(PROFILE_BATCH_CONCURRENCY);
  });

  it('keeps the newest profile when relays return several', async () => {
    const querySync = vi.fn(() =>
      Promise.resolve([profileEvent(BOB, 'old', 1), profileEvent(BOB, 'new', 2)]),
    );
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
  it('asks nothing and reads no list when there is no relay (#142)', async () => {
    const get = vi.fn(() => new Promise(() => undefined));
    const pool = { get, querySync: vi.fn() } as unknown as RelayReader;

    await expect(fetchContactListSnapshot(pool, [], ALICE)).resolves.toEqual({ contacts: [] });
    expect(get).not.toHaveBeenCalled();
  });

  it('parses the account’s kind 3', async () => {
    const get = vi.fn(() =>
      Promise.resolve({
        id: 'e1',
        pubkey: ALICE,
        kind: 3,
        created_at: 100,
        tags: [['p', BOB, '', 'Bob']],
        content: '',
        sig: '',
      }),
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
    const pool = {
      get: vi.fn(() => Promise.resolve(null)),
      querySync: vi.fn(),
    } as unknown as RelayReader;

    await expect(fetchContactListSnapshot(pool, RELAYS, ALICE)).resolves.toEqual({ contacts: [] });
  });
});

describe('contact cache bounds (workspace#182)', () => {
  const kind0 = (content: string): NostrEvent => ({
    id: 'p1',
    pubkey: BOB,
    kind: 0,
    created_at: 1,
    tags: [],
    content,
    sig: '',
  });
  const contactTags = (count: number) =>
    Array.from({ length: count }, (_, index) => ['p', pubkeyAt(index + 1)]);

  it('does not parse a kind 0 whose content is over the limit', () => {
    const content = JSON.stringify({ name: 'Bob', about: 'x'.repeat(MAX_PROFILE_CONTENT_LENGTH) });

    expect(parseContactProfile(kind0(content))).toBeNull();
  });

  it('measures kind 0 content in UTF-8 bytes, not characters', () => {
    // Three bytes each in UTF-8, so under the limit in characters but over it in bytes.
    const content = JSON.stringify({ about: '\u4e2d'.repeat(MAX_PROFILE_CONTENT_LENGTH / 2) });

    expect(content.length).toBeLessThan(MAX_PROFILE_CONTENT_LENGTH);
    expect(parseContactProfile(kind0(content))).toBeNull();
  });

  it('cuts long names and about text to their limits', () => {
    const profile = parseContactProfile(
      kind0(
        JSON.stringify({
          name: 'n'.repeat(MAX_NAME_LENGTH + 1),
          display_name: 'd'.repeat(MAX_NAME_LENGTH + 50),
          about: 'a'.repeat(MAX_ABOUT_LENGTH + 1),
        }),
      ),
    );

    expect(profile?.name).toBe('n'.repeat(MAX_NAME_LENGTH));
    expect(profile?.displayName).toBe('d'.repeat(MAX_NAME_LENGTH));
    expect(profile?.about).toBe('a'.repeat(MAX_ABOUT_LENGTH));
  });

  it('drops a picture or NIP-05 address over the limit rather than cutting it', () => {
    const long = `https://example.com/${'p'.repeat(MAX_URL_LENGTH)}`;
    const profile = parseContactProfile(kind0(JSON.stringify({ picture: long, nip05: long })));

    expect(profile?.picture).toBe('');
    expect(profile?.nip05).toBe('');
  });

  it('keeps fields within the limits as they are', () => {
    const profile = parseContactProfile(
      kind0(JSON.stringify({ name: 'Bob', picture: 'https://example.com/bob.png' })),
    );

    expect(profile?.name).toBe('Bob');
    expect(profile?.picture).toBe('https://example.com/bob.png');
  });

  it('cuts a long petname and drops a relay hint over the limit', () => {
    const relay = `wss://${'r'.repeat(MAX_URL_LENGTH)}.example`;

    expect(parseContactTags([['p', BOB, relay, 'b'.repeat(MAX_NAME_LENGTH + 1)]])).toEqual([
      { pubkey: BOB, relayUrl: '', petname: 'b'.repeat(MAX_NAME_LENGTH) },
    ]);
  });

  it('keeps at most the contact limit and marks the list as truncated', async () => {
    const pool = {
      get: vi.fn(() =>
        Promise.resolve({
          id: 'e1',
          pubkey: ALICE,
          kind: 3,
          created_at: 100,
          tags: contactTags(MAX_CONTACTS_PER_ACCOUNT + 1),
          content: '',
          sig: '',
        }),
      ),
      querySync: vi.fn(),
    } as unknown as RelayReader;

    const snapshot = await fetchContactListSnapshot(pool, RELAYS, ALICE);

    expect(snapshot.contacts).toHaveLength(MAX_CONTACTS_PER_ACCOUNT);
    expect(snapshot.contacts.at(-1)?.pubkey).toBe(pubkeyAt(MAX_CONTACTS_PER_ACCOUNT));
    expect(snapshot.truncated).toBe(true);
  });

  it('does not mark a list at exactly the limit, or one padded with duplicates', async () => {
    const tags = [...contactTags(MAX_CONTACTS_PER_ACCOUNT), ['p', pubkeyAt(1)]];
    const pool = {
      get: vi.fn(() =>
        Promise.resolve({
          id: 'e1',
          pubkey: ALICE,
          kind: 3,
          created_at: 100,
          tags,
          content: '',
          sig: '',
        }),
      ),
      querySync: vi.fn(),
    } as unknown as RelayReader;

    const snapshot = await fetchContactListSnapshot(pool, RELAYS, ALICE);

    expect(snapshot.contacts).toHaveLength(MAX_CONTACTS_PER_ACCOUNT);
    expect(snapshot).not.toHaveProperty('truncated');
  });
});
