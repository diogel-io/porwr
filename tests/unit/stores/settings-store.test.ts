import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import useSettingsStore from '@/stores/settings-store';
import { FALLBACK_RELAYS, storageService } from '@/services/storage-service';
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

  it('should add and remove profile search relays', async () => {
    const store = useSettingsStore();

    await store.addProfileSearchRelay('wss://profiles.example.com/');
    expect(store.profileSearchRelays).toContain('wss://profiles.example.com');

    await store.removeProfileSearchRelay('wss://profiles.example.com');
    expect(store.profileSearchRelays).not.toContain('wss://profiles.example.com');
  });
});
