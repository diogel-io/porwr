import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('@/services/storage-service', () => ({
  NIP47_PENDING_AUTHORIZATIONS_KEY: 'nip47:pending-authorizations',
  storageService: {
    get: vi.fn((key: string, area: string) => {
      expect([key, area]).toEqual(['nip47:pending-authorizations', 'session']);
      return Promise.resolve(session.value);
    }),
    set: vi.fn((_key: string, value: unknown, area: string) => {
      expect(area).toBe('session');
      session.value = structuredClone(value);
      return Promise.resolve();
    }),
    remove: vi.fn((_key: string, area: string) => {
      expect(area).toBe('session');
      session.value = undefined;
      return Promise.resolve();
    }),
  },
}));

import {
  PENDING_AUTHORIZATION_TTL_MS,
  CLAIMED_AUTHORIZATION_GRACE_MS,
  bindPendingNip47AuthorizationPopup,
  claimPendingNip47Authorization,
  clearPendingNip47Authorizations,
  findPendingNip47AuthorizationByPopup,
  onExpiredPendingNip47Popups,
  savePendingNip47Authorization,
  takePendingNip47Authorization,
} from '@/../src-bex/services/nip47-pending-authorization-store';

const entry = (pendingId: string) => ({
  pendingId,
  accountPubkey: 'a'.repeat(64),
  providerId: 'coinos' as const,
  origin: 'https://coinos.io',
  clientSecret: 'f'.repeat(64),
  clientPubkey: 'c'.repeat(64),
});

const NOW = 1_800_000_000_000;

beforeEach(() => {
  session.value = undefined;
});

