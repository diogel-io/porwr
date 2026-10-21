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
  clearPendingNip47Authorizations,
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

    await clearPendingNip47Authorizations();

    expect(session.value).toBeUndefined();
    expect(await takePendingNip47Authorization('one', NOW)).toBeNull();
    expect(await takePendingNip47Authorization('two', NOW)).toBeNull();
  });
});
