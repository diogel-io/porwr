import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { ContactCacheSnapshot } from '@/services/contact-cache';

const mocks = vi.hoisted(() => ({
  observeContactCache: vi.fn(),
  requestContactRefresh: vi.fn(),
  listeners: new Map<string, (snapshot: ContactCacheSnapshot) => void>(),
  stops: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock('@/services/contact-cache', () => ({ observeContactCache: mocks.observeContactCache }));
vi.mock('@/services/contact-list-service', () => ({ requestContactRefresh: mocks.requestContactRefresh }));

import { useContactCache } from '@/composables/useContactCache';

const ALICE = 'a'.repeat(64);
const CAROL = 'c'.repeat(64);
const bob = { pubkey: 'b'.repeat(64), relayUrl: '', petname: 'Bob' };

const emit = (accountPubkey: string, snapshot: ContactCacheSnapshot) => mocks.listeners.get(accountPubkey)?.(snapshot);

const setup = (initial: string | undefined) => {
  const account = ref<string | undefined>(initial);
  const scope = effectScope();
  const cache = scope.run(() => useContactCache(account))!;
  return { account, scope, cache };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.stops.clear();
  mocks.requestContactRefresh.mockResolvedValue(undefined);
  mocks.observeContactCache.mockImplementation(
    (accountPubkey: string, onChange: (snapshot: ContactCacheSnapshot) => void) => {
      mocks.listeners.set(accountPubkey, onChange);
      const stop = vi.fn();
      mocks.stops.set(accountPubkey, stop);
      return stop;
    },
  );
});

describe('useContactCache', () => {
  it('is loading until the cache holds a list, then ready', () => {
    const { cache } = setup(ALICE);
    expect(cache.status.value).toBe('loading');

    emit(ALICE, { list: undefined, profiles: {} });
    expect(cache.status.value).toBe('loading');

    emit(ALICE, { list: { accountPubkey: ALICE, contacts: [bob], fetchedAt: 1 }, profiles: {} });
    expect(cache.status.value).toBe('ready');
    expect(cache.contacts.value).toEqual([bob]);
  });

  it('treats an empty list as ready, not loading', () => {
    const { cache } = setup(ALICE);

    emit(ALICE, { list: { accountPubkey: ALICE, contacts: [], fetchedAt: 1 }, profiles: {} });

    expect(cache.status.value).toBe('ready');
  });

  it('always has the background revalidate when it starts, however fresh the cache', () => {
    setup(ALICE);

    expect(mocks.requestContactRefresh).toHaveBeenCalledWith({ force: true });
  });

  it('drops the previous account’s contacts when the account changes', async () => {
    const { account, cache } = setup(ALICE);
    emit(ALICE, { list: { accountPubkey: ALICE, contacts: [bob], fetchedAt: 1 }, profiles: {} });

    account.value = CAROL;
    await nextTick();

    expect(mocks.stops.get(ALICE)).toHaveBeenCalled();
    expect(cache.contacts.value).toEqual([]);
    expect(cache.status.value).toBe('loading');
    expect(mocks.observeContactCache).toHaveBeenLastCalledWith(CAROL, expect.any(Function), expect.any(Function));
    expect(mocks.requestContactRefresh).toHaveBeenCalledTimes(2);

    // A late update for the old account is ignored.
    emit(ALICE, { list: { accountPubkey: ALICE, contacts: [bob], fetchedAt: 2 }, profiles: {} });
    expect(cache.contacts.value).toEqual([]);
  });

  it('is idle with no account and asks for nothing', () => {
    const { cache } = setup(undefined);

    expect(cache.status.value).toBe('idle');
    expect(mocks.observeContactCache).not.toHaveBeenCalled();
    expect(mocks.requestContactRefresh).not.toHaveBeenCalled();
  });

  it('forces a refresh on request and reports a failure', async () => {
    const { cache } = setup(ALICE);
    mocks.requestContactRefresh.mockRejectedValueOnce(new Error('Vault is locked'));

    await cache.refresh(true);

    expect(mocks.requestContactRefresh).toHaveBeenLastCalledWith({ force: true });
    expect(cache.error.value).toBe('Vault is locked');
  });

  it('stops watching when its scope ends', async () => {
    const { scope } = setup(ALICE);
    await flushPromises();

    scope.stop();

    expect(mocks.stops.get(ALICE)).toHaveBeenCalled();
  });
});
