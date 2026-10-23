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
  bindPendingNip47AuthorizationPopup,
  clearPendingNip47Authorizations,
  findPendingNip47AuthorizationByPopup,
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

    it('binds nothing once the authorization is gone or expired', async () => {
      expect(await bindPendingNip47AuthorizationPopup('missing', popup, NOW)).toBe(false);

      await savePendingNip47Authorization(entry('a'), NOW);
      const later = NOW + PENDING_AUTHORIZATION_TTL_MS + 1;
      expect(await bindPendingNip47AuthorizationPopup('a', popup, later)).toBe(false);
      expect(await findPendingNip47AuthorizationByPopup({ windowId: 7 }, later)).toBeNull();
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
