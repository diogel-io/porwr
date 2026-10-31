import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedContactList, CachedContactProfile, ContactProfile } from '@/types/contact-list';

/**
 * The repository mocks Dexie rather than running IndexedDB, so this stands in for the two cache
 * tables with just the calls `contact-cache` makes.
 */
const store = vi.hoisted(() => ({
  lists: new Map<string, unknown>(),
  profiles: new Map<string, unknown>(),
}));

vi.mock('@/services/database', () => {
  const profileKey = (key: [string, string]) => key.join(':');
  const profileRows = () =>
    [...store.profiles.values()] as { accountPubkey: string; pubkey: string }[];

  const byAccount = (accountPubkey: string) => {
    const matching = () => profileRows().filter((row) => row.accountPubkey === accountPubkey);
    const remove = (rows: { accountPubkey: string; pubkey: string }[]) => {
      for (const row of rows) store.profiles.delete(profileKey([row.accountPubkey, row.pubkey]));
      return Promise.resolve(rows.length);
    };
    return {
      toArray: () => Promise.resolve(matching()),
      delete: () => remove(matching()),
      filter: (keep: (row: { accountPubkey: string; pubkey: string }) => boolean) => ({
        delete: () => remove(matching().filter(keep)),
      }),
    };
  };

  return {
    db: {
      contactLists: {
        get: (key: string) => Promise.resolve(store.lists.get(key)),
        put: (row: { accountPubkey: string }) => {
          store.lists.set(row.accountPubkey, structuredClone(row));
          return Promise.resolve(row.accountPubkey);
        },
        delete: (key: string) => {
          store.lists.delete(key);
          return Promise.resolve();
        },
      },
      contactProfiles: {
        bulkGet: (keys: [string, string][]) =>
          Promise.resolve(keys.map((key) => store.profiles.get(profileKey(key)))),
        bulkPut: (rows: { accountPubkey: string; pubkey: string }[]) => {
          for (const row of rows)
            store.profiles.set(profileKey([row.accountPubkey, row.pubkey]), structuredClone(row));
          return Promise.resolve();
        },
        where: () => ({ equals: (accountPubkey: string) => byAccount(accountPubkey) }),
      },
      transaction: (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)(),
    },
  };
});

import { MAX_CONTACTS_PER_ACCOUNT } from '@/services/contact-fetch';
import {
  CONTACT_CACHE_TTL_MS,
  clearAccount,
  isStale,
  pruneProfiles,
  readContactCache,
  upsertProfiles,
  writeContactList,
} from '@/services/contact-cache';

const ALICE = 'a'.repeat(64);
const CAROL = 'c'.repeat(64);
const BOB = 'b'.repeat(64);
const DAVE = 'd'.repeat(64);

const profile = (pubkey: string, name: string, updatedAt: number): ContactProfile => ({
  pubkey,
  name,
  displayName: '',
  about: '',
  picture: '',
  nip05: '',
  updatedAt,
});

const bob = { pubkey: BOB, relayUrl: '', petname: 'Bob' };
const dave = { pubkey: DAVE, relayUrl: '', petname: 'Dave' };

beforeEach(() => {
  store.lists.clear();
  store.profiles.clear();
});

describe('writeContactList', () => {
  it('fills an empty cache', async () => {
    await expect(
      writeContactList(ALICE, { contacts: [bob], sourceEventId: 'e1', sourceCreatedAt: 100 }, 5),
    ).resolves.toBe(true);

    expect(store.lists.get(ALICE)).toEqual({
      accountPubkey: ALICE,
      contacts: [bob],
      sourceEventId: 'e1',
      sourceCreatedAt: 100,
      fetchedAt: 5,
    });
  });

  it('keys by account, so one account never sees another’s contacts', async () => {
    await writeContactList(ALICE, { contacts: [bob], sourceCreatedAt: 100 });
    await writeContactList(CAROL, { contacts: [dave], sourceCreatedAt: 100 });

    expect((await readContactCache(ALICE)).list?.contacts).toEqual([bob]);
    expect((await readContactCache(CAROL)).list?.contacts).toEqual([dave]);
  });

  it('replaces the list with a newer one from relays', async () => {
    await writeContactList(ALICE, { contacts: [bob], sourceCreatedAt: 100 });

    await expect(
      writeContactList(ALICE, { contacts: [bob, dave], sourceCreatedAt: 200 }, 9),
    ).resolves.toBe(true);

    expect((store.lists.get(ALICE) as CachedContactList).contacts).toEqual([bob, dave]);
  });

  it('keeps a newer published list when a slow relay answers with the old one', async () => {
    await writeContactList(
      ALICE,
      { contacts: [bob, dave], sourceEventId: 'new', sourceCreatedAt: 200 },
      1,
    );

    await expect(
      writeContactList(ALICE, { contacts: [bob], sourceEventId: 'old', sourceCreatedAt: 100 }, 7),
    ).resolves.toBe(false);

    const cached = store.lists.get(ALICE) as CachedContactList;
    expect(cached.contacts).toEqual([bob, dave]);
    expect(cached.sourceEventId).toBe('new');
    // Still marked as checked, so pages do not keep asking.
    expect(cached.fetchedAt).toBe(7);
  });

  it('keeps a known list when relays return none', async () => {
    await writeContactList(ALICE, { contacts: [bob], sourceCreatedAt: 100 });

    await expect(writeContactList(ALICE, { contacts: [] })).resolves.toBe(false);

    expect((store.lists.get(ALICE) as CachedContactList).contacts).toEqual([bob]);
  });

  it('records an account with no published list, so pages stop loading', async () => {
    await writeContactList(ALICE, { contacts: [] }, 3);

    expect(store.lists.get(ALICE)).toEqual({ accountPubkey: ALICE, contacts: [], fetchedAt: 3 });
  });
});

