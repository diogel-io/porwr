import { acceptHMRUpdate, defineStore } from 'pinia';
import {
  BLOSSOM_SERVER,
  DARK_MODE,
  FALLBACK_RELAYS,
  REQUEST_EXPIRY_MINUTES,
  storageService,
  VAULT_AUTO_LOCK_MINUTES,
} from '@/services/storage-service';
import {
  clampRequestExpiryMinutes,
  REQUEST_EXPIRY_DEFAULT_MINUTES,
} from '@/services/request-expiry';
import { RELAY_SEEDS } from '@/data/relay-seeds';
import { PROFILE_SEARCH_RELAY_SEEDS } from '@/data/profile-search-relay-seeds';
import { normalizeRelayUrl } from '@/services/relay-url';
import {
  getStoredProfileSearchRelays,
  setStoredProfileSearchRelays,
} from '@/services/profile-search-relay-settings-service';

const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net/';
const DEFAULT_VAULT_AUTO_LOCK_MINUTES = 15;
const DEFAULT_FALLBACK_RELAYS = RELAY_SEEDS;
const DEFAULT_PROFILE_SEARCH_RELAYS = PROFILE_SEARCH_RELAY_SEEDS;

function normalizeRelayList(relays: string[]): string[] {
  const normalized = relays
    .map((relay) => normalizeRelayUrl(relay))
    .filter((result): result is { valid: true; url: string; hostname?: string } => result.valid && typeof result.url === 'string')
    .map((result) => result.url);

  return Array.from(new Set(normalized));
}

