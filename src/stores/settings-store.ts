import { acceptHMRUpdate, defineStore } from 'pinia';
import {
  BLOSSOM_SERVER,
  DARK_MODE,
  FALLBACK_RELAYS,
  QUICK_PUBLISH_CLIENT_TAG,
  REQUEST_EXPIRY_MINUTES,
  storageService,
} from '@/services/storage-service';
import {
  clampRequestExpiryMinutes,
  REQUEST_EXPIRY_DEFAULT_MINUTES,
} from '@/services/request-expiry';
import { RELAY_SEEDS } from '@/data/relay-seeds';
import { AUTO_LOCK_DEFAULT_MINUTES, clampAutoLockMinutes } from '@/services/auto-lock-minutes';
import {
  getProtected,
  PROTECTED_AUTO_LOCK_MINUTES,
  setProtected,
} from '@/services/protected-settings';
import { PROFILE_SEARCH_RELAY_SEEDS } from '@/data/profile-search-relay-seeds';
import { RELAY_PROTOCOL_ERROR, normalizeRelayUrl } from '@/services/relay-url';
import { LogLevel, logService } from '@/services/log-service';
import { normalizeBlossomServer } from '@/services/blossom-server';
import {
  getStoredProfileSearchRelays,
  setStoredProfileSearchRelays,
} from '@/services/profile-search-relay-settings-service';

const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net/';
const DEFAULT_FALLBACK_RELAYS = RELAY_SEEDS;
const DEFAULT_PROFILE_SEARCH_RELAYS = PROFILE_SEARCH_RELAY_SEEDS;

function normalizeRelayList(relays: string[]): string[] {
  const results = relays.map((relay) => normalizeRelayUrl(relay));
  results.forEach((result, index) => {
    if (result.error !== RELAY_PROTOCOL_ERROR) return;
    // Saved before relays had to be wss:// (diogel-io/workspace#142). The host only, never the URL.
    let host = 'unparseable';
    try {
      host = new URL(relays[index]!.trim()).hostname;
    } catch {
      // keep the placeholder
    }
    logService.log(LogLevel.INFO, '[settings] Dropped a stored plaintext ws:// relay', { host });
  });
  const normalized = results
    .filter(
      (result): result is { valid: true; url: string; hostname?: string } =>
        result.valid && typeof result.url === 'string',
    )
    .map((result) => result.url);

  return Array.from(new Set(normalized));
}

const useSettingsStore = defineStore('settings', {
  state: () => ({
    blossomServer: DEFAULT_BLOSSOM_SERVER,
    darkMode: true, // Default to dark mode as per current observed behavior
    vaultAutoLockMinutes: AUTO_LOCK_DEFAULT_MINUTES,
    requestExpiryMinutes: REQUEST_EXPIRY_DEFAULT_MINUTES,
    fallbackRelays: DEFAULT_FALLBACK_RELAYS,
    profileSearchRelays: DEFAULT_PROFILE_SEARCH_RELAYS,
    // NIP-89 client tag on Quick Publish notes. On by default; only an explicit `false` turns it off.
    quickPublishClientTag: true,
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
        REQUEST_EXPIRY_MINUTES,
        FALLBACK_RELAYS,
        QUICK_PUBLISH_CLIENT_TAG,
      ]);
      if (result[BLOSSOM_SERVER] && typeof result[BLOSSOM_SERVER] === 'string') {
        // A server saved before uploads had to be https:// falls back to the default (T21).
        const stored = normalizeBlossomServer(result[BLOSSOM_SERVER]);
        this.blossomServer = stored.valid && stored.url ? stored.url : DEFAULT_BLOSSOM_SERVER;
      }
      if (Object.prototype.hasOwnProperty.call(result, DARK_MODE)) {
        this.darkMode = Boolean(result[DARK_MODE]);
      }
      // Kept out of content-script storage, and clamped as the background clamps it (#140).
      this.vaultAutoLockMinutes = clampAutoLockMinutes(
        await getProtected<unknown>(PROTECTED_AUTO_LOCK_MINUTES),
      );
      if (Object.prototype.hasOwnProperty.call(result, REQUEST_EXPIRY_MINUTES)) {
        // Clamped on read as well as on write: the background applies the same clamp, and the
        // UI must never present a value the background would refuse (ADR D8).
        this.requestExpiryMinutes = clampRequestExpiryMinutes(result[REQUEST_EXPIRY_MINUTES]);
      }
      if (
        Array.isArray(result[FALLBACK_RELAYS]) &&
        (result[FALLBACK_RELAYS] as unknown[]).length > 0
      ) {
        const normalized = normalizeRelayList(result[FALLBACK_RELAYS] as string[]);
        this.fallbackRelays = normalized.length > 0 ? normalized : DEFAULT_FALLBACK_RELAYS;
      }
      this.quickPublishClientTag = result[QUICK_PUBLISH_CLIENT_TAG] !== false;
      let storedProfileSearchRelays: string[] | undefined;
      try {
        storedProfileSearchRelays = await getStoredProfileSearchRelays();
      } catch {
        storedProfileSearchRelays = undefined;
      }
      if (Array.isArray(storedProfileSearchRelays)) {
        const normalized = normalizeRelayList(storedProfileSearchRelays);
        this.profileSearchRelays =
          normalized.length > 0 ? normalized : DEFAULT_PROFILE_SEARCH_RELAYS;
      }
    },

    /** Saves an https:// Blossom server. Throws for anything else, and leaves the setting unchanged. */
    async setBlossomServer(url: string): Promise<void> {
      const result = normalizeBlossomServer(url);
      if (!result.valid || !result.url) {
        throw new Error(result.error ?? 'Enter a valid Blossom server URL');
      }
      this.blossomServer = result.url;
      await storageService.set(BLOSSOM_SERVER, result.url);
    },

    async setDarkMode(dark: boolean): Promise<void> {
      this.darkMode = dark;
      await storageService.set(DARK_MODE, dark);
    },

    async setQuickPublishClientTag(enabled: boolean): Promise<void> {
      this.quickPublishClientTag = enabled;
      await storageService.set(QUICK_PUBLISH_CLIENT_TAG, enabled);
    },

    async setVaultAutoLockMinutes(minutes: number): Promise<void> {
      const normalized = clampAutoLockMinutes(minutes);
      this.vaultAutoLockMinutes = normalized;
      await setProtected(PROTECTED_AUTO_LOCK_MINUTES, normalized);
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
      const next = filtered.length > 0 ? filtered : DEFAULT_PROFILE_SEARCH_RELAYS;
      this.profileSearchRelays = next;
      // A plain copy: IndexedDB cannot clone the store's reactive proxy (#263).
      await setStoredProfileSearchRelays([...next]);
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
            const changed = typeof newValue === 'string' ? normalizeBlossomServer(newValue) : null;
            if (changed?.valid && changed.url) {
              this.blossomServer = changed.url;
            }
          }
          if (DARK_MODE in changes) {
            const newValue = changes[DARK_MODE].newValue;
            this.darkMode = typeof newValue === 'boolean' ? newValue : Boolean(newValue);
          }
          if (QUICK_PUBLISH_CLIENT_TAG in changes) {
            this.quickPublishClientTag = changes[QUICK_PUBLISH_CLIENT_TAG].newValue !== false;
          }
          if (FALLBACK_RELAYS in changes) {
            const newValue = changes[FALLBACK_RELAYS].newValue;
            const normalized = Array.isArray(newValue)
              ? normalizeRelayList(newValue as string[])
              : [];
            if (normalized.length > 0) {
              this.fallbackRelays = normalized;
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