describe('nip47 pending authorization store', () => {
  it('keeps a saved authorization in session storage with an expiry', async () => {
    const saved = await savePendingNip47Authorization(entry('a'), NOW);

    expect(saved).toMatchObject({
      pendingId: 'a',
      createdAt: NOW,
      expiresAt: NOW + PENDING_AUTHORIZATION_TTL_MS,
    });
    expect(session.value).toEqual([saved]);
  });

  it('hands an authorization out once', async () => {
    await savePendingNip47Authorization(entry('a'), NOW);

    expect(await takePendingNip47Authorization('a', NOW + 1)).toMatchObject({ pendingId: 'a' });
    expect(await takePendingNip47Authorization('a', NOW + 2)).toBeNull();
    expect(session.value).toBeUndefined();
  });

  it('refuses and discards an expired authorization', async () => {
    await savePendingNip47Authorization(entry('a'), NOW);

    expect(await takePendingNip47Authorization('a', NOW + PENDING_AUTHORIZATION_TTL_MS)).toBeNull();
    expect(session.value).toBeUndefined();
  });

  it('returns null for an unknown id without touching the others', async () => {
    await savePendingNip47Authorization(entry('a'), NOW);

    expect(await takePendingNip47Authorization('missing', NOW)).toBeNull();
    expect(session.value).toEqual([expect.objectContaining({ pendingId: 'a' })]);
  });

  it('drops expired entries and keeps only the newest five', async () => {
    await savePendingNip47Authorization(entry('old'), NOW - PENDING_AUTHORIZATION_TTL_MS - 1);
    for (const id of ['1', '2', '3', '4', '5', '6']) {
      await savePendingNip47Authorization(entry(id), NOW);
    }

    expect((session.value as Array<{ pendingId: string }>).map((item) => item.pendingId)).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('never pushes out an entry that is being settled (workspace#85)', async () => {
    const onEvicted = vi.fn();
    for (const id of ['1', '2', '3', '4', '5']) {
      await savePendingNip47Authorization(entry(id), NOW);
    }
    await claimPendingNip47Authorization('1', NOW);

    await savePendingNip47Authorization(entry('6'), NOW, onEvicted);

    expect(onEvicted.mock.calls[0]![0]).toEqual([expect.objectContaining({ pendingId: '2' })]);
    expect((session.value as Array<{ pendingId: string }>).map((item) => item.pendingId)).toEqual([
      '1',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('says which unexpired entries it pushed out, and none when there was room (workspace#85)', async () => {
    const onEvicted = vi.fn();
    await savePendingNip47Authorization(entry('old'), NOW - PENDING_AUTHORIZATION_TTL_MS - 1);
    for (const id of ['1', '2', '3', '4', '5']) {
      await savePendingNip47Authorization(entry(id), NOW, onEvicted);
    }
    // The expired entry was dropped, not evicted.
    expect(onEvicted).not.toHaveBeenCalled();

    await savePendingNip47Authorization(entry('6'), NOW, onEvicted);

    expect(onEvicted).toHaveBeenCalledOnce();
    expect(onEvicted.mock.calls[0]![0]).toEqual([expect.objectContaining({ pendingId: '1' })]);
  });

  it('treats unreadable storage as empty', async () => {
    session.value = 'corrupt';

    expect(await takePendingNip47Authorization('a', NOW)).toBeNull();
  });

  it('clears every pending authorization, so none can be completed afterwards (#142)', async () => {
    await savePendingNip47Authorization(entry('one'), NOW);
    await savePendingNip47Authorization(entry('two'), NOW);

    const cleared = await clearPendingNip47Authorizations();

    expect(cleared.map((item) => item.pendingId)).toEqual(['one', 'two']);
    expect(session.value).toBeUndefined();
    expect(await takePendingNip47Authorization('one', NOW)).toBeNull();
    expect(await takePendingNip47Authorization('two', NOW)).toBeNull();
  });

  it('hands an authorization to only one of two takes that overlap (workspace#85)', async () => {
    await savePendingNip47Authorization(entry('a'), NOW);

    const [first, second] = await Promise.all([
      takePendingNip47Authorization('a', NOW),
      takePendingNip47Authorization('a', NOW),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  describe('a popup the background opened (workspace#85)', () => {
    const popup = { windowId: 7, tabId: 70, requestId: 'req-1' };

    it('binds a popup to its authorization and finds it by window or tab without taking it', async () => {
      await savePendingNip47Authorization(entry('a'), NOW);
      await savePendingNip47Authorization(entry('b'), NOW);

      expect(await bindPendingNip47AuthorizationPopup('a', popup, NOW)).toBe(true);

      expect(await findPendingNip47AuthorizationByPopup({ windowId: 7 }, NOW)).toMatchObject({
        pendingId: 'a',
        popup,
      });
      expect(await findPendingNip47AuthorizationByPopup({ tabId: 70 }, NOW)).toMatchObject({
        pendingId: 'a',
      });
      expect(await findPendingNip47AuthorizationByPopup({ tabId: 71 }, NOW)).toBeNull();
      // Still there: finding is not taking.
      expect(await takePendingNip47Authorization('a', NOW)).toMatchObject({ popup });
    });

    it('claims an authorization once, keeps it stored, and gives it time to settle', async () => {
      await savePendingNip47Authorization(entry('a'), NOW);
      await bindPendingNip47AuthorizationPopup('a', popup, NOW);
      const nearExpiry = NOW + PENDING_AUTHORIZATION_TTL_MS - 1;

      const [first, second] = await Promise.all([
        claimPendingNip47Authorization('a', nearExpiry),
        claimPendingNip47Authorization('a', nearExpiry),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
      const claimed = first ?? second;
      expect(claimed).toMatchObject({ claimed: true, popup });
      expect(claimed!.expiresAt).toBe(nearExpiry + CLAIMED_AUTHORIZATION_GRACE_MS);
      // Still stored, so a restarted background can find it by its popup.
      expect(
        await findPendingNip47AuthorizationByPopup({ requestId: 'req-1' }, nearExpiry + 1),
      ).toMatchObject({ claimed: true });
      expect(await takePendingNip47Authorization('a', nearExpiry + 1)).toMatchObject({
        claimed: true,
      });
    });

    it('lets a cancel remove an entry only while it is unclaimed', async () => {
      await savePendingNip47Authorization(entry('a'), NOW);
      await claimPendingNip47Authorization('a', NOW);

      expect(
        await takePendingNip47Authorization('a', NOW, { when: (item) => !item.claimed }),
      ).toBeNull();
      // Still there for the path settling it.
      expect(await takePendingNip47Authorization('a', NOW)).toMatchObject({ claimed: true });
    });

    it('lets a claim left by a restarted background be taken over, and no other', async () => {
      await savePendingNip47Authorization(entry('a'), NOW);
      await claimPendingNip47Authorization('a', NOW);

      expect(await claimPendingNip47Authorization('a', NOW, () => false)).toBeNull();
      expect(await claimPendingNip47Authorization('a', NOW, () => true)).toMatchObject({
        pendingId: 'a',
        claimed: true,
      });
    });

    it('binds nothing once the authorization is gone or expired', async () => {
      expect(await bindPendingNip47AuthorizationPopup('missing', popup, NOW)).toBe(false);

      await savePendingNip47Authorization(entry('a'), NOW);
      const later = NOW + PENDING_AUTHORIZATION_TTL_MS + 1;
      expect(await bindPendingNip47AuthorizationPopup('a', popup, later)).toBe(false);
      expect(await findPendingNip47AuthorizationByPopup({ windowId: 7 }, later)).toBeNull();
    });

    it('reports an expired authorization that owned a popup when a write drops it', async () => {
      const onExpired = vi.fn();
      onExpiredPendingNip47Popups(onExpired);
      await savePendingNip47Authorization(entry('a'), NOW);
      await bindPendingNip47AuthorizationPopup('a', popup, NOW);
      await savePendingNip47Authorization(entry('b'), NOW);
      expect(onExpired).not.toHaveBeenCalled();

      const later = NOW + PENDING_AUTHORIZATION_TTL_MS + 1;
      // Still stored until a write drops it, and cancelling can find it meanwhile.
      expect(
        await findPendingNip47AuthorizationByPopup({ requestId: 'req-1' }, later, {
          includeExpired: true,
        }),
      ).toMatchObject({ pendingId: 'a' });
      await takePendingNip47Authorization('missing', later);

      expect(onExpired).toHaveBeenCalledOnce();
      expect(onExpired.mock.calls[0]![0]).toEqual([expect.objectContaining({ pendingId: 'a' })]);
      onExpiredPendingNip47Popups(() => undefined);
    });

    it('does not find an expired authorization by its popup', async () => {
      await savePendingNip47Authorization(entry('a'), NOW);
      await bindPendingNip47AuthorizationPopup('a', popup, NOW);

      expect(
        await findPendingNip47AuthorizationByPopup(
          { windowId: 7 },
          NOW + PENDING_AUTHORIZATION_TTL_MS + 1,
        ),
      ).toBeNull();
    });
  });
});