const useSettingsStore = defineStore('settings', {
  state: () => ({
    blossomServer: DEFAULT_BLOSSOM_SERVER,
    darkMode: true, // Default to dark mode as per current observed behavior
    vaultAutoLockMinutes: DEFAULT_VAULT_AUTO_LOCK_MINUTES,
    requestExpiryMinutes: REQUEST_EXPIRY_DEFAULT_MINUTES,
    fallbackRelays: DEFAULT_FALLBACK_RELAYS,
    profileSearchRelays: DEFAULT_PROFILE_SEARCH_RELAYS,
    isListening: false,
  }),

  actions: {
    async getFallbackRelays(): Promise<string[]> {
      if (this.fallbackRelays.length === 0) {
        await this.getSettings();
      }
      return this.fallbackRelays;
    },

    async getProfileSearchRelays(): Promise<string[]> {
      if (this.profileSearchRelays.length === 0) {
        await this.getSettings();
      }
      return this.profileSearchRelays;
    },

    async getSettings(): Promise<void> {
      const result = await storageService.getMultiple([
        BLOSSOM_SERVER,
        DARK_MODE,
        VAULT_AUTO_LOCK_MINUTES,
        REQUEST_EXPIRY_MINUTES,
        FALLBACK_RELAYS,
      ]);
      if (result[BLOSSOM_SERVER] && typeof result[BLOSSOM_SERVER] === 'string') {
        this.blossomServer = result[BLOSSOM_SERVER];
      }
      if (Object.prototype.hasOwnProperty.call(result, DARK_MODE)) {
        this.darkMode = Boolean(result[DARK_MODE]);
      }
      if (Object.prototype.hasOwnProperty.call(result, VAULT_AUTO_LOCK_MINUTES)) {
        const value = Number(result[VAULT_AUTO_LOCK_MINUTES]);
        this.vaultAutoLockMinutes = Number.isFinite(value)
          ? Math.max(0, Math.floor(value))
          : DEFAULT_VAULT_AUTO_LOCK_MINUTES;
      }
      if (Object.prototype.hasOwnProperty.call(result, REQUEST_EXPIRY_MINUTES)) {
        // Clamped on read as well as on write: the background applies the same clamp, and the
        // UI must never present a value the background would refuse (ADR D8).
        this.requestExpiryMinutes = clampRequestExpiryMinutes(result[REQUEST_EXPIRY_MINUTES]);
      }
      if (Array.isArray(result[FALLBACK_RELAYS]) && (result[FALLBACK_RELAYS] as unknown[]).length > 0) {
        this.fallbackRelays = result[FALLBACK_RELAYS] as string[];
      }
      let storedProfileSearchRelays: string[] | undefined;
      try {
        storedProfileSearchRelays = await getStoredProfileSearchRelays();
      } catch {
        storedProfileSearchRelays = undefined;
      }
      if (Array.isArray(storedProfileSearchRelays)) {
        const normalized = normalizeRelayList(storedProfileSearchRelays);
        this.profileSearchRelays = normalized.length > 0 ? normalized : DEFAULT_PROFILE_SEARCH_RELAYS;
      }
    },

    async setBlossomServer(url: string): Promise<void> {
      this.blossomServer = url;
      await storageService.set(BLOSSOM_SERVER, url);
    },

    async setDarkMode(dark: boolean): Promise<void> {
      this.darkMode = dark;
      await storageService.set(DARK_MODE, dark);
    },

    async setVaultAutoLockMinutes(minutes: number): Promise<void> {
      const normalized = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
      this.vaultAutoLockMinutes = normalized;
      await storageService.set(VAULT_AUTO_LOCK_MINUTES, normalized);
    },

    async setRequestExpiryMinutes(minutes: number): Promise<void> {
      const normalized = clampRequestExpiryMinutes(minutes);
      this.requestExpiryMinutes = normalized;
      await storageService.set(REQUEST_EXPIRY_MINUTES, normalized);
    },

    async setFallbackRelays(relays: string[]): Promise<void> {
      const filtered = Array.isArray(relays) ? normalizeRelayList(relays) : [];
      if (filtered.length === 0) {
        this.fallbackRelays = DEFAULT_FALLBACK_RELAYS;
      } else {
        this.fallbackRelays = filtered;
      }
      await storageService.set(FALLBACK_RELAYS, this.fallbackRelays);
    },

    async setProfileSearchRelays(relays: string[]): Promise<void> {
      const filtered = Array.isArray(relays) ? normalizeRelayList(relays) : [];
      this.profileSearchRelays = filtered.length > 0 ? filtered : DEFAULT_PROFILE_SEARCH_RELAYS;
      await setStoredProfileSearchRelays(this.profileSearchRelays);
    },

    async addProfileSearchRelay(relay: string): Promise<void> {
      const normalized = normalizeRelayList([...this.profileSearchRelays, relay]);
      if (normalized.length === 0) {
        throw new Error('Invalid relay URL.');
      }
      await this.setProfileSearchRelays(normalized);
    },

    async removeProfileSearchRelay(relay: string): Promise<void> {
      await this.setProfileSearchRelays(this.profileSearchRelays.filter((item) => item !== relay));
    },

    listenToStorageChanges() {
      if (this.isListening) return;

      storageService.onChanged((changes, areaName) => {
        if (areaName === 'local') {
          if (BLOSSOM_SERVER in changes) {
            const newValue = changes[BLOSSOM_SERVER].newValue;
            if (typeof newValue === 'string' && newValue.length > 0) {
              this.blossomServer = newValue;
            }
          }
          if (DARK_MODE in changes) {
            const newValue = changes[DARK_MODE].newValue;
            this.darkMode = typeof newValue === 'boolean' ? newValue : Boolean(newValue);
          }
          if (VAULT_AUTO_LOCK_MINUTES in changes) {
            const newValue = Number(changes[VAULT_AUTO_LOCK_MINUTES].newValue);
            this.vaultAutoLockMinutes = Number.isFinite(newValue)
              ? Math.max(0, Math.floor(newValue))
              : DEFAULT_VAULT_AUTO_LOCK_MINUTES;
          }
          if (FALLBACK_RELAYS in changes) {
            const newValue = changes[FALLBACK_RELAYS].newValue;
            if (Array.isArray(newValue) && newValue.length > 0) {
              this.fallbackRelays = normalizeRelayList(newValue as string[]);
            } else {
              this.fallbackRelays = DEFAULT_FALLBACK_RELAYS;
            }
          }
        }
      });

      this.isListening = true;
    },
  },
});

export default useSettingsStore;

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      acceptHMRUpdate(useSettingsStore, import.meta.hot)(newModule);
    }
  });
}