describe('writeContactList bounds (workspace#182)', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      pubkey: index.toString(16).padStart(64, '0'),
      relayUrl: '',
      petname: '',
    }));

  it('keeps at most the contact limit from any caller and marks the list truncated', async () => {
    await writeContactList(ALICE, {
      contacts: many(MAX_CONTACTS_PER_ACCOUNT + 5),
      sourceCreatedAt: 100,
    });

    const cached = store.lists.get(ALICE) as CachedContactList;
    expect(cached.contacts).toHaveLength(MAX_CONTACTS_PER_ACCOUNT);
    expect(cached.truncated).toBe(true);
  });

  it('stores the truncated mark a fetch reported', async () => {
    await writeContactList(ALICE, { contacts: [bob], sourceCreatedAt: 100, truncated: true });

    expect((store.lists.get(ALICE) as CachedContactList).truncated).toBe(true);
  });

  it('keeps the mark when a slow relay answers with an older list', async () => {
    await writeContactList(ALICE, { contacts: [bob], sourceCreatedAt: 200, truncated: true });

    await writeContactList(ALICE, { contacts: [dave], sourceCreatedAt: 100 });

    expect((store.lists.get(ALICE) as CachedContactList).truncated).toBe(true);
  });

  it('clears the mark when a newer list fits', async () => {
    await writeContactList(ALICE, { contacts: [bob], sourceCreatedAt: 100, truncated: true });

    await writeContactList(ALICE, { contacts: [bob, dave], sourceCreatedAt: 200 });

    expect(store.lists.get(ALICE)).not.toHaveProperty('truncated');
  });
});

describe('upsertProfiles', () => {
  it('stores profiles for the account', async () => {
    await upsertProfiles(ALICE, [profile(BOB, 'bob', 10)], 4);

    expect((await readContactCache(ALICE)).profiles).toEqual({ [BOB]: profile(BOB, 'bob', 10) });
    expect((store.profiles.get(`${ALICE}:${BOB}`) as CachedContactProfile).fetchedAt).toBe(4);
  });

  it('replaces an older profile and keeps a newer one', async () => {
    await upsertProfiles(ALICE, [profile(BOB, 'bob-old', 10), profile(DAVE, 'dave-new', 50)]);

    await upsertProfiles(ALICE, [profile(BOB, 'bob-new', 20), profile(DAVE, 'dave-old', 40)]);

    const { profiles } = await readContactCache(ALICE);
    expect(profiles[BOB]?.name).toBe('bob-new');
    expect(profiles[DAVE]?.name).toBe('dave-new');
  });

  it('keeps each account’s copy of a shared contact apart', async () => {
    await upsertProfiles(ALICE, [profile(BOB, 'bob', 10)]);

    expect((await readContactCache(CAROL)).profiles).toEqual({});
  });
});

describe('pruneProfiles and clearAccount', () => {
  it('drops profiles of people no longer followed', async () => {
    await upsertProfiles(ALICE, [profile(BOB, 'bob', 1), profile(DAVE, 'dave', 1)]);
    await upsertProfiles(CAROL, [profile(DAVE, 'dave', 1)]);

    await pruneProfiles(ALICE, [BOB]);

    expect(Object.keys((await readContactCache(ALICE)).profiles)).toEqual([BOB]);
    expect(Object.keys((await readContactCache(CAROL)).profiles)).toEqual([DAVE]);
  });

  it('forgets one account and nothing else', async () => {
    await writeContactList(ALICE, { contacts: [bob], sourceCreatedAt: 1 });
    await upsertProfiles(ALICE, [profile(BOB, 'bob', 1)]);
    await writeContactList(CAROL, { contacts: [dave], sourceCreatedAt: 1 });

    await clearAccount(ALICE);

    expect(await readContactCache(ALICE)).toEqual({ list: undefined, profiles: {} });
    expect((await readContactCache(CAROL)).list?.contacts).toEqual([dave]);
  });
});

describe('isStale', () => {
  it('treats a list as fresh within the TTL and stale after it', () => {
    expect(isStale(1000, 1000 + CONTACT_CACHE_TTL_MS - 1)).toBe(false);
    expect(isStale(1000, 1000 + CONTACT_CACHE_TTL_MS)).toBe(true);
  });
});
