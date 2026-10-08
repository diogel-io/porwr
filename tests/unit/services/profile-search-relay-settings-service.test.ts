import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock('@/services/database', () => ({
  db: {
    appSettings: {
      get: databaseMocks.get,
      put: databaseMocks.put,
    },
  },
}));

const {
  PROFILE_SEARCH_RELAYS_SETTING_KEY,
  getStoredProfileSearchRelays,
  setStoredProfileSearchRelays,
} = await import('@/services/profile-search-relay-settings-service');

describe('profile-search-relay-settings-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads stored profile search relays from IndexedDB settings', async () => {
    databaseMocks.get.mockResolvedValue({
      key: PROFILE_SEARCH_RELAYS_SETTING_KEY,
      value: ['wss://profiles.example.com'],
      updatedAt: '2026-06-13T19:00:00.000Z',
    });

    await expect(getStoredProfileSearchRelays()).resolves.toEqual(['wss://profiles.example.com']);
    expect(databaseMocks.get).toHaveBeenCalledWith(PROFILE_SEARCH_RELAYS_SETTING_KEY);
  });

  it('returns undefined for missing or invalid stored values', async () => {
    databaseMocks.get.mockResolvedValueOnce(undefined);
    await expect(getStoredProfileSearchRelays()).resolves.toBeUndefined();

    databaseMocks.get.mockResolvedValueOnce({
      key: PROFILE_SEARCH_RELAYS_SETTING_KEY,
      value: ['wss://valid.example.com', 42],
      updatedAt: '2026-06-13T19:00:00.000Z',
    });
    await expect(getStoredProfileSearchRelays()).resolves.toBeUndefined();
  });

  it('writes profile search relays to IndexedDB settings', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T19:00:00.000Z'));

    await setStoredProfileSearchRelays(['wss://profiles.example.com']);

    expect(databaseMocks.put).toHaveBeenCalledWith({
      key: PROFILE_SEARCH_RELAYS_SETTING_KEY,
      value: ['wss://profiles.example.com'],
      updatedAt: '2026-06-13T19:00:00.000Z',
    });

    vi.useRealTimers();
  });
});
