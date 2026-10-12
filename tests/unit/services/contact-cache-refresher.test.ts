import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedContactList, ContactProfile } from '@/types/contact-list';

const mocks = vi.hoisted(() => ({
  list: undefined as CachedContactList | undefined,
  readContactList: vi.fn(),
  writeContactList: vi.fn(),
  upsertProfiles: vi.fn(),
  pruneProfiles: vi.fn(),
  isStale: vi.fn(),
  fetchContactListSnapshot: vi.fn(),
  fetchProfilesInBatches: vi.fn(),
  getFallbackRelays: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/services/contact-cache', () => ({
  readContactList: mocks.readContactList,
  writeContactList: mocks.writeContactList,
  upsertProfiles: mocks.upsertProfiles,
  pruneProfiles: mocks.pruneProfiles,
  isStale: mocks.isStale,
}));
vi.mock('@/services/contact-fetch', () => ({
  fetchContactListSnapshot: mocks.fetchContactListSnapshot,
  fetchProfilesInBatches: mocks.fetchProfilesInBatches,
}));
vi.mock('@/../src-bex/services/messaging-relays', () => ({ getFallbackRelays: mocks.getFallbackRelays }));
vi.mock('@/services/log-service', () => ({
  LogLevel: { WARN: 'WARN' },
  logService: { log: mocks.log },
}));

import { refreshContacts, refreshContactsInBackground } from '@/../src-bex/services/contact-cache-refresher';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const RELAYS = ['wss://relay.example'];
const bobProfile: ContactProfile = {
  pubkey: BOB, name: 'bob', displayName: '', about: '', picture: '', nip05: '', updatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list = undefined;
  mocks.readContactList.mockImplementation(() => Promise.resolve(mocks.list));
  mocks.writeContactList.mockImplementation((accountPubkey: string, snapshot: Omit<CachedContactList, 'accountPubkey' | 'fetchedAt'>) => {
    mocks.list = { accountPubkey, ...snapshot, fetchedAt: 1 };
    return Promise.resolve(true);
  });
  mocks.upsertProfiles.mockResolvedValue(undefined);
  mocks.pruneProfiles.mockResolvedValue(undefined);
  mocks.isStale.mockReturnValue(true);
  mocks.getFallbackRelays.mockResolvedValue(RELAYS);
  mocks.fetchContactListSnapshot.mockResolvedValue({
    contacts: [{ pubkey: BOB, relayUrl: '', petname: 'Bob' }],
    sourceEventId: 'e1',
    sourceCreatedAt: 100,
  });
  mocks.fetchProfilesInBatches.mockImplementation(
    async (_pool: unknown, _relays: string[], _pubkeys: string[], onBatch: (p: Record<string, ContactProfile>) => Promise<void>) => {
      await onBatch({ [BOB]: bobProfile });
      return { [BOB]: bobProfile };
    },
  );
});

describe('refreshContacts', () => {
  it('fills the cache: the list, then each batch of profiles, then prunes', async () => {
    await refreshContacts(ALICE);

    expect(mocks.fetchContactListSnapshot).toHaveBeenCalledWith(expect.anything(), RELAYS, ALICE);
    expect(mocks.writeContactList).toHaveBeenCalledWith(ALICE, expect.objectContaining({ sourceEventId: 'e1' }));
    expect(mocks.fetchProfilesInBatches).toHaveBeenCalledWith(expect.anything(), RELAYS, [BOB], expect.any(Function));
    expect(mocks.upsertProfiles).toHaveBeenCalledWith(ALICE, [bobProfile]);
    expect(mocks.pruneProfiles).toHaveBeenCalledWith(ALICE, [BOB]);
  });

  it('leaves a fresh cache alone', async () => {
    mocks.list = { accountPubkey: ALICE, contacts: [], fetchedAt: 1 };
    mocks.isStale.mockReturnValue(false);

    await refreshContacts(ALICE);

    expect(mocks.fetchContactListSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes a stale cache', async () => {
    mocks.list = { accountPubkey: ALICE, contacts: [], fetchedAt: 1 };

    await refreshContacts(ALICE);

    expect(mocks.fetchContactListSnapshot).toHaveBeenCalledTimes(1);
  });

  it('refreshes a fresh cache when forced', async () => {
    mocks.list = { accountPubkey: ALICE, contacts: [], fetchedAt: 1 };
    mocks.isStale.mockReturnValue(false);

    await refreshContacts(ALICE, { force: true });

    expect(mocks.fetchContactListSnapshot).toHaveBeenCalledTimes(1);
  });

  it('fetches profiles for the list the cache kept, not the one relays sent', async () => {
    const dave = 'd'.repeat(64);
    // A publish already stored a newer list; the relay's older answer loses.
    mocks.writeContactList.mockImplementation(() => {
      mocks.list = { accountPubkey: ALICE, contacts: [{ pubkey: dave, relayUrl: '', petname: '' }], fetchedAt: 1 };
      return Promise.resolve(false);
    });

    await refreshContacts(ALICE);

    expect(mocks.fetchProfilesInBatches).toHaveBeenCalledWith(expect.anything(), RELAYS, [dave], expect.any(Function));
  });

  it('shares one run between concurrent refreshes of the same account', async () => {
    await Promise.all([refreshContacts(ALICE), refreshContacts(ALICE), refreshContacts(ALICE)]);

    expect(mocks.fetchContactListSnapshot).toHaveBeenCalledTimes(1);

    await refreshContacts(ALICE);
    expect(mocks.fetchContactListSnapshot).toHaveBeenCalledTimes(2);
  });

  it('runs once more for a forced refresh that arrives mid-run, however many arrive', async () => {
    const first = refreshContacts(ALICE);
    const forced = [refreshContacts(ALICE, { force: true }), refreshContacts(ALICE, { force: true })];

    await Promise.all([first, ...forced]);

    expect(mocks.fetchContactListSnapshot).toHaveBeenCalledTimes(2);
  });

  it('runs separately for different accounts', async () => {
    const carol = 'c'.repeat(64);

    await Promise.all([refreshContacts(ALICE), refreshContacts(carol)]);

    expect(mocks.fetchContactListSnapshot).toHaveBeenCalledTimes(2);
  });
});

describe('refreshContactsInBackground', () => {
  it('logs a failure instead of throwing', async () => {
    mocks.getFallbackRelays.mockRejectedValue(new Error('storage unavailable'));

    expect(() => refreshContactsInBackground(ALICE)).not.toThrow();
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.anything()));
  });
});
