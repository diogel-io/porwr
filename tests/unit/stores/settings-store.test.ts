import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { isProxy } from 'vue';
import useSettingsStore from '@/stores/settings-store';
import { FALLBACK_RELAYS, QUICK_PUBLISH_CLIENT_TAG, storageService } from '@/services/storage-service';
import {
  getStoredProfileSearchRelays,
  setStoredProfileSearchRelays,
} from '@/services/profile-search-relay-settings-service';
import { RELAY_SEEDS } from '@/data/relay-seeds';
import { PROFILE_SEARCH_RELAY_SEEDS } from '@/data/profile-search-relay-seeds';

// Mock storage service
vi.mock('@/services/storage-service', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    storageService: {
      getMultiple: vi.fn(),
      set: vi.fn(),
      onChanged: vi.fn(),
    },
  };
});

vi.mock('@/services/profile-search-relay-settings-service', () => ({
  getStoredProfileSearchRelays: vi.fn(),
  setStoredProfileSearchRelays: vi.fn(),
}));

describe('SettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(getStoredProfileSearchRelays).mockResolvedValue(undefined);
  });

  const DEFAULT_FALLBACK_RELAYS = RELAY_SEEDS;
  const DEFAULT_PROFILE_SEARCH_RELAYS = PROFILE_SEARCH_RELAY_SEEDS;

  it('should initialize with seeded default fallback relays', () => {
    const store = useSettingsStore();
    expect(store.fallbackRelays).toEqual(DEFAULT_FALLBACK_RELAYS);
  });

  it('should initialize with seeded default profile search relays', () => {
    const store = useSettingsStore();
    expect(store.profileSearchRelays).toEqual(DEFAULT_PROFILE_SEARCH_RELAYS);
  });

  it('leaves relay.nostr.band out of both default lists, as it no longer answers (#267)', () => {
    const store = useSettingsStore();
    expect(store.fallbackRelays).not.toContain('wss://relay.nostr.band');
    expect(store.profileSearchRelays).not.toContain('wss://relay.nostr.band');
  });

  it('should read stored fallback relays during getSettings', async () => {
    const storedRelays = ['wss://my-relay.com'];
    /* eslint-disable @typescript-eslint/unbound-method */
    vi.mocked(storageService.getMultiple).mockResolvedValue({
      [FALLBACK_RELAYS]: storedRelays,
    });

    const store = useSettingsStore();
    await store.getSettings();

    expect(store.fallbackRelays).toEqual(storedRelays);
    expect(storageService.getMultiple).toHaveBeenCalledWith(expect.arrayContaining([FALLBACK_RELAYS]));
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('should read stored profile search relays during getSettings', async () => {
    const storedRelays = ['wss://profiles.example.com/'];
    /* eslint-disable @typescript-eslint/unbound-method */
    vi.mocked(storageService.getMultiple).mockResolvedValue({
      [FALLBACK_RELAYS]: ['wss://my-relay.com'],
    });
    vi.mocked(getStoredProfileSearchRelays).mockResolvedValue(storedRelays);

    const store = useSettingsStore();
    await store.getSettings();

    expect(store.profileSearchRelays).toEqual(['wss://profiles.example.com']);
    expect(getStoredProfileSearchRelays).toHaveBeenCalled();
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('should survive repeated reads without mutation', async () => {
    const storedRelays = ['wss://my-relay.com'];
    /* eslint-disable @typescript-eslint/unbound-method */
    vi.mocked(storageService.getMultiple).mockResolvedValue({
      [FALLBACK_RELAYS]: storedRelays,
    });

    const store = useSettingsStore();
    await store.getSettings();
    expect(store.fallbackRelays).toEqual(storedRelays);

    // Second read
    await store.getSettings();
    expect(store.fallbackRelays).toEqual(storedRelays);
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('should handle empty or invalid stored values safely', async () => {
    /* eslint-disable @typescript-eslint/unbound-method */
    vi.mocked(storageService.getMultiple).mockResolvedValue({
      [FALLBACK_RELAYS]: [], // Empty list
    });

    const store = useSettingsStore();
    await store.getSettings();

    // Should keep default if stored is empty (as per implementation logic)
    expect(store.fallbackRelays).toEqual(DEFAULT_FALLBACK_RELAYS);

    vi.mocked(storageService.getMultiple).mockResolvedValue({
      [FALLBACK_RELAYS]: null, // Invalid value
    });

    await store.getSettings();
    expect(store.fallbackRelays).toEqual(DEFAULT_FALLBACK_RELAYS);
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('should handle empty profile search relay storage by using defaults', async () => {
    /* eslint-disable @typescript-eslint/unbound-method */
    vi.mocked(storageService.getMultiple).mockResolvedValue({
      [FALLBACK_RELAYS]: ['wss://my-relay.com'],
    });
    vi.mocked(getStoredProfileSearchRelays).mockResolvedValue([]);

    const store = useSettingsStore();
    await store.getSettings();

    expect(store.profileSearchRelays).toEqual(DEFAULT_PROFILE_SEARCH_RELAYS);
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('should update storage when setting fallback relays', async () => {
    const store = useSettingsStore();
    const newRelays = ['wss://new-relay.com'];

    await store.setFallbackRelays(newRelays);

    expect(store.fallbackRelays).toEqual(newRelays);
    /* eslint-disable @typescript-eslint/unbound-method */
    expect(storageService.set).toHaveBeenCalledWith(FALLBACK_RELAYS, newRelays);
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('should handle empty input for setFallbackRelays by reverting to defaults', async () => {
    const store = useSettingsStore();
    await store.setFallbackRelays([]);

    expect(store.fallbackRelays).toEqual(DEFAULT_FALLBACK_RELAYS);
    /* eslint-disable @typescript-eslint/unbound-method */
    expect(storageService.set).toHaveBeenCalledWith(FALLBACK_RELAYS, DEFAULT_FALLBACK_RELAYS);
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('should update storage when setting profile search relays', async () => {
    const store = useSettingsStore();
    const newRelays = ['wss://profiles.example.com/'];

    await store.setProfileSearchRelays(newRelays);

    expect(store.profileSearchRelays).toEqual(['wss://profiles.example.com']);
    /* eslint-disable @typescript-eslint/unbound-method */
    expect(setStoredProfileSearchRelays).toHaveBeenCalledWith(['wss://profiles.example.com']);
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('stores profile search relays as a plain array IndexedDB can clone (#263)', async () => {
    const store = useSettingsStore();

    await store.setProfileSearchRelays(['wss://profiles.example.com/']);
    await store.setProfileSearchRelays([]);

    const written = vi.mocked(setStoredProfileSearchRelays).mock.calls.map(([relays]) => relays);
    expect(written).toEqual([['wss://profiles.example.com'], DEFAULT_PROFILE_SEARCH_RELAYS]);
    expect(written.some((relays) => isProxy(relays))).toBe(false);
  });

  it('should add and remove profile search relays', async () => {
    const store = useSettingsStore();

    await store.addProfileSearchRelay('wss://profiles.example.com/');
    expect(store.profileSearchRelays).toContain('wss://profiles.example.com');

    await store.removeProfileSearchRelay('wss://profiles.example.com');
    expect(store.profileSearchRelays).not.toContain('wss://profiles.example.com');
  });

  describe('the Quick Publish client tag setting (#226)', () => {
    /* eslint-disable @typescript-eslint/unbound-method */
    it('is on by default, and stays on when nothing is stored', async () => {
      const store = useSettingsStore();
      expect(store.quickPublishClientTag).toBe(true);

      vi.mocked(storageService.getMultiple).mockResolvedValue({});
      await store.getSettings();

      expect(store.quickPublishClientTag).toBe(true);
      expect(storageService.getMultiple).toHaveBeenCalledWith(expect.arrayContaining([QUICK_PUBLISH_CLIENT_TAG]));
    });

    it('reads a stored false as off, and anything else as on', async () => {
      const store = useSettingsStore();

      vi.mocked(storageService.getMultiple).mockResolvedValue({ [QUICK_PUBLISH_CLIENT_TAG]: false });
      await store.getSettings();
      expect(store.quickPublishClientTag).toBe(false);

      vi.mocked(storageService.getMultiple).mockResolvedValue({ [QUICK_PUBLISH_CLIENT_TAG]: true });
      await store.getSettings();
      expect(store.quickPublishClientTag).toBe(true);
    });

    it('stores the choice so it survives a restart', async () => {
      const store = useSettingsStore();

      await store.setQuickPublishClientTag(false);

      expect(store.quickPublishClientTag).toBe(false);
      expect(storageService.set).toHaveBeenCalledWith(QUICK_PUBLISH_CLIENT_TAG, false);
    });

    it('follows a change made in another surface', () => {
      const store = useSettingsStore();
      store.listenToStorageChanges();
      const listener = vi.mocked(storageService.onChanged).mock.calls[0]![0];

      listener({ [QUICK_PUBLISH_CLIENT_TAG]: { newValue: false } }, 'local');
      expect(store.quickPublishClientTag).toBe(false);

      listener({ [QUICK_PUBLISH_CLIENT_TAG]: { newValue: true } }, 'local');
      expect(store.quickPublishClientTag).toBe(true);
    });
    /* eslint-enable @typescript-eslint/unbound-method */
  });
});
